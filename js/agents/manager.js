// ============================================================
//  MANAGER.JS — Agent 5 (Orchestrator): Synthesis + Score + Report
//  Max output: 1500 tokens | Never reads source code directly
//  Implements: ISO 27001, 27002, 27004, 27005, NIST CSF, ISO 31000
//  Equipo de Auditoría Multi-Agente · Avalanche
// ============================================================

import { callLLM, extractJSON } from '../llm.js';
import { AGENT_BUDGETS } from '../config.js';

const BUDGET = AGENT_BUDGETS.manager;

// ── Score penalty table (ISO 27004) ──────────────────────────
const SEVERITY_PENALTIES = {
  critico:     25,
  alto:        15,
  medio:        7,
  bajo:         2,
  informativo:  0,
};

// ── Risk matrix (ISO 31000 / ISO 27005) ──────────────────────
function calcRiskLevel(prob, impact) {
  if (prob == null || impact == null) return 'no_cuantificable';
  const score = prob * impact;
  if (score >= 16) return 'critico';
  if (score >= 10) return 'alto';
  if (score >=  5) return 'medio';
  return 'bajo';
}

// ── System Prompt ─────────────────────────────────────────────
const SYSTEM_PROMPT = `You are the Manager Agent in a smart contract security audit pipeline.
You receive 4 JSON micro-reports from sub-agents. You NEVER see the original contract source.
Your job: synthesize the reports, resolve conflicts, write an executive summary in Spanish.
You MUST return ONLY valid JSON — no markdown, no prose outside JSON.
Do not exceed ${BUDGET.maxOut} output tokens.

Required output schema:
{
  "resumen_ejecutivo": "string — 3-5 sentences in plain Spanish for a developer. Mention top risks and overall posture.",
  "conflict_resolutions": [
    {
      "finding_id": "string",
      "original_severity": "string",
      "adjusted_severity": "string",
      "reason": "string"
    }
  ],
  "synthesis_notes": "string (optional — any synthesis observations, max 100 chars)"
}

Conflict rules:
- If Scanner flagged reentrancy but Hacker found poc_confirmed=false: downgrade severity to 'informativo', reason='No PoC confirmed'.
- If Hacker confirmed a PoC: severity must be at least 'alto'.
- If Economist flagged high impact but Hacker probability is 1: set riesgo_nivel via the matrix.
- Do not invent findings. Only resolve conflicts between the 4 reports provided.`;

// ── Main synthesis function ───────────────────────────────────
/**
 * Runs Manager agent synthesis.
 * Combines 4 micro-reports, calculates score, builds audit_result and dashboard_payload.
 *
 * @param {object} microReports   { scanner, economist, compliance, hacker }
 * @param {object} agentFailures  { scanner: bool, economist: bool, compliance: bool, hacker: bool }
 * @param {object} meta           { auditId, contractAddress, contractName, network }
 * @param {object} settings
 * @param {Function} onProgress
 * @returns {{ auditResult: object, dashboardPayload: object, tokensIn, tokensOut, costUSD }}
 */
