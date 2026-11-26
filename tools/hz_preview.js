// 预览「按持有年限的建议」表（与 web/app.js 里 horizonAdvice 同算法）
// 跑法: jsc tools/hz_preview.js
var window = this;
load("web/data.js");
load("web/backtest.js");
var BT = window.SMH_BT;
var DD = BT.DRAWDOWN_LEVELS, RB = BT.REBOUND_LEVELS;
var dd = { 15: 0, 25: 25, 35: 75, 45: 90, 50: 50 };
var rb = { 50: 0, 100: 0, 200: 100 };
var A = "SMH", B = "SOXL", TOTAL = 10000;
var HZ = [252, 756, 1260, 2520], W_STEP = 20, MAXS = 12, MINS = 3, TIE = 0.02;
var OFF = { trendOn: false };
var HYB = { trendOn: true, trendLong: 200, trendShort: 50, trendBuf: 3,
  trendConfirm: 2, trendShortCut: 30, trendDeepDD: 35,
  trendBlockAdd: true, trendReenter: true };

function median(a) { a = a.slice().sort(function (x, y) { return x - y; });
  var n = a.length; if (!n) return NaN;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2; }

function quantile(a, q) {
  a = a.slice().sort(function (x, y) { return x - y; });
  if (!a.length) return NaN;
  var pos = (a.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (pos - lo);
}

function pickSamples(tl, st, hold) {
  var useDd = st.troughStale, cand = [];
  for (var i = 0; i < tl.length - hold; i++) {
    var d = tl[i];
    if (d.phase !== st.phase) continue;
    if (useDd) { if (Math.abs(d.ddPct - st.ddPct) > 5) continue; }
    else if (Math.abs(d.rbPct - st.rbPct) > 15) continue;
    var p = cand[cand.length - 1];
    if (p && d.index - p.index < 20) continue;
    cand.push({ index: d.index, start: d.date, end: tl[i + hold].date });
  }
  if (cand.length <= MAXS) return cand;
  var out = [], step = (cand.length - 1) / (MAXS - 1);
  for (var k = 0; k < MAXS; k++) out.push(cand[Math.round(k * step)]);
  return out;
}

function evalWeight(samples, w, t) {
  var capB = TOTAL * w / 100, capA = TOTAL - capB, mu = [], ds = [], used = 0;
  samples.forEach(function (s) {
    var o = { keyA: A, keyB: B, capA: capA, capB: capB, drawdowns: dd, rebounds: rb,
      startDate: s.start, endDate: s.end, monthlyPct: 0, holdDays: 0, holdRatio: 1 };
    for (var k in t) o[k] = t[k];
    var r; try { r = BT.runBacktest(o); } catch (e) { return; }
    var m = BT.calcMetrics(r.equityDates, r.equityStrategy);
    if (!m) return;
    used++; mu.push(r.finalTotal / (r.totalInvested || TOTAL));
    ds.push(Math.abs(m.maxDD) * 100);
  });
  if (!used) return null;
  return { w: w, n: used, medMult: median(mu), medDD: median(ds),
    p25Mult: quantile(mu, 0.25), minMult: Math.min.apply(null, mu) };
}

function pickRec(list) {
  if (!list.length) return null;
  var top = list.slice().sort(function (x, y) { return y.medMult - x.medMult; })[0];
  var tie = list.filter(function (r) { return r.medMult >= top.medMult * (1 - TIE); });
  return tie.slice().sort(function (x, y) { return x.medDD - y.medDD; })[0] || top;
}

// 年限表专用：按「样本内最差情形终值」选优（短持有期会自动压低杠杆端占比）
function pickHz(list) {
  if (!list.length) return null;
  var top = list.slice().sort(function (x, y) { return y.minMult - x.minMult; })[0];
  var tie = list.filter(function (r) { return r.minMult >= top.minMult * 0.95; });
  return tie.slice().sort(function (x, y) { return x.medDD - y.medDD; })[0] || top;
}

var st = BT.computeLiveState(A, B), tl = BT.phaseTimeline(A, B);
var ddFired = {}; st.ddFired.forEach(function (l) { ddFired[l] = 1; });
var base = 100, lev = 0;
DD.forEach(function (lv) { if (!ddFired[lv] && st.ddPct < lv) return;
  var amt = base * (dd[lv] || 0) / 100; base -= amt; lev += amt; });
var cap = Math.round(Math.max(0, Math.min(100, lev)) / 5) * 5;
print("phase=" + st.phase + " ddPct=" + st.ddPct.toFixed(2) + " cap=" + cap + "%");
var ws = []; for (var w = 0; w <= 100; w += W_STEP) if (w <= cap) ws.push(w);
if (cap > 0 && ws[ws.length - 1] !== cap) ws.push(cap);
if (!ws.length) ws = [0];
print("weights=" + ws.join(","));
HZ.forEach(function (days) {
  var s = pickSamples(tl, st, days);
  if (s.length < MINS) { print((days / 252) + "y  samples=" + s.length + "  不足"); return; }
  var rows = []; ws.forEach(function (w) { var r = evalWeight(s, w, OFF); if (r) rows.push(r); });
  rows.forEach(function (r) {
    var ann = Math.pow(r.medMult, 252 / days) - 1;
    print("   w=" + r.w + "% med=" + r.medMult.toFixed(2) + "x p25=" + r.p25Mult.toFixed(2)
      + "x min=" + r.minMult.toFixed(2) + "x dd=" + r.medDD.toFixed(1)
      + "% ann=" + (ann * 100).toFixed(1) + "% ann/dd=" + (ann / (r.medDD / 100)).toFixed(2));
  });
  var rec = pickHz(rows); if (!rec) { print((days / 252) + "y none"); return; }
  var p = evalWeight(s, rec.w, HYB);
  print((days / 252) + "y n=" + s.length + "  rec w=" + rec.w + "%  med=" + rec.medMult.toFixed(2)
    + "x worst=" + rec.minMult.toFixed(2) + "x dd=" + rec.medDD.toFixed(1) + "%   protect med="
    + (p ? p.medMult.toFixed(2) + "x worst=" + p.minMult.toFixed(2) + "x dd="
    + p.medDD.toFixed(1) + "%  gain=" + (p.medMult / rec.medMult).toFixed(2) : "n/a"));
});