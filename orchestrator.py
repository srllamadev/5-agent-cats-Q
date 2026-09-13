import json
import os
import uuid
from datetime import datetime, timezone

from config import MAX_AUDIT_BUDGET_USD, OUTPUT_DIR, AGENT_BUDGETS
from agents.scanner_agent import ScannerAgent
from agents.economist_agent import EconomistAgent
from agents.compliance_agent import ComplianceAgent
from agents.hacker_agent import HackerAgent
from agents.base_agent import BaseAgent
from utils.ledger import AuditLedger
from utils.risk_calculator import calculate_risk_level, calculate_security_score
from utils.token_counter import count_tokens, estimate_cost


MANAGER_SYSTEM_PROMPT = """Eres el Orquestador Jefe (Manager) de un equipo de auditoría de smart contracts.
NO auditas código directamente. Tu trabajo es:
1. Consumir los micro-reportes JSON de 4 agentes (Escáner, Economista, Cumplimiento, Hacker).
2. Resolver conflictos entre hallazgos.
3. Calcular el securityScore (0-100) usando ISO 27004.
4. Generar el Informe Ejecutivo y el payload para el Dashboard.

REGLAS DE NO-ALUCINACIÓN:
- No inventes hallazgos que no estén en los micro-reportes.
- Si un dato falta, usa null y decláralo en el resumen.
- No cambies severidad sin justificar con "reason".
- Sé conciso: máximo 1500 tokens de salida.

Formato JSON obligatorio para el Informe Ejecutivo:
{
  "audit_id": "string",
  "fecha": "ISO-8601",
  "security_score": 0-100,
  "resumen_ejecutivo": "3-5 líneas claras",
  "hallazgos": [
    {
      "id": "string",
      "titulo": "string",
      "severidad": "critico|alto|medio|bajo|informativo",
      "probabilidad": "1-5|null",
      "impacto": "1-5|null",
      "riesgo_nivel": "bajo|medio|alto|critico|no_cuantificable",
      "control_iso27001": "A.x.x",
      "funcion_nist": "identify|protect|detect|respond|recover",
      "descripcion": "string",
      "poc_confirmado": true|false,
      "recomendacion": "string"
    }
  ],
  "matriz_riesgo": [{"hallazgo_id": "string", "x": "prob", "y": "impact"}],
  "cumplimiento": {
    "iso27001": "porcentaje",
    "nist_csf": {"identify": "...", "protect": "...", "detect": "...", "respond": "...", "recover": "..."}
  },
  "estado_pago": "liquidado|pendiente|parcial",
  "costo_auditoria_tokens": {"total_usd": 0.0, "detalle_por_agente": {}}
}

Y el payload del Dashboard:
{
  "kpis": {"security_score": 0-100, "hallazgos_criticos": 0, "hallazgos_altos": 0, "hallazgos_medios": 0, "hallazgos_bajos": 0},
  "grafico_matriz_riesgo": [],
  "grafico_cumplimiento_nist": {},
  "tabla_hallazgos": []
}"""


