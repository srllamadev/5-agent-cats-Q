// ============================================================
//  SCANNER.JS — Agent 1: AST Analysis + Suspicious Line Extraction
//  Max output: 600 tokens | Reads contract ONCE
//  Equipo de Auditoría Multi-Agente · Avalanche
// ============================================================

import { callLLM, extractJSON } from '../llm.js';
import { AGENT_BUDGETS } from '../config.js';

const BUDGET = AGENT_BUDGETS.scanner;

// ── System Prompt ─────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Agent 1 (Scanner) in a smart contract security audit pipeline.
Your ONLY job: analyze a Solidity contract and produce a compact JSON report.
You MUST return ONLY valid JSON — no markdown, no prose, no explanations outside JSON.
Be concise. Do not exceed ${BUDGET.maxOut} output tokens.

Required output schema:
{
  "functions": [
    { "name": "string", "visibility": "public|private|internal|external", "is_payable": bool, "line_approx": number }
  ],
  "state_vars": [
    { "name": "string", "type": "string", "visibility": "public|private|internal", "line_approx": number }
  ],
  "suspicious_lines": [
    { "line_approx": number, "snippet": "string (max 120 chars)", "reason": "string", "pattern": "reentrancy|overflow|access_control|unchecked_call|front_running|other" }
  ],
  "modifiers": ["string"],
  "has_constructor": bool,
  "inherits_from": ["string"],
  "summary": "string (max 2 sentences describing what the contract does)"
}

Rules:
- Mark lines suspicious only if they match known Solidity vulnerability patterns.
- Snippet must be the actual code line, truncated to 120 chars.
- If nothing is suspicious, return "suspicious_lines": [].
- Do not invent line numbers — use approx if uncertain.`;

// ── Runner ────────────────────────────────────────────────────
/**
 * Runs Agent 1 (Scanner) on the full contract source.
 *
 * @param {string}   contractSource  Full Solidity source text
 * @param {object}   settings        From loadSettings()
 * @param {Function} onProgress      (status: string) => void
 * @returns {{ report: object, tokensIn: number, tokensOut: number, costUSD: number }}
 */
export async function runScanner(contractSource, settings, onProgress = () => {}) {
  onProgress('Analizando estructura del contrato...');

  const result = await callLLM(
    'scanner',
    SYSTEM_PROMPT,
    `Analyze this Solidity contract:\n\n${contractSource}`,
    BUDGET.maxOut,
    settings,
  );

  onProgress('Procesando hallazgos del escáner...');

  let report;
  try {
    report = extractJSON(result.content);
  } catch (err) {
    // Partial failure — return what we can
    report = {
      functions: [],
      state_vars: [],
      suspicious_lines: [],
      modifiers: [],
      has_constructor: false,
      inherits_from: [],
      summary: 'Scanner failed to parse contract.',
      _parse_error: err.message,
    };
  }

  // Validate shape — ensure required arrays exist
  report.functions        = report.functions        || [];
  report.state_vars       = report.state_vars       || [];
  report.suspicious_lines = report.suspicious_lines || [];
  report.modifiers        = report.modifiers        || [];

  return {
    report,
    tokensIn:  result.tokensIn,
    tokensOut: result.tokensOut,
    costUSD:   result.costUSD,
  };
}
