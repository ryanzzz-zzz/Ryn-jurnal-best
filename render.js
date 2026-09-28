/* ============================================================
   RYN THE JOURNAL — Rendering layer
   Pure functions: (data) -> HTML string, plus chart drawers.
   ============================================================ */

const C = window.RYNCALC;

function esc(s) {
  if (s === undefined || s === null) return '';
  return String(s).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}

function resolvePairs(trade) {
  return (trade.pairs || []).map(p => p === 'CUSTOM' ? (trade.customPair || 'CUSTOM') : p);
}
function resolveRR(trade) {
  return trade.rr === 'CUSTOM' ? (trade.customRR || 'CUSTOM') : trade.rr;
}
function resolveRisk(trade) {
  return trade.risk === 'CUSTOM' ? (trade.customRisk || 'CUSTOM') : trade.risk;
}

/* ---------------- STAT BOX ---------------- */
function statBox(label, value, cls = '') {
  return `<div class="stat-box">
    <div class="stat-label">${esc(label)}</div>
    <div class="stat-value ${cls}">${value}</div>
  </div>`;
}

/* ---------------- DASHBOARD ---------------- */
function renderDashboard(trades) {
  if (!trades.length) {
    return emptyState('NO TRADING DATA YET', 'Tambahkan trade pertamamu untuk mulai melihat statistik.');
  }
  const s = C.computeStats(trades);
  const rClass = v => v > 0 ? 'pos' : (v < 0 ? 'neg' : '');

  return `
    <div class="section-title">OVERVIEW</div>
    <div class="stat-grid cols-3">
      ${statBox('TOTAL TRADES', s.n)}
      ${statBox('WIN', s.win, 'pos')}
      ${statBox('LOSS', s.loss, 'neg')}
      ${statBox('BE', s.be)}
      ${statBox('WIN RATE', C.fmtPct(s.winRate))}
      ${statBox('LOSS RATE', C.fmtPct(s.lossRate))}
    </div>

    <div class="section-title">R PERFORMANCE</div>
    <div class="stat-grid">
      ${statBox('TOTAL R', C.fmtR(s.totalR), rClass(s.totalR))}
      ${statBox('AVERAGE R', C.fmtR(s.avgR), rClass(s.avgR))}
      ${statBox('EXPECTANCY', C.fmtR(s.expectancy), rClass(s.expectancy))}
      ${statBox('PROFIT FACTOR', s.profitFactor === null ? 'N/A' : C.fmtNum(s.profitFactor))}
    </div>

    <div class="section-title">RR STATISTICS</div>
    <div class="stat-grid">
      ${statBox('AVERAGE RR', s.avgRR === null ? '--' : `1:${C.fmtNum(s.avgRR)}`)}
      ${statBox('MAX RR', s.maxRR === null ? '--' : `1:${C.fmtNum(s.maxRR)}`)}
      ${statBox('IDEAL AVG RR', s.idealAvgRR === null ? '--' : `1:${C.fmtNum(s.idealAvgRR)}`)}
      ${statBox('MAX IDEAL RR', s.maxIdealRR === null ? '--' : `1:${C.fmtNum(s.maxIdealRR)}`)}
    </div>

    <div class="section-title">MISSED OPPORTUNITY</div>
    <div class="stat-grid">
      ${statBox('COULD HAVE PROFIT', s.couldHaveProfit)}
      ${statBox('COULD HAVE BE', s.couldHaveBE)}
    </div>

    <div class="section-title">STREAKS &amp; EXTREMES</div>
    <div class="stat-grid">
      ${statBox('MAX CONSEC WIN', s.maxConsecWin, 'pos')}
      ${statBox('MAX CONSEC LOSS', s.maxConsecLoss, 'neg')}
      ${statBox('BEST TRADE', s.best ? C.fmtR(C.tradeR(s.best)) : '--', 'pos')}
      ${statBox('WORST TRADE', s.worst ? C.fmtR(C.tradeR(s.worst)) : '--', 'neg')}
    </div>

    <div class="section-title">EQUITY CURVE</div>
    <div class="card"><canvas id="chart-equity" height="180"></canvas></div>
  `;
}

