// ============================================================
//  LLM.JS — Unified LLM Client (Claude / DeepSeek / OpenAI)
//  Enforces hard max_tokens at API level. Tracks cost.
//  Equipo de Auditoría Multi-Agente · Avalanche
// ============================================================

import { getApiKey, getActiveModel, calcCostUSD, getLedger, MAX_AUDIT_BUDGET_USD } from './config.js';

// ── Budget Exceeded Error ─────────────────────────────────────
export class BudgetExceededError extends Error {
  constructor(spent, cap) {
    super(`Budget exceeded: $${spent.toFixed(4)} > $${cap}`);
    this.name = 'BudgetExceededError';
    this.spent = spent;
    this.cap = cap;
  }
}

export class AgentTimeoutError extends Error {
  constructor(agent) {
    super(`Agent ${agent} timed out`);
    this.name = 'AgentTimeoutError';
    this.agent = agent;
  }
}

// ── Main caller ───────────────────────────────────────────────
/**
 * Calls the configured LLM provider for a given agent.
 *
 * @param {string}   agentName   - For logging / ledger
 * @param {string}   systemPrompt
 * @param {string}   userContent
 * @param {number}   maxTokens   - Hard cap enforced at API level
 * @param {object}   settings    - From loadSettings()
 * @param {Function} onProgress  - Optional callback(text) for streaming
 * @returns {{ content: string, tokensIn: number, tokensOut: number, costUSD: number }}
 */
export async function callLLM(agentName, systemPrompt, userContent, maxTokens, settings, onProgress) {
  // Circuit breaker pre-check
  const ledger = getLedger();
  if (ledger) {
    const budget = settings.maxBudget ?? MAX_AUDIT_BUDGET_USD;
    if (ledger.totalCostUSD >= budget && !ledger.circuitBreakerFired) {
      throw new BudgetExceededError(ledger.totalCostUSD, budget);
    }
  }

  const provider = settings.provider || 'claude';
  const model    = getActiveModel(settings);
  const apiKey   = getApiKey(provider);

  if (!apiKey) {
    throw new Error(`No API key configured for provider "${provider}". Please add it in Settings.`);
  }

  let result;
  switch (provider) {
    case 'claude':   result = await callClaude(systemPrompt, userContent, maxTokens, model, apiKey, onProgress); break;
    case 'deepseek': result = await callDeepSeek(systemPrompt, userContent, maxTokens, model, apiKey); break;
    case 'openai':   result = await callOpenAI(systemPrompt, userContent, maxTokens, model, apiKey); break;
    default: throw new Error(`Unknown provider: ${provider}`);
  }

  result.costUSD = calcCostUSD(provider, model, result.tokensIn, result.tokensOut);
  return result;
}

// ── Claude (Anthropic) ────────────────────────────────────────
async function callClaude(system, user, maxTokens, model, apiKey, onProgress) {
  const body = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  };

  const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':         'application/json',
      'x-api-key':            apiKey,
      'anthropic-version':    '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Claude API error ${res.status}: ${err?.error?.message || res.statusText}`);
  }

  const data = await res.json();
  const content   = data.content?.[0]?.text ?? '';
  const tokensIn  = data.usage?.input_tokens  ?? 0;
  const tokensOut = data.usage?.output_tokens ?? 0;
  return { content, tokensIn, tokensOut };
}

// ── DeepSeek ──────────────────────────────────────────────────
async function callDeepSeek(system, user, maxTokens, model, apiKey) {
  const body = {
    model,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user',   content: user },
    ],
  };

  const res = await fetchWithTimeout('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`DeepSeek API error ${res.status}: ${err?.error?.message || res.statusText}`);
  }

  const data = await res.json();
  const content   = data.choices?.[0]?.message?.content ?? '';
  const tokensIn  = data.usage?.prompt_tokens     ?? 0;
  const tokensOut = data.usage?.completion_tokens ?? 0;
  return { content, tokensIn, tokensOut };
}

// ── OpenAI ────────────────────────────────────────────────────
async function callOpenAI(system, user, maxTokens, model, apiKey) {
  const body = {
    model,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user',   content: user },
    ],
  };

  const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`OpenAI API error ${res.status}: ${err?.error?.message || res.statusText}`);
  }

  const data = await res.json();
  const content   = data.choices?.[0]?.message?.content ?? '';
  const tokensIn  = data.usage?.prompt_tokens     ?? 0;
  const tokensOut = data.usage?.completion_tokens ?? 0;
  return { content, tokensIn, tokensOut };
}

// ── Fetch with 60s timeout ────────────────────────────────────
async function fetchWithTimeout(url, options, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new AgentTimeoutError(url);
    throw err;
  }
}

// ── JSON extractor (agents must return JSON) ──────────────────
export function extractJSON(text) {
  // Strip markdown code fences if present
  const stripped = text
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim();

  // Try to find a JSON object or array
  const match = stripped.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (!match) throw new Error(`No JSON found in LLM output: ${text.slice(0, 200)}`);
  return JSON.parse(match[1]);
}
