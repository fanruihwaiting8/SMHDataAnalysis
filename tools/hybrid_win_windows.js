// 混合保护策略 vs 动态策略：逐月进场，找出「混合跑赢」的连续进场区间
// 口径：初始 100,000（SMH 18,000 + SOXL 82,000），默认档位，trendDeepDD=35
// 用法：jsc tools/hybrid_win_windows.js   （须在项目根目录执行）
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
function fin(s, e, extra) { return runBacktest(opts(s, e, extra)).finalTotal; }
function pad(s, n) { s = String(s); while (s.length < n) s = " " + s; return s; }
function money(v) { return Math.round(v).toLocaleString ? Math.round(v).toLocaleString("en-US") : String(Math.round(v)); }
function addYears(d, y) { var p = d.split("-"); return (Number(p[0]) + y) + "-" + p[1] + "-" + p[2]; }

var allDates = window.PRICE_DATA.SMH.dates;
var dates = allDates.filter(function (d) { return d >= "2010-03-11"; });
var LAST = dates[dates.length - 1];
var starts = [], seen = {};
dates.forEach(function (d) { var m = d.slice(0, 7); if (!seen[m]) { seen[m] = 1; starts.push(d); } });

// ---- 1) 进场 → 持有到今天 ----
print("===== 逐月进场，持有到 " + LAST + " =====");
print(pad("进场月", 8) + " | " + pad("动态终值", 12) + " | " + pad("混合终值", 12) + " | 混合/动态");
var rowsNow = [];
starts.forEach(function (s) {
  var b = fin(s, LAST, { trendOn: false });
  var h = fin(s, LAST, { trendOn: true, trendDeepDD: 35 });
  rowsNow.push({ s: s, b: b, h: h, r: h / b });
});
rowsNow.forEach(function (r) {
  print(pad(r.s.slice(0, 7), 8) + " | " + pad(money(r.b), 12) + " | " + pad(money(r.h), 12)
    + " | " + r.r.toFixed(3) + (r.r > 1 ? "  WIN" : ""));
});

function segs(rows) {
  var out = [], cur = null;
  rows.forEach(function (r) {
    if (r.r > 1) { if (!cur) cur = { a: r.s, b: r.s, best: r }; else { cur.b = r.s; if (r.r > cur.best.r) cur.best = r; } }
    else if (cur) { out.push(cur); cur = null; }
  });
  if (cur) out.push(cur);
  return out;
}
print("\n-- 混合跑赢的连续进场区间（持有到今天）--");
segs(rowsNow).forEach(function (g) {
  print(g.a.slice(0, 7) + " ~ " + g.b.slice(0, 7) + "  最佳 " + g.best.s.slice(0, 7)
    + "  动态 " + money(g.best.b) + " vs 混合 " + money(g.best.h) + "  = " + g.best.r.toFixed(2) + "x");
});

// ---- 2) 固定持有期滚动 ----
[1, 2, 3].forEach(function (yrs) {
  var rows = [];
  starts.forEach(function (s) {
    var e = addYears(s, yrs);
    if (e > LAST) return;
    var b = fin(s, e, { trendOn: false });
    var h = fin(s, e, { trendOn: true, trendDeepDD: 35 });
    rows.push({ s: s, e: e, b: b, h: h, r: h / b });
  });
  print("\n===== 持有 " + yrs + " 年，混合跑赢的连续进场区间（n=" + rows.length + "，胜率 "
    + (rows.filter(function (r) { return r.r > 1; }).length / rows.length * 100).toFixed(0) + "%）=====");
  segs(rows).forEach(function (g) {
    if (g.a === g.b && g.best.r < 1.05) return;
    print(pad(g.a.slice(0, 7) + " ~ " + g.b.slice(0, 7), 18)
      + " | 区间内最佳 " + g.best.s.slice(0, 7) + "→" + g.best.e.slice(0, 7)
      + "  动态 " + pad(money(g.best.b), 10) + " vs 混合 " + pad(money(g.best.h), 10)
      + "  = " + g.best.r.toFixed(2) + "x");
  });
});

// ---- 3) 指定对照组：几个用户容易对上号的进场点 ----
var PICKS = [
  ["2021-11-19", "2022-10-14", "2021年11月高点进 → 2022熊底"],
  ["2021-11-19", "2023-12-29", "2021年11月高点进 → 2023年底"],
  ["2021-11-19", LAST, "2021年11月高点进 → 今"],
  ["2022-01-03", LAST, "2022年初进 → 今"],
  ["2024-07-10", LAST, "2024年7月高点进 → 今"],
  ["2025-01-02", LAST, "2025年初进 → 今"],
  ["2020-02-19", "2020-12-31", "2020疫情前高点进 → 2020年底"],
  ["2018-03-12", "2019-06-28", "2018贸易战前进 → 2019年中"],
];
print("\n===== 指定对照组（初始 100,000）=====");
PICKS.forEach(function (p) {
  var b = fin(p[0], p[1], { trendOn: false });
  var h = fin(p[0], p[1], { trendOn: true, trendDeepDD: 35 });
  print(pad(p[2], 30) + " | 动态 " + pad(money(b), 11) + " | 混合 " + pad(money(h), 11)
    + " | " + (h / b).toFixed(2) + "x");
});