// 定投版参数网格搜索（最近 10 年窗口，末日总资金最大化）
//
// 与 optimize_group_10y.py 同一套分阶段搜索流程，区别只在于支持
// 「每月定投注入起始总资金的 N%」。注入口径与 web/backtest.js 完全一致：
// 每月第一个共同交易日注入，注入额全部买入基准端，是否换成杠杆端由回撤档位决定。
//
// 用 JavaScriptCore 跑（比纯 Python 循环快一个量级），需在 web/ 目录下执行：
//   cd web
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc \
//     ../tools/optimize_dca.js -- SMH 2
// 参数：组合键(SMH|QQQ|USD) 每月注入占起始资金百分比(0 表示一次性投入)
//
// monthlyPct=0 时结果应能复现 app.js 里现有的一次性推荐参数，可作正确性校验。

var window = this;
load('data.js');

var DD = [15, 25, 35, 45, 50];
var RB = [50, 100, 200];
var TT = 25.0;
var GROUPS = { SMH: ['SMH', 'SOXL'], QQQ: ['QQQ', 'TQQQ'], USD: ['SMH', 'USD'] };
var CAP_A = 20000.0, CAP_B = 20000.0;

function series(k) {
  var s = window.PRICE_DATA[k], m = {};
  for (var i = 0; i < s.dates.length; i++) m[s.dates[i]] = s.closes[i];
  return m;
}

function buildCtx(ka, kb) {
  var sa = series(ka), sb = series(kb);
  var ad = window.PRICE_DATA[ka].dates, bd = window.PRICE_DATA[kb].dates;
  var setB = {};
  for (var i = 0; i < bd.length; i++) setB[bd[i]] = 1;
  var all = ad.filter(function (d) { return setB[d]; }).sort();
  var last = all[all.length - 1];
  var cut = (parseInt(last.slice(0, 4), 10) - 10) + last.slice(4);
  var common = all.filter(function (d) { return d >= cut; });
  var AP = [], BP = [], YM = [];
  for (var j = 0; j < common.length; j++) {
    AP.push(sa[common[j]]); BP.push(sb[common[j]]); YM.push(common[j].slice(0, 7));
  }
  return { common: common, AP: AP, BP: BP, YM: YM, N: common.length };
}

// 内联纯计算回测，返回末日总资金（逻辑与 web/backtest.js runBacktest 一致）
function fastTotal(c, ddp, rbp, mc) {
  var AP = c.AP, BP = c.BP, YM = c.YM, N = c.N;
  var aSh = CAP_A / AP[0], bSh = CAP_B / BP[0];
  var peak = AP[0], trough = AP[0];
  var d0 = false, d1 = false, d2 = false, d3 = false, d4 = false;
  var r0 = false, r1 = false, r2 = false;
  var segActive = false, segLow = null, lastMonth = YM[0];
  for (var i = 1; i < N; i++) {
    var p = AP[i], pb = BP[i];
    if (mc > 0 && YM[i] !== lastMonth) { lastMonth = YM[i]; aSh += mc / p; }
    if (p > peak) {
      peak = p; d0 = d1 = d2 = d3 = d4 = false;
      segActive = false; segLow = null; continue;
    }
    if (segLow === null || p < segLow) segLow = p;
    var ddPct = (peak - p) / peak * 100.0;
    if (!d0 && ddPct >= 15) { d0 = true; if (ddp[0] > 0 && aSh > 0) { var m0 = aSh * p * ddp[0] / 100; aSh -= m0 / p; bSh += m0 / pb; } }
    if (!d1 && ddPct >= 25) { d1 = true; if (ddp[1] > 0 && aSh > 0) { var m1 = aSh * p * ddp[1] / 100; aSh -= m1 / p; bSh += m1 / pb; } }
    if (!d2 && ddPct >= 35) { d2 = true; if (ddp[2] > 0 && aSh > 0) { var m2 = aSh * p * ddp[2] / 100; aSh -= m2 / p; bSh += m2 / pb; } }
    if (!d3 && ddPct >= 45) { d3 = true; if (ddp[3] > 0 && aSh > 0) { var m3 = aSh * p * ddp[3] / 100; aSh -= m3 / p; bSh += m3 / pb; } }
    if (!d4 && ddPct >= 50) { d4 = true; if (ddp[4] > 0 && aSh > 0) { var m4 = aSh * p * ddp[4] / 100; aSh -= m4 / p; bSh += m4 / pb; } }
    if (ddPct >= TT) {
      if (!segActive) { segActive = true; trough = segLow; r0 = r1 = r2 = false; }
      else if (segLow < trough) { trough = segLow; r0 = r1 = r2 = false; }
    }
    var rbPct = trough > 0 ? (p - trough) / trough * 100.0 : 0.0;
    if (!r0 && rbPct >= 50) { r0 = true; if (rbp[0] > 0 && bSh > 0) { var n0 = bSh * pb * rbp[0] / 100; bSh -= n0 / pb; aSh += n0 / p; } }
    if (!r1 && rbPct >= 100) { r1 = true; if (rbp[1] > 0 && bSh > 0) { var n1 = bSh * pb * rbp[1] / 100; bSh -= n1 / pb; aSh += n1 / p; } }
    if (!r2 && rbPct >= 200) { r2 = true; if (rbp[2] > 0 && bSh > 0) { var n2 = bSh * pb * rbp[2] / 100; bSh -= n2 / pb; aSh += n2 / p; } }
  }
  return aSh * AP[N - 1] + bSh * BP[N - 1];
}

