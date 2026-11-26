// 校验「混合保护策略详情」卡片所需字段在真实回测结果中都存在（jsc 运行，无 DOM）
// 用法：jsc tools/hybrid_detail_check.js   （须在项目根目录执行）
var window = this;
load("web/data.js");
load("web/backtest.js");
var BT = window.SMH_BT;

var base = {
  keyA: "SMH", keyB: "SOXL", capA: 18000, capB: 82000,
  drawdowns: { 15: 0, 25: 25, 35: 75, 45: 90, 50: 50 },
  rebounds: { 50: 0, 100: 0, 200: 100 },
  startDate: "2021-01-04", endDate: null,
  monthlyPct: 0, holdDays: 0, holdRatio: 0,
};
var hyb = Object.assign({}, base, {
  trendOn: true, trendLong: 200, trendShort: 50, trendBuf: 3,
  trendConfirm: 2, trendShortCut: 30, trendDeepDD: 35,
  trendBlockDip: true, trendReenter: true,
});

function show(tag, o) {
  var r = BT.runBacktest(o);
  var m = BT.calcMetrics(r.equityDates, r.equityStrategy);
  print(tag + " final=" + m.finalTotal.toFixed(0) + " cagr=" + (m.cagr * 100).toFixed(2) +
    "% maxDD=" + (m.maxDD * 100).toFixed(1) + "% sharpe=" + m.sharpe.toFixed(2) +
    " trades=" + r.trades.length + " marks=" + r.tradeMarks.length +
    " deepEnters=" + r.trendDeepEnters + " deepDays=" + r.trendDeepDays +
    " range=" + r.startDate + "~" + r.endDate);
  if (r.trades.length) {
    var t = r.trades[0];
    print("  first trade: date=" + t[0] + " type=" + t[1] + " descKey=" +
      (t[2] && t[2].k) + " pa=" + t[3] + " pb=" + t[4] + " va=" + t[5] + " vb=" + t[6] +
      " eq=" + (r.tradeMarks[0] && r.tradeMarks[0].equity));
  }
  return r;
}

show("dynamic", base);
show("hybrid ", hyb);