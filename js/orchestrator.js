// ============================================================
//  ORCHESTRATOR.JS — Pipeline Runner + Circuit Breaker
//  Sequence: Scanner → [Economist + Compliance] → Hacker → Manager
//  Equipo de Auditoría Multi-Agente · Avalanche
// ============================================================

import {
  loadSettings, initLedger, addLedgerEntry, getLedger,
  saveAuditResult, saveDashboardPayload, fireCircuitBreaker,
  MAX_AUDIT_BUDGET_USD,
} from './config.js';

import { runScanner    } from './agents/scanner.js';
import { runEconomist  } from './agents/economist.js';
import { runCompliance } from './agents/compliance.js';
import { runHacker     } from './agents/hacker.js';
import { runManager    } from './agents/manager.js';

import {
  extractPayableFunctions,
  extractConstructorAndModifiers,
} from './parser.js';

import { BudgetExceededError } from './llm.js';
import { uploadReport         } from './ipfs.js';
import { dispatchCompleteAudit } from './avalanche.js';

// ── Event bus for live UI updates ─────────────────────────────
const listeners = {};

export function onAuditEvent(event, cb) {
  if (!listeners[event]) listeners[event] = [];
  listeners[event].push(cb);
}

function emit(event, data) {
  (listeners[event] || []).forEach(cb => cb(data));
}

// ── Main pipeline ─────────────────────────────────────────────
/**
 * Runs the full 5-agent audit pipeline.
 *
 * @param {string} contractSource   Full Solidity source
 * @param {object} meta             { auditId, contractAddress, contractName, network }
 * @returns {object}                Final audit result
 */
export async function runAuditPipeline(contractSource, meta) {
  const settings = loadSettings();
  const ledger   = initLedger(meta.auditId);
  const budget   = settings.maxBudget ?? MAX_AUDIT_BUDGET_USD;

  const agentFailures  = { scanner: false, economist: false, compliance: false, hacker: false };
  const microReports   = { scanner: null, economist: null, compliance: null, hacker: null };

  emit('pipeline:start', { auditId: meta.auditId, meta });

  // ─────────────────────────────────────────────────────────────
  // AGENT 1 — Scanner (reads full contract ONCE)
  // ─────────────────────────────────────────────────────────────
  emit('agent:start', { agent: 'scanner' });
  try {
    const r = await runScanner(contractSource, settings, status => emit('agent:progress', { agent: 'scanner', status }));
    microReports.scanner = r.report;
    recordLedger('scanner', r, ledger, settings);
    emit('agent:done', { agent: 'scanner', report: r.report, costUSD: r.costUSD });
  } catch (err) {
    handleAgentError('scanner', err, agentFailures);
  }

  checkBudget(ledger, budget, agentFailures);

  // ─────────────────────────────────────────────────────────────
  // AGENTS 2 & 3 — Economist + Compliance (parallel, filtered inputs)
  // ─────────────────────────────────────────────────────────────
  const payableFunctions = extractPayableFunctions(contractSource);
  const constructorMods  = extractConstructorAndModifiers(contractSource);

  emit('agent:start', { agent: 'economist' });
  emit('agent:start', { agent: 'compliance' });

  const [econResult, compResult] = await Promise.allSettled([
    runEconomist(
      payableFunctions,
      settings,
      status => emit('agent:progress', { agent: 'economist', status }),
    ),
    runCompliance(
      constructorMods,
      settings,
      status => emit('agent:progress', { agent: 'compliance', status }),
    ),
  ]);

  if (econResult.status === 'fulfilled') {
    const r = econResult.value;
    microReports.economist = r.report;
    recordLedger('economist', r, ledger, settings);
    emit('agent:done', { agent: 'economist', report: r.report, costUSD: r.costUSD });
  } else {
    handleAgentError('economist', econResult.reason, agentFailures);
  }

  if (compResult.status === 'fulfilled') {
    const r = compResult.value;
    microReports.compliance = r.report;
    recordLedger('compliance', r, ledger, settings);
    emit('agent:done', { agent: 'compliance', report: r.report, costUSD: r.costUSD });
  } else {
    handleAgentError('compliance', compResult.reason, agentFailures);
  }

  checkBudget(ledger, budget, agentFailures);

  // ─────────────────────────────────────────────────────────────
  // AGENT 4 — Hacker (only suspicious fragments, max 2 rounds)
  // ─────────────────────────────────────────────────────────────
  emit('agent:start', { agent: 'hacker' });
  try {
    const suspiciousLines = microReports.scanner?.suspicious_lines || [];
    const r = await runHacker(
      suspiciousLines,
      settings,
      status => emit('agent:progress', { agent: 'hacker', status }),
    );
    microReports.hacker = r.report;
    recordLedger('hacker', r, ledger, settings);
    emit('agent:done', { agent: 'hacker', report: r.report, costUSD: r.costUSD, rounds: r.rounds });
  } catch (err) {
    handleAgentError('hacker', err, agentFailures);
  }

  checkBudget(ledger, budget, agentFailures);

  // ─────────────────────────────────────────────────────────────
  // AGENT 5 — Manager (synthesis, scoring, report generation)
  // ─────────────────────────────────────────────────────────────
  emit('agent:start', { agent: 'manager' });
  let auditResult, dashboardPayload;
  try {
    const r = await runManager(
      microReports,
      agentFailures,
      meta,
      settings,
      status => emit('agent:progress', { agent: 'manager', status }),
    );
    auditResult      = r.auditResult;
    dashboardPayload = r.dashboardPayload;
    recordLedger('manager', r, ledger, settings);
    emit('agent:done', { agent: 'manager', costUSD: r.costUSD });
  } catch (err) {
    handleAgentError('manager', err, agentFailures);
    // Build a minimal partial result if manager fails
    auditResult = buildPartialResult(microReports, agentFailures, meta, ledger);
    dashboardPayload = buildPartialDashboard(auditResult);
  }

  // ─────────────────────────────────────────────────────────────
  // IPFS Upload
  // ─────────────────────────────────────────────────────────────
  emit('pipeline:ipfs', { status: 'Subiendo informe a IPFS...' });
  let ipfsResult = { cid: 'N/A', url: '#', simulated: true };
  try {
    ipfsResult = await uploadReport(auditResult, settings);
    auditResult.ipfs = ipfsResult;
    dashboardPayload.ipfs = ipfsResult;
    emit('pipeline:ipfs', { status: 'IPFS listo', cid: ipfsResult.cid });
  } catch (err) {
    emit('pipeline:ipfs', { status: `IPFS error: ${err.message}`, error: true });
  }

  // ─────────────────────────────────────────────────────────────
  // On-chain liquidation: completeAudit()
  // ─────────────────────────────────────────────────────────────
  emit('pipeline:chain', { status: 'Liquidando auditoría en Avalanche...' });
  try {
    const txResult = await dispatchCompleteAudit(
      meta.auditId,
      auditResult.security_score,
      ipfsResult.cid,
      settings,
    );
    auditResult.estado_pago    = auditResult.partial ? 'parcial' : 'liquidado';
    auditResult.tx             = txResult;
    dashboardPayload.tx        = txResult;
    dashboardPayload.estado_pago = auditResult.estado_pago;
    emit('pipeline:chain', { status: 'Liquidación completada', tx: txResult });
  } catch (err) {
    auditResult.estado_pago    = 'pendiente';
    dashboardPayload.estado_pago = 'pendiente';
    emit('pipeline:chain', { status: `Error en liquidación: ${err.message}`, error: true });
  }

  // ─────────────────────────────────────────────────────────────
  // Persist results
  // ─────────────────────────────────────────────────────────────
  const finalLedger = getLedger();
  auditResult.costo_auditoria_tokens.total_usd = +(finalLedger?.totalCostUSD || 0).toFixed(6);
  dashboardPayload.costo_total_usd = auditResult.costo_auditoria_tokens.total_usd;
  dashboardPayload.ledger_entries  = finalLedger?.entries || [];

  saveAuditResult(auditResult);
  saveDashboardPayload(dashboardPayload);

  emit('pipeline:complete', { auditResult, dashboardPayload });
  return auditResult;
}

