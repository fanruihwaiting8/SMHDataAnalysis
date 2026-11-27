// 「前 N 年开混合保护、满 N 年后切回纯动态策略」是否真能两头通吃？
// 口径：初始 100,000（SMH 18,000 + SOXL 82,000），默认档位，trendDeepDD=35
// 用法：jsc tools/hybrid_switch_eval.js   （须在项目根目录执行）
var window = this;
load("web/data.js");
load("web/backtest.js");

var DD = { 15: 0, 25: 25, 35: 75, 45: 90, 50: 50 };
var RB = { 50: 0, 100: 0, 200: 100 };
var CAP_A = 18000, CAP_B = 82000;
var SW = [3, 5, 7];

function run(s, e, extra) {
  var o = {
    keyA: "SMH", keyB: "SOXL", capA: CAP_A, capB: CAP_B,
    drawdowns: DD, rebounds: RB, startDate: s, endDate: e,
    monthlyPct: 0, holdDays: 0, holdRatio: 0,
  };
  for (var k in extra) o[k] = extra[k];
  var r = runBacktest(o);
  var eq = r.equityStrategy, pk = eq[0], mdd = 0;
  for (var i = 1; i < eq.length; i++) {
    if (eq[i] > pk) pk = eq[i];
    var d = (eq[i] - pk) / pk * 100;
    if (d < mdd) mdd = d;
  }
  return { v: r.finalTotal, mdd: mdd };
}
function pad(s, n) { s = String(s); while (s.length < n) s = " " + s; return s; }
function money(v) { return Math.round(v).toLocaleString("en-US"); }
function addY(d, y) { return (Number(d.slice(0, 4)) + y) + d.slice(4); }

var allDates = window.PRICE_DATA.SMH.dates;
var dates = allDates.filter(function (d) { return d >= "2010-03-11"; });
var LAST = dates[dates.length - 1];
var starts = [], seen = {};
dates.forEach(function (d) { var m = d.slice(0, 7); if (!seen[m]) { seen[m] = 1; starts.push(d); } });

var rows = [];
starts.forEach(function (s) {
  var r = { s: s };
  r.dyn = run(s, LAST, { trendOn: false });
  r.hyb = run(s, LAST, { trendOn: true, trendDeepDD: 35 });
  SW.forEach(function (n) { r["sw" + n] = run(s, LAST, { trendOn: true, trendDeepDD: 35, trendOffYears: n }); });
  rows.push(r);
});

print("===== 逐月进场 → 持有到 " + LAST + "（n=" + rows.length + "）=====");
print("列：动态 / 全程混合 / 混合满3年切 / 满5年切 / 满7年切");
rows.forEach(function (r) {
  if (r.s.slice(5, 7) !== "01" && r.s.slice(5, 7) !== "07") return;
  print(pad(r.s.slice(0, 7), 8) + " | " + pad(money(r.dyn.v), 12) + " | " + pad(money(r.hyb.v), 12)
    + " | " + pad(money(r.sw3.v), 12) + " | " + pad(money(r.sw5.v), 12) + " | " + pad(money(r.sw7.v), 12));
});

function stat(label, key, base, subset) {
  var rs = rows.filter(subset);
  if (!rs.length) return;
  var win = rs.filter(function (r) { return r[key].v > r[base].v; }).length;
  var rat = rs.map(function (r) { return r[key].v / r[base].v; }).sort(function (a, b) { return a - b; });
  var med = rat[Math.floor(rat.length / 2)];
  var mdd = rs.reduce(function (a, r) { return a + r[key].mdd; }, 0) / rs.length;
  var mddB = rs.reduce(function (a, r) { return a + r[base].mdd; }, 0) / rs.length;
  print(pad(label, 22) + " | n=" + pad(rs.length, 3) + " | 胜率 " + pad((win / rs.length * 100).toFixed(0) + "%", 5)
    + " | 中位 " + rat[0].toFixed(2) + "~" + rat[rat.length - 1].toFixed(2) + " 之间 " + med.toFixed(2) + "x"
    + " | 平均最大回撤 " + mdd.toFixed(0) + "% vs " + mddB.toFixed(0) + "%");
}
var ALL = function () { return true; };
var PRE = function (r) { return r.s < "2020-07-01"; };
var POST = function (r) { return r.s >= "2020-07-01"; };
[["全部起点", ALL], ["2020-07 之前进场", PRE], ["2020-07 之后进场", POST]].forEach(function (g) {
  print("\n----- " + g[0] + "：切换版 vs 纯动态 -----");
  stat("全程混合", "hyb", "dyn", g[1]);
  SW.forEach(function (n) { stat("满 " + n + " 年切回动态", "sw" + n, "dyn", g[1]); });
  print("----- " + g[0] + "：切换版 vs 全程混合 -----");
  SW.forEach(function (n) { stat("满 " + n + " 年切回动态", "sw" + n, "hyb", g[1]); });
});

print("\n===== 固定持有期：满 N 年切换后再拿 K 年 =====");
[5, 8, 10].forEach(function (hold) {
  var rs = [];
  starts.forEach(function (s) {
    var e = addY(s, hold);
    if (e > LAST) return;
    var o = { dyn: run(s, e, { trendOn: false }), hyb: run(s, e, { trendOn: true, trendDeepDD: 35 }) };
    o.sw3 = run(s, e, { trendOn: true, trendDeepDD: 35, trendOffYears: 3 });
    o.sw5 = run(s, e, { trendOn: true, trendDeepDD: 35, trendOffYears: 5 });
    rs.push(o);
  });
  if (!rs.length) return;
  function w(k) { return (rs.filter(function (r) { return r[k].v > r.dyn.v; }).length / rs.length * 100).toFixed(0) + "%"; }
  function m(k) { var a = rs.map(function (r) { return r[k].v / r.dyn.v; }).sort(function (x, y) { return x - y; }); return a[Math.floor(a.length / 2)].toFixed(2); }
  print("持有 " + hold + " 年（n=" + rs.length + "）：全程混合 胜率 " + w("hyb") + " 中位 " + m("hyb")
    + "x | 满3年切 " + w("sw3") + " " + m("sw3") + "x | 满5年切 " + w("sw5") + " " + m("sw5") + "x");
});