export async function runManager(microReports, agentFailures, meta, settings, onProgress = () => {}) {
  onProgress('Sintetizando micro-reportes...');

  // ── Step 1: Merge all findings into a canonical list ─────
  const allFindings = buildCanonicalFindings(microReports, agentFailures);

  // ── Step 2: Call LLM for executive summary + conflict resolution ─
  const reportsPayload = JSON.stringify({
    scanner:    microReports.scanner    || null,
    economist:  microReports.economist  || null,
    compliance: microReports.compliance || null,
    hacker:     microReports.hacker     || null,
    agent_failures: agentFailures,
  });

  const llmResult = await callLLM(
    'manager',
    SYSTEM_PROMPT,
    `Here are the 4 agent micro-reports. Synthesize and resolve conflicts:\n\n${reportsPayload}`,
    BUDGET.maxOut,
    settings,
  );

  onProgress('Calculando Security Score (ISO 27004)...');

  let synthesis = { resumen_ejecutivo: '', conflict_resolutions: [] };
  try {
    synthesis = extractJSON(llmResult.content);
  } catch {
    synthesis.resumen_ejecutivo = 'Síntesis automática no disponible — revisar hallazgos individuales.';
  }

  // ── Step 3: Apply conflict resolutions ───────────────────
  const resolvedFindings = applyConflictResolutions(allFindings, synthesis.conflict_resolutions || []);

  // ── Step 4: Calculate Security Score (ISO 27004) ─────────
  let score = 100;
  for (const f of resolvedFindings) {
    if (f.severidad && f.severidad !== 'informativo') {
      score -= (SEVERITY_PENALTIES[f.severidad] || 0);
    }
  }
  score = Math.max(0, Math.min(100, score));

  // ── Step 5: Build risk matrix entries (ISO 31000) ────────
  const matrizRiesgo = resolvedFindings.map(f => ({
    hallazgo_id: f.id,
    x: f.probabilidad,
    y: f.impacto,
    nivel: calcRiskLevel(f.probabilidad, f.impacto),
    titulo: f.titulo,
  }));

  // ── Step 6: NIST CSF scores ───────────────────────────────
  const nistScores = microReports.compliance?.nist_scores || {
    identify: 50, protect: 50, detect: 50, respond: 50, recover: 50,
  };

  // ── Step 7: ISO 27001 compliance ─────────────────────────
  const iso27001Pct = microReports.compliance?.iso27001_compliance_pct ?? null;

  // ── Step 8: Ledger summary ────────────────────────────────
  const { getLedger } = await import('../config.js');
  const ledger = getLedger();
  const costDetails = {};
  (ledger?.entries || []).forEach(e => {
    costDetails[e.agent] = {
      tokens_in:  e.tokensIn,
      tokens_out: e.tokensOut,
      cost_usd:   +(e.costUSD || 0).toFixed(6),
    };
  });

  // ── Step 9: Assemble audit result ────────────────────────
  const auditResult = {
    audit_id:          meta.auditId,
    fecha:             new Date().toISOString(),
    security_score:    score,
    resumen_ejecutivo: synthesis.resumen_ejecutivo || '',
    hallazgos:         resolvedFindings,
    matriz_riesgo:     matrizRiesgo,
    cumplimiento: {
      iso27001: iso27001Pct != null ? `${iso27001Pct}%` : 'No cuantificado',
      nist_csf: {
        identify: `${nistScores.identify ?? 0}%`,
        protect:  `${nistScores.protect  ?? 0}%`,
        detect:   `${nistScores.detect   ?? 0}%`,
        respond:  `${nistScores.respond  ?? 0}%`,
        recover:  `${nistScores.recover  ?? 0}%`,
      },
    },
    contrato: {
      address:     meta.contractAddress || null,
      name:        meta.contractName    || 'N/A',
      network:     meta.network         || 'N/A',
    },
    agent_failures:    agentFailures,
    partial:           Object.values(agentFailures).some(Boolean) || (ledger?.circuitBreakerFired ?? false),
    estado_pago:       'pendiente',
    costo_auditoria_tokens: {
      total_usd:         +(ledger?.totalCostUSD || 0).toFixed(6),
      detalle_por_agente: costDetails,
    },
    synthesis_notes:   synthesis.synthesis_notes || null,
  };

  // ── Step 10: Dashboard payload ────────────────────────────
  const counts = countBySeverity(resolvedFindings);
  const dashboardPayload = {
    kpis: {
      security_score:      score,
      hallazgos_criticos:  counts.critico,
      hallazgos_altos:     counts.alto,
      hallazgos_medios:    counts.medio,
      hallazgos_bajos:     counts.bajo,
    },
    grafico_matriz_riesgo:  matrizRiesgo,
    grafico_cumplimiento_nist: {
      identify: nistScores.identify ?? 0,
      protect:  nistScores.protect  ?? 0,
      detect:   nistScores.detect   ?? 0,
      respond:  nistScores.respond  ?? 0,
      recover:  nistScores.recover  ?? 0,
    },
    tabla_hallazgos:   resolvedFindings,
    audit_id:          meta.auditId,
    fecha:             auditResult.fecha,
    resumen_ejecutivo: auditResult.resumen_ejecutivo,
    cumplimiento:      auditResult.cumplimiento,
    contrato:          auditResult.contrato,
    partial:           auditResult.partial,
    costo_total_usd:   auditResult.costo_auditoria_tokens.total_usd,
  };

  return {
    auditResult,
    dashboardPayload,
    tokensIn:  llmResult.tokensIn,
    tokensOut: llmResult.tokensOut,
    costUSD:   llmResult.costUSD,
  };
}

