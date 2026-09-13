// ============================================================
//  HACKER.JS — Agent 4: PoC Exploit Attempt (max 2 rounds)
//  Max output: 1200 tokens | Only reads suspicious fragments
//  Equipo de Auditoría Multi-Agente · Avalanche
// ============================================================

import { callLLM, extractJSON } from '../llm.js';
import { AGENT_BUDGETS } from '../config.js';

const BUDGET = AGENT_BUDGETS.hacker;

// ── System Prompt (Round 1) ───────────────────────────────────
const SYSTEM_PROMPT_R1 = `You are Agent 4 (Hacker) in a smart contract security audit pipeline.
Your job: attempt to confirm or deny exploitability of the suspicious code fragments provided.
You MUST return ONLY valid JSON — no markdown, no prose.
Do not exceed ${BUDGET.maxOut} output tokens.

For each suspicious fragment, assess whether a real exploit is feasible.

Required output schema:
{
  "exploits": [
    {
      "id": "HACK-001",
      "related_scanner_line": number,
      "vulnerability_class": "reentrancy|integer_overflow|access_control|front_running|denial_of_service|signature_replay|other",
      "poc_confirmed": true|false,
      "poc_description": "string — describe the attack vector in ≤200 chars, or 'No viable PoC found'",
      "probability_score": 1-5,
      "attack_complexity": "low|medium|high",
      "requires_privileged_access": bool,
      "snippet": "string (the vulnerable code, max 120 chars)"
    }
  ],
  "overall_exploitability": "confirmed|partial|unconfirmed",
  "needs_refinement": bool,
  "refinement_reason": "string or null"
}

Rules:
- probability_score: 1=theoretical only, 5=trivially exploitable.
- poc_confirmed=true ONLY if you can describe a concrete, step-by-step attack.
- If a fragment looks safe on inspection, still include it with poc_confirmed=false.
- Set needs_refinement=true if you want a second round to look deeper at specific fragments.
- Set needs_refinement=false if you are confident in your assessment.`;

// ── System Prompt (Round 2 — refinement) ─────────────────────
const SYSTEM_PROMPT_R2 = `You are Agent 4 (Hacker) — SECOND AND FINAL ROUND.
You previously flagged certain fragments as needing deeper analysis.
This is your last chance. Produce a FINAL assessment.
You MUST return ONLY valid JSON. Do not exceed ${BUDGET.maxOut} output tokens.
Same output schema as Round 1, but needs_refinement MUST be false.
Do not request another round — this is the final pass.`;

// ── Runner ────────────────────────────────────────────────────
/**
 * Runs Agent 4 (Hacker) on suspicious code fragments.
 * Maximum 2 rounds. If round 1 returns needs_refinement=true, runs round 2.
 *
 * @param {Array}    suspiciousLines   Array of { line_approx, snippet, reason } from scanner
 * @param {object}   settings
 * @param {Function} onProgress
 * @returns {{ report: object, rounds: number, tokensIn: number, tokensOut: number, costUSD: number }}
 */