function emptyState(title, sub) {
  return `<div class="empty-state">
    <div style="font-size:13px; letter-spacing:2px; color:var(--text-dim); margin-bottom:8px;">${esc(title)}</div>
    <div>${esc(sub || '')}</div>
  </div>`;
}

/* ---------------- JOURNAL ---------------- */
function renderTradeCard(trade, index) {
  const idLabel = '#' + String(index).padStart(3, '0');
  const pairs = resolvePairs(trade).join(' / ');
  const r = C.tradeR(trade);
  const resultCls = trade.result === 'TP' ? 'pos' : (trade.result === 'SL' ? 'neg' : 'be');
  const dateFmt = formatDateDisplay(trade.date);

  return `
  <div class="trade-card" data-trade-id="${esc(trade.id)}">
    <div class="trade-card-top">
      <span class="trade-id">${idLabel}</span>
      <span class="trade-date">${esc(dateFmt)}</span>
    </div>
    <div class="trade-pair-row">
      <span class="trade-pair">${esc(pairs)}</span>
      <span class="badge ${trade.direction === 'BUY' ? 'badge-buy' : 'badge-sell'}">${esc(trade.direction || '')}</span>
    </div>
    <div class="trade-meta">${esc((trade.sessions || []).join(' • '))}</div>
    <div class="trade-models">${esc((trade.models || []).join(' • '))}</div>
    <div class="trade-tf">${esc((trade.timeframes || []).join(' • '))}</div>
    <div class="trade-bottom">
      <div class="trade-rr">RR ${esc(resolveRR(trade) || '--')} &nbsp;•&nbsp; RISK ${esc(resolveRisk(trade) || '--')}</div>
      <div class="trade-result ${resultCls}">${trade.result === 'BE' ? 'BE' : C.fmtR(r, 1)}</div>
    </div>
  </div>`;
}

function renderJournal(trades, filters) {
  const filterBar = `
    <input type="text" id="journal-search" class="search-input" placeholder="Cari pair, model, note..." value="${esc(filters.search || '')}" />
    <div class="filter-bar">
      ${filterPill('all', 'SEMUA', filters.result)}
      ${filterPill('TP', 'TP', filters.result)}
      ${filterPill('SL', 'SL', filters.result)}
      ${filterPill('BE', 'BE', filters.result)}
    </div>
  `;
  if (!trades.length) {
    return filterBar + emptyState('NO TRADING DATA YET', 'Tidak ada trade yang cocok dengan filter.');
  }
  const sorted = [...trades].sort((a, b) => new Date(b.date) - new Date(a.date));
  const cards = sorted.map((t, i) => renderTradeCard(t, sorted.length - i)).join('');
  return filterBar + cards;
}

function filterPill(value, label, active) {
  const isActive = (active || 'all') === value;
  return `<button class="filter-pill ${isActive ? 'active' : ''}" data-result-filter="${value}">${esc(label)}</button>`;
}

