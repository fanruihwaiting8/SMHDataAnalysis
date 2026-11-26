// deepDD 稳健性检验：在滚动窗口上统计每个阈值的「相对基线倍数比」与排名，
// 判断固定起点上看到的 35% 甜点是真规律还是单点过拟合。
// 用法：jsc tools/deepdd_robust.js  （项目根目录执行）
var window = this;
load("web/data.js");
load("web/backtest.js");

var DD = { 15: 0, 25: 25, 35: 75, 45: 90, 50: 50 };
var RB = { 50: 0, 100: 0, 200: 100 };
var INIT = 100000;
var M = window.SMH_BT;
var DEEPS = [0, 15, 20, 25, 30, 35, 40, 45];

function run(s, e, deep, trendOn) {
  var r = runBacktest({
    keyA: "SMH", keyB: "SOXL", capA: 18000, capB: 82000,
    drawdowns: DD, rebounds: RB, startDate: s, endDate: e,
    monthlyPct: 0, holdDays: 0, holdRatio: 0,
    trendOn: trendOn, trendDeepDD: deep,
  });
  var m = M.calcMetrics(r.equityDates, r.equityStrategy);
  return { mult: r.finalTotal / INIT, dd: Math.abs(m.maxDD) * 100, sharpe: m.sharpe };
}

function pad(s, n) { s = String(s); while (s.length < n) s = " " + s; return s; }
function addYears(d, y) { var p = d.split("-"); return (Number(p[0]) + y) + "-" + p[1] + "-" + p[2]; }

var dates = window.PRICE_DATA.SMH.dates.filter(function (d) { return d >= "2010-03-11"; });
var LAST = dates[dates.length - 1];
var starts = [], seen = {};
dates.forEach(function (d) {
  var q = d.slice(0, 4) + "H" + (Number(d.slice(5, 7)) <= 6 ? 1 : 2);
  if (!seen[q]) { seen[q] = 1; starts.push(d); }
});

[3, 5].forEach(function (yrs) {
  var used = starts.filter(function (s) { return addYears(s, yrs) <= LAST; });
  var acc = {};
  DEEPS.forEach(function (d) { acc[d] = { ratio: [], dd: [], sharpe: [], rank: [], win: 0 }; });

  used.forEach(function (s) {
    var e = addYears(s, yrs);
    var base = run(s, e, 0, false);
    var res = DEEPS.map(function (d) { return { d: d, r: run(s, e, d, true) }; });
    var sorted = res.slice().sort(function (a, b) { return b.r.mult - a.r.mult; });
    res.forEach(function (x) {
      var a = acc[x.d];
      a.ratio.push(x.r.mult / base.mult);
      a.dd.push(x.r.dd);
      a.sharpe.push(x.r.sharpe);
      a.rank.push(sorted.findIndex(function (y) { return y.d === x.d; }) + 1);
      if (x.r.mult > base.mult) a.win += 1;
    });
  });

  function med(a) { var b = a.slice().sort(function (x, y) { return x - y; }); return b[Math.floor(b.length / 2)]; }
  function avg(a) { return a.reduce(function (x, y) { return x + y; }, 0) / a.length; }

  print("\n===== 滚动 " + yrs + " 年窗口，n=" + used.length + "（ratio = 该阈值末值 / 基线末值）=====");
  print(" deep | ratio中位 | ratio均值 | 最差ratio | 平均回撤 | 平均夏普 | 平均名次 | 跑赢基线");
  DEEPS.forEach(function (d) {
    var a = acc[d];
    print(pad(d + "%", 5) + " | " + pad(med(a.ratio).toFixed(2), 9)
      + " | " + pad(avg(a.ratio).toFixed(2), 9)
      + " | " + pad(Math.min.apply(null, a.ratio).toFixed(2), 9)
      + " | " + pad("-" + avg(a.dd).toFixed(0) + "%", 8)
      + " | " + pad(avg(a.sharpe).toFixed(2), 8)
      + " | " + pad(avg(a.rank).toFixed(1), 8)
      + " | " + pad((a.win / used.length * 100).toFixed(0) + "%", 8));
  });
});