export async function runHacker(suspiciousLines, settings, onProgress = () => {}) {
  if (!suspiciousLines || suspiciousLines.length === 0) {
    onProgress('No hay fragmentos sospechosos para analizar.');
    return {
      report: {
        exploits: [],
        overall_exploitability: 'unconfirmed',
        needs_refinement: false,
        refinement_reason: 'No suspicious lines provided by Scanner.',
      },
      rounds:    0,
      tokensIn:  0,
      tokensOut: 0,
      costUSD:   0,
    };
  }

  // Build user content from scanner suspicious lines
  const fragmentText = suspiciousLines.map((l, i) =>
    `Fragment ${i + 1} (line ~${l.line_approx}):\nPattern: ${l.pattern}\nReason: ${l.reason}\nCode: ${l.snippet}`
  ).join('\n\n---\n\n');

  // ── Round 1 ──────────────────────────────────────────────
  onProgress('Intento de explotación — Ronda 1...');

  const r1 = await callLLM(
    'hacker',
    SYSTEM_PROMPT_R1,
    `Analyze these suspicious Solidity fragments for exploitability:\n\n${fragmentText}`,
    BUDGET.maxOut,
    settings,
  );

  let report1;
  try {
    report1 = extractJSON(r1.content);
  } catch {
    return {
      report: buildFallbackReport(suspiciousLines, 'Round 1 JSON parse failed'),
      rounds:    1,
      tokensIn:  r1.tokensIn,
      tokensOut: r1.tokensOut,
      costUSD:   r1.costUSD,
    };
  }

  report1.exploits = report1.exploits || [];

  // If no refinement needed, or we're at max budget — stop at round 1
  if (!report1.needs_refinement) {
    onProgress('Análisis de explotabilidad completado.');
    return {
      report:    report1,
      rounds:    1,
      tokensIn:  r1.tokensIn,
      tokensOut: r1.tokensOut,
      costUSD:   r1.costUSD,
    };
  }

  // ── Round 2 (refinement, max 1 more) ─────────────────────
  onProgress(`Refinamiento — Ronda 2: ${report1.refinement_reason || ''}...`);

  // Build more focused input for round 2 — only unconfirmed exploits
  const unconfirmed = report1.exploits
    .filter(e => !e.poc_confirmed)
    .map(e => `ID: ${e.id}\nVulnerability: ${e.vulnerability_class}\nCode: ${e.snippet}\nCurrent assessment: ${e.poc_description}`)
    .join('\n\n---\n\n');

  const r2Input = unconfirmed || fragmentText;

  const r2 = await callLLM(
    'hacker',
    SYSTEM_PROMPT_R2,
    `Review these unconfirmed vulnerability assessments for final determination:\n\n${r2Input}`,
    BUDGET.maxOut,
    settings,
  );

  let report2;
  try {
    report2 = extractJSON(r2.content);
  } catch {
    // Round 2 failed — use round 1 results with unconfirmed status
    report1.exploits = report1.exploits.map(e => ({ ...e, poc_confirmed: false, _r2_failed: true }));
    report1.overall_exploitability = 'unconfirmed';
    report1.needs_refinement = false;
    return {
      report:    report1,
      rounds:    2,
      tokensIn:  r1.tokensIn  + r2.tokensIn,
      tokensOut: r1.tokensOut + r2.tokensOut,
      costUSD:   r1.costUSD   + r2.costUSD,
    };
  }

  // Merge: round 2 overrides for same IDs, otherwise keep round 1
  const merged = mergeExploits(report1.exploits, report2.exploits || []);
  report2.exploits           = merged;
  report2.needs_refinement   = false; // Force-stop after 2 rounds

  onProgress('Análisis de explotabilidad finalizado (2 rondas).');

  return {
    report:    report2,
    rounds:    2,
    tokensIn:  r1.tokensIn  + r2.tokensIn,
    tokensOut: r1.tokensOut + r2.tokensOut,
    costUSD:   r1.costUSD   + r2.costUSD,
  };
}

// ── Helpers ───────────────────────────────────────────────────
function mergeExploits(r1Exploits, r2Exploits) {
  const map = new Map(r1Exploits.map(e => [e.id, e]));
  for (const e of r2Exploits) {
    map.set(e.id, e); // r2 overrides r1 for same id
  }
  return Array.from(map.values());
}

function buildFallbackReport(suspiciousLines, reason) {
  return {
    exploits: suspiciousLines.map((l, i) => ({
      id: `HACK-${String(i + 1).padStart(3, '0')}`,
      related_scanner_line: l.line_approx,
      vulnerability_class: l.pattern || 'other',
      poc_confirmed: false,
      poc_description: 'Analysis failed — manual review required.',
      probability_score: null,
      attack_complexity: null,
      requires_privileged_access: null,
      snippet: l.snippet,
    })),
    overall_exploitability: 'unconfirmed',
    needs_refinement: false,
    refinement_reason: reason,
  };
}
