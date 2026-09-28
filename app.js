/* ============================================================
   RYN THE JOURNAL — App controller
   ============================================================ */

const DB = window.RYNDB;
const R = window.RYNRENDER;
const CALC = window.RYNCALC;

const state = {
  page: 'dashboard',
  trades: [],
  settings: DB.DEFAULT_SETTINGS,
  journalFilters: { search: '', result: 'all' },
  analyticsTab: 'session',
  editingTrade: null, // trade object being created/edited (draft)
  editingId: null
};

function uid() {
  return 't_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

/* ---------------- FILTERED VIEW ---------------- */
function getFilteredTrades() {
  let list = state.trades;
  const f = state.journalFilters;
  if (f.result && f.result !== 'all') {
    list = list.filter(t => t.result === f.result);
  }
  if (f.search) {
    const q = f.search.toLowerCase();
    list = list.filter(t => {
      const hay = [
        ...(t.pairs || []), t.customPair, ...(t.models || []),
        ...(t.sessions || []), t.note, t.direction
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }
  return list;
}

/* ---------------- PAGE RENDER ---------------- */
function renderPage() {
  const content = document.getElementById('page-content');
  const trades = state.trades;

  if (state.page === 'dashboard') {
    content.innerHTML = R.renderDashboard(trades);
    const s = CALC.computeStats(trades);
    if (trades.length) R.drawEquityChart('chart-equity', s.equitySeries);
  } else if (state.page === 'journal') {
    content.innerHTML = R.renderJournal(getFilteredTrades(), state.journalFilters);
    bindJournalEvents();
  } else if (state.page === 'analytics') {
    content.innerHTML = R.renderAnalytics(trades, state.settings, state.analyticsTab);
    bindAnalyticsEvents(trades);
    if (state.analyticsTab === 'month' && trades.length) {
      const rows = CALC.groupStats(trades, t => CALC.monthKey(t.date));
      R.drawMonthChart('chart-month', rows);
    }
  } else if (state.page === 'pattern') {
    content.innerHTML = R.renderPattern(trades, state.settings);
  } else if (state.page === 'settings') {
    content.innerHTML = R.renderSettings(state.settings);
    bindSettingsEvents();
  }

  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === state.page);
  });
}

function bindJournalEvents() {
  const search = document.getElementById('journal-search');
  if (search) {
    search.addEventListener('input', (e) => {
      state.journalFilters.search = e.target.value;
      renderPage();
      // restore focus + cursor since we re-render the DOM
      const el = document.getElementById('journal-search');
      el.focus();
      el.selectionStart = el.selectionEnd = el.value.length;
    });
  }
  document.querySelectorAll('[data-result-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.journalFilters.result = btn.dataset.resultFilter;
      renderPage();
    });
  });
  document.querySelectorAll('.trade-card').forEach(card => {
    card.addEventListener('click', () => {
      const trade = state.trades.find(t => t.id === card.dataset.tradeId);
      if (trade) openTradeDetail(trade);
    });
  });
}

function bindAnalyticsEvents(trades) {
  document.querySelectorAll('[data-analytics-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.analyticsTab = btn.dataset.analyticsTab;
      renderPage();
    });
  });
  const minSampleSel = document.getElementById('combo-min-sample');
  if (minSampleSel) {
    minSampleSel.addEventListener('change', async (e) => {
      state.settings.minSampleSize = parseInt(e.target.value, 10);
      await DB.setSetting('minSampleSize', state.settings.minSampleSize);
      renderPage();
    });
  }
}

function bindSettingsEvents() {
  const map = {
    'set-currency': 'currency',
    'set-default-risk': 'defaultRisk',
    'set-default-rr': 'defaultRR',
    'set-min-sample': 'minSampleSize'
  };
  Object.keys(map).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', async (e) => {
      let v = e.target.value;
      if (map[id] === 'minSampleSize') v = parseInt(v, 10);
      state.settings[map[id]] = v;
      await DB.setSetting(map[id], v);
    });
  });

  const darkToggle = document.getElementById('set-dark-toggle');
  if (darkToggle) darkToggle.addEventListener('click', async () => {
    state.settings.darkMode = !state.settings.darkMode;
    await DB.setSetting('darkMode', state.settings.darkMode);
    renderPage();
  });

  document.getElementById('btn-export-csv').addEventListener('click', exportCSV);
  document.getElementById('import-csv-input').addEventListener('change', importCSV);
  document.getElementById('btn-backup').addEventListener('click', backupJSON);
  document.getElementById('restore-input').addEventListener('change', restoreJSON);
  document.getElementById('btn-wipe').addEventListener('click', wipeAllData);
}

