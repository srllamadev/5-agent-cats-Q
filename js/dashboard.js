// ============================================================
//  DASHBOARD.JS — Pure render logic. Zero business calculations.
//  Reads dashboardPayload from localStorage, only renders.
//  Equipo de Auditoría Multi-Agente · Avalanche
// ============================================================

import { getDashboardPayload, getAuditResult, loadSettings } from './config.js';
import { dispatchCompleteAudit } from './avalanche.js';

// ── Boot ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const payload = getDashboardPayload();
  const result  = getAuditResult();

  if (!payload) {
    document.getElementById('no-data-msg').style.display = 'flex';
    return;
  }

  renderHeader(payload);
  renderScoreRing(payload.kpis.security_score);
  renderKPIs(payload.kpis);
  renderExecutiveSummary(payload.resumen_ejecutivo);
  renderRiskMatrix(payload.grafico_matriz_riesgo);
  renderNISTChart(payload.grafico_cumplimiento_nist);
  renderComplianceBar(payload.cumplimiento);
  renderFindingsTable(payload.tabla_hallazgos);
  renderLedger(payload.ledger_entries || []);
  renderLiquidationPanel(payload, result);

  // Sidebar nav
  initSidebarNav();

  // Download buttons
  document.getElementById('btn-download-report')?.addEventListener('click', () => downloadJSON(result, `audit-${payload.audit_id}.json`));
  document.getElementById('btn-download-ledger')?.addEventListener('click', () => downloadJSON(payload.ledger_entries, `ledger-${payload.audit_id}.json`));
  document.getElementById('btn-new-audit')?.addEventListener('click', () => { window.location.href = 'index.html'; });

  // Partial banner
  if (payload.partial) {
    document.getElementById('partial-banner')?.classList.add('active');
  }
});

// ── Header ────────────────────────────────────────────────────
function renderHeader(payload) {
  setText('audit-id-display',    payload.audit_id || '—');
  setText('audit-date-display',  formatDate(payload.fecha));
  setText('contract-name',       payload.contrato?.name    || 'N/A');
  setText('contract-address',    payload.contrato?.address || 'N/A');
  setText('contract-network',    payload.contrato?.network || 'N/A');
  setText('total-cost-display',  `$${(payload.costo_total_usd || 0).toFixed(4)} USD`);

  if (payload.contrato?.address && payload.contrato.address !== 'N/A') {
    const el = document.getElementById('contract-address');
    if (el) {
      el.style.cursor = 'pointer';
      el.title = 'Ver en Snowtrace';
      el.onclick = () => window.open(`https://snowtrace.io/address/${payload.contrato.address}`, '_blank');
    }
  }
}

// ── Security Score Ring ───────────────────────────────────────
function renderScoreRing(score) {
  const numEl   = document.getElementById('score-number');
  const fillEl  = document.getElementById('score-ring-fill');
  const statusEl= document.getElementById('score-status');
  const sideEl  = document.getElementById('sidebar-score');

  if (score == null) {
    if (numEl) numEl.textContent = '—';
    return;
  }

  // Circumference = 2π × 70 ≈ 440
  const circumference = 440;
  const offset        = circumference - (score / 100) * circumference;

  // Color class
  const cls = score >= 71 ? 'score-high' : score >= 41 ? 'score-medium' : 'score-low';

  if (fillEl) {
    fillEl.className = `score-ring-fill ${cls}`;
    // Trigger animation after a tick
    requestAnimationFrame(() => { fillEl.style.strokeDashoffset = offset; });
  }

  if (numEl) {
    numEl.textContent = score;
    numEl.style.color = score >= 71 ? 'var(--risk-bajo)' : score >= 41 ? 'var(--sev-medium)' : 'var(--sev-critical)';
  }

  if (statusEl) {
    const labels = { 'score-high': ['Seguro', 'high'], 'score-medium': ['Riesgo Moderado', 'medium'], 'score-low': ['Riesgo Crítico', 'low'] };
    const [label, statusCls] = labels[cls];
    statusEl.textContent  = label;
    statusEl.className    = `score-status ${statusCls}`;
  }

  if (sideEl) sideEl.textContent = score;
}

