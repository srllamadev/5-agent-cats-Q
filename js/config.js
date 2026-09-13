// ============================================================
//  CONFIG.JS — Hard Caps, API Keys (localStorage), Providers
//  Lee claves desde js/env.js → fallback a localStorage
//  Equipo de Auditoría Multi-Agente · Avalanche
// ============================================================

import ENV from './env.js';

// ── Aplicar env.js → localStorage al cargar ───────────────────
// Sólo escribe si el valor en env.js no está vacío.
// De esta forma el .env tiene precedencia sobre la UI, pero
// el usuario puede sobreescribir desde la UI de Configuración.
(function bootstrapFromEnv() {
  if (ENV.DEEPSEEK_API_KEY) localStorage.setItem('apikey_deepseek', ENV.DEEPSEEK_API_KEY);
  if (ENV.CLAUDE_API_KEY)   localStorage.setItem('apikey_claude',   ENV.CLAUDE_API_KEY);
  if (ENV.OPENAI_API_KEY)   localStorage.setItem('apikey_openai',   ENV.OPENAI_API_KEY);
  if (ENV.PINATA_JWT)       localStorage.setItem('apikey_pinata',   ENV.PINATA_JWT);
  if (ENV.SNOWTRACE_API_KEY)localStorage.setItem('apikey_snowtrace',ENV.SNOWTRACE_API_KEY);

  // Aplicar defaults de env.js sólo si no hay settings guardados aún
  const existing = localStorage.getItem('audit_settings');
  if (!existing) {
    const envSettings = {
      provider:        ENV.DEFAULT_PROVIDER       || 'deepseek',
      deepseekModel:   ENV.DEFAULT_DEEPSEEK_MODEL || 'deepseek-coder',
      claudeModel:     ENV.DEFAULT_CLAUDE_MODEL   || 'claude-sonnet-4-5',
      openaiModel:     ENV.DEFAULT_OPENAI_MODEL   || 'gpt-4o-mini',
      maxBudget:       ENV.MAX_AUDIT_BUDGET_USD   || 0.10,
      chainMode:       ENV.CHAIN_MODE             || 'simulated',
      ipfsMode:        ENV.IPFS_MODE              || 'simulated',
      snowtraceKey:    ENV.SNOWTRACE_API_KEY       || '',
    };
    localStorage.setItem('audit_settings', JSON.stringify(envSettings));
  }
})();

export const AGENT_BUDGETS = {
  scanner:    { maxOut: 600,  maxRounds: 1, label: 'Escáner',     emoji: '🔍' },
  economist:  { maxOut: 800,  maxRounds: 1, label: 'Economista',  emoji: '💰' },
  compliance: { maxOut: 700,  maxRounds: 1, label: 'Cumplimiento',emoji: '📋' },
  hacker:     { maxOut: 1200, maxRounds: 2, label: 'Hacker',      emoji: '🎯' },
  manager:    { maxOut: 1500, maxRounds: 2, label: 'Manager',      emoji: '🧠' },
};

// Max total spend for a full audit run (USD). Circuit breaker fires if exceeded.
export const MAX_AUDIT_BUDGET_USD = ENV.MAX_AUDIT_BUDGET_USD || 0.10;

// Per-token costs (USD). These are approximate and per-provider.
export const TOKEN_COSTS = {
  claude: {
    'claude-sonnet-4-5':         { input: 0.000003,  output: 0.000015  },
    'claude-3-5-haiku-20241022': { input: 0.0000008, output: 0.000004  },
    'claude-opus-4-5':           { input: 0.000015,  output: 0.000075  },
  },
  deepseek: {
    'deepseek-chat':   { input: 0.00000027, output: 0.00000110 }, // DeepSeek V3 (más rápido, mejor calidad)
    'deepseek-coder':  { input: 0.00000014, output: 0.00000028 },
    'deepseek-reasoner': { input: 0.00000055, output: 0.00000219 }, // DeepSeek R1
  },
  openai: {
    'gpt-4o':                    { input: 0.0000025,  output: 0.00001   },
    'gpt-4o-mini':               { input: 0.00000015, output: 0.0000006 },
  },
};