/* ---------------- TRADE DETAIL ---------------- */
function renderTradeDetail(trade) {
  const images = (trade.images || []).map((img, i) => `<img class="detail-img" src="${img}" data-idx="${i}" />`).join('');
  return `
    <div class="detail-label">PAIR / DIRECTION</div>
    <div class="detail-value">${esc(resolvePairs(trade).join(', '))} — ${esc(trade.direction)}</div>

    <div class="detail-label">DATE / DAY</div>
    <div class="detail-value">${esc(formatDateDisplay(trade.date))} (${esc((trade.days||[]).join(', '))})</div>

    <div class="detail-label">SESSION</div>
    <div class="detail-value">${esc((trade.sessions||[]).join(', ') || '--')}</div>

    <div class="detail-label">MODEL / CONFLUENCE</div>
    <div class="detail-value">${esc((trade.models||[]).join(' + ') || '--')}</div>

    <div class="detail-label">TIME FRAME</div>
    <div class="detail-value">${esc((trade.timeframes||[]).join(', ') || '--')}</div>

    <div class="detail-label">RR / RISK</div>
    <div class="detail-value">${esc(resolveRR(trade) || '--')} • ${esc(resolveRisk(trade) || '--')}</div>

    <div class="detail-label">RESULT</div>
    <div class="detail-value">${esc(trade.result)} (${C.fmtR(C.tradeR(trade), 2)})</div>

    <div class="detail-label">TIME ENTRY</div>
    <div class="detail-value">${esc(trade.timeEntry || '--')}</div>

    <div class="detail-label">IDEAL R (MAX FAVORABLE)</div>
    <div class="detail-value">${trade.idealR !== undefined && trade.idealR !== '' ? esc(trade.idealR) + 'R' : '--'}</div>

    <div class="detail-label">NOTE</div>
    <div class="detail-value">${esc(trade.note) || '--'}</div>

    ${images ? `<div class="detail-label">SCREENSHOTS</div>${images}` : ''}
  `;
}

/* ---------------- ANALYTICS ---------------- */
function groupTableRows(rows, labelFn) {
  if (!rows.length) return `<div class="empty-state">Belum ada data.</div>`;
  return rows.map(r => {
    const s = r.stats;
    const rClass = s.totalR > 0 ? 'pos' : (s.totalR < 0 ? 'neg' : '');
    return `<div class="group-row">
      <div class="group-row-top">
        <div class="group-name">${esc(labelFn ? labelFn(r.key) : r.key)}</div>
        <div class="group-total-r ${rClass}">${C.fmtR(s.totalR)}</div>
      </div>
      <div class="group-stats-line">
        <span>TRADES <b>${s.n}</b></span>
        <span>WIN RATE <b>${C.fmtPct(s.winRate)}</b></span>
        <span>AVG R <b>${C.fmtR(s.avgR)}</b></span>
        <span>EXPECTANCY <b>${C.fmtR(s.expectancy)}</b></span>
        <span>PF <b>${s.profitFactor === null ? 'N/A' : C.fmtNum(s.profitFactor)}</b></span>
      </div>
    </div>`;
  }).join('');
}

function renderAnalytics(trades, settings, activeTab) {
  if (!trades.length) return emptyState('NO TRADING DATA YET', 'Analytics akan muncul setelah ada trade.');

  const tabs = ['session', 'month', 'year', 'model', 'combination'];
  const tabLabels = { session: 'SESSION', month: 'MONTH', year: 'YEAR', model: 'MODEL', combination: 'COMBO' };
  const tabRow = `<div class="tab-row">${tabs.map(t =>
    `<button class="tab-btn ${activeTab === t ? 'active' : ''}" data-analytics-tab="${t}">${tabLabels[t]}</button>`
  ).join('')}</div>`;

  let body = '';
  if (activeTab === 'session') {
    const rows = C.groupStats(trades, t => t.sessions);
    body = `<div class="section-title">PERFORMANCE BY SESSION</div>` + groupTableRows(rows);
  } else if (activeTab === 'month') {
    body = `<div class="section-title">PERFORMANCE BY MONTH</div>
      <div class="card"><canvas id="chart-month" height="180"></canvas></div>`;
  } else if (activeTab === 'year') {
    const rows = C.groupStats(trades, t => C.yearKey(t.date));
    body = `<div class="section-title">PERFORMANCE BY YEAR</div>` + groupTableRows(rows);
  } else if (activeTab === 'model') {
    const rows = C.groupStats(trades, t => t.models);
    const best = rows[0];
    const worst = rows[rows.length - 1];
    body = `<div class="section-title">PERFORMANCE BY MODEL</div>`
      + (best ? `<div class="insight-card good">BEST PERFORMING MODEL: <b>${esc(best.key)}</b> (${C.fmtR(best.stats.totalR)}, ${C.fmtPct(best.stats.winRate)} WR)</div>` : '')
      + (worst && worst.key !== (best && best.key) ? `<div class="insight-card warn">WORST PERFORMING MODEL: <b>${esc(worst.key)}</b> (${C.fmtR(worst.stats.totalR)}, ${C.fmtPct(worst.stats.winRate)} WR)</div>` : '')
      + groupTableRows(rows);
  } else if (activeTab === 'combination') {
    const minSample = settings.minSampleSize || 5;
    const combo = C.combinationAnalysis(trades, minSample);
    body = `
      <div class="section-title">COMBINATION ANALYSIS <span style="color:var(--text-faint); font-weight:400;">(min. ${minSample} trades)</span></div>
      <div class="row-2" style="margin-bottom:14px;">
        <select id="combo-min-sample">
          ${[3,5,10,20,30].map(v => `<option value="${v}" ${v === minSample ? 'selected' : ''}>MIN ${v} TRADES</option>`).join('')}
        </select>
      </div>
      <div class="section-title">TOP PERFORMING COMBINATIONS</div>
      ${groupTableRows(combo.top)}
      <div class="section-title">WORST PERFORMING COMBINATIONS</div>
      ${groupTableRows(combo.worst)}
    `;
  }

  return tabRow + body;
}