// ── KPI Cards ─────────────────────────────────────────────────
function renderKPIs(kpis) {
  setText('kpi-critico', kpis.hallazgos_criticos ?? 0);
  setText('kpi-alto',    kpis.hallazgos_altos    ?? 0);
  setText('kpi-medio',   kpis.hallazgos_medios   ?? 0);
  setText('kpi-bajo',    kpis.hallazgos_bajos    ?? 0);

  // Sidebar mini-counts
  setText('side-critico', kpis.hallazgos_criticos ?? 0);
  setText('side-alto',    kpis.hallazgos_altos    ?? 0);
  setText('side-medio',   kpis.hallazgos_medios   ?? 0);
  setText('side-bajo',    kpis.hallazgos_bajos    ?? 0);
}

// ── Executive Summary ─────────────────────────────────────────
function renderExecutiveSummary(text) {
  const el = document.getElementById('exec-summary-text');
  if (el) el.textContent = text || 'Resumen no disponible.';
}

// ── Risk Matrix (ISO 31000) ───────────────────────────────────
function renderRiskMatrix(matrizData) {
  const grid = document.getElementById('risk-matrix-grid');
  if (!grid) return;

  // Build 5×5 matrix
  grid.innerHTML = '';

  // Y-axis label column (rows 5→1 top to bottom)
  // X-axis label row (cols 1→5)

  // Add corner blank
  const corner = document.createElement('div');
  corner.className = 'matrix-axis-label';
  grid.appendChild(corner);

  // X-axis labels (Probabilidad 1-5)
  for (let x = 1; x <= 5; x++) {
    const lbl = document.createElement('div');
    lbl.className   = 'matrix-axis-label';
    lbl.textContent = x;
    lbl.style.fontSize = '0.6875rem';
    lbl.style.color = 'var(--text-muted)';
    grid.appendChild(lbl);
  }

  // Rows (impact 5→1, top to bottom)
  for (let y = 5; y >= 1; y--) {
    // Y-axis label
    const yLbl = document.createElement('div');
    yLbl.className   = 'matrix-axis-label';
    yLbl.textContent = y;
    yLbl.style.fontSize = '0.6875rem';
    yLbl.style.color = 'var(--text-muted)';
    grid.appendChild(yLbl);

    for (let x = 1; x <= 5; x++) {
      const val   = x * y;
      const level = val >= 16 ? 'critico' : val >= 10 ? 'alto' : val >= 5 ? 'medio' : 'bajo';
      const cell  = document.createElement('div');
      cell.className    = 'matrix-cell';
      cell.dataset.level = level;
      cell.dataset.x    = x;
      cell.dataset.y    = y;

      // Check for findings at this cell
      const findings = (matrizData || []).filter(f => f.x === x && f.y === y);
      if (findings.length > 0) {
        cell.classList.add('has-finding');
        cell.title = findings.map(f => f.titulo).join('\n');

        const dot = document.createElement('div');
        dot.className = 'matrix-finding-dot';
        dot.style.color = level === 'critico' ? 'var(--sev-critical)' : level === 'alto' ? 'var(--sev-high)' : level === 'medio' ? 'var(--sev-medium)' : 'var(--risk-bajo)';
        cell.appendChild(dot);

        if (findings.length > 1) {
          const count = document.createElement('span');
          count.style.cssText = 'font-size:0.6rem;color:inherit;margin-left:2px;';
          count.textContent = findings.length;
          cell.appendChild(count);
        }
      }

      grid.appendChild(cell);
    }
  }
}

// ── NIST CSF Chart ────────────────────────────────────────────
function renderNISTChart(nistData) {
  const container = document.getElementById('nist-bars');
  if (!container || !nistData) return;

  const functions = [
    { key: 'identify', label: 'Identify', cls: 'nist-identify' },
    { key: 'protect',  label: 'Protect',  cls: 'nist-protect'  },
    { key: 'detect',   label: 'Detect',   cls: 'nist-detect'   },
    { key: 'respond',  label: 'Respond',  cls: 'nist-respond'  },
    { key: 'recover',  label: 'Recover',  cls: 'nist-recover'  },
  ];

  container.innerHTML = functions.map(fn => {
    const pct = nistData[fn.key] ?? 0;
    return `
      <div class="nist-bar-item">
        <div class="nist-bar-label">${fn.label}</div>
        <div class="nist-bar-track">
          <div class="nist-bar-fill ${fn.cls}" style="width:0%" data-target="${pct}"></div>
        </div>
        <div class="nist-bar-pct">${pct}%</div>
      </div>`;
  }).join('');

  // Animate bars
  requestAnimationFrame(() => {
    container.querySelectorAll('.nist-bar-fill').forEach(bar => {
      bar.style.width = bar.dataset.target + '%';
    });
  });
}

