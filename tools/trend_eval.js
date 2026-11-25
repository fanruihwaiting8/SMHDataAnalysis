// 趋势过滤（200 日均线轮动 + 包络带阶梯离场）效果评估
// 用法：jsc tools/trend_eval.js   （须在项目根目录执行）
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
    rotMult: r.equityTrendRotate ? r.equityTrendRotate[r.equityTrendRotate.length - 1] / init : null,
    rotDD: r.equityTrendRotate ? maxDD(r.equityTrendRotate) : null,
    holdB: r.holdAllSmh3 / init,
    holdBDD: maxDD(r.equityHoldB),
  };
}

var variants = [
  ['关(基线)', { trendOn: false }],
  ['开 200/50 buf3 cfm2 cut30', { trendOn: true }],
  ['开 无缓冲 buf0 cfm1', { trendOn: true, trendBuf: 0, trendConfirm: 1 }],
  ['开 buf5 cfm3', { trendOn: true, trendBuf: 5, trendConfirm: 3 }],
  ['开 buf3 cfm2 不减短均线', { trendOn: true, trendShortCut: 0 }],
  ['开 buf3 cfm2 不重建仓', { trendOn: true, trendReenter: false }],
  ['开 buf3 cfm2 不禁补仓', { trendOn: true, trendBlockAdd: false }],
];

var starts = [null, '2008-01-02', '2010-01-04', '2015-01-02', '2018-01-02', '2020-01-02', '2021-11-19'];

for (var s = 0; s < starts.length; s++) {
  var st = starts[s];
  print('===== 起点 ' + (st || '全历史') + ' =====');
  var h = null;
  for (var v = 0; v < variants.length; v++) {
    var res = run(st, variants[v][1]);
    h = res;
    print(pad(variants[v][0], 28) + ' | 末值 ' + pad(res.mult.toFixed(2) + 'x', 10)
      + ' | 最大回撤 ' + pad(res.dd.toFixed(1) + '%', 8)
      + ' | 交易 ' + pad(res.trades, 4)
      + (res.rotMult != null ? ' | 纯轮动 ' + pad(res.rotMult.toFixed(2) + 'x', 10) + '/' + pad(res.rotDD.toFixed(1) + '%', 7) : ''));
  }
  print(pad('纯持杠杆端', 28) + ' | 末值 ' + pad(h.holdB.toFixed(2) + 'x', 10) + ' | 最大回撤 ' + pad(h.holdBDD.toFixed(1) + '%', 8));
  print('');
}