/* ---------------- NAVIGATION ---------------- */
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    state.page = btn.dataset.page;
    renderPage();
  });
});

/* ---------------- MODAL: TRADE FORM ---------------- */
function openTradeForm(trade) {
  state.editingTrade = trade ? JSON.parse(JSON.stringify(trade)) : null;
  state.editingId = trade ? trade.id : null;
  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = `
    <div class="modal-overlay" id="trade-modal-overlay">
      <div class="modal-sheet">
        <div class="modal-header">
          <div class="modal-title">${trade ? 'EDIT TRADE' : 'ADD TRADE'}</div>
          <button class="icon-btn" id="close-trade-modal">✕</button>
        </div>
        <div class="modal-body" id="trade-form-body">
          ${R.renderTradeForm(state.editingTrade, state.settings)}
        </div>
        <div class="modal-footer">
          ${trade ? `<button class="btn-danger" id="btn-delete-trade">DELETE</button>` : ''}
          <button class="btn-primary" id="btn-save-trade">SAVE</button>
        </div>
      </div>
    </div>
  `;
  bindTradeFormEvents();
}

function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
  state.editingTrade = null;
  state.editingId = null;
}

function currentDraft() {
  // Build a draft object from current form DOM state (chip selections tracked separately in memory)
  return state.editingTrade || {};
}

function bindTradeFormEvents() {
  document.getElementById('close-trade-modal').addEventListener('click', closeModal);
  document.getElementById('trade-modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'trade-modal-overlay') closeModal();
  });

  // init draft skeleton if new
  if (!state.editingTrade) {
    state.editingTrade = {
      id: uid(),
      date: new Date().toISOString().slice(0,10),
      days: [], pairs: [], sessions: [], direction: '', models: [], timeframes: [],
      rr: state.settings.defaultRR, risk: state.settings.defaultRisk, result: 'TP',
      timeEntry: '', note: '', images: [], idealR: '',
      customPair: '', customRR: '', customRisk: ''
    };
  }

  const body = document.getElementById('trade-form-body');

  // date
  body.querySelector('#f-date').addEventListener('change', (e) => {
    state.editingTrade.date = e.target.value;
  });

  // chip groups (multi-select except direction/rr/risk/result which are single-select)
  const singleSelectGroups = ['direction', 'rr', 'risk', 'result'];
  body.querySelectorAll('[data-chip-group]').forEach(group => {
    const groupName = group.dataset.chipGroup;
    group.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const value = chip.dataset.chipValue;
        if (singleSelectGroups.includes(groupName)) {
          state.editingTrade[groupName] = value;
        } else {
          const arr = state.editingTrade[groupName] || [];
          const idx = arr.indexOf(value);
          if (idx >= 0) arr.splice(idx, 1); else arr.push(value);
          state.editingTrade[groupName] = arr;
        }
        // re-render just the form body to reflect selection + conditional custom inputs
        rerenderTradeFormBody();
      });
    });
  });

  bindTradeFormTextInputs();

  document.getElementById('btn-save-trade').addEventListener('click', saveTradeFromForm);
  const delBtn = document.getElementById('btn-delete-trade');
  if (delBtn) delBtn.addEventListener('click', async () => {
    if (confirm('Hapus trade ini? Tindakan tidak bisa dibatalkan.')) {
      await DB.dbDelete(DB.STORE_TRADES, state.editingId);
      state.trades = state.trades.filter(t => t.id !== state.editingId);
      closeModal();
      renderPage();
    }
  });
}

