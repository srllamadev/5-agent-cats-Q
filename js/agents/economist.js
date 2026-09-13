// ============================================================
//  ECONOMIST.JS — Agent 2: Economic Risk Analysis
//  Max output: 800 tokens | Only reads payable/transfer/swap functions
//  Equipo de Auditoría Multi-Agente · Avalanche
// ============================================================

import { callLLM, extractJSON } from '../llm.js';
import { AGENT_BUDGETS } from '../config.js';

const BUDGET = AGENT_BUDGETS.economist;

// ── System Prompt ─────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Agent 2 (Economist) in a smart contract security audit pipeline.
Your ONLY job: analyze the provided payable/transfer/swap Solidity function snippets for economic risks.
You MUST return ONLY valid JSON — no markdown, no prose.
Be concise. Do not exceed ${BUDGET.maxOut} output tokens.

Required output schema:
{
  "economic_risks": [
    {
      "id": "ECON-001",
      "function_name": "string",
      "risk_type": "rug_pull|price_manipulation|flash_loan|fee_drain|uncapped_mint|integer_overflow|other",
      "description": "string (max 150 chars)",
      "value_at_risk": "high|medium|low|unknown",
      "impact_score": 1-5,
      "snippet": "string (max 120 chars of relevant code)"
    }
  ],
  "tvl_estimate": "string (e.g. 'Unknown - no TVL data in source' or dollar estimate if inferable)",
  "has_fee_mechanism": bool,
  "has_minting": bool,
  "has_burning": bool,
  "total_economic_risk_level": "high|medium|low"
}

Rules:
- Only analyze the functions you are given.
- impact_score maps to ISO 31000: 1=negligible, 5=catastrophic.
- If no risks found, return "economic_risks": [].
- Do not invent data not present in the provided snippets.`;

// ── Runner ────────────────────────────────────────────────────
/**
 * Runs Agent 2 (Economist) on filtered payable/transfer/swap functions only.
 *
 * @param {string}   payableFunctions  Pre-filtered source fragments (from parser.js)
 * @param {object}   settings
 * @param {Function} onProgress
 * @returns {{ report: object, tokensIn: number, tokensOut: number, costUSD: number }}
 */
export async function runEconomist(payableFunctions, settings, onProgress = () => {}) {
  onProgress('Analizando riesgos económicos...');

  const result = await callLLM(
    'economist',
    SYSTEM_PROMPT,
    `Analyze these Solidity function snippets for economic risks:\n\n${payableFunctions}`,
    BUDGET.maxOut,
    settings,
  );

  onProgress('Evaluando impacto económico...');

  let report;
  try {
    report = extractJSON(result.content);
  } catch (err) {
    report = {
      economic_risks: [],
      tvl_estimate: null,
      has_fee_mechanism: null,
      has_minting: null,
      has_burning: null,
      total_economic_risk_level: null,
      _parse_error: err.message,
    };
  }

  report.economic_risks = report.economic_risks || [];

  return {
    report,
    tokensIn:  result.tokensIn,
    tokensOut: result.tokensOut,
    costUSD:   result.costUSD,
  };
}
