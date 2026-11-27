// 价格行动路线图冒烟测试：从 app.js 里切出三个函数，注入 stub 后直接跑。
var srcAll = readFile("app.js");

// 1) 整体语法检查
try { new Function(srcAll); print("SYNTAX OK app.js"); }
catch (e) { print("SYNTAX FAIL app.js: " + e); throw e; }

var i = srcAll.indexOf("function roadmapRows(");
var j = srcAll.indexOf("// 单个方案框");
if (i < 0 || j < 0 || j < i) throw new Error("cannot locate roadmap block");
var block = srcAll.slice(i, j);

var DD = [5, 10, 15, 25, 35, 45, 55];
var RB = [10, 20, 30, 45, 60];
var BT = { TROUGH_TRIGGER_PCT: 25.0 };
function fmtPrice(v) { return "$" + Number(v).toFixed(2); }
function fmtMoney(v) { return "$" + Math.round(Number(v)); }
function T(k, p) {
  if (!p) return "[" + k + "]";
  var s = "[" + k;
  Object.keys(p).forEach(function (x) { s += " " + x + "=" + p[x]; });
  return s + "]";
}
var factory = new Function("DD", "RB", "BT", "T", "fmtPrice", "fmtMoney",
  block + "\nreturn { roadmapRows: roadmapRows, roadmapBottomTable: roadmapBottomTable, renderPriceRoadmap: renderPriceRoadmap };");
var M = factory(DD, RB, BT, T, fmtPrice, fmtMoney);
print("BLOCK OK (3 fns extracted)");

var src = { na: "SMH", nb: "SOXL" };
var dd = { 5: 20, 10: 20, 15: 20, 25: 25, 35: 30, 45: 40, 55: 50 };
var rb = { 10: 10, 20: 20, 30: 30, 45: 40, 60: 50 };

function mkState(o) {
  var peak = o.peak, trough = o.trough, px = o.px;
  var st = {
    peak: peak, peakDate: "2026-01-15", activeTrough: trough, troughDate: "2026-03-02",
    latestPrice: px, latestDate: "2026-11-26",
    ddFired: o.ddFired || [], rbFired: o.rbFired || [],
    ddPct: (peak - px) / peak * 100, rbPct: trough ? (px - trough) / trough * 100 : 0,
    troughStale: !!o.stale, phase: "x", phaseLabel: "阶段X",
    ddTriggerPrices: {}, rbTriggerPrices: {},
  };
  DD.forEach(function (lv) { st.ddTriggerPrices[lv] = peak * (1 - lv / 100); });
  RB.forEach(function (lv) { st.rbTriggerPrices[lv] = (trough || peak) * (1 + lv / 100); });
  return st;
}

function check(name, st) {
  var rows = M.roadmapRows(src, st, dd, rb, 6000, 4000);
  var desc = rows.map(function (r) { return r.kind + "@" + r.price.toFixed(2); }).join(" ");
  // 价格必须严格降序
  for (var k = 1; k < rows.length; k++) {
    if (rows[k].price > rows[k - 1].price + 1e-9) throw new Error(name + ": not sorted desc");
  }
  // 余额守恒：每行 a+b 应恒等于 10000
  rows.forEach(function (r) {
    if (r.a === null) return;
    if (Math.abs(r.a + r.b - 10000) > 1e-6) throw new Error(name + ": balance drift " + (r.a + r.b));
    if (r.a < -1e-9 || r.b < -1e-9) throw new Error(name + ": negative sleeve");
  });
  var html = M.renderPriceRoadmap(src, st, dd, rb, 6000, 4000);
  if (html.indexOf("adv.map.sec") < 0) throw new Error(name + ": no section title");
  if (html.indexOf("adv.map.nowGap") < 0) throw new Error(name + ": missing NOW row");
  if ((html.match(/adv\.map\.nowGap/g) || []).length !== 1) throw new Error(name + ": NOW row duplicated");
  // 同一价格不应出现两行
  var seen = {};
  rows.forEach(function (r) {
    var k = r.price.toFixed(4);
    if (seen[k]) throw new Error(name + ": duplicate price row at " + k);
    seen[k] = 1;
  });
  print(name + " rows=" + rows.length + " htmlLen=" + html.length + " | " + desc);
}

// 场景1：回撤 30%，本轮底部有效，已触发 -5/-10/-15/-25
check("drawdown-active", mkState({ peak: 300, trough: 200, px: 210, ddFired: [5, 10, 15, 25] }));
// 场景2：刚创新高附近，底部已过期（troughStale）
check("near-high-stale", mkState({ peak: 300, trough: 200, px: 298, ddFired: [], stale: true }));
// 场景3：历史新高当天（latestPrice === peak）
check("at-new-high", mkState({ peak: 300, trough: 200, px: 300, ddFired: [], stale: true }));
// 场景4：深度回撤 60%，补仓档全部触发
check("deep-dd", mkState({ peak: 300, trough: 118, px: 120, ddFired: [5, 10, 15, 25, 35, 45, 55] }));
print("ROADMAP SMOKE OK");