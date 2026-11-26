// 混合保护策略「什么时候更优」扫描
//   base = 动态策略（纯回撤补仓/反弹减仓）
//   hyb  = 混合保护（趋势过滤 + 深跌交还 35%）
// 三个维度：
//   A) 持有年限 × 进场位置（相对 SMH 历史高点的回撤深度）
//   B) 窗口内是否发生基准端 ≥X% 的深跌
//   C) 典型历史片段固定区间
// 用法：jsc tools/hybrid_edge_scan.js   （须在项目根目录执行）
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
function pad(s, n) { s = String(s); while (s.length < n) s = " " + s; return s; }
function addYears(d, y) { var p = d.split("-"); return (Number(p[0]) + y) + "-" + p[1] + "-" + p[2]; }

// ---- 交易日轴与 SMH 收盘 ----
var allDates = window.PRICE_DATA.SMH.dates;
var closes = {};
allDates.forEach(function (d, i) { closes[d] = window.PRICE_DATA.SMH.closes[i]; });
var dates = allDates.filter(function (d) { return d >= "2010-03-11"; });
var LAST = dates[dates.length - 1];

// 进场日相对「此前历史最高收盘」的回撤（用全量历史算高点，含 2010 之前）
var ddAtEntry = {};
(function () {
  var peak = -Infinity;
  allDates.forEach(function (d, i) {
    var c = window.PRICE_DATA.SMH.closes[i];
    if (c == null) return;
    if (c > peak) peak = c;
    ddAtEntry[d] = (peak - c) / peak * 100;
  });
})();

function pxAt(d) { // 不晚于 d 的最后一个收盘
  var v = null;
  for (var i = 0; i < dates.length; i++) { if (dates[i] <= d) v = closes[dates[i]]; }
  return v;
}
// 窗口内基准端的最大跌幅（峰到谷）
function windowWorstDD(s, e) {
  var peak = -Infinity, worst = 0;
  for (var i = 0; i < dates.length; i++) {
    var d = dates[i];
    if (d < s || d > e) continue;
    var c = closes[d];
    if (c == null) continue;
    if (c > peak) peak = c;
    var x = (peak - c) / peak * 100;
    if (x > worst) worst = x;
  }
  return worst;
}

// 每月取一个起点
var starts = [];
var seen = {};
dates.forEach(function (d) {
  var m = d.slice(0, 7);
  if (!seen[m]) { seen[m] = 1; starts.push(d); }
});

function group(rows, label) {
  if (!rows.length) { print(pad(label, 16) + " | 无样本"); return; }
  function avg(f) { return rows.reduce(function (a, r) { return a + f(r); }, 0) / rows.length; }
  function med(f) {
    var v = rows.map(f).sort(function (a, b) { return a - b; });
    var i = Math.floor((v.length - 1) / 2);
    return v.length % 2 ? v[i] : (v[i] + v[i + 1]) / 2;
  }
  var winR = rows.filter(function (r) { return r.h.mult > r.b.mult; }).length / rows.length * 100;
  print(pad(label, 16) + " n=" + pad(rows.length, 3)
    + " | 基线中位 " + pad(med(function (r) { return r.b.mult; }).toFixed(2) + "x", 9)
    + " DD" + pad("-" + avg(function (r) { return r.b.dd; }).toFixed(0) + "%", 5)
    + " | 混合中位 " + pad(med(function (r) { return r.h.mult; }).toFixed(2) + "x", 9)
    + " DD" + pad("-" + avg(function (r) { return r.h.dd; }).toFixed(0) + "%", 5)
    + " | 混合胜率 " + pad(winR.toFixed(0) + "%", 4)
    + " | 中位比 " + med(function (r) { return r.h.mult / r.b.mult; }).toFixed(2) + "x");
}

var YRS = [1, 2, 3, 5];
var cache = {};
YRS.forEach(function (yrs) {
  var rows = [];
  starts.forEach(function (s) {
    var e = addYears(s, yrs);
    if (e > LAST) return;
    rows.push({
      s: s, e: e, entryDD: ddAtEntry[s], wDD: windowWorstDD(s, e),
      smh: (Math.pow(pxAt(e) / closes[s], 1 / yrs) - 1) * 100,
      b: one(s, e, { trendOn: false }),
      h: one(s, e, { trendOn: true, trendDeepDD: 35 }),
    });
  });
  cache[yrs] = rows;

  print("\n===== 滚动 " + yrs + " 年窗口（每月一个起点，n=" + rows.length + "）=====");
  print("-- 按进场位置（SMH 距历史高点的回撤）--");
  group(rows.filter(function (r) { return r.entryDD <= 5; }), "高点附近≤5%");
  group(rows.filter(function (r) { return r.entryDD > 5 && r.entryDD <= 20; }), "回调 5-20%");
  group(rows.filter(function (r) { return r.entryDD > 20 && r.entryDD <= 40; }), "深跌 20-40%");
  group(rows.filter(function (r) { return r.entryDD > 40; }), "重跌 >40%");
  print("-- 按窗口内基准端最大跌幅 --");
  group(rows.filter(function (r) { return r.wDD < 25; }), "窗口内跌<25%");
  group(rows.filter(function (r) { return r.wDD >= 25 && r.wDD < 40; }), "窗口内跌25-40%");
  group(rows.filter(function (r) { return r.wDD >= 40; }), "窗口内跌≥40%");
  print("-- 按基准端年化 --");
  group(rows.filter(function (r) { return r.smh < 0; }), "SMH年化<0");
  group(rows.filter(function (r) { return r.smh >= 0 && r.smh < 15; }), "SMH年化0-15%");
  group(rows.filter(function (r) { return r.smh >= 15; }), "SMH年化≥15%");
  group(rows, "全部");
});

// ---- C) 典型历史片段 ----
var SEGS = [
  ["2011-05-02", "2012-12-31", "2011 欧债回调+震荡"],
  ["2014-09-02", "2016-06-30", "2015 中国股灾+半导体下行"],
  ["2018-03-12", "2019-06-28", "2018 贸易战+Q4 杀估值"],
  ["2020-02-19", "2020-12-31", "2020 疫情闪崩+V 反弹"],
  ["2021-11-19", "2022-10-14", "2021 高点→2022 熊底"],
  ["2021-11-19", "2023-12-29", "2021 高点→2023 收复"],
  ["2021-11-19", LAST, "2021 高点→今"],
  ["2024-07-10", LAST, "2024-07 高点→今"],
  ["2025-01-02", LAST, "2025 年初→今"],
];
print("\n===== 典型历史片段 =====");
print(pad("区间", 30) + " | " + pad("基线", 9) + pad("DD", 7) + " | " + pad("混合", 9) + pad("DD", 7) + " | 混合/基线");
SEGS.forEach(function (sg) {
  if (sg[0] > LAST) return;
  var b = one(sg[0], sg[1], { trendOn: false });
  var h = one(sg[0], sg[1], { trendOn: true, trendDeepDD: 35 });
  print(pad(sg[2], 30) + " | " + pad(b.mult.toFixed(2) + "x", 9) + pad("-" + b.dd.toFixed(1) + "%", 7)
    + " | " + pad(h.mult.toFixed(2) + "x", 9) + pad("-" + h.dd.toFixed(1) + "%", 7)
    + " | " + (h.mult / b.mult).toFixed(2) + "x");
});