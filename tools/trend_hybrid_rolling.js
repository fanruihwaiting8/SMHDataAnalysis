// 滚动起点对比：同一套参数下「动态策略(基线)」 vs 「混合保护策略(趋势过滤+深跌交还35%)」
// 目的：看保护策略随持有年限拉长的变化规律
// 用法：jsc tools/trend_hybrid_rolling.js   （须在项目根目录执行）
var window = this;
load('web/data.js');
load('web/backtest.js');

var DD = { 15: 0, 25: 25, 35: 75, 45: 90, 50: 50 };
var RB = { 50: 0, 100: 0, 200: 100 };

function base(startDate) {
  return {
    keyA: 'SMH', keyB: 'SOXL',
    capA: 18000, capB: 82000,
    drawdowns: DD, rebounds: RB,
    startDate: startDate, endDate: null,
    monthlyPct: 0, holdDays: 0, holdRatio: 0,
  };
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

function pad(s, n) { s = String(s); while (s.length < n) s = ' ' + s; return s; }

function run(startDate, opts) {
  var o = base(startDate);
  for (var k in opts) o[k] = opts[k];
  var r = runBacktest(o);
  var init = o.capA + o.capB;
  return {
    mult: r.finalTotal / init,
    dd: maxDD(r.equityStrategy),
    years: r.equityStrategy.length / 252,
    len: r.equityStrategy.length,
  };
}

var starts = [null, '2011-01-03', '2013-01-02', '2015-01-02', '2017-01-03',
  '2019-01-02', '2020-01-02', '2021-01-04', '2021-11-19', '2022-07-01', '2023-01-03'];

print(pad('起点', 12) + ' | ' + pad('年数', 5) + ' | ' + pad('基线末值', 11) + ' ' + pad('回撤', 7)
  + ' | ' + pad('混合末值', 11) + ' ' + pad('回撤', 7) + ' | 混合/基线');
for (var i = 0; i < starts.length; i++) {
  var st = starts[i];
  var a = run(st, { trendOn: false });
  var b = run(st, { trendOn: true, trendDeepDD: 35 });
  print(pad(st || '全历史', 12) + ' | ' + pad(a.years.toFixed(1), 5)
    + ' | ' + pad(a.mult.toFixed(2) + 'x', 11) + ' ' + pad('-' + a.dd.toFixed(1) + '%', 7)
    + ' | ' + pad(b.mult.toFixed(2) + 'x', 11) + ' ' + pad('-' + b.dd.toFixed(1) + '%', 7)
    + ' | ' + (b.mult / a.mult).toFixed(2) + 'x');
}