// ── Build canonical finding list from all agent reports ───────
function buildCanonicalFindings(reports, failures) {
  const findings = [];
  let counter = 1;

  const mkId = (prefix) => `${prefix}-${String(counter++).padStart(3, '0')}`;

  // From Scanner — structural/pattern findings
  if (!failures.scanner && reports.scanner?.suspicious_lines) {
    for (const line of reports.scanner.suspicious_lines) {
      findings.push({
        id:               mkId('SCAN'),
        titulo:           `Pattern detectado: ${line.pattern}`,
        severidad:        mapPatternSeverity(line.pattern),
        probabilidad:     null, // filled in by hacker cross-reference
        impacto:          null,
        riesgo_nivel:     null,
        control_iso27001: null,
        funcion_nist:     null,
        descripcion:      line.reason || line.snippet,
        poc_confirmado:   false,
        recomendacion:    null,
        _source:          'scanner',
        _scanner_line:    line.line_approx,
        _pattern:         line.pattern,
      });
    }
  }

  // From Economist — economic risk findings
  if (!failures.economist && reports.economist?.economic_risks) {
    for (const risk of reports.economist.economic_risks) {
      findings.push({
        id:               mkId('ECON'),
        titulo:           `Riesgo económico: ${risk.risk_type}`,
        severidad:        mapImpactToSeverity(risk.impact_score),
        probabilidad:     null,
        impacto:          risk.impact_score || null,
        riesgo_nivel:     null,
        control_iso27001: 'A.8.28',
        funcion_nist:     'protect',
        descripcion:      risk.description,
        poc_confirmado:   false,
        recomendacion:    `Revisar función ${risk.function_name} para ${risk.risk_type}`,
        _source:          'economist',
        _econ_id:         risk.id,
      });
    }
  }

  // From Compliance — control gap findings
  if (!failures.compliance && reports.compliance?.findings) {
    for (const cf of reports.compliance.findings) {
      findings.push({
        id:               mkId('COMP'),
        titulo:           cf.title,
        severidad:        cf.severity || 'bajo',
        probabilidad:     null,
        impacto:          null,
        riesgo_nivel:     null,
        control_iso27001: cf.control_iso27001 || null,
        funcion_nist:     cf.funcion_nist     || null,
        descripcion:      cf.description,
        poc_confirmado:   false,
        recomendacion:    cf.recommendation || null,
        _source:          'compliance',
        _comp_id:         cf.id,
      });
    }
  }

  // Cross-reference with Hacker — fill in probability + poc_confirmed
  if (!failures.hacker && reports.hacker?.exploits) {
    for (const exploit of reports.hacker.exploits) {
      // Find matching scanner finding by line number
      const match = findings.find(
        f => f._source === 'scanner' && f._scanner_line === exploit.related_scanner_line
      );
      if (match) {
        match.probabilidad   = exploit.probability_score ?? null;
        match.poc_confirmado = exploit.poc_confirmed     ?? false;
        // If hacker confirmed PoC, escalate severity
        if (exploit.poc_confirmed && match.severidad === 'informativo') {
          match.severidad = 'medio';
        }
      } else {
        // New finding from hacker — not cross-referenced
        findings.push({
          id:               mkId('HACK'),
          titulo:           `Exploit: ${exploit.vulnerability_class}`,
          severidad:        exploit.poc_confirmed ? 'alto' : 'medio',
          probabilidad:     exploit.probability_score ?? null,
          impacto:          null,
          riesgo_nivel:     null,
          control_iso27001: mapVulnToISO(exploit.vulnerability_class),
          funcion_nist:     'protect',
          descripcion:      exploit.poc_description,
          poc_confirmado:   exploit.poc_confirmed ?? false,
          recomendacion:    null,
          _source:          'hacker',
          _hack_id:         exploit.id,
        });
      }
    }
  }

  // Fill in risk levels and missing impact scores
  for (const f of findings) {
    if (f.impacto == null) {
      f.impacto = severityToImpact(f.severidad);
    }
    if (f.probabilidad == null && f.poc_confirmado) {
      f.probabilidad = 4;
    }
    f.riesgo_nivel = calcRiskLevel(f.probabilidad, f.impacto);
  }

  return findings;
}

// ── Apply LLM-proposed conflict resolutions ───────────────────
function applyConflictResolutions(findings, resolutions) {
  for (const res of resolutions) {
    const f = findings.find(x => x.id === res.finding_id);
    if (!f) continue;
    f.severidad           = res.adjusted_severity || f.severidad;
    f._conflict_resolved  = true;
    f._resolution_reason  = res.reason;
    // Recalculate risk level after severity change
    f.impacto    = severityToImpact(f.severidad);
    f.riesgo_nivel = calcRiskLevel(f.probabilidad, f.impacto);
  }
  return findings;
}

// ── Count findings by severity ────────────────────────────────
function countBySeverity(findings) {
  return {
    critico:     findings.filter(f => f.severidad === 'critico').length,
    alto:        findings.filter(f => f.severidad === 'alto').length,
    medio:       findings.filter(f => f.severidad === 'medio').length,
    bajo:        findings.filter(f => f.severidad === 'bajo').length,
    informativo: findings.filter(f => f.severidad === 'informativo').length,
  };
}

// ── Mapping helpers ───────────────────────────────────────────
function mapPatternSeverity(pattern) {
  const map = {
    reentrancy:      'alto',
    overflow:        'alto',
    access_control:  'alto',
    unchecked_call:  'medio',
    front_running:   'medio',
    other:           'bajo',
  };
  return map[pattern] || 'bajo';
}

function mapImpactToSeverity(impact) {
  if (impact >= 5) return 'critico';
  if (impact >= 4) return 'alto';
  if (impact >= 3) return 'medio';
  if (impact >= 2) return 'bajo';
  return 'informativo';
}

function severityToImpact(severity) {
  const map = { critico: 5, alto: 4, medio: 3, bajo: 2, informativo: 1 };
  return map[severity] || 2;
}

function mapVulnToISO(vulnClass) {
  const map = {
    reentrancy:       'A.8.28',
    integer_overflow: 'A.8.28',
    access_control:   'A.5.15',
    front_running:    'A.8.28',
    denial_of_service:'A.8.28',
    signature_replay: 'A.5.17',
  };
  return map[vulnClass] || 'A.8.28';
}

// ── calcRiskLevel re-export (used by orchestrator) ─────────────
export { calcRiskLevel };
