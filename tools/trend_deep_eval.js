// 趋势过滤「深跌交接」阈值扫描：回撤达到 X% 后交还给补仓阶梯
// 用法：jsc tools/trend_deep_eval.js   （须在项目根目录执行）
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

function run(startDate, trendOpts) {
  var o = base(startDate);
  for (var k in trendOpts) o[k] = trendOpts[k];
  var r = runBacktest(o);
  var init = o.capA + o.capB;
  return {
    mult: r.finalTotal / init,
    dd: maxDD(r.equityStrategy),
    trades: r.trades.length,
    deepEnters: r.trendDeepEnters,
    deepDays: r.trendDeepDays,
    days: r.equityStrategy.length,
  };
}

var variants = [
  ['关(基线=纯补仓阶梯)', { trendOn: false }],
  ['开 无深跌交接', { trendOn: true }],
  ['开 深跌交接 20%', { trendOn: true, trendDeepDD: 20 }],
  ['开 深跌交接 25%', { trendOn: true, trendDeepDD: 25 }],
  ['开 深跌交接 30%', { trendOn: true, trendDeepDD: 30 }],
  ['开 深跌交接 35%', { trendOn: true, trendDeepDD: 35 }],
  ['开 深跌交接 40%', { trendOn: true, trendDeepDD: 40 }],
  ['开 深跌交接 45%', { trendOn: true, trendDeepDD: 45 }],
  ['开 深跌交接 50%', { trendOn: true, trendDeepDD: 50 }],
];

var starts = [null, '2015-01-02', '2018-01-02', '2020-01-02', '2021-11-19'];

for (var s = 0; s < starts.length; s++) {
  var st = starts[s];
  print('===== 起点 ' + (st || '全历史') + ' =====');
  for (var v = 0; v < variants.length; v++) {
    var res = run(st, variants[v][1]);
    print(pad(variants[v][0], 22) + ' | 末值 ' + pad(res.mult.toFixed(2) + 'x', 11)
      + ' | 回撤 ' + pad(res.dd.toFixed(1) + '%', 7)
      + ' | 交易 ' + pad(res.trades, 4)
      + ' | 深跌模式 ' + pad(res.deepEnters || 0, 3) + '次/' + pad(res.deepDays || 0, 5) + '天(共' + res.days + '天)');
  }
  print('');
}