// ── Compliance Bars ───────────────────────────────────────────
function renderComplianceBar(cumplimiento) {
  const container = document.getElementById('compliance-bars');
  if (!container || !cumplimiento) return;

  const iso = parseInt(cumplimiento.iso27001) || 0;
  const nist = cumplimiento.nist_csf || {};
  const nistAvg = Object.values(nist)
    .map(v => parseInt(v) || 0)
    .reduce((a, b) => a + b, 0) / 5;

  const items = [
    { label: 'ISO 27001', pct: iso,              color: 'var(--accent-primary)' },
    { label: 'NIST CSF',  pct: Math.round(nistAvg), color: 'var(--accent-secondary)' },
  ];

  container.innerHTML = items.map(item => `
    <div class="compliance-row">
      <div class="compliance-name">${item.label}</div>
      <div class="compliance-bar-track">
        <div class="compliance-bar-fill" style="width:0%;background:${item.color}" data-target="${item.pct}"></div>
      </div>
      <div class="compliance-pct">${item.pct}%</div>
    </div>`
  ).join('');

  requestAnimationFrame(() => {
    container.querySelectorAll('.compliance-bar-fill').forEach(bar => {
      bar.style.width = bar.dataset.target + '%';
    });
  });
}

// ── Findings Table ────────────────────────────────────────────
function renderFindingsTable(findings) {
  const tbody = document.getElementById('findings-tbody');
  if (!tbody) return;

  if (!findings || findings.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:2rem;">No se encontraron hallazgos.</td></tr>`;
    setText('findings-count', '0');
    return;
  }

  setText('findings-count', findings.length);

  tbody.innerHTML = findings.map((f, idx) => `
    <tr class="finding-row" onclick="toggleFindingDetail(${idx})" id="finding-row-${idx}">
      <td><span class="finding-id">${escapeHTML(f.id)}</span></td>
      <td>
        <div class="finding-title">${escapeHTML(f.titulo)}</div>
        <div class="finding-desc">${escapeHTML((f.descripcion || '').slice(0, 100))}${(f.descripcion || '').length > 100 ? '…' : ''}</div>
      </td>
      <td><span class="badge badge-${f.severidad}">${f.severidad}</span></td>
      <td><span class="badge badge-${f.funcion_nist || 'neutral'}">${f.funcion_nist || '—'}</span></td>
      <td style="font-family:var(--font-mono);font-size:0.8125rem;color:var(--text-secondary);">${f.control_iso27001 || '—'}</td>
      <td>
        ${f.probabilidad != null ? `<span style="font-family:var(--font-mono)">${f.probabilidad} × ${f.impacto}</span>` : '<span style="color:var(--text-muted)">—</span>'}
      </td>
      <td>
        <span class="poc-badge ${f.poc_confirmado ? 'confirmed' : 'unconfirmed'}">
          ${f.poc_confirmado ? '⚡ Confirmado' : '— No confirmado'}
        </span>
      </td>
    </tr>
    <tr class="finding-detail-row" id="finding-detail-${idx}">
      <td colspan="7">
        <div class="finding-detail-grid">
          <div>
            <div class="finding-detail-item-label">Nivel de Riesgo (ISO 31000)</div>
            <div class="finding-detail-item-value"><span class="badge badge-${f.riesgo_nivel || 'neutral'}">${f.riesgo_nivel || 'No cuantificable'}</span></div>
          </div>
          <div>
            <div class="finding-detail-item-label">Fuente</div>
            <div class="finding-detail-item-value">${f._source || '—'}</div>
          </div>
          <div>
            <div class="finding-detail-item-label">Probabilidad (ISO 27005)</div>
            <div class="finding-detail-item-value">${f.probabilidad ?? 'null'} / 5</div>
          </div>
          <div>
            <div class="finding-detail-item-label">Impacto (ISO 31000)</div>
            <div class="finding-detail-item-value">${f.impacto ?? 'null'} / 5</div>
          </div>
        </div>
        <div class="recommendation-box">${escapeHTML(f.recomendacion || 'Sin recomendación disponible.')}</div>
        ${f._resolution_reason ? `<div style="margin-top:var(--sp-3);font-size:0.8125rem;color:var(--text-muted)">⚖️ Ajuste de severidad: ${escapeHTML(f._resolution_reason)}</div>` : ''}
      </td>
    </tr>
  `).join('');

  // Expose toggle globally
  window.toggleFindingDetail = (idx) => {
    const detail = document.getElementById(`finding-detail-${idx}`);
    detail?.classList.toggle('open');
  };

  // Filter chips
  initFindingFilters(findings);
}