function searchDD(c, rg, rbp, mc) {
  var best = -1, bc = null, cb = [0, 0, 0, 0, 0];
  for (var a = 0; a < rg[0].length; a++) { cb[0] = rg[0][a];
  for (var b = 0; b < rg[1].length; b++) { cb[1] = rg[1][b];
  for (var d = 0; d < rg[2].length; d++) { cb[2] = rg[2][d];
  for (var e = 0; e < rg[3].length; e++) { cb[3] = rg[3][e];
  for (var f = 0; f < rg[4].length; f++) { cb[4] = rg[4][f];
    var v = fastTotal(c, cb, rbp, mc);
    if (v > best) { best = v; bc = cb.slice(); }
  }}}}}
  return { c: bc, v: best };
}

function searchRB(c, ddp, rg, mc) {
  var best = -1, bc = null, cb = [0, 0, 0];
  for (var a = 0; a < rg[0].length; a++) { cb[0] = rg[0][a];
  for (var b = 0; b < rg[1].length; b++) { cb[1] = rg[1][b];
  for (var d = 0; d < rg[2].length; d++) { cb[2] = rg[2][d];
    var v = fastTotal(c, ddp, cb, mc);
    if (v > best) { best = v; bc = cb.slice(); }
  }}}
  return { c: bc, v: best };
}

function rng(lo, hi, step) {
  var out = [];
  for (var v = lo; v <= hi; v += step) out.push(v);
  return out;
}
function nb(x) { return rng(Math.max(0, x - 10), Math.min(100, x + 10), 5); }
function fm(v) { return Math.round(v).toLocaleString('en-US'); }
function show(lvs, arr) {
  return lvs.map(function (lv, i) { return lv + ':' + arr[i]; }).join('  ');
}

var argv = (typeof arguments !== 'undefined') ? arguments : [];
var key = (argv[0] || 'SMH').toUpperCase();
var mpct = argv.length > 1 ? parseFloat(argv[1]) : 2;
var g = GROUPS[key];
if (!g) { print('未知组合 ' + key); } else {
  var c = buildCtx(g[0], g[1]);
  var total = CAP_A + CAP_B;
  var mc = total * mpct / 100.0;

  print('='.repeat(64));
  print(g[0] + ' / ' + g[1] + '  10 年窗口 ' + c.common[0] + ' ~ ' +
        c.common[c.N - 1] + '（' + c.N + ' 个交易日）');
  print('起始资金 ' + fm(total) + '（' + g[0] + ' ' + fm(CAP_A) + ' + ' + g[1] + ' ' + fm(CAP_B) + '）');
  print('月度定投 ' + mpct + '% = 每月 ' + fm(mc) + ' 全额买入 ' + g[0]);

  // 对照组（同样的现金流）
  var zero5 = [0, 0, 0, 0, 0], zero3 = [0, 0, 0];
  var holdA = fastTotal({ AP: c.AP, BP: c.BP, YM: c.YM, N: c.N }, zero5, zero3, mc);
  print('对照：不做任何调仓（50-50 起始 + 定投只买基准）= ' + fm(holdA));

  var RB_INIT = [25, 50, 100];
  var coarse = rng(0, 100, 10);
  var s1 = searchDD(c, [coarse, coarse, coarse, coarse, coarse], RB_INIT, mc);
  print('[1] 粗搜补仓 ' + show(DD, s1.c) + '  -> ' + fm(s1.v));
  var s2 = searchDD(c, s1.c.map(nb), RB_INIT, mc);
  print('[2] 细搜补仓 ' + show(DD, s2.c) + '  -> ' + fm(s2.v));
  var rc = rng(0, 100, 10);
  var s3 = searchRB(c, s2.c, [rc, rc, rc], mc);
  print('[3] 搜索减仓 ' + show(RB, s3.c) + '  -> ' + fm(s3.v));
  var s3b = searchRB(c, s2.c, s3.c.map(nb), mc);
  print('[3b] 细搜减仓 ' + show(RB, s3b.c) + '  -> ' + fm(s3b.v));
  var s4 = searchDD(c, s2.c.map(nb), s3b.c, mc);
  print('[4] 收敛补仓 ' + show(DD, s4.c) + '  -> ' + fm(s4.v));

  print('-'.repeat(64));
  print('RESULT ' + key + ' monthlyPct=' + mpct);
  print('dd: { ' + DD.map(function (lv, i) { return lv + ': ' + s4.c[i]; }).join(', ') + ' }');
  print('rb: { ' + RB.map(function (lv, i) { return lv + ': ' + s3b.c[i]; }).join(', ') + ' }');
  print('final=' + fm(s4.v) + '  vs 不调仓=' + fm(holdA));
}