class Orchestrator:
    def __init__(self, audit_id: str = None):
        self.audit_id = audit_id or str(uuid.uuid4())[:8]
        self.ledger = AuditLedger(self.audit_id)
        self.scanner = ScannerAgent(self.ledger)
        self.economist = EconomistAgent(self.ledger)
        self.compliance = ComplianceAgent(self.ledger)
        self.hacker = HackerAgent(self.ledger)
        self.reports = {}
        self.is_partial = False

    async def run_audit(self, source_code: str, contract_name: str = "Unknown") -> dict:
        print(f"[{self.audit_id}] Iniciando auditoría para: {contract_name}")

        scanner_result = await self.scanner.scan(source_code, MAX_AUDIT_BUDGET_USD)
        self.reports["scanner"] = scanner_result

        if not scanner_result["success"]:
            print(f"[{self.audit_id}] Scanner falló: {scanner_result['error']}")
            self.reports["scanner"] = {"agent": "scanner", "success": False, "data": None}
            self.is_partial = True
            return self._build_partial_report()

        scanner_data = scanner_result.get("data", {})
        print(f"[{self.audit_id}] Scanner completado. {len(scanner_data.get('initial_vectors', []))} vectores encontrados.")

        fragments = self._extract_fragments(source_code, scanner_data)

        economist_result = await self.economist.analyze(
            fragments, scanner_data.get("initial_vectors", []), MAX_AUDIT_BUDGET_USD
        )
        self.reports["economist"] = economist_result
        print(f"[{self.audit_id}] Economista: {'OK' if economist_result['success'] else 'FAIL'}")

        compliance_result = await self.compliance.assess(fragments, MAX_AUDIT_BUDGET_USD)
        self.reports["compliance"] = compliance_result
        print(f"[{self.audit_id}] Cumplimiento: {'OK' if compliance_result['success'] else 'FAIL'}")

        vulnerable_fragments = self._extract_vulnerable_fragments(source_code, scanner_data)
        hacker_result = await self.hacker.attempt_exploit(
            vulnerable_fragments, scanner_data.get("initial_vectors", []), MAX_AUDIT_BUDGET_USD
        )
        self.reports["hacker"] = hacker_result
        print(f"[{self.audit_id}] Hacker R1: {'OK' if hacker_result['success'] else 'FAIL'}")

        if (hacker_result["success"] and hacker_result.get("data", {}).get("exploits")):
            needs_refinement = any(
                e.get("refinement_needed") for e in hacker_result["data"]["exploits"]
            )
            if needs_refinement and not self.ledger.is_over_budget(MAX_AUDIT_BUDGET_USD):
                refine_frags = self._extract_refinement_fragments(source_code, hacker_result["data"])
                hacker_r2 = await self.hacker.refine_exploit(hacker_result, refine_frags, MAX_AUDIT_BUDGET_USD)
                self.reports["hacker_r2"] = hacker_r2
                print(f"[{self.audit_id}] Hacker R2: {'OK' if hacker_r2['success'] else 'FAIL'}")

        if self.ledger.circuit_broken:
            self.is_partial = True
            print(f"[{self.audit_id}] Circuit breaker activado. Reporte parcial.")

        return self._synthesize_report(source_code, contract_name)

    def _extract_fragments(self, source_code: str, scanner_data: dict) -> dict:
        lines = source_code.split("\n")
        fragments = {}

        payable_lines = []
        for func in scanner_data.get("payable_functions", []):
            start = func.get("line", 1) - 1
            end = min(start + 20, len(lines))
            payable_lines.append("\n".join(lines[start:end]))
        fragments["payable_functions_code"] = "\n---\n".join(payable_lines) if payable_lines else ""

        transfer_lines = []
        for func in scanner_data.get("transfer_functions", []):
            start = func.get("line", 1) - 1
            end = min(start + 20, len(lines))
            transfer_lines.append("\n".join(lines[start:end]))
        fragments["transfer_functions_code"] = "\n---\n".join(transfer_lines) if transfer_lines else ""

        balance_vars = []
        for var in scanner_data.get("state_variables", []):
            if any(kw in var.get("type", "").lower() for kw in ["uint", "int", "mapping", "balance"]):
                start = var.get("line", 1) - 1
                end = min(start + 3, len(lines))
                balance_vars.append("\n".join(lines[start:end]))
        fragments["balance_variables_code"] = "\n".join(balance_vars) if balance_vars else ""

        constructor_lines = []
        for func in scanner_data.get("functions", []):
            if func.get("name") in ["constructor", "initialize"]:
                start = func.get("line", 1) - 1
                end = min(start + 30, len(lines))
                constructor_lines.append("\n".join(lines[start:end]))
        fragments["constructor_code"] = "\n---\n".join(constructor_lines) if constructor_lines else ""

        modifier_lines = []
        for mod in scanner_data.get("modifiers", []):
            start = mod.get("line", 1) - 1
            end = min(start + 10, len(lines))
            modifier_lines.append("\n".join(lines[start:end]))
        fragments["modifiers_code"] = "\n---\n".join(modifier_lines) if modifier_lines else ""

        state_var_lines = []
        for var in scanner_data.get("state_variables", []):
            start = var.get("line", 1) - 1
            end = min(start + 2, len(lines))
            state_var_lines.append("\n".join(lines[start:end]))
        fragments["state_variables_code"] = "\n".join(state_var_lines) if state_var_lines else ""

        access_funcs = []
        for func in scanner_data.get("functions", []):
            mods = func.get("modifiers", [])
            if any("only" in m.lower() or "auth" in m.lower() for m in mods):
                start = func.get("line", 1) - 1
                end = min(start + 20, len(lines))
                access_funcs.append("\n".join(lines[start:end]))
        fragments["access_control_functions"] = "\n---\n".join(access_funcs) if access_funcs else ""

        return fragments

    def _extract_vulnerable_fragments(self, source_code: str, scanner_data: dict) -> dict:
        lines = source_code.split("\n")
        fragments = {}

        for vector in scanner_data.get("initial_vectors", []):
            vec_lines = vector.get("lines", [])
            if vec_lines:
                start = max(0, min(vec_lines) - 5)
                end = min(len(lines), max(vec_lines) + 10)
                fragments[vector.get("type", "unknown")] = "\n".join(lines[start:end])

        for susp in scanner_data.get("suspicious_lines", []):
            line_num = susp.get("line", 1)
            start = max(0, line_num - 5)
            end = min(len(lines), line_num + 10)
            key = f"suspicious_{susp.get('type', 'unknown')}_{line_num}"
            fragments[key] = "\n".join(lines[start:end])

        return fragments

    def _extract_refinement_fragments(self, source_code: str, hacker_data: dict) -> str:
        lines = source_code.split("\n")
        extra = []
        for exploit in hacker_data.get("exploits", []):
            if exploit.get("refinement_needed"):
                for line in exploit.get("target_lines", []):
                    start = max(0, line - 5)
                    end = min(len(lines), line + 10)
                    extra.append("\n".join(lines[start:end]))
        return "\n---\n".join(extra)

    def _synthesize_report(self, source_code: str, contract_name: str) -> dict:
        scanner_data = self.reports.get("scanner", {}).get("data", {}) or {}
        economist_data = self.reports.get("economist", {}).get("data", {}) or {}
        compliance_data = self.reports.get("compliance", {}).get("data", {}) or {}
        hacker_data = self.reports.get("hacker", {}).get("data", {}) or {}
        hacker_r2_data = self.reports.get("hacker_r2", {}).get("data", {}) or {}

        if hacker_r2_data and "refined_exploits" in hacker_r2_data:
            for refined in hacker_r2_data["refined_exploits"]:
                for orig in hacker_data.get("exploits", []):
                    if orig.get("vector") == refined.get("vector"):
                        orig.update({
                            "poc_confirmed": refined.get("poc_confirmed", False),
                            "probability": refined.get("probability", orig.get("probability")),
                            "status": refined.get("status", orig.get("status")),
                        })

        findings = self._build_findings(scanner_data, economist_data, compliance_data, hacker_data)
        security_score = calculate_security_score(findings)

        cost_summary = self.ledger.get_summary()
        estado_pago = "parcial" if self.is_partial else "liquidado"

        resumen = self._build_resumen(findings, security_score, contract_name)

        executive_report = {
            "audit_id": self.audit_id,
            "fecha": datetime.now(timezone.utc).isoformat(),
            "security_score": security_score,
            "resumen_ejecutivo": resumen,
            "hallazgos": findings,
            "matriz_riesgo": [
                {"hallazgo_id": f["id"], "x": f["probabilidad"], "y": f["impacto"]}
                for f in findings if f["probabilidad"] is not None
            ],
            "cumplimiento": {
                "iso27001": f"{compliance_data.get('compliance_score_percent', 'N/A')}%",
                "nist_csf": compliance_data.get("nist_csf_mapping", {}),
            },
            "estado_pago": estado_pago,
            "costo_auditoria_tokens": cost_summary,
        }

        dashboard_payload = self._build_dashboard_payload(executive_report)

        report = {
            "executive_report": executive_report,
            "dashboard_payload": dashboard_payload,
            "agent_reports": {k: v for k, v in self.reports.items()},
        }

        self._save_report(report)
        self.ledger.save()

        return report

    def _build_findings(self, scanner_data: dict, economist_data: dict,
                        compliance_data: dict, hacker_data: dict) -> list:
        findings = []
        idx = 1

        vectors = scanner_data.get("initial_vectors", [])
        exploits = hacker_data.get("exploits", [])
        economic_impacts = economist_data.get("economic_impact", [])

        exploit_map = {}
        for e in exploits:
            exploit_map[e.get("vector", "")] = e

        impact_map = {}
        for ei in economic_impacts:
            impact_map[ei.get("vector", "")] = ei

        for vector in vectors:
            vtype = vector.get("type", "unknown")
            exploit = exploit_map.get(vtype, {})
            econ = impact_map.get(vtype, {})

            poc_confirmed = exploit.get("poc_confirmed", False)
            probability = exploit.get("probability", None)
            impact_level = econ.get("impact_level", None)

            if poc_confirmed:
                severity = self._severity_from_risk(probability, impact_level)
            else:
                severity = self._downgrade_severity(probability, impact_level)

            risk = calculate_risk_level(probability, impact_level)

            controls = compliance_data.get("iso27001_controls", [])
            control_id = self._find_relevant_control(vtype, controls)

            nist = compliance_data.get("nist_csf_mapping", {})
            nist_func = self._find_nist_function(vtype, nist)

            finding = {
                "id": f"F-{idx:03d}",
                "titulo": f"{vtype.replace('_', ' ').title()}",
                "severidad": severity,
                "probabilidad": probability,
                "impacto": impact_level,
                "riesgo_nivel": risk["level"],
                "control_iso27001": control_id,
                "funcion_nist": nist_func,
                "descripcion": vector.get("description", ""),
                "poc_confirmado": poc_confirmed,
                "recomendacion": self._get_recommendation(vtype, compliance_data),
            }

            if not poc_confirmed and probability is not None:
                finding["reason_severity_adjusted"] = "No PoC exploit confirmed by Hacker agent"

            findings.append(finding)
            idx += 1

        for bp in compliance_data.get("best_practices", []):
            if not bp.get("implemented"):
                findings.append({
                    "id": f"F-{idx:03d}",
                    "titulo": f"Best practice missing: {bp.get('practice', 'unknown')}",
                    "severidad": "bajo",
                    "probabilidad": 2,
                    "impacto": 2,
                    "riesgo_nivel": "bajo",
                    "control_iso27001": "A.14.2",
                    "funcion_nist": "protect",
                    "descripcion": f"Missing: {bp.get('practice', '')}",
                    "poc_confirmado": False,
                    "recomendacion": f"Implement {bp.get('practice', '')}",
                })
                idx += 1

        return findings

    def _severity_from_risk(self, probability: int, impact: int) -> str:
        if probability is None or impact is None:
            return "informativo"
        score = probability * impact
        if score >= 16:
            return "critico"
        elif score >= 10:
            return "alto"
        elif score >= 5:
            return "medio"
        else:
            return "bajo"

    def _downgrade_severity(self, probability: int, impact: int) -> str:
        base = self._severity_from_risk(probability, impact)
        downgrade = {"critico": "alto", "alto": "medio", "medio": "bajo", "bajo": "informativo", "informativo": "informativo"}
        return downgrade.get(base, "informativo")

    def _find_relevant_control(self, vector_type: str, controls: list) -> str:
        access_keywords = ["access", "owner", "auth", "reentrancy"]
        if any(k in vector_type.lower() for k in access_keywords):
            return "A.9.1"
        if "overflow" in vector_type.lower() or "arithmetic" in vector_type.lower():
            return "A.12.2"
        if "oracle" in vector_type.lower() or "manipulation" in vector_type.lower():
            return "A.12.1"
        return "A.14.2"

    def _find_nist_function(self, vector_type: str, nist_map: dict) -> str:
        if any(k in vector_type.lower() for k in ["access", "auth", "owner"]):
            return "protect"
        if any(k in vector_type.lower() for k in ["reentrancy", "overflow", "arithmetic"]):
            return "protect"
        if any(k in vector_type.lower() for k in ["oracle", "manipulation", "front"]):
            return "detect"
        return "identify"

    def _get_recommendation(self, vector_type: str, compliance_data: dict) -> str:
        recs = compliance_data.get("iso27002_recommendations", [])
        for rec in recs:
            if vector_type.lower() in rec.get("recommendation", "").lower():
                return rec["recommendation"]

        defaults = {
            "reentrancy": "Apply checks-effects-interactions pattern. Use ReentrancyGuard modifier (ISO 27002 A.14.2).",
            "overflow": "Use Solidity >=0.8.0 with built-in overflow checks. Add SafeMath if using <0.8.0 (ISO 27002 A.12.2).",
            "access_control": "Implement role-based access control with OpenZeppelin AccessControl. Use multisig for critical functions (ISO 27002 A.9.1).",
            "front_running": "Use commit-reveal scheme or private mempool. Add slippage protection (ISO 27002 A.12.1).",
            "oracle_manipulation": "Use decentralized oracle (Chainlink). Add TWAP and circuit breakers (ISO 27002 A.12.1).",
        }
        return defaults.get(vector_type.lower(), "Review and remediate according to ISO 27002 guidelines.")

    def _build_resumen(self, findings: list, score: int, contract_name: str) -> str:
        crit = sum(1 for f in findings if f["severidad"] == "critico")
        alto = sum(1 for f in findings if f["severidad"] == "alto")
        medio = sum(1 for f in findings if f["severidad"] == "medio")
        bajo = sum(1 for f in findings if f["severidad"] == "bajo")

        status = "seguro" if score >= 80 else "con riesgos moderados" if score >= 50 else "con riesgos significativos"

        resumen = (
            f"Auditoría de {contract_name} completada. Security Score: {score}/100 ({status}). "
            f"Se encontraron {len(findings)} hallazgos: {crit} críticos, {alto} altos, {medio} medios, {bajo} bajos. "
        )

        if self.is_partial:
            resumen += "NOTA: Esta auditoría es PARCIAL por límite de presupuesto de tokens. Algunos agentes no completaron su análisis."

        return resumen

    def _build_dashboard_payload(self, executive_report: dict) -> dict:
        findings = executive_report.get("hallazgos", [])
        return {
            "kpis": {
                "security_score": executive_report.get("security_score", 0),
                "hallazgos_criticos": sum(1 for f in findings if f["severidad"] == "critico"),
                "hallazgos_altos": sum(1 for f in findings if f["severidad"] == "alto"),
                "hallazgos_medios": sum(1 for f in findings if f["severidad"] == "medio"),
                "hallazgos_bajos": sum(1 for f in findings if f["severidad"] == "bajo"),
            },
            "grafico_matriz_riesgo": executive_report.get("matriz_riesgo", []),
            "grafico_cumplimiento_nist": executive_report.get("cumplimiento", {}).get("nist_csf", {}),
            "tabla_hallazgos": findings,
        }

    def _build_partial_report(self) -> dict:
        cost_summary = self.ledger.get_summary()
        return {
            "executive_report": {
                "audit_id": self.audit_id,
                "fecha": datetime.now(timezone.utc).isoformat(),
                "security_score": 0,
                "resumen_ejecutivo": "Auditoría interrumpida. El agente Escáner falló y no se pudo completar el análisis.",
                "hallazgos": [],
                "matriz_riesgo": [],
                "cumplimiento": {"iso27001": "N/A", "nist_csf": {}},
                "estado_pago": "parcial",
                "costo_auditoria_tokens": cost_summary,
            },
            "dashboard_payload": {
                "kpis": {"security_score": 0, "hallazgos_criticos": 0, "hallazgos_altos": 0, "hallazgos_medios": 0, "hallazgos_bajos": 0},
                "grafico_matriz_riesgo": [],
                "grafico_cumplimiento_nist": {},
                "tabla_hallazgos": [],
            },
            "agent_reports": {k: v for k, v in self.reports.items()},
        }

    def _save_report(self, report: dict):
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        filepath = os.path.join(OUTPUT_DIR, f"{self.audit_id}_report.json")
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2, ensure_ascii=False, default=str)

        dashboard_path = os.path.join(OUTPUT_DIR, f"{self.audit_id}_dashboard.json")
        with open(dashboard_path, "w", encoding="utf-8") as f:
            json.dump(report["dashboard_payload"], f, indent=2, ensure_ascii=False, default=str)

        print(f"[{self.audit_id}] Reporte guardado: {filepath}")
        print(f"[{self.audit_id}] Dashboard data: {dashboard_path}")