function initFindingFilters(allFindings) {
  const chips = document.querySelectorAll('.filter-chip');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');

      const filter = chip.dataset.filter;
      const rows   = document.querySelectorAll('.finding-row');
      const details= document.querySelectorAll('.finding-detail-row');

      details.forEach(d => d.classList.remove('open'));

      rows.forEach((row, idx) => {
        const finding   = allFindings[idx];
        const visible   = filter === 'all' || finding.severidad === filter;
        row.style.display              = visible ? '' : 'none';
        details[idx].style.display    = visible ? '' : 'none';
      });
    });
  });
}

// ── Ledger Table ──────────────────────────────────────────────
function renderLedger(entries) {
  const tbody = document.getElementById('ledger-tbody');
  if (!tbody) return;

  if (!entries || entries.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:1rem;">No hay entradas en el ledger.</td></tr>`;
    return;
  }

  tbody.innerHTML = entries.map(e => `
    <tr>
      <td>${escapeHTML(e.agent)}</td>
      <td>${e.tokensIn ?? '—'}</td>
      <td>${e.tokensOut ?? '—'}</td>
      <td>$${(e.costUSD || 0).toFixed(6)}</td>
      <td>${e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : '—'}</td>
    </tr>
  `).join('');
}

// ── Liquidation Panel ─────────────────────────────────────────
function renderLiquidationPanel(payload, result) {
  const statusEl = document.getElementById('liquidation-status');
  const txEl     = document.getElementById('liquidation-tx');
  const ipfsEl   = document.getElementById('ipfs-link');
  const btn      = document.getElementById('btn-complete-audit');

  const estado = payload.estado_pago || 'pendiente';
  if (statusEl) {
    statusEl.className  = `liquidation-status ${estado}`;
    statusEl.textContent = estado.charAt(0).toUpperCase() + estado.slice(1);
  }

  const tx = payload.tx || result?.tx;
  if (txEl && tx?.txHash) {
    txEl.textContent = tx.txHash.slice(0, 20) + '...';
    if (!tx.simulated && tx.explorerUrl) {
      txEl.style.cursor = 'pointer';
      txEl.onclick = () => window.open(tx.explorerUrl, '_blank');
    }
  }

  if (ipfsEl && payload.ipfs?.url) {
    ipfsEl.href = payload.ipfs.url;
    ipfsEl.textContent = payload.ipfs.cid?.slice(0, 20) + '...';
  }

  if (btn && estado === 'pendiente') {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Procesando...';
      try {
        const settings = loadSettings();
        const res = await dispatchCompleteAudit(
          payload.audit_id,
          payload.kpis.security_score,
          payload.ipfs?.cid || 'N/A',
          settings,
        );
        if (statusEl) {
          statusEl.className = 'liquidation-status liquidado';
          statusEl.textContent = 'Liquidado';
        }
        if (txEl) {
          txEl.textContent = res.txHash?.slice(0, 20) + '...';
        }
        btn.textContent = '✓ Liquidado';
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Reintentar Liquidación';
        alert(`Error: ${err.message}`);
      }
    });
  } else if (btn) {
    btn.disabled = true;
    btn.textContent = estado === 'liquidado' ? '✓ Liquidado' : '⚠ Parcial';
  }
}

// ── Sidebar Navigation ────────────────────────────────────────
function initSidebarNav() {
  const navItems = document.querySelectorAll('.sidebar-nav-item[data-section]');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.id;
        navItems.forEach(item => {
          item.classList.toggle('active', item.dataset.section === id);
        });
      }
    });
  }, { threshold: 0.4 });

  navItems.forEach(item => {
    const section = document.getElementById(item.dataset.section);
    if (section) observer.observe(section);
    item.addEventListener('click', () => {
      section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

// ── Utilities ─────────────────────────────────────────────────
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function escapeHTML(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return iso; }
}

function downloadJSON(data, filename) {
  if (!data) return;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

// loadSettings imported at top of file via renderLiquidationPanel closure
