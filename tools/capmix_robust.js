// 初始杠杆端占比的稳健性检验：滚动窗口上比较 capB 82% / 60% / 40% / 20%
// （均不开保护），看「少放初始杠杆」是否在多数窗口都占优。
// 用法：jsc tools/capmix_robust.js
var window = this;
load("web/data.js");
load("web/backtest.js");

var DD = { 15: 0, 25: 25, 35: 75, 45: 90, 50: 50 };
var RB = { 50: 0, 100: 0, 200: 100 };
var INIT = 100000;
var M = window.SMH_BT;
var CAPS = [82000, 60000, 40000, 20000];

function run(s, e, capB, deep, trendOn) {
  var r = runBacktest({
    keyA: "SMH", keyB: "SOXL", capA: INIT - capB, capB: capB,
    drawdowns: DD, rebounds: RB, startDate: s, endDate: e,
    monthlyPct: 0, holdDays: 0, holdRatio: 0,
    trendOn: trendOn, trendDeepDD: deep,
  });
  var m = M.calcMetrics(r.equityDates, r.equityStrategy);
  return { mult: r.finalTotal / INIT, dd: Math.abs(m.maxDD) * 100, sharpe: m.sharpe };
}

function pad(s, n) { s = String(s); while (s.length < n) s = " " + s; return s; }
function addYears(d, y) { var p = d.split("-"); return (Number(p[0]) + y) + "-" + p[1] + "-" + p[2]; }
function med(a) { var b = a.slice().sort(function (x, y) { return x - y; }); return b[Math.floor(b.length / 2)]; }
function avg(a) { return a.reduce(function (x, y) { return x + y; }, 0) / a.length; }

var dates = window.PRICE_DATA.SMH.dates.filter(function (d) { return d >= "2010-03-11"; });
var LAST = dates[dates.length - 1];
var starts = [], seen = {};
dates.forEach(function (d) {
  var q = d.slice(0, 4) + "H" + (Number(d.slice(5, 7)) <= 6 ? 1 : 2);
  if (!seen[q]) { seen[q] = 1; starts.push(d); }
});

[3, 5, 10].forEach(function (yrs) {
  var used = starts.filter(function (s) { return addYears(s, yrs) <= LAST; });
  var acc = {};
  CAPS.forEach(function (c) { acc[c] = { ratio: [], dd: [], sharpe: [], win: 0 }; });

  used.forEach(function (s) {
    var e = addYears(s, yrs);
    var ref = run(s, e, 82000, 0, false);
    CAPS.forEach(function (c) {
      var r = run(s, e, c, 0, false);
      var a = acc[c];
      a.ratio.push(r.mult / ref.mult); a.dd.push(r.dd); a.sharpe.push(r.sharpe);
      if (r.mult > ref.mult) a.win += 1;
    });
  });

  print("\n===== 滚动 " + yrs + " 年窗口，n=" + used.length + "（ratio 以 杠杆端82% 为 1.00）=====");
  print(" 杠杆端 | ratio中位 | ratio均值 | 最差ratio | 平均回撤 | 最深回撤 | 平均夏普 | 赢82%");
  CAPS.forEach(function (c) {
    var a = acc[c];
    print(pad(c / 1000 + "%", 6) + " | " + pad(med(a.ratio).toFixed(2), 9)
      + " | " + pad(avg(a.ratio).toFixed(2), 9)
      + " | " + pad(Math.min.apply(null, a.ratio).toFixed(2), 9)
      + " | " + pad("-" + avg(a.dd).toFixed(0) + "%", 8)
      + " | " + pad("-" + Math.max.apply(null, a.dd).toFixed(0) + "%", 8)
      + " | " + pad(avg(a.sharpe).toFixed(2), 8)
      + " | " + pad((a.win / used.length * 100).toFixed(0) + "%", 5));
  });
});