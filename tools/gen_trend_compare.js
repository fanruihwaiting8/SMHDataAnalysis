// 生成「趋势过滤保护 开/关/混合」净值曲线对比页：web/trend_compare.html
// 用法：jsc tools/gen_trend_compare.js   （须在项目根目录执行）
var window = this;
load('web/data.js');
load('web/backtest.js');

var DD = { 15: 0, 25: 25, 35: 75, 45: 90, 50: 50 };
var RB = { 50: 0, 100: 0, 200: 100 };
var CAP_A = 18000, CAP_B = 82000, INIT = CAP_A + CAP_B;

function run(extra) {
  var o = {
    keyA: 'SMH', keyB: 'SOXL', capA: CAP_A, capB: CAP_B,
    drawdowns: DD, rebounds: RB, startDate: null, endDate: null,
    monthlyPct: 0, holdDays: 0, holdRatio: 0,
  };
  for (var k in extra) o[k] = extra[k];
  return runBacktest(o);
}

function maxDD(a) {
  var peak = -Infinity, w = 0;
  for (var i = 0; i < a.length; i++) {
    if (a[i] == null) continue;
    if (a[i] > peak) peak = a[i];
    var d = (peak - a[i]) / peak * 100;
    if (d > w) w = d;
  }
  return w;
}

var series = [
  { name: '未启用保护（纯回撤补仓阶梯）', color: '#e4572e', res: run({ trendOn: false }) },
  { name: '纯趋势过滤（200日均线）', color: '#2a9d8f', res: run({ trendOn: true }) },
  { name: '混合：趋势过滤 + 深跌35%交还', color: '#3d5a80', res: run({ trendOn: true, trendDeepDD: 35 }) },
  { name: '纯持 SOXL 不动', color: '#9b9b9b', res: null },
];

var base = series[0].res;
var dates = base.equityDates;
series[3].res = { equityStrategy: base.equityHoldB, equityDates: dates, trades: [] };

var N = dates.length;
var STEP = Math.max(1, Math.floor(N / 900));
var idx = [];
for (var i = 0; i < N; i += STEP) idx.push(i);
if (idx[idx.length - 1] !== N - 1) idx.push(N - 1);