function rerenderTradeFormBody() {
  const body = document.getElementById('trade-form-body');
  const scrollTop = body.scrollTop;
  body.innerHTML = R.renderTradeForm(state.editingTrade, state.settings);
  body.scrollTop = scrollTop;
  // rebind chip + text events on the fresh DOM
  const singleSelectGroups = ['direction', 'rr', 'risk', 'result'];
  body.querySelectorAll('[data-chip-group]').forEach(group => {
    const groupName = group.dataset.chipGroup;
    group.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const value = chip.dataset.chipValue;
        if (singleSelectGroups.includes(groupName)) {
          state.editingTrade[groupName] = value;
        } else {
          const arr = state.editingTrade[groupName] || [];
          const idx = arr.indexOf(value);
          if (idx >= 0) arr.splice(idx, 1); else arr.push(value);
          state.editingTrade[groupName] = arr;
        }
        rerenderTradeFormBody();
      });
    });
  });
  body.querySelector('#f-date').addEventListener('change', (e) => { state.editingTrade.date = e.target.value; });
  bindTradeFormTextInputs();
}

function bindTradeFormTextInputs() {
  const body = document.getElementById('trade-form-body');
  const bindIf = (id, key) => {
    const el = body.querySelector(id);
    if (el) el.addEventListener('input', (e) => { state.editingTrade[key] = e.target.value; });
  };
  bindIf('#f-custom-pair', 'customPair');
  bindIf('#f-custom-rr', 'customRR');
  bindIf('#f-custom-risk', 'customRisk');
  bindIf('#f-time-entry', 'timeEntry');
  bindIf('#f-ideal-r', 'idealR');
  bindIf('#f-note', 'note');

  const imgInput = body.querySelector('#f-image-input');
  if (imgInput) {
    imgInput.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      for (const file of files) {
        const dataUrl = await fileToDataURL(file);
        state.editingTrade.images = state.editingTrade.images || [];
        state.editingTrade.images.push(dataUrl);
      }
      rerenderTradeFormBody();
    });
  }
  body.querySelectorAll('[data-remove-img]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.removeImg, 10);
      state.editingTrade.images.splice(idx, 1);
      rerenderTradeFormBody();
    });
  });
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function saveTradeFromForm() {
  const t = state.editingTrade;
  if (!t.date) { alert('Tanggal wajib diisi.'); return; }
  if (!t.pairs || !t.pairs.length) { alert('Pilih minimal satu pair.'); return; }
  if (!t.direction) { alert('Pilih direction (BUY/SELL).'); return; }
  if (!t.result) { alert('Pilih result (TP/SL/BE).'); return; }

  // auto-fill day from date if none selected manually
  if (!t.days || !t.days.length) {
    const dow = CALC.dayOfWeekFromDate(t.date);
    if (dow && DAY_OPTIONS_INCLUDES(dow)) t.days = [dow];
  }

  await persistTrade(t);
  closeModal();
  renderPage();
}

// Shared persistence path used by both the manual Add Trade form and
// RYN AI AUTO JOURNAL (see js/ai-journal.js). Keeps a single source of
// truth for how a trade object is written to IndexedDB + app state,
// so anything that writes into STORE_TRADES stays consistent.
async function persistTrade(t) {
  await DB.dbPut(DB.STORE_TRADES, t);
  const idx = state.trades.findIndex(x => x.id === t.id);
  if (idx >= 0) state.trades[idx] = t; else state.trades.push(t);
  return t;
}

function DAY_OPTIONS_INCLUDES(d) {
  return R.DAY_OPTIONS.includes(d);
}

