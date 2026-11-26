// 第三条路：与其「开保护」，不如「少放杠杆」？
// 比较同一回撤水平下，降低杠杆端初始占比 vs 开启混合保护，哪种拿到的收益更高。
// 用法：jsc tools/capmix_vs_protect.js
var window = this;
load("web/data.js");
load("web/backtest.js");

var DD = { 15: 0, 25: 25, 35: 75, 45: 90, 50: 50 };
var RB = { 50: 0, 100: 0, 200: 100 };
var INIT = 100000;
var M = window.SMH_BT;

function run(s, e, capB, deep, trendOn) {
  var r = runBacktest({
    keyA: "SMH", keyB: "SOXL", capA: INIT - capB, capB: capB,
    drawdowns: DD, rebounds: RB, startDate: s, endDate: e,
    monthlyPct: 0, holdDays: 0, holdRatio: 0,
    trendOn: trendOn, trendDeepDD: deep,
  });
  var m = M.calcMetrics(r.equityDates, r.equityStrategy);
  return { mult: r.finalTotal / INIT, cagr: m.cagr * 100, dd: Math.abs(m.maxDD) * 100, sharpe: m.sharpe };
}

function pad(s, n) { s = String(s); while (s.length < n) s = " " + s; return s; }

var WINDOWS = [
  ["全历史", "2010-03-11", "2026-11-25"],
  ["近10年", "2016-11-25", "2026-11-25"],
  ["高点入场", "2021-11-19", "2026-11-25"],
  ["震荡段", "2021-01-04", "2023-12-29"],
];

WINDOWS.forEach(function (w) {
  print("\n===== " + w[0] + "  " + w[1] + " ~ " + w[2] + " =====");
  print("           方案 |     末值 |  年化 |  回撤 | 夏普 | 年化/回撤");
  var rows = [];
  [82000, 60000, 40000, 20000].forEach(function (cb) {
    rows.push(["无保护 杠杆端" + (cb / 1000) + "%", run(w[1], w[2], cb, 0, false)]);
  });
  [82000, 60000, 40000].forEach(function (cb) {
    rows.push(["混合35 杠杆端" + (cb / 1000) + "%", run(w[1], w[2], cb, 35, true)]);
  });
  rows.forEach(function (x) {
    var r = x[1];
    print(pad(x[0], 15) + " | " + pad(r.mult.toFixed(2) + "x", 8)
      + " | " + pad(r.cagr.toFixed(1) + "%", 5)
      + " | " + pad("-" + r.dd.toFixed(0) + "%", 5)
      + " | " + pad(r.sharpe.toFixed(2), 4)
      + " | " + pad((r.cagr / r.dd).toFixed(2), 8));
  });
});