/* ============================================================
   RYN THE JOURNAL — RYN AI AUTO JOURNAL
   Natural-language trade entry: describe a trade in plain words
   (and/or attach a screenshot), review the extracted fields,
   then CONFIRM & SAVE into the exact same IndexedDB store used
   by the manual Add Trade form.

   This file is self-contained and only talks to the rest of the
   app through window.RYNDB / window.RYNRENDER / window.RYNCALC /
   window.RYNAPP (exposed at the end of js/app.js). It never
   touches app.js internals directly, and it never removes or
   replaces any existing feature.
   ============================================================ */
(function () {
  const DB = window.RYNDB;
  const RENDER = window.RYNRENDER;
  const CALC = window.RYNCALC;

  /* ============================================================
     1. AIJournalService — provider-agnostic abstraction
     ============================================================
     SECURITY NOTE: this is a static, client-only web app. There is
     nowhere safe to store a real LLM provider API key in this
     codebase — any key placed in JS here would be visible to every
     visitor. So this service NEVER hard-codes a key.

     To connect a real AI provider later:
       1. Build a tiny backend/serverless proxy (Cloudflare Worker,
          Vercel function, your own server, etc). That proxy holds
          the actual API key server-side and forwards the request
          to your LLM of choice (e.g. the Anthropic Messages API).
       2. Point this app at that proxy by setting, before this
          script runs (e.g. in a small inline <script> in index.html
          or a separate config.js):
            window.RYN_AI_CONFIG = { endpoint: 'https://your-proxy.example.com/analyze-trade' };
       3. That's it — AIJournalService will POST { text, images } to
          your endpoint and expects back a JSON body shaped like the
          object documented above localExtract() below.

     Until RYN_AI_CONFIG is set, the app runs in "local-heuristic"
     mode: a fully offline, deterministic, rule-based parser (below)
     that never invents data it cannot find in the text.
     ============================================================ */
  const AIJournalService = (function () {
    function getConfig() {
      return (window.RYN_AI_CONFIG && window.RYN_AI_CONFIG.endpoint) ? window.RYN_AI_CONFIG : null;
    }

    function isConfigured() {
      return !!getConfig();
    }

    async function analyzeTrade(inputText, images) {
      const config = getConfig();
      images = images || [];

      if (config) {
        try {
          const res = await fetch(config.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: inputText, images })
          });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const data = await res.json();
          return { success: true, data, source: 'remote-api' };
        } catch (err) {
          return { success: false, error: 'AI ANALYSIS FAILED', detail: err.message, source: 'remote-api' };
        }
      }

      try {
        const data = localExtract(inputText || '', images);
        return { success: true, data, source: 'local-heuristic' };
      } catch (err) {
        return { success: false, error: 'AI ANALYSIS FAILED', detail: err.message, source: 'local-heuristic' };
      }
    }

    return { isConfigured, analyzeTrade };
  })();

  /* ============================================================
     2. Local heuristic extractor (default, offline, no API key)
     ============================================================ */
  const PAIR_SYNONYMS = {
    'gold': 'XAUUSD', 'xauusd': 'XAUUSD', 'xau': 'XAUUSD',
    'nq': 'NAS100', 'nasdaq': 'NAS100', 'nas100': 'NAS100', 'us100': 'NAS100',
    'us30': 'US30', 'dow': 'US30', 'dowjones': 'US30', 'ym': 'US30',
    'eurusd': 'EURUSD', 'euro': 'EURUSD',
    'gbpusd': 'GBPUSD', 'pound': 'GBPUSD', 'cable': 'GBPUSD'
  };

  const MODEL_PATTERNS = [
    // Order matters: more specific patterns must be checked before their substrings.
    [/\bifvg\b/i, 'IFVG'],
    [/\bfvg\b/i, 'FVG'],
    [/\border block\b/i, 'ORDER BLOCK'],
    [/\brejection block\b/i, 'REJECTION BLOCK'],
    [/\bbreaker block\b/i, 'BREAKER BLOCK'],
    [/\bsell side liquidity\b|\bssl\b/i, 'SELL SIDE LIQUIDITY'],
    [/\bbuy side liquidity\b|\bbsl\b/i, 'BUY SIDE LIQUIDITY'],
    [/\bliquidity void\b/i, 'LIQUIDITY VOID'],
    [/\basia high\b/i, 'ASIA HIGH'],
    [/\basia low\b/i, 'ASIA LOW'],
    [/\blondon high\b/i, 'LONDON HIGH'],
    [/\blondon low\b/i, 'LONDON LOW'],
    [/\bssmt\b/i, 'SSMT'],
    [/\bsmt\b/i, 'SMT'],
    [/\bcisd\b/i, 'CISD'],
    [/\bsupport\b/i, 'SUPPORT'],
    [/\bresistance\b/i, 'RESISTANCE'],
    [/\bsbr\b/i, 'SBR'],
    [/\brbs\b/i, 'RBS'],
    [/\bmss\b|market structure shift/i, 'MSS'],
    [/\bohlc\b/i, 'OHLC'],
    [/\bolhc\b/i, 'OLHC'],
    [/\bcrt\b/i, 'CRT'],
    // Generic sweep language maps to LIQUIDITY SWEEP (matches app's spec example
    // where plain "sweep"/"disweep" on its own is read as a liquidity sweep).
    [/liquidity\s+sweep|\bsweep\b|\bdisweep\b|\bswept\b/i, 'LIQUIDITY SWEEP'],
    [/\bbreak\b/i, 'BREAK']
  ];

  function normalizeToken(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function detectPair(text) {
    const words = text.split(/[\s,.;:()\[\]]+/);
    for (const w of words) {
      const key = normalizeToken(w);
      if (key && PAIR_SYNONYMS[key]) return PAIR_SYNONYMS[key];
    }
    // also try official pair names typed directly (already-correct casing)
    const OFFICIAL = ['XAUUSD', 'NAS100', 'US30', 'EURUSD', 'GBPUSD'];
    for (const p of OFFICIAL) {
      if (new RegExp('\\b' + p + '\\b', 'i').test(text)) return p;
    }
    return '';
  }

  function detectDirection(text) {
    const buyMatch = text.match(/\b(buy|long)\b/i);
    const sellMatch = text.match(/\b(sell|short)\b/i);
    if (buyMatch && sellMatch) {
      return buyMatch.index <= sellMatch.index ? 'BUY' : 'SELL';
    }
    if (buyMatch) return 'BUY';
    if (sellMatch) return 'SELL';
    return '';
  }

  function detectSessions(text) {
    const found = [];
    const push = (v) => { if (!found.includes(v)) found.push(v); };
    if (/\bny\s*am\b|new york am/i.test(text)) push('NEW YORK AM');
    if (/\bny\s*pm\b|new york pm/i.test(text)) push('NEW YORK PM');
    if (/london session\b|\blondon\b(?!\s+(high|low))/i.test(text)) push('LONDON SESSION');
    if (/asia session\b|\basia\b(?!\s+(high|low))/i.test(text)) push('ASIA SESSION');
    return found;
  }

  function detectModels(text) {
    const found = [];
    MODEL_PATTERNS.forEach(([re, label]) => {
      if (re.test(text) && !found.includes(label)) found.push(label);
    });
    return found;
  }

  function detectTimeframes(text) {
    const found = [];
    const re = /\b(H4|H1|M15|M5|M3|M1)\b/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      const v = m[1].toUpperCase();
      if (!found.includes(v)) found.push(v);
    }
    return found;
  }

  function detectPrice(text, keywordRe) {
    const m = text.match(keywordRe);
    if (!m) return '';
    const num = m[m.length - 1];
    return num !== undefined ? num : '';
  }

  function detectEntry(text) {
    return detectPrice(text, /\bentry\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
  }
  function detectSL(text) {
    return detectPrice(text, /\b(?:sl|stop\s*loss|stop)\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
  }
  function detectTP(text) {
    return detectPrice(text, /\b(?:tp|take\s*profit)\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
  }
  function detectRiskPercent(text) {
    const m = text.match(/\brisk\s*[:=]?\s*(\d+(?:\.\d+)?)\s*%/i);
    return m ? m[1] + '%' : '';
  }
  function detectTimeEntry(text) {
    const m = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\s*-\s*([01]?\d|2[0-3]):([0-5]\d)\b/);
    return m ? m[0] : '';
  }

  // Result: a bare TP/SL/BE token NOT immediately followed by a price
  // (":", "=" or a digit) is read as the trade outcome, not a price label.
  function detectResult(text) {
    let result = '';
    const re = /\b(TP|SL|BE|break\s*even)\b/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 6);
      const isPriceLabel = /^\s*[:=]?\s*\d/.test(after);
      if (!isPriceLabel) {
        const token = m[1].toUpperCase();
        result = token.startsWith('BREAK') ? 'BE' : token;
      }
    }
    return result;
  }

  function computeRR(direction, entry, sl, tp) {
    const e = parseFloat(entry), s = parseFloat(sl), t = parseFloat(tp);
    if (isNaN(e) || isNaN(s) || isNaN(t) || !direction) return '';
    let risk, reward;
    if (direction === 'BUY') {
      risk = Math.abs(e - s);
      reward = Math.abs(t - e);
    } else {
      risk = Math.abs(s - e);
      reward = Math.abs(e - t);
    }
    if (risk === 0) return '';
    const ratio = reward / risk;
    if (!isFinite(ratio)) return '';
    return '1:' + ratio.toFixed(2);
  }

  function buildAnalysisNote(d) {
    const parts = [];
    if (d.models.length) parts.push(`Setup terdeteksi: ${d.models.join(' + ')}.`);
    if (d.pair) parts.push(`Pair: ${d.pair}${d.direction ? ', arah ' + d.direction : ''}.`);
    if (d.sessions.length) parts.push(`Sesi: ${d.sessions.join(', ')}.`);
    if (d.rr) parts.push(`RR dihitung otomatis dari entry/SL/TP yang disebutkan: ${d.rr}.`);
    if (d.result) parts.push(`Hasil disebutkan sebagai ${d.result}.`);
    if (!parts.length) return 'Tidak cukup informasi untuk dianalisis dari teks yang diberikan.';
    return parts.join(' ');
  }

  function localExtract(text, images) {
    const pair = detectPair(text);
    const direction = detectDirection(text);
    const sessions = detectSessions(text);
    const models = detectModels(text);
    const timeframes = detectTimeframes(text);
    const entry = detectEntry(text);
    const sl = detectSL(text);
    const tp = detectTP(text);
    const riskPercent = detectRiskPercent(text);
    const timeEntry = detectTimeEntry(text);
    const result = detectResult(text);
    const rr = computeRR(direction, entry, sl, tp);

    const draft = {
      date: '', // user rarely states an absolute date; left for manual confirmation
      pair, sessions, direction, models,
      timeframes, entry, sl, tp,
      riskPercent, rr, result,
      timeEntry,
      note: text,
      mistake: '',
      images: images || []
    };
    draft.aiAnalysis = buildAnalysisNote(draft);

    const missing = [];
    if (!pair) missing.push('pair');
    if (!direction) missing.push('direction');
    if (!sessions.length) missing.push('session');
    if (!models.length) missing.push('model');
    if (!entry) missing.push('entry');
    if (!sl) missing.push('sl');
    if (!tp) missing.push('tp');
    if (!result) missing.push('result');

    const confident = !!(pair && direction && result);

    return { draft, missing, confident };
  }

  /* ============================================================
     3. UI controller
     ============================================================ */
  const PAIR_OPTIONS = RENDER.PAIR_OPTIONS;
  const SESSION_OPTIONS = RENDER.SESSION_OPTIONS;
  const MODEL_OPTIONS = RENDER.MODEL_OPTIONS;
  const TF_OPTIONS = RENDER.TF_OPTIONS;
  const RISK_OPTIONS = RENDER.RISK_OPTIONS;
  const esc = RENDER.esc;

  // Session-local draft, kept alive across analyze failures/retries so the
  // user's text and screenshots are never lost.
  const ai = {
    text: '',
    images: [],
    extraction: null, // last successful { draft, missing, confident, source }
    reviewDraft: null // editable copy shown in the review step
  };

  function modalRoot() { return document.getElementById('modal-root'); }

  function openAIJournal() {
    ai.text = '';
    ai.images = [];
    ai.extraction = null;
    ai.reviewDraft = null;
    renderInputStep();
  }

  function closeAIModal() {
    modalRoot().innerHTML = '';
  }

  /* ---------------- STEP 1: INPUT ---------------- */
  function renderInputStep(errorMsg) {
    const configured = AIJournalService.isConfigured();
    modalRoot().innerHTML = `
      <div class="modal-overlay" id="ai-modal-overlay">
        <div class="modal-sheet">
          <div class="modal-header">
            <div class="modal-title">✦ AI JOURNAL</div>
            <button class="icon-btn" id="ai-close-1">✕</button>
          </div>
          <div class="modal-body">
            ${!configured ? `
              <div class="ai-not-configured">
                <div class="tag">LOCAL MODE</div>
                <div>AI SERVICE NOT CONFIGURED — belum tersambung ke backend/API eksternal.
                Fitur tetap jalan memakai parser lokal (offline, tanpa API key) untuk membaca
                pair, session, direction, model, entry/SL/TP, dan RR dari teks kamu.</div>
              </div>
            ` : ''}
            ${errorMsg ? `<div class="insight-card warn">${esc(errorMsg)}</div>` : ''}
            <div class="form-group">
              <label class="form-label">TRADE DESCRIPTION</label>
              <textarea id="ai-input-text" class="ai-textarea" placeholder="Contoh:&#10;NQ buy NY AM. Asia low disweep, bullish SMT, lalu CISD. Entry 24500, SL 24480, TP 24540. TP kena.">${esc(ai.text)}</textarea>
            </div>
            <div class="form-group">
              <label class="form-label">ADD CHART SCREENSHOT</label>
              <div class="ai-shot-row" id="ai-shot-row">
                ${ai.images.map((img, i) => `<div class="ai-shot-thumb"><img src="${img}"/><button type="button" class="rm" data-ai-remove-img="${i}">✕</button></div>`).join('')}
                <label class="ai-shot-add">+<br/>SCREENSHOT<input type="file" id="ai-image-input" accept="image/*" multiple style="display:none;"/></label>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" id="ai-close-2">CANCEL</button>
            <button class="btn-primary" id="ai-analyze-btn">ANALYZE</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('ai-close-1').addEventListener('click', closeAIModal);
    document.getElementById('ai-close-2').addEventListener('click', closeAIModal);
    document.getElementById('ai-modal-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'ai-modal-overlay') closeAIModal();
    });

    const textarea = document.getElementById('ai-input-text');
    textarea.addEventListener('input', (e) => { ai.text = e.target.value; });

    document.getElementById('ai-image-input').addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      for (const file of files) {
        try {
          const dataUrl = await fileToCompressedDataURL(file);
          ai.images.push(dataUrl);
        } catch (err) {
          alert('Gagal memproses gambar: ' + file.name);
        }
      }
      renderInputStep();
    });

    modalRoot().querySelectorAll('[data-ai-remove-img]').forEach(btn => {
      btn.addEventListener('click', () => {
        ai.images.splice(parseInt(btn.dataset.aiRemoveImg, 10), 1);
        renderInputStep();
      });
    });

    document.getElementById('ai-analyze-btn').addEventListener('click', runAnalysis);
  }

  function fileToCompressedDataURL(file, maxDim, quality) {
    maxDim = maxDim || 1280;
    quality = quality || 0.72;
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => resolve(reader.result); // fallback: store original if decode fails
        img.onload = () => {
          try {
            let { width, height } = img;
            if (width > maxDim || height > maxDim) {
              const scale = maxDim / Math.max(width, height);
              width = Math.round(width * scale);
              height = Math.round(height * scale);
            }
            const canvas = document.createElement('canvas');
            canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', quality));
          } catch (e) {
            resolve(reader.result); // fallback: original data URL
          }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ---------------- ANALYZE ---------------- */
  async function runAnalysis() {
    if (!ai.text.trim() && !ai.images.length) {
      alert('Tulis cerita trade atau lampirkan screenshot dulu.');
      return;
    }
    renderLoadingStep();
    const result = await AIJournalService.analyzeTrade(ai.text, ai.images);
    if (!result.success) {
      renderInputStep(result.error || 'AI ANALYSIS FAILED');
      return;
    }
    ai.extraction = result.data;
    ai.extraction.source = result.source;
    ai.reviewDraft = JSON.parse(JSON.stringify(result.data.draft));
    renderReviewStep();
  }

  function renderLoadingStep() {
    modalRoot().innerHTML = `
      <div class="modal-overlay">
        <div class="modal-sheet">
          <div class="modal-header"><div class="modal-title">✦ AI JOURNAL</div></div>
          <div class="modal-body">
            <div class="ai-loading"><div class="ai-spinner"></div>ANALYZING...</div>
          </div>
        </div>
      </div>
    `;
  }

  /* ---------------- STEP 2: REVIEW BEFORE SAVE ---------------- */
  function chipGroupAI(name, options, selected) {
    selected = selected || [];
    return `<div class="chip-group" data-ai-chip-group="${name}">
      ${options.map(o => `<button type="button" class="chip ${selected.includes(o) ? 'selected' : ''}" data-ai-chip-value="${esc(o)}">${esc(o)}</button>`).join('')}
    </div>`;
  }

  function renderReviewStep() {
    const { missing, confident } = ai.extraction;
    const d = ai.reviewDraft;
    const isMissing = (f) => missing.includes(f);
    const source = ai.extraction.source === 'remote-api' ? 'REMOTE AI' : 'LOCAL PARSER (offline)';

    modalRoot().innerHTML = `
      <div class="modal-overlay" id="ai-review-overlay">
        <div class="modal-sheet">
          <div class="modal-header">
            <div class="modal-title">RYN AI ANALYSIS</div>
            <button class="icon-btn" id="ai-review-close">✕</button>
          </div>
          <div class="modal-body" id="ai-review-body">
            <span class="ai-status-badge ${confident ? 'confident' : 'review'}">
              ${confident ? '✓ AI CONFIDENT' : '⚠ NEEDS REVIEW'}
            </span>
            <div class="settings-sub" style="margin:-8px 0 14px;">Source: ${esc(source)}</div>

            <div class="ai-review-field ${isMissing('pair') ? 'warn' : ''}">
              <label class="form-label">PAIR</label>
              <select id="ai-f-pair">
                <option value="">-- pilih --</option>
                ${PAIR_OPTIONS.filter(p => p !== 'CUSTOM').map(p => `<option value="${p}" ${d.pair === p ? 'selected' : ''}>${p}</option>`).join('')}
              </select>
              ${isMissing('pair') ? '<div class="ai-field-hint">⚠ PAIR NOT DETECTED</div>' : ''}
            </div>

            <div class="ai-review-field ${isMissing('session') ? 'warn' : ''}">
              <label class="form-label">SESSION</label>
              ${chipGroupAI('sessions', SESSION_OPTIONS, d.sessions)}
              ${isMissing('session') ? '<div class="ai-field-hint">⚠ SESSION NOT DETECTED</div>' : ''}
            </div>

            <div class="ai-review-field ${isMissing('direction') ? 'warn' : ''}">
              <label class="form-label">DIRECTION</label>
              ${chipGroupAI('direction', ['BUY', 'SELL'], d.direction ? [d.direction] : [])}
              ${isMissing('direction') ? '<div class="ai-field-hint">⚠ DIRECTION NOT DETECTED</div>' : ''}
            </div>

            <div class="ai-review-field ${isMissing('model') ? 'warn' : ''}">
              <label class="form-label">MODEL / CONFLUENCE</label>
              ${chipGroupAI('models', MODEL_OPTIONS, d.models)}
              ${isMissing('model') ? '<div class="ai-field-hint">⚠ MODEL NOT DETECTED</div>' : ''}
            </div>

            <div class="form-group">
              <label class="form-label">TIME FRAME</label>
              ${chipGroupAI('timeframes', TF_OPTIONS, d.timeframes)}
            </div>

            <div class="row-2">
              <div class="ai-review-field ${isMissing('entry') ? 'warn' : ''}">
                <label class="form-label">ENTRY</label>
                <input type="text" id="ai-f-entry" value="${esc(d.entry)}" placeholder="--" />
                ${isMissing('entry') ? '<div class="ai-field-hint">⚠ ENTRY NOT DETECTED</div>' : ''}
              </div>
              <div class="ai-review-field ${isMissing('sl') ? 'warn' : ''}">
                <label class="form-label">SL</label>
                <input type="text" id="ai-f-sl" value="${esc(d.sl)}" placeholder="--" />
                ${isMissing('sl') ? '<div class="ai-field-hint">⚠ SL NOT DETECTED</div>' : ''}
              </div>
            </div>
            <div class="row-2">
              <div class="ai-review-field ${isMissing('tp') ? 'warn' : ''}">
                <label class="form-label">TP</label>
                <input type="text" id="ai-f-tp" value="${esc(d.tp)}" placeholder="--" />
                ${isMissing('tp') ? '<div class="ai-field-hint">⚠ TP NOT DETECTED</div>' : ''}
              </div>
              <div class="form-group">
                <label class="form-label">RR (auto)</label>
                <input type="text" id="ai-f-rr" value="${esc(d.rr)}" placeholder="--" />
              </div>
            </div>

            <div class="row-2">
              <div class="form-group">
                <label class="form-label">RISK / TRADE</label>
                <select id="ai-f-risk">
                  <option value="">-- pilih --</option>
                  ${RISK_OPTIONS.filter(r => r !== 'CUSTOM').map(r => `<option value="${r}" ${d.riskPercent === r ? 'selected' : ''}>${r}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">TIME ENTRY</label>
                <input type="text" id="ai-f-time" value="${esc(d.timeEntry)}" placeholder="10:10 - 10:25" />
              </div>
            </div>

            <div class="ai-review-field ${isMissing('result') ? 'warn' : ''}">
              <label class="form-label">RESULT</label>
              ${chipGroupAI('result', ['TP', 'SL', 'BE'], d.result ? [d.result] : [])}
              ${isMissing('result') ? '<div class="ai-field-hint">⚠ RESULT NOT DETECTED</div>' : ''}
            </div>

            <div class="form-group">
              <label class="form-label">DATE</label>
              <input type="date" id="ai-f-date" value="${esc(d.date || new Date().toISOString().slice(0,10))}" />
            </div>

            <div class="form-group">
              <label class="form-label">NOTE</label>
              <textarea id="ai-f-note">${esc(d.note)}</textarea>
            </div>

            <div class="ai-note-box">
              <div class="ai-note-label">AI ANALYSIS (factual, auto-generated)</div>
              ${esc(d.aiAnalysis)}
            </div>

            ${d.images && d.images.length ? `<div class="img-thumb-row" style="margin-top:12px;">${d.images.map(img => `<div class="img-thumb"><img src="${img}"/></div>`).join('')}</div>` : ''}
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" id="ai-edit-back">EDIT</button>
            <button class="btn-primary" id="ai-confirm-save">CONFIRM &amp; SAVE</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('ai-review-close').addEventListener('click', closeAIModal);
    document.getElementById('ai-review-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'ai-review-overlay') closeAIModal();
    });
    document.getElementById('ai-edit-back').addEventListener('click', () => renderInputStep());

    bindReviewFieldEvents();

    document.getElementById('ai-confirm-save').addEventListener('click', confirmAndSave);
  }

  function bindReviewFieldEvents() {
    const body = document.getElementById('ai-review-body');
    const d = ai.reviewDraft;

    body.querySelector('#ai-f-pair').addEventListener('change', (e) => { d.pair = e.target.value; });
    body.querySelector('#ai-f-entry').addEventListener('input', (e) => { d.entry = e.target.value; recomputeRR(); });
    body.querySelector('#ai-f-sl').addEventListener('input', (e) => { d.sl = e.target.value; recomputeRR(); });
    body.querySelector('#ai-f-tp').addEventListener('input', (e) => { d.tp = e.target.value; recomputeRR(); });
    body.querySelector('#ai-f-rr').addEventListener('input', (e) => { d.rr = e.target.value; });
    body.querySelector('#ai-f-risk').addEventListener('change', (e) => { d.riskPercent = e.target.value; });
    body.querySelector('#ai-f-time').addEventListener('input', (e) => { d.timeEntry = e.target.value; });
    body.querySelector('#ai-f-date').addEventListener('change', (e) => { d.date = e.target.value; });
    body.querySelector('#ai-f-note').addEventListener('input', (e) => { d.note = e.target.value; });

    body.querySelectorAll('[data-ai-chip-group]').forEach(group => {
      const groupName = group.dataset.aiChipGroup;
      const singleSelect = groupName === 'direction' || groupName === 'result';
      group.querySelectorAll('.chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const value = chip.dataset.aiChipValue;
          if (singleSelect) {
            d[groupName] = value;
          } else {
            const arr = d[groupName] || [];
            const idx = arr.indexOf(value);
            if (idx >= 0) arr.splice(idx, 1); else arr.push(value);
            d[groupName] = arr;
          }
          if (groupName === 'direction') recomputeRR();
          chip.classList.toggle('selected');
        });
      });
    });
  }

  function recomputeRR() {
    const d = ai.reviewDraft;
    const auto = computeRR(d.direction, d.entry, d.sl, d.tp);
    if (auto) {
      d.rr = auto;
      const rrInput = document.getElementById('ai-f-rr');
      if (rrInput) rrInput.value = auto;
    }
  }

  /* ---------------- CONFIRM & SAVE ---------------- */
  async function confirmAndSave() {
    const d = ai.reviewDraft;
    if (!d.pair) { alert('Pilih pair terlebih dahulu.'); return; }
    if (!d.direction) { alert('Pilih direction (BUY/SELL) terlebih dahulu.'); return; }
    if (!d.result) { alert('Pilih result (TP/SL/BE) terlebih dahulu.'); return; }

    const APP = window.RYNAPP;
    const isOfficialPair = PAIR_OPTIONS.includes(d.pair) && d.pair !== 'CUSTOM';

    const trade = {
      id: APP.uid(),
      date: d.date || new Date().toISOString().slice(0, 10),
      days: [],
      pairs: isOfficialPair ? [d.pair] : ['CUSTOM'],
      customPair: isOfficialPair ? '' : d.pair,
      sessions: d.sessions || [],
      direction: d.direction,
      models: d.models || [],
      timeframes: d.timeframes || [],
      rr: d.rr ? 'CUSTOM' : '',
      customRR: d.rr || '',
      risk: RISK_OPTIONS.includes(d.riskPercent) ? d.riskPercent : (d.riskPercent ? 'CUSTOM' : ''),
      customRisk: RISK_OPTIONS.includes(d.riskPercent) ? '' : (d.riskPercent || ''),
      result: d.result,
      timeEntry: d.timeEntry || '',
      idealR: '',
      note: d.note || '',
      images: d.images || [],
      // Additive AI metadata — existing trade objects simply won't have these
      // fields, and CSV/backup export already tolerates unknown/undefined props.
      aiAnalysis: d.aiAnalysis || '',
      aiConfidence: ai.extraction.confident ? 'confident' : 'needs_review',
      aiSource: ai.extraction.source || 'local-heuristic'
    };

    if (!trade.days.length) {
      const dow = CALC.dayOfWeekFromDate(trade.date);
      if (dow && APP.DAY_OPTIONS_INCLUDES(dow)) trade.days = [dow];
    }

    try {
      await APP.persistTrade(trade);
    } catch (err) {
      alert('Gagal menyimpan trade: ' + err.message);
      return;
    }

    closeAIModal();
    APP.renderPage();
    showToast('TRADE SAVED ✓');
  }

  function showToast(msg) {
    const el = document.createElement('div');
    el.className = 'ai-toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }

  /* ---------------- BIND ENTRY BUTTON ---------------- */
  const btn = document.getElementById('btn-ai-journal');
  if (btn) btn.addEventListener('click', openAIJournal);

  // Exposed for debugging / future extension (e.g. a real backend proxy
  // can be tested from the console with AIJournalService.analyzeTrade(...)).
  window.AIJournalService = AIJournalService;
})();