/* ---------------- MODAL: TRADE DETAIL ---------------- */
function openTradeDetail(trade) {
  const modalRoot = document.getElementById('modal-root');
  modalRoot.innerHTML = `
    <div class="modal-overlay" id="detail-modal-overlay">
      <div class="modal-sheet">
        <div class="modal-header">
          <div class="modal-title">TRADE DETAIL</div>
          <button class="icon-btn" id="close-detail-modal">✕</button>
        </div>
        <div class="modal-body">${R.renderTradeDetail(trade)}</div>
        <div class="modal-footer">
          <button class="btn-secondary" id="btn-edit-trade">EDIT</button>
          <button class="btn-primary" id="btn-close-detail">CLOSE</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('close-detail-modal').addEventListener('click', closeModal);
  document.getElementById('btn-close-detail').addEventListener('click', closeModal);
  document.getElementById('detail-modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'detail-modal-overlay') closeModal();
  });
  document.getElementById('btn-edit-trade').addEventListener('click', () => {
    closeModal();
    openTradeForm(trade);
  });
}

document.getElementById('btn-add-trade').addEventListener('click', () => openTradeForm(null));

/* ---------------- CSV EXPORT / IMPORT ---------------- */
const CSV_FIELDS = ['id','date','days','pairs','customPair','sessions','direction','models',
  'timeframes','rr','customRR','risk','customRisk','result','timeEntry','idealR','note'];

function csvEscape(val) {
  if (val === undefined || val === null) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function exportCSV() {
  const rows = [CSV_FIELDS.join(',')];
  state.trades.forEach(t => {
    const row = CSV_FIELDS.map(f => {
      let v = t[f];
      if (Array.isArray(v)) v = v.join(';');
      return csvEscape(v);
    });
    rows.push(row.join(','));
  });
  downloadFile('ryn_journal_export.csv', rows.join('\n'), 'text/csv');
}

function parseCSVLine(line) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { result.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  result.push(cur);
  return result;
}

function importCSV(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const text = reader.result;
    const lines = text.split(/\r?\n/).filter(l => l.trim().length);
    const header = parseCSVLine(lines[0]);
    const arrFields = ['days','pairs','sessions','models','timeframes'];
    const imported = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      const t = {};
      header.forEach((h, idx) => {
        let v = cols[idx] !== undefined ? cols[idx] : '';
        if (arrFields.includes(h)) v = v ? v.split(';').filter(Boolean) : [];
        t[h] = v;
      });
      if (!t.id) t.id = uid();
      t.images = [];
      imported.push(t);
    }
    await DB.dbBulkPut(DB.STORE_TRADES, imported);
    imported.forEach(t => {
      const idx = state.trades.findIndex(x => x.id === t.id);
      if (idx >= 0) state.trades[idx] = t; else state.trades.push(t);
    });
    alert(`Import selesai: ${imported.length} trade ditambahkan/diperbarui.`);
    renderPage();
    e.target.value = '';
  };
  reader.readAsText(file);
}

/* ---------------- BACKUP / RESTORE ---------------- */
function backupJSON() {
  const payload = { version: 1, exportedAt: new Date().toISOString(), settings: state.settings, trades: state.trades };
  downloadFile('ryn_journal_backup.json', JSON.stringify(payload, null, 2), 'application/json');
}

function restoreJSON(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const payload = JSON.parse(reader.result);
      if (!confirm(`Restore akan mengganti seluruh data saat ini dengan backup (${(payload.trades||[]).length} trade). Lanjutkan?`)) return;
      await DB.dbClear(DB.STORE_TRADES);
      await DB.dbBulkPut(DB.STORE_TRADES, payload.trades || []);
      if (payload.settings) {
        for (const k of Object.keys(payload.settings)) {
          await DB.setSetting(k, payload.settings[k]);
        }
      }
      await loadAll();
      alert('Restore berhasil.');
      renderPage();
    } catch (err) {
      alert('File backup tidak valid.');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
}

async function wipeAllData() {
  if (!confirm('Ini akan menghapus SELURUH data trade secara permanen. Yakin?')) return;
  await DB.dbClear(DB.STORE_TRADES);
  state.trades = [];
  renderPage();
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ---------------- PUBLIC BRIDGE (used by js/ai-journal.js) ---------------- */
// Exposes just what the AI Journal module needs, so it never has to reach
// into app.js internals directly. Nothing about existing behavior changes.
window.RYNAPP = {
  state,
  uid,
  persistTrade,
  renderPage,
  closeModal,
  openTradeForm,
  DAY_OPTIONS_INCLUDES
};

/* ---------------- BOOT ---------------- */
async function loadAll() {
  state.settings = await DB.getSettings();
  state.trades = await DB.dbAll(DB.STORE_TRADES);
}

async function boot() {
  await loadAll();
  renderPage();

  // splash screen: fixed ~2s then reveal app
  setTimeout(() => {
    document.getElementById('splash').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
  }, 2000);
}

boot();
