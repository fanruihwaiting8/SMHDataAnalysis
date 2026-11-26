// trendDeepDD 滑杆扫描：收益 / 回撤 / 夏普 / 单位回撤收益 随「深跌交还比例」的变化
// 问题：混合比例上是否存在一个风险调整意义上的最优点？
// 用法：jsc tools/deepdd_sweep.js  （项目根目录执行）
var window = this;
load("web/data.js");
load("web/backtest.js");

var DD = { 15: 0, 25: 25, 35: 75, 45: 90, 50: 50 };
var RB = { 50: 0, 100: 0, 200: 100 };
var CAP_A = 18000, CAP_B = 82000, INIT = CAP_A + CAP_B;
var M = window.SMH_BT;

function run(s, e, deep, trendOn) {
  var r = runBacktest({
    keyA: "SMH", keyB: "SOXL", capA: CAP_A, capB: CAP_B,
    drawdowns: DD, rebounds: RB, startDate: s, endDate: e,
    monthlyPct: 0, holdDays: 0, holdRatio: 0,
    trendOn: trendOn, trendDeepDD: deep,
  });
  var m = M.calcMetrics(r.equityDates, r.equityStrategy);
  return {
    mult: r.finalTotal / INIT, cagr: m.cagr * 100, dd: Math.abs(m.maxDD) * 100,
    sharpe: m.sharpe, uw: m.maxUnderwaterDays, n: r.trades.length,
  };
}

function pad(s, n) { s = String(s); while (s.length < n) s = " " + s; return s; }

var WINDOWS = [
  ["全历史", "2010-03-11", "2026-11-25"],
  ["近10年", "2016-11-25", "2026-11-25"],
  ["高点入场", "2021-11-19", "2026-11-25"],
  ["震荡段", "2021-01-04", "2023-12-29"],
  ["AI行情", "2023-01-03", "2026-11-25"],
];
// 注意：trendDeepDD 是「回撤阈值」而非比例。0 = 关闭深跌交接（纯趋势过滤）；
// 阈值 ≥50 时本段历史从未触发，结果与纯趋势过滤相同。
var DEEPS = [0, 15, 20, 25, 30, 35, 40, 45, 50];

WINDOWS.forEach(function (w) {
  print("\n===== " + w[0] + "  " + w[1] + " ~ " + w[2] + " =====");
  print(" deep |    末值 |  年化 |  回撤 | 夏普 | 水下天 | 笔数 | 年化/回撤");
  var base = run(w[1], w[2], 0, false);
  print(pad("基线", 5) + " | " + pad(base.mult.toFixed(2) + "x", 7)
    + " | " + pad(base.cagr.toFixed(1) + "%", 5)
    + " | " + pad("-" + base.dd.toFixed(0) + "%", 5)
    + " | " + pad(base.sharpe.toFixed(2), 4)
    + " | " + pad(base.uw, 6)
    + " | " + pad(base.n, 4)
    + " | " + pad((base.cagr / base.dd).toFixed(2), 8));
  DEEPS.forEach(function (d) {
    var r = run(w[1], w[2], d, true);
    print(pad(d + "%", 5) + " | " + pad(r.mult.toFixed(2) + "x", 7)
      + " | " + pad(r.cagr.toFixed(1) + "%", 5)
      + " | " + pad("-" + r.dd.toFixed(0) + "%", 5)
      + " | " + pad(r.sharpe.toFixed(2), 4)
      + " | " + pad(r.uw, 6)
      + " | " + pad(r.n, 4)
      + " | " + pad((r.cagr / r.dd).toFixed(2), 8));
  });
});

// 补充：纯持有基准端 / 纯持有杠杆端 作为参照
print("\n===== 参照：不做任何切换 =====");
WINDOWS.forEach(function (w) {
  var out = [pad(w[0], 8)];
  ["SMH", "SOXL"].forEach(function (k) {
    var d = window.PRICE_DATA[k].dates, c = window.PRICE_DATA[k].closes;
    var a = null, b = null, da = null, db = null;
    for (var i = 0; i < d.length; i++) {
      if (d[i] >= w[1] && a === null) { a = c[i]; da = d[i]; }
      if (d[i] <= w[2]) { b = c[i]; db = d[i]; }
    }
    var yrs = (new Date(db) - new Date(da)) / 86400000 / 365.25;
    out.push(k + " " + pad((b / a).toFixed(2) + "x", 8)
      + " 年化" + pad(((Math.pow(b / a, 1 / yrs) - 1) * 100).toFixed(1) + "%", 6));
  });
  print(out.join(" | "));
});