// ── Helpers ───────────────────────────────────────────────────

function recordLedger(agentName, result, ledger, settings) {
  addLedgerEntry({
    agent:     agentName,
    tokensIn:  result.tokensIn  || 0,
    tokensOut: result.tokensOut || 0,
    costUSD:   result.costUSD   || 0,
    model:     settings.provider,
  });
}

function handleAgentError(agentName, err, agentFailures) {
  agentFailures[agentName] = true;
  if (err instanceof BudgetExceededError) {
    fireCircuitBreaker();
    emit('circuit:breaker', { reason: err.message, spent: err.spent, cap: err.cap });
  } else {
    emit('agent:error', { agent: agentName, error: err.message });
  }
}

function checkBudget(ledger, budget, agentFailures) {
  const current = getLedger();
  if (current && current.totalCostUSD >= budget && !current.circuitBreakerFired) {
    fireCircuitBreaker();
    emit('circuit:breaker', {
      reason: `Presupuesto $${budget} USD alcanzado ($${current.totalCostUSD.toFixed(4)} gastado)`,
      spent:  current.totalCostUSD,
      cap:    budget,
    });
  }
}

function buildPartialResult(microReports, agentFailures, meta, ledger) {
  return {
    audit_id:          meta.auditId,
    fecha:             new Date().toISOString(),
    security_score:    null,
    resumen_ejecutivo: 'Auditoría parcial — el agente Manager falló durante la síntesis.',
    hallazgos:         [],
    matriz_riesgo:     [],
    cumplimiento:      { iso27001: 'N/A', nist_csf: {} },
    contrato:          meta,
    agent_failures:    agentFailures,
    partial:           true,
    estado_pago:       'parcial',
    costo_auditoria_tokens: {
      total_usd: +(ledger?.totalCostUSD || 0).toFixed(6),
      detalle_por_agente: {},
    },
  };
}

function buildPartialDashboard(auditResult) {
  return {
    kpis: { security_score: null, hallazgos_criticos: 0, hallazgos_altos: 0, hallazgos_medios: 0, hallazgos_bajos: 0 },
    grafico_matriz_riesgo: [],
    grafico_cumplimiento_nist: { identify: 0, protect: 0, detect: 0, respond: 0, recover: 0 },
    tabla_hallazgos: [],
    audit_id: auditResult.audit_id,
    fecha: auditResult.fecha,
    resumen_ejecutivo: auditResult.resumen_ejecutivo,
    cumplimiento: auditResult.cumplimiento,
    contrato: auditResult.contrato,
    partial: true,
    costo_total_usd: auditResult.costo_auditoria_tokens.total_usd,
  };
}
