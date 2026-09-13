// ============================================================
//  COMPLIANCE.JS — Agent 3: ISO 27001 / NIST CSF Mapping
//  Max output: 700 tokens | Reads constructor + modifiers + state vars only
//  Equipo de Auditoría Multi-Agente · Avalanche
// ============================================================

import { callLLM, extractJSON } from '../llm.js';
import { AGENT_BUDGETS } from '../config.js';

const BUDGET = AGENT_BUDGETS.compliance;

// ── System Prompt ─────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Agent 3 (Compliance) in a smart contract security audit pipeline.
Your ONLY job: analyze Solidity constructor, modifiers, and state variable declarations for security control gaps.
Map every finding to ISO/IEC 27001:2022 Annex A controls and NIST CSF 2.0 functions.
You MUST return ONLY valid JSON — no markdown, no prose.
Be concise. Do not exceed ${BUDGET.maxOut} output tokens.

Required output schema:
{
  "findings": [
    {
      "id": "COMP-001",
      "title": "string",
      "description": "string (max 150 chars)",
      "severity": "critico|alto|medio|bajo|informativo",
      "control_iso27001": "A.5.x / A.8.x / etc.",
      "control_description": "string (brief control name)",
      "funcion_nist": "identify|protect|detect|respond|recover",
      "recommendation": "string based on ISO 27002 guidance (max 150 chars)"
    }
  ],
  "access_control_patterns": ["onlyOwner", "hasRole", "multisig", "...etc"],
  "missing_controls": ["string"],
  "nist_scores": {
    "identify": 0-100,
    "protect":  0-100,
    "detect":   0-100,
    "respond":  0-100,
    "recover":  0-100
  },
  "iso27001_compliance_pct": 0-100
}

ISO 27001 Annex A reference for smart contracts:
- A.5.15: Access control
- A.5.16: Identity management
- A.5.17: Authentication information
- A.8.2:  Privileged access rights
- A.8.4:  Access to source code
- A.8.25: Secure development life cycle
- A.8.28: Secure coding
- A.8.29: Security testing in development

NIST CSF 2.0 functions:
- Identify (GV,ID): asset management, risk assessment
- Protect (PR): access control, data protection, secure config
- Detect (DE): anomaly detection, monitoring
- Respond (RS): incident response
- Recover (RC): recovery planning

Rules:
- Map each finding to exactly one ISO control and one NIST function.
- nist_scores: estimate 0-100 coverage for each function based on what you see.
- If no issues found, return "findings": [].`;

// ── Runner ────────────────────────────────────────────────────
/**
 * Runs Agent 3 (Compliance) on constructor + modifiers + state vars.
 *
 * @param {string}   constructorAndModifiers  Pre-filtered source (from parser.js)
 * @param {object}   settings
 * @param {Function} onProgress
 * @returns {{ report: object, tokensIn: number, tokensOut: number, costUSD: number }}
 */
export async function runCompliance(constructorAndModifiers, settings, onProgress = () => {}) {
  onProgress('Analizando controles de acceso y cumplimiento...');

  const result = await callLLM(
    'compliance',
    SYSTEM_PROMPT,
    `Analyze the following Solidity constructor, modifiers, and state variables:\n\n${constructorAndModifiers}`,
    BUDGET.maxOut,
    settings,
  );

  onProgress('Mapeando estándares ISO 27001 / NIST CSF...');

  let report;
  try {
    report = extractJSON(result.content);
  } catch (err) {
    report = {
      findings: [],
      access_control_patterns: [],
      missing_controls: [],
      nist_scores: { identify: 0, protect: 0, detect: 0, respond: 0, recover: 0 },
      iso27001_compliance_pct: null,
      _parse_error: err.message,
    };
  }

  // Ensure required fields
  report.findings               = report.findings               || [];
  report.access_control_patterns = report.access_control_patterns || [];
  report.missing_controls       = report.missing_controls       || [];
  report.nist_scores            = report.nist_scores            || { identify: 50, protect: 50, detect: 50, respond: 50, recover: 50 };

  return {
    report,
    tokensIn:  result.tokensIn,
    tokensOut: result.tokensOut,
    costUSD:   result.costUSD,
  };
}
