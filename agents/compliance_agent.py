from agents.base_agent import BaseAgent
from utils.ledger import AuditLedger


COMPLIANCE_SYSTEM_PROMPT = """Eres el Agente Cumplimiento de un equipo de auditoría de smart contracts en Avalanche.
Tu tarea es evaluar el contrato contra marcos normativos de seguridad. Recibes SOLO: constructor, modifiers, variables de estado y funciones de control de acceso.

Tu micro-reporte JSON debe incluir:
1. Mapeo de controles ISO 27001 Anexo A aplicables (A.9 Gestión de acceso, A.12 Operaciones, A.14 Desarrollo).
2. Evaluación de segregación de funciones (onlyOwner, multisig, roles).
3. Mapeo a funciones NIST CSF (Identify, Protect, Detect, Respond, Recover).
4. Cumplimiento de buenas prácticas (checks-effects-interactions, Pausable, Upgradable patterns).
5. Recomendaciones basadas en ISO 27002.

REGLAS ESTRICTAS:
- Tu salida DEBE ser JSON válido, sin texto adicional.
- Usa nomenclatura formal exacta de los estándares.
- Sé conciso: máximo 700 tokens de salida.
- NO leas el contrato completo, solo los fragmentos de control.

Formato JSON obligatorio:
{
  "iso27001_controls": [{"control_id": "A.9.x|x.x", "description": "string", "compliant": true|false|partial, "evidence": "string"}],
  "access_control": {"has_owner": bool, "has_multisig": bool, "has_roles": bool, "segregation_assessment": "string"},
  "nist_csf_mapping": {"identify": ["string"], "protect": ["string"], "detect": ["string"], "respond": ["string"], "recover": ["string"]},
  "best_practices": [{"practice": "string", "implemented": bool, "lines": [int]}],
  "iso27002_recommendations": [{"recommendation": "string", "priority": "high|medium|low"}],
  "compliance_score_percent": 0-100
}"""


class ComplianceAgent(BaseAgent):
    def __init__(self, ledger: AuditLedger):
        super().__init__("compliance", ledger)

    async def assess(self, control_fragments: dict, max_budget_usd: float) -> dict:
        fragments_text = ""
        if "constructor_code" in control_fragments:
            fragments_text += "\nConstructor:\n" + control_fragments["constructor_code"]
        if "modifiers_code" in control_fragments:
            fragments_text += "\nModifiers:\n" + control_fragments["modifiers_code"]
        if "state_variables_code" in control_fragments:
            fragments_text += "\nVariables de estado:\n" + control_fragments["state_variables_code"]
        if "access_control_functions" in control_fragments:
            fragments_text += "\nFunciones de control de acceso:\n" + control_fragments["access_control_functions"]

        user_content = f"Evalúa el cumplimiento normativo de estos fragmentos del contrato:\n{fragments_text}"
        return await self.invoke(COMPLIANCE_SYSTEM_PROMPT, user_content, max_budget_usd)
