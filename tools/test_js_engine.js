// 用 macOS 自带 jsc 校验 web/backtest.js 与 backtest.py 结果一致（本机无 node）
// 运行：
//   cd my-project/APP/SMHDataAnalysisBot
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc tools/test_js_engine.js
// 对拍 Python 侧：.venv/bin/python tools/test_py_engine.py（两边输出应逐行相同）
var window = this;
window.T = undefined;
load('web/data.js');
load('web/backtest.js');

var DD = { 15: 0, 25: 45, 35: 100, 45: 0, 50: 0 };
var RB = { 50: 0, 100: 0, 200: 100 };

var cases = [
  { start: '2022-10-05', capA: 0, capB: 10000 },
  { start: '2022-10-12', capA: 0, capB: 10000 },
  { start: '2022-10-14', capA: 0, capB: 10000 },
  { start: '2022-10-21', capA: 0, capB: 10000 },
  { start: '2022-11-10', capA: 0, capB: 10000 },
  { start: '2021-12-27', capA: 5000, capB: 5000 },
  { start: '2010-03-11', capA: 5000, capB: 5000 },
  // 时间兜底（持杠杆端满 N 个交易日强制换回）：0=关闭，其余为开启
  { start: '2010-03-11', capA: 5000, capB: 5000, holdDays: 756, holdRatio: 1 },
  { start: '2010-03-11', capA: 5000, capB: 5000, holdDays: 504, holdRatio: 0.5 },
  { start: '2016-11-23', capA: 5000, capB: 5000, holdDays: 378, holdRatio: 1 },
];

print('start        hold    multiple  trades  initTrough');
for (var i = 0; i < cases.length; i++) {
  var c = cases[i];
  var r = runBacktest({
    keyA: 'SMH', keyB: 'SOXL',
    capA: c.capA, capB: c.capB,
    drawdowns: DD, rebounds: RB,
    startDate: c.start, endDate: null,
    monthlyPct: 0,
    holdDays: c.holdDays || 0,
    holdRatio: c.holdRatio === undefined ? 1 : c.holdRatio,
  });
  var mult = r.finalTotal / (c.capA + c.capB);
  print(
    r.startDate + '  ' +
    (c.holdDays || 0) + '/' + (c.holdRatio === undefined ? 1 : c.holdRatio) +
    '  ' + mult.toFixed(4) +
    '  ' + r.trades.length +
    '  ' + r.troughs[0][1].toFixed(2)
  );
}