/* ============================================================
   RYN THE JOURNAL — Calculation engine
   All numbers are derived strictly from real trade data.
   Nothing here is faked or hardcoded.
   ============================================================ */

// Parse an RR string like "1:2", "1:1.5", "1:3" or a raw custom number into its numeric ratio.
function parseRR(rrStr) {
  if (rrStr === undefined || rrStr === null || rrStr === '') return NaN;
  const s = String(rrStr).trim();
  if (s.includes(':')) {
    const parts = s.split(':');
    const num = parseFloat(parts[1]);
    return isNaN(num) ? NaN : num;
  }
  const num = parseFloat(s);
  return isNaN(num) ? NaN : num;
}

// Result of a single trade expressed in R multiples.
// TP  -> + RR ratio (planned reward)
// SL  -> -1R (the defined risk unit)
// BE  -> 0R
function tradeR(trade) {
  const rr = parseRR(trade.rr);
  if (trade.result === 'TP') return isNaN(rr) ? 0 : rr;
  if (trade.result === 'SL') return -1;
  return 0; // BE
}

function fmtR(n, decimals = 2) {
  if (n === null || n === undefined || isNaN(n)) return '--';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(decimals)}R`;
}

function fmtPct(n, decimals = 1) {
  if (n === null || n === undefined || isNaN(n)) return '--';
  return `${n.toFixed(decimals)}%`;
}

function fmtNum(n, decimals = 2) {
  if (n === null || n === undefined || isNaN(n)) return '--';
  return n.toFixed(decimals);
}

// Build a cumulative equity (R) curve from a date-sorted trade list.
function buildEquitySeries(sortedTrades) {
  let cum = 0;
  const points = [{ label: 'START', value: 0 }];
  sortedTrades.forEach(t => {
    cum += tradeR(t);
    points.push({ label: t.date, value: Number(cum.toFixed(4)) });
  });
  return points;
}

// Core statistics for any array of trades (already filtered by caller).
function computeStats(trades) {
  const n = trades.length;
  const base = {
    n, win: 0, loss: 0, be: 0,
    winRate: 0, lossRate: 0,
    totalR: 0, avgR: 0,
    avgRR: null, maxRR: null,
    idealAvgRR: null, maxIdealRR: null,
    couldHaveProfit: 0, couldHaveBE: 0,
    expectancy: 0, profitFactor: null,
    maxConsecWin: 0, maxConsecLoss: 0,
    best: null, worst: null,
    equitySeries: [{ label: 'START', value: 0 }]
  };
  if (n === 0) return base;

  const sorted = [...trades].sort((a, b) => new Date(a.date) - new Date(b.date));

  let win = 0, loss = 0, be = 0;
  let totalR = 0;
  const rrValues = [];
  const idealValues = [];
  const winRs = [];
  const lossRs = [];
  let couldHaveProfit = 0, couldHaveBE = 0;
  let bestTrade = sorted[0], worstTrade = sorted[0];
  let bestR = tradeR(sorted[0]), worstR = tradeR(sorted[0]);

  let streakType = null, streak = 0, maxConsecWin = 0, maxConsecLoss = 0;

  sorted.forEach(t => {
    const r = tradeR(t);
    totalR += r;

    const rrVal = parseRR(t.rr);
    if (!isNaN(rrVal)) rrValues.push(rrVal);

    if (t.idealR !== undefined && t.idealR !== null && t.idealR !== '') {
      const ideal = parseFloat(t.idealR);
      if (!isNaN(ideal)) {
        idealValues.push(ideal);
        if (t.result === 'SL' && ideal > 0.05) couldHaveProfit++;
        else if (t.result === 'SL' && ideal >= -0.05 && ideal <= 0.05) couldHaveBE++;
      }
    }

    if (t.result === 'TP') { win++; winRs.push(r); }
    else if (t.result === 'SL') { loss++; lossRs.push(r); }
    else { be++; }

    if (r > bestR) { bestR = r; bestTrade = t; }
    if (r < worstR) { worstR = r; worstTrade = t; }

    if (t.result === 'TP') {
      streak = (streakType === 'TP') ? streak + 1 : 1;
      streakType = 'TP';
      maxConsecWin = Math.max(maxConsecWin, streak);
    } else if (t.result === 'SL') {
      streak = (streakType === 'SL') ? streak + 1 : 1;
      streakType = 'SL';
      maxConsecLoss = Math.max(maxConsecLoss, streak);
    } else {
      streakType = null; streak = 0;
    }
  });

  const winRate = (win / n) * 100;
  const lossRate = (loss / n) * 100;
  const avgR = totalR / n;
  const avgRR = rrValues.length ? rrValues.reduce((a, b) => a + b, 0) / rrValues.length : null;
  const maxRR = rrValues.length ? Math.max(...rrValues) : null;
  const idealAvgRR = idealValues.length ? idealValues.reduce((a, b) => a + b, 0) / idealValues.length : null;
  const maxIdealRR = idealValues.length ? Math.max(...idealValues) : null;

  const avgWinR = winRs.length ? winRs.reduce((a, b) => a + b, 0) / winRs.length : 0;
  const avgLossR = lossRs.length ? Math.abs(lossRs.reduce((a, b) => a + b, 0) / lossRs.length) : 0;
  const expectancy = (win / n) * avgWinR - (loss / n) * avgLossR;

  const grossWin = winRs.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(lossRs.reduce((a, b) => a + b, 0));
  const profitFactor = grossLoss === 0 ? null : grossWin / grossLoss;

  return {
    n, win, loss, be, winRate, lossRate, totalR, avgR,
    avgRR, maxRR, idealAvgRR, maxIdealRR,
    couldHaveProfit, couldHaveBE,
    expectancy, profitFactor,
    maxConsecWin, maxConsecLoss,
    best: bestTrade, worst: worstTrade,
    equitySeries: buildEquitySeries(sorted)
  };
}

// Group trades by a key function, returning [{ key, stats }] sorted by totalR desc.
function groupStats(trades, keyFn) {
  const map = new Map();
  trades.forEach(t => {
    const keys = keyFn(t); // keyFn may return a single key or an array of keys (for multi-select fields)
    const list = Array.isArray(keys) ? keys : [keys];
    list.forEach(k => {
      if (k === undefined || k === null || k === '') return;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(t);
    });
  });
  const rows = [];
  map.forEach((list, key) => {
    rows.push({ key, stats: computeStats(list) });
  });
  rows.sort((a, b) => b.stats.totalR - a.stats.totalR);
  return rows;
}

// Combination analysis: exact-match combos of pair + session + direction + models.
function combinationAnalysis(trades, minSample = 5) {
  const map = new Map();
  trades.forEach(t => {
    const pairPart = (t.pairs || []).slice().sort().join('+');
    const sessionPart = (t.sessions || []).slice().sort().join('+');
    const modelPart = (t.models || []).slice().sort().join('+');
    const key = [pairPart, sessionPart, t.direction, modelPart].filter(Boolean).join(' | ');
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(t);
  });
  const rows = [];
  map.forEach((list, key) => {
    if (list.length < minSample) return;
    rows.push({ key, stats: computeStats(list) });
  });
  const top = [...rows].sort((a, b) => b.stats.totalR - a.stats.totalR).slice(0, 10);
  const worst = [...rows].sort((a, b) => a.stats.totalR - b.stats.totalR).slice(0, 10);
  return { rows, top, worst };
}

// Simple, evidence-based pattern insights. Never asserts causation, only describes the data.
function patternInsights(trades, minSample = 5) {
  const insights = [];
  if (trades.length < minSample) {
    return [{ type: 'neutral', text: `Data belum cukup untuk analisis pola (minimum ${minSample} trade).` }];
  }

  const bySession = groupStats(trades, t => t.sessions).filter(r => r.stats.n >= minSample);
  const byPair = groupStats(trades, t => t.pairs).filter(r => r.stats.n >= minSample);
  const byDirection = groupStats(trades, t => t.direction).filter(r => r.stats.n >= minSample);
  const byDay = groupStats(trades, t => t.days).filter(r => r.stats.n >= minSample);
  const byModel = groupStats(trades, t => t.models).filter(r => r.stats.n >= minSample);
  const byTF = groupStats(trades, t => t.timeframes).filter(r => r.stats.n >= minSample);

  function bestWorstByWinRate(rows) {
    if (!rows.length) return null;
    const sorted = [...rows].sort((a, b) => b.stats.winRate - a.stats.winRate);
    return { best: sorted[0], worst: sorted[sorted.length - 1] };
  }

  const sessBW = bestWorstByWinRate(bySession);
  if (sessBW && sessBW.best.key !== sessBW.worst.key) {
    insights.push({ type: 'good', text: `Data menunjukkan sesi ${sessBW.best.key} memiliki win rate tertinggi (${fmtPct(sessBW.best.stats.winRate)} dari ${sessBW.best.stats.n} trade).` });
    insights.push({ type: 'warn', text: `Data menunjukkan sesi ${sessBW.worst.key} memiliki win rate terendah (${fmtPct(sessBW.worst.stats.winRate)} dari ${sessBW.worst.stats.n} trade).` });
  }

  const dayBW = bestWorstByWinRate(byDay);
  if (dayBW && dayBW.best.key !== dayBW.worst.key) {
    insights.push({ type: 'neutral', text: `Data menunjukkan hari ${dayBW.worst.key} memiliki win rate terendah (${fmtPct(dayBW.worst.stats.winRate)}), sedangkan ${dayBW.best.key} tertinggi (${fmtPct(dayBW.best.stats.winRate)}).` });
  }

  if (byDirection.length === 2) {
    const [a, b] = byDirection;
    const better = a.stats.expectancy >= b.stats.expectancy ? a : b;
    const worse = better === a ? b : a;
    insights.push({ type: 'neutral', text: `Data menunjukkan arah ${better.key} memiliki performa lebih baik dibanding ${worse.key} (expectancy ${fmtR(better.stats.expectancy)} vs ${fmtR(worse.stats.expectancy)}).` });
  }

  if (byModel.length) {
    const bestModel = [...byModel].sort((a, b) => b.stats.totalR - a.stats.totalR)[0];
    insights.push({ type: 'good', text: `Data menunjukkan model "${bestModel.key}" menghasilkan total R terbesar (${fmtR(bestModel.stats.totalR)} dari ${bestModel.stats.n} trade).` });
    const worstModel = [...byModel].sort((a, b) => a.stats.totalR - b.stats.totalR)[0];
    if (worstModel.key !== bestModel.key && worstModel.stats.totalR < 0) {
      insights.push({ type: 'warn', text: `Data menunjukkan model "${worstModel.key}" mengalami ${worstModel.stats.loss} loss dari ${worstModel.stats.n} trade (total ${fmtR(worstModel.stats.totalR)}).` });
    }
  }

  const pairBW = bestWorstByWinRate(byPair);
  if (pairBW && pairBW.best.key !== pairBW.worst.key) {
    insights.push({ type: 'neutral', text: `Data menunjukkan pair ${pairBW.best.key} memiliki win rate tertinggi (${fmtPct(pairBW.best.stats.winRate)}).` });
  }

  const combo = combinationAnalysis(trades, minSample);
  if (combo.top.length) {
    const t = combo.top[0];
    insights.push({ type: 'good', text: `Data menunjukkan kombinasi [${t.key}] adalah yang paling profitable (${fmtR(t.stats.totalR)} dari ${t.stats.n} trade, win rate ${fmtPct(t.stats.winRate)}).` });
  }
  if (combo.worst.length && combo.worst[0].stats.totalR < 0) {
    const w = combo.worst[0];
    insights.push({ type: 'warn', text: `Data menunjukkan kombinasi [${w.key}] mengalami ${w.stats.loss} loss dari ${w.stats.n} trade (total ${fmtR(w.stats.totalR)}).` });
  }

  if (!insights.length) {
    insights.push({ type: 'neutral', text: 'Belum ditemukan pola yang signifikan dari data saat ini.' });
  }
  return insights;
}

// Group trades by "MMM YYYY" and by year.
function monthKey(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d)) return 'UNKNOWN';
  return d.toLocaleString('en-US', { month: 'short', year: 'numeric' }).toUpperCase();
}
function yearKey(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d)) return 'UNKNOWN';
  return String(d.getFullYear());
}
function dayOfWeekFromDate(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  const names = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
  return names[d.getDay()];
}

window.RYNCALC = {
  parseRR, tradeR, fmtR, fmtPct, fmtNum,
  buildEquitySeries, computeStats, groupStats,
  combinationAnalysis, patternInsights,
  monthKey, yearKey, dayOfWeekFromDate
};