// Default settings — overridden by localStorage
export const DEFAULTS = {
  provider:        ENV.DEFAULT_PROVIDER       || 'deepseek',
  claudeModel:     ENV.DEFAULT_CLAUDE_MODEL   || 'claude-sonnet-4-5',
  deepseekModel:   ENV.DEFAULT_DEEPSEEK_MODEL || 'deepseek-coder',
  openaiModel:     ENV.DEFAULT_OPENAI_MODEL   || 'gpt-4o-mini',
  maxBudget:       ENV.MAX_AUDIT_BUDGET_USD   || 0.10,
  ipfsMode:        ENV.IPFS_MODE              || 'simulated',
  chainMode:       ENV.CHAIN_MODE             || 'simulated',
  snowtraceKey:    ENV.SNOWTRACE_API_KEY       || '',
};

// ── Settings persistence ──────────────────────────────────────
export function loadSettings() {
  try {
    const saved = localStorage.getItem('audit_settings');
    return saved ? { ...DEFAULTS, ...JSON.parse(saved) } : { ...DEFAULTS };
  } catch { return { ...DEFAULTS }; }
}

export function saveSettings(settings) {
  localStorage.setItem('audit_settings', JSON.stringify(settings));
}


// API key helpers (stored separately for security isolation)
export function getApiKey(provider) {
  return localStorage.getItem(`apikey_${provider}`) || '';
}

export function setApiKey(provider, key) {
  if (key) {
    localStorage.setItem(`apikey_${provider}`, key);
  } else {
    localStorage.removeItem(`apikey_${provider}`);
  }
}

// ── Active model for a given provider ────────────────────────
export function getActiveModel(settings) {
  const p = settings.provider;
  if (p === 'claude')   return settings.claudeModel   || DEFAULTS.claudeModel;
  if (p === 'deepseek') return settings.deepseekModel || DEFAULTS.deepseekModel;
  if (p === 'openai')   return settings.openaiModel   || DEFAULTS.openaiModel;
  return '';
}

// ── Cost calculator ───────────────────────────────────────────
export function calcCostUSD(provider, model, tokensIn, tokensOut) {
  const costs = TOKEN_COSTS[provider]?.[model];
  if (!costs) return 0;
  return (tokensIn * costs.input) + (tokensOut * costs.output);
}

// ── Audit ledger (session storage) ───────────────────────────
export function initLedger(auditId) {
  const ledger = {
    auditId,
    startedAt: new Date().toISOString(),
    entries: [],
    totalCostUSD: 0,
    circuitBreakerFired: false,
  };
  sessionStorage.setItem('audit_ledger', JSON.stringify(ledger));
  return ledger;
}

export function getLedger() {
  try {
    return JSON.parse(sessionStorage.getItem('audit_ledger') || 'null');
  } catch { return null; }
}

export function addLedgerEntry(entry) {
  const ledger = getLedger();
  if (!ledger) return;
  ledger.entries.push({ ...entry, timestamp: new Date().toISOString() });
  ledger.totalCostUSD = ledger.entries.reduce((s, e) => s + (e.costUSD || 0), 0);
  sessionStorage.setItem('audit_ledger', JSON.stringify(ledger));
  return ledger;
}

export function fireCircuitBreaker() {
  const ledger = getLedger();
  if (!ledger) return;
  ledger.circuitBreakerFired = true;
  sessionStorage.setItem('audit_ledger', JSON.stringify(ledger));
}

// ── Audit result (localStorage → persists across pages) ──────
export function saveAuditResult(result) {
  localStorage.setItem('audit_result',    JSON.stringify(result));
}

export function saveDashboardPayload(payload) {
  localStorage.setItem('dashboard_payload', JSON.stringify(payload));
}

export function getAuditResult() {
  try { return JSON.parse(localStorage.getItem('audit_result') || 'null'); } catch { return null; }
}

export function getDashboardPayload() {
  try { return JSON.parse(localStorage.getItem('dashboard_payload') || 'null'); } catch { return null; }
}
