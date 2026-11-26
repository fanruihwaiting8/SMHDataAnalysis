// 滚动窗口 × 市场状态扫描：回答「有没有一个全局最优策略」
// 每季度取一个起点，分别跑 3/5/10 年窗口，比较：
//   base  = 动态策略（纯回撤补仓/反弹减仓，无趋势过滤）
//   hyb   = 混合保护（趋势过滤 + 深跌交还 35%）
//   trend = 纯趋势过滤（深跌交还 = 0）
// 并按窗口内基准端(SMH)的年化涨幅把窗口分成 牛 / 震荡 / 熊 三类。
// 用法：jsc tools/regime_scan.js   （须在项目根目录执行）
var window = this;
load("web/data.js");
load("web/backtest.js");

var DD = { 15: 0, 25: 25, 35: 75, 45: 90, 50: 50 };
var RB = { 50: 0, 100: 0, 200: 100 };
var CAP_A = 18000, CAP_B = 82000, INIT = CAP_A + CAP_B;

function opts(s, e, extra) {
  var o = {
    keyA: "SMH", keyB: "SOXL", capA: CAP_A, capB: CAP_B,
    drawdowns: DD, rebounds: RB, startDate: s, endDate: e,
    monthlyPct: 0, holdDays: 0, holdRatio: 0,
  };
  for (var k in extra) o[k] = extra[k];
  return o;
}

function maxDD(arr) {
  var peak = -Infinity, worst = 0;
  for (var i = 0; i < arr.length; i++) {
    var v = arr[i];
    if (v == null) continue;
    if (v > peak) peak = v;
    var d = (peak - v) / peak * 100;
    if (d > worst) worst = d;
  }
  return worst;
}

function one(s, e, extra) {
  var r = runBacktest(opts(s, e, extra));
  return { mult: r.finalTotal / INIT, dd: maxDD(r.equityStrategy), n: r.trades.length };
}

// 交易日轴（SMH/SOXL 交集后的实际起点约 2010-03）
var dates = window.PRICE_DATA.SMH.dates.filter(function (d) { return d >= "2010-03-11"; });
var closes = {};
window.PRICE_DATA.SMH.dates.forEach(function (d, i) { closes[d] = window.PRICE_DATA.SMH.closes[i]; });

function addYears(d, y) {
  var p = d.split("-");
  return (Number(p[0]) + y) + "-" + p[1] + "-" + p[2];
}
function pad(s, n) { s = String(s); while (s.length < n) s = " " + s; return s; }

// 每季度取一个起点
var starts = [];
var seen = {};
dates.forEach(function (d) {
  var q = d.slice(0, 4) + "Q" + Math.floor((Number(d.slice(5, 7)) - 1) / 3);
  if (!seen[q]) { seen[q] = 1; starts.push(d); }
});

var LAST = dates[dates.length - 1];

[3, 5, 10].forEach(function (yrs) {
  var rows = [];
  starts.forEach(function (s) {
    var e = addYears(s, yrs);
    if (e > LAST) return;
    var pxS = closes[s], pxE = null;
    for (var i = 0; i < dates.length; i++) { if (dates[i] <= e) pxE = closes[dates[i]]; }
    var smhCagr = (Math.pow(pxE / pxS, 1 / yrs) - 1) * 100;
    rows.push({
      s: s, regime: smhCagr > 15 ? "牛" : (smhCagr < 0 ? "熊" : "震荡"),
      smh: smhCagr,
      b: one(s, e, { trendOn: false }),
      h: one(s, e, { trendOn: true, trendDeepDD: 35 }),
      t: one(s, e, { trendOn: true, trendDeepDD: 0 }),
    });
  });

  print("\n===== 滚动 " + yrs + " 年窗口（共 " + rows.length + " 个起点）=====");
  ["牛", "震荡", "熊", "全部"].forEach(function (g) {
    var sub = g === "全部" ? rows : rows.filter(function (r) { return r.regime === g; });
    if (!sub.length) { print(pad(g, 4) + " | 无样本"); return; }
    function avg(f) { return sub.reduce(function (a, r) { return a + f(r); }, 0) / sub.length; }
    function win(f) { return sub.filter(f).length / sub.length * 100; }
    print(pad(g, 4) + " n=" + pad(sub.length, 3)
      + " | 基线 " + pad(avg(function (r) { return r.b.mult; }).toFixed(2) + "x", 8)
      + " DD" + pad("-" + avg(function (r) { return r.b.dd; }).toFixed(0) + "%", 5)
      + " | 混合 " + pad(avg(function (r) { return r.h.mult; }).toFixed(2) + "x", 8)
      + " DD" + pad("-" + avg(function (r) { return r.h.dd; }).toFixed(0) + "%", 5)
      + " 胜率" + pad(win(function (r) { return r.h.mult > r.b.mult; }).toFixed(0) + "%", 4)
      + " | 纯趋势 " + pad(avg(function (r) { return r.t.mult; }).toFixed(2) + "x", 8)
      + " DD" + pad("-" + avg(function (r) { return r.t.dd; }).toFixed(0) + "%", 5)
      + " 胜率" + pad(win(function (r) { return r.t.mult > r.b.mult; }).toFixed(0) + "%", 4));
  });
});