/* ---------------- PATTERN ---------------- */
function renderPattern(trades, settings) {
  if (!trades.length) return emptyState('NO TRADING DATA YET', 'Pattern insights membutuhkan data trade.');
  const insights = C.patternInsights(trades, settings.minSampleSize || 5);
  return `
    <div class="section-title">PATTERN INSIGHTS</div>
    ${insights.map(i => `<div class="insight-card ${i.type === 'good' ? 'good' : (i.type === 'warn' ? 'warn' : '')}">${esc(i.text)}</div>`).join('')}
  `;
}

/* ---------------- SETTINGS ---------------- */
function renderSettings(settings) {
  return `
    <div class="section-title">GENERAL</div>
    <div class="card">
      <div class="settings-row">
        <div><div class="settings-label">Currency</div></div>
        <select id="set-currency">
          ${['USD','IDR','EUR','GBP'].map(c => `<option value="${c}" ${settings.currency === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div class="settings-row">
        <div><div class="settings-label">Default Risk</div></div>
        <select id="set-default-risk">
          ${['0.25%','0.5%','1%','2%'].map(c => `<option value="${c}" ${settings.defaultRisk === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div class="settings-row">
        <div><div class="settings-label">Default RR</div></div>
        <select id="set-default-rr">
          ${['1:1','1:1.5','1:2','1:3'].map(c => `<option value="${c}" ${settings.defaultRR === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div class="settings-row">
        <div><div class="settings-label">Minimum Sample Size</div><div class="settings-sub">Untuk combination analysis &amp; pattern</div></div>
        <select id="set-min-sample">
          ${[3,5,10,20,30].map(c => `<option value="${c}" ${settings.minSampleSize === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div class="settings-row">
        <div><div class="settings-label">Dark Mode</div></div>
        <button id="set-dark-toggle" class="toggle ${settings.darkMode ? 'on' : ''}"></button>
      </div>
    </div>

    <div class="section-title">DATA</div>
    <div class="card" style="display:flex; flex-direction:column; gap:10px;">
      <button id="btn-export-csv" class="btn-secondary btn-block">EXPORT CSV</button>
      <label class="btn-secondary btn-block" style="text-align:center; display:block;">
        IMPORT CSV
        <input type="file" id="import-csv-input" accept=".csv" style="display:none;" />
      </label>
      <button id="btn-backup" class="btn-secondary btn-block">BACKUP (JSON)</button>
      <label class="btn-secondary btn-block" style="text-align:center; display:block;">
        RESTORE BACKUP
        <input type="file" id="restore-input" accept=".json" style="display:none;" />
      </label>
      <button id="btn-wipe" class="btn-danger btn-block">HAPUS SEMUA DATA</button>
    </div>

    <div class="section-title">ABOUT</div>
    <div class="card">
      <div class="settings-row"><div class="settings-label">RYN THE JOURNAL</div><div class="settings-sub">v1.0.0 — 100% local, no server</div></div>
    </div>
  `;
}

/* ---------------- TRADE FORM MODAL ---------------- */
const DAY_OPTIONS = ['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY'];
const PAIR_OPTIONS = ['XAUUSD','NAS100','US30','EURUSD','GBPUSD','CUSTOM'];
const SESSION_OPTIONS = ['ASIA SESSION','LONDON SESSION','NEW YORK AM','NEW YORK PM'];
const MODEL_OPTIONS = ['FVG','IFVG','LIQUIDITY SWEEP','MSS','ORDER BLOCK','REJECTION BLOCK',
  'SELL SIDE LIQUIDITY','BUY SIDE LIQUIDITY','LIQUIDITY VOID','ASIA HIGH','ASIA LOW',
  'LONDON HIGH','LONDON LOW','SMT','SSMT','CISD','SUPPORT','RESISTANCE','SBR','RBS',
  'BREAKER BLOCK','BREAK','SWEEP','OHLC','OLHC','CRT'];
const TF_OPTIONS = ['H4','H1','M15','M5','M3','M1'];
const RR_OPTIONS = ['1:1','1:1.5','1:2','1:3','CUSTOM'];
const RISK_OPTIONS = ['0.25%','0.5%','1%','2%','CUSTOM'];

function chipGroup(name, options, selected, extraClass) {
  selected = selected || [];
  return `<div class="chip-group" data-chip-group="${name}">
    ${options.map(o => `<button type="button" class="chip ${extraClass ? extraClass(o) : ''} ${selected.includes(o) ? 'selected' : ''}" data-chip-value="${esc(o)}">${esc(o)}</button>`).join('')}
  </div>`;
}

function renderTradeForm(trade, settings) {
  trade = trade || {
    date: new Date().toISOString().slice(0,10),
    days: [], pairs: [], sessions: [], direction: '', models: [], timeframes: [],
    rr: settings.defaultRR, risk: settings.defaultRisk, result: 'TP',
    timeEntry: '', note: '', images: [], idealR: ''
  };
  return `
    <div class="form-group">
      <label class="form-label">DATE</label>
      <input type="date" id="f-date" value="${esc(trade.date)}" />
    </div>
    <div class="form-group">
      <label class="form-label">DAY</label>
      ${chipGroup('days', DAY_OPTIONS, trade.days)}
    </div>
    <div class="form-group">
      <label class="form-label">PAIR</label>
      ${chipGroup('pairs', PAIR_OPTIONS, trade.pairs)}
      ${trade.pairs && trade.pairs.includes('CUSTOM') ? `<input type="text" id="f-custom-pair" placeholder="Custom pair" value="${esc(trade.customPair||'')}" style="margin-top:8px;" />` : ''}
    </div>
    <div class="form-group">
      <label class="form-label">SESSION</label>
      ${chipGroup('sessions', SESSION_OPTIONS, trade.sessions)}
    </div>
    <div class="form-group">
      <label class="form-label">DIRECTION</label>
      ${chipGroup('direction', ['BUY','SELL'], trade.direction ? [trade.direction] : [], o => o.toLowerCase())}
    </div>
    <div class="form-group">
      <label class="form-label">MODEL / ENTRY MODEL</label>
      ${chipGroup('models', MODEL_OPTIONS, trade.models)}
    </div>
    <div class="form-group">
      <label class="form-label">TIME FRAME</label>
      ${chipGroup('timeframes', TF_OPTIONS, trade.timeframes)}
    </div>
    <div class="row-2">
      <div class="form-group">
        <label class="form-label">RR</label>
        ${chipGroup('rr', RR_OPTIONS, trade.rr ? [trade.rr] : [])}
        ${trade.rr === 'CUSTOM' ? `<input type="text" id="f-custom-rr" placeholder="ex: 1:4.5" value="${esc(trade.customRR||'')}" style="margin-top:8px;" />` : ''}
      </div>
      <div class="form-group">
        <label class="form-label">RISK / TRADE</label>
        ${chipGroup('risk', RISK_OPTIONS, trade.risk ? [trade.risk] : [])}
        ${trade.risk === 'CUSTOM' ? `<input type="text" id="f-custom-risk" placeholder="ex: 0.75%" value="${esc(trade.customRisk||'')}" style="margin-top:8px;" />` : ''}
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">RESULT</label>
      ${chipGroup('result', ['TP','SL','BE'], trade.result ? [trade.result] : [])}
    </div>
    <div class="form-group">
      <label class="form-label">TIME ENTRY</label>
      <input type="text" id="f-time-entry" placeholder="10:10 - 10:25" value="${esc(trade.timeEntry||'')}" />
    </div>
    <div class="form-group">
      <label class="form-label">MAX FAVORABLE / IDEAL R (opsional)</label>
      <input type="number" step="0.1" id="f-ideal-r" placeholder="ex: 1.5" value="${esc(trade.idealR||'')}" />
    </div>
    <div class="form-group">
      <label class="form-label">IMAGE (SCREENSHOT)</label>
      <div class="img-thumb-row" id="f-image-row">
        ${(trade.images||[]).map((img,i) => `<div class="img-thumb"><img src="${img}"/><button type="button" class="rm" data-remove-img="${i}">✕</button></div>`).join('')}
        <label class="add-img-btn">+<input type="file" id="f-image-input" accept="image/*" multiple style="display:none;"/></label>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">NOTE</label>
      <textarea id="f-note" placeholder="Catatan trade...">${esc(trade.note||'')}</textarea>
    </div>
  `;
}

/* ---------------- CHARTS ---------------- */
let _equityChart = null;
let _monthChart = null;

function drawEquityChart(canvasId, series) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  if (_equityChart) { _equityChart.destroy(); _equityChart = null; }
  const rootStyles = getComputedStyle(document.documentElement);
  const green = rootStyles.getPropertyValue('--green').trim();
  const text = rootStyles.getPropertyValue('--text-dim').trim();
  const grid = rootStyles.getPropertyValue('--border-soft').trim();
  _equityChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: series.map(p => p.label),
      datasets: [{
        data: series.map(p => p.value),
        borderColor: green,
        backgroundColor: 'rgba(51,209,122,0.08)',
        fill: true,
        tension: 0.15,
        pointRadius: 0,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: { ticks: { color: text, font: { family: 'JetBrains Mono', size: 9 } }, grid: { color: grid } }
      }
    }
  });
}

function drawMonthChart(canvasId, rows) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  if (_monthChart) { _monthChart.destroy(); _monthChart = null; }
  const rootStyles = getComputedStyle(document.documentElement);
  const green = rootStyles.getPropertyValue('--green').trim();
  const red = rootStyles.getPropertyValue('--red').trim();
  const text = rootStyles.getPropertyValue('--text-dim').trim();
  const grid = rootStyles.getPropertyValue('--border-soft').trim();
  const sortedRows = [...rows].sort((a,b) => new Date(a.key) - new Date(b.key));
  _monthChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sortedRows.map(r => r.key),
      datasets: [{
        data: sortedRows.map(r => r.stats.totalR),
        backgroundColor: sortedRows.map(r => r.stats.totalR >= 0 ? green : red)
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: text, font: { family: 'JetBrains Mono', size: 8 } }, grid: { display: false } },
        y: { ticks: { color: text, font: { family: 'JetBrains Mono', size: 9 } }, grid: { color: grid } }
      }
    }
  });
}

function formatDateDisplay(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr || '--';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
}

window.RYNRENDER = {
  esc, resolvePairs, resolveRR, resolveRisk,
  renderDashboard, renderJournal, renderTradeDetail, renderAnalytics, renderPattern,
  renderSettings, renderTradeForm, drawEquityChart, drawMonthChart, formatDateDisplay,
  DAY_OPTIONS, PAIR_OPTIONS, SESSION_OPTIONS, MODEL_OPTIONS, TF_OPTIONS, RR_OPTIONS, RISK_OPTIONS
};