var W = 1180, H = 560, PL = 70, PR = 24, PT = 24, PB = 48;
var lo = Infinity, hi = -Infinity;
for (var s = 0; s < series.length; s++) {
  var a = series[s].res.equityStrategy;
  for (var j = 0; j < idx.length; j++) {
    var v = a[idx[j]];
    if (v == null || !(v > 0)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
}
var lgLo = Math.log10(lo), lgHi = Math.log10(hi);
function X(k) { return PL + (W - PL - PR) * (k / (idx.length - 1)); }
function Y(v) { return PT + (H - PT - PB) * (1 - (Math.log10(v) - lgLo) / (lgHi - lgLo)); }

var svg = ['<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" preserveAspectRatio="xMidYMid meet">'];
svg.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#fff"/>');
for (var p = Math.ceil(lgLo); p <= Math.floor(lgHi); p++) {
  var yy = Y(Math.pow(10, p)).toFixed(1);
  svg.push('<line x1="' + PL + '" y1="' + yy + '" x2="' + (W - PR) + '" y2="' + yy + '" stroke="#e6e6e6"/>');
  var lab = Math.pow(10, p) >= 1000 ? (Math.pow(10, p) / 1000) + 'k' : String(Math.pow(10, p));
  svg.push('<text x="' + (PL - 8) + '" y="' + (+yy + 4) + '" font-size="11" fill="#888" text-anchor="end">$' + lab + '</text>');
}
for (var t = 0; t < idx.length; t += Math.floor(idx.length / 8)) {
  var xx = X(t).toFixed(1);
  svg.push('<line x1="' + xx + '" y1="' + PT + '" x2="' + xx + '" y2="' + (H - PB) + '" stroke="#f0f0f0"/>');
  svg.push('<text x="' + xx + '" y="' + (H - PB + 18) + '" font-size="11" fill="#888" text-anchor="middle">' + dates[idx[t]].slice(0, 7) + '</text>');
}
for (var s2 = 0; s2 < series.length; s2++) {
  var arr = series[s2].res.equityStrategy, d = '';
  for (var k = 0; k < idx.length; k++) {
    var val = arr[idx[k]];
    if (val == null || !(val > 0)) continue;
    d += (d ? 'L' : 'M') + X(k).toFixed(1) + ' ' + Y(val).toFixed(1) + ' ';
  }
  svg.push('<path d="' + d + '" fill="none" stroke="' + series[s2].color + '" stroke-width="' + (s2 === 2 ? 2.6 : 1.7) + '"/>');
}
svg.push('<text x="' + PL + '" y="' + (H - 8) + '" font-size="11" fill="#999">纵轴为对数坐标（初始投入 $' + INIT.toLocaleString() + '，SMH 基准端 + SOXL 杠杆端，无定投）</text>');
svg.push('</svg>');

var rows = '';
for (var r = 0; r < series.length; r++) {
  var e = series[r].res.equityStrategy;
  var fin = e[e.length - 1];
  rows += '<tr><td><span class="dot" style="background:' + series[r].color + '"></span>' + series[r].name + '</td>'
    + '<td>$' + Math.round(fin).toLocaleString() + '</td>'
    + '<td>' + (fin / INIT).toFixed(1) + 'x</td>'
    + '<td class="dd">-' + maxDD(e).toFixed(1) + '%</td>'
    + '<td>' + (series[r].res.trades ? series[r].res.trades.length : 0) + '</td></tr>';
}

var html = '<!doctype html><html lang="zh"><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<title>趋势过滤保护 开/关/混合 收益曲线对比</title><style>'
  + 'body{font-family:-apple-system,"PingFang SC",sans-serif;margin:0;padding:22px;background:#f7f8fa;color:#222}'
  + '.card{max-width:1240px;margin:0 auto 18px;background:#fff;border-radius:12px;padding:18px 20px;box-shadow:0 1px 4px rgba(0,0,0,.07)}'
  + 'h1{font-size:19px;margin:0 0 4px}.sub{color:#777;font-size:13px;margin-bottom:14px}'
  + 'table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:8px 10px;border-bottom:1px solid #eee;text-align:right}'
  + 'th:first-child,td:first-child{text-align:left}th{color:#666;font-weight:600;background:#fafafa}'
  + '.dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:7px}'
  + '.dd{color:#c0392b}.note{font-size:12.5px;color:#666;line-height:1.75;margin-top:12px}'
  + '</style></head><body><div class="card"><h1>趋势过滤保护：开 / 关 / 混合 — 收益曲线对比</h1>'
  + '<div class="sub">SMH + SOXL，' + dates[0] + ' ~ ' + dates[N - 1] + '，初始 $' + INIT.toLocaleString()
  + '（基准端 $' + CAP_A.toLocaleString() + ' / 杠杆端 $' + CAP_B.toLocaleString() + '），回撤补仓档 15/25/35/45/50，反弹减仓档 50/100/200，无定投</div>'
  + svg.join('') + '</div><div class="card"><table><thead><tr><th>方案</th><th>期末总值</th><th>倍数</th><th>最大回撤</th><th>交易笔数</th></tr></thead><tbody>'
  + rows + '</tbody></table><div class="note">'
  + '· <b>未启用保护</b>：原始策略，深跌照加杠杆，末值最高但最大回撤约 -80%。<br>'
  + '· <b>纯趋势过滤</b>：跌破 200 日均线就把杠杆换回基准端，回撤降到约 -59%，但末值掉一个数量级——超额收益恰恰来自深跌加杠杆。<br>'
  + '· <b>混合（推荐）</b>：浅跌听趋势过滤避险，回撤跌穿 35% 后交还给补仓阶梯继续加杠杆，价格重新站上 200 日均线再交回趋势过滤。<br>'
  + '· 本页由 <code>tools/gen_trend_compare.js</code> 用与网页版完全相同的回测引擎生成。</div></div></body></html>';

print(html);
// 诊断数字见 tools/trend_deep_eval.js；本脚本 stdout 即 HTML，请重定向到 web/trend_compare.html
