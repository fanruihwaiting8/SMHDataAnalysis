// i18n 键对称 + 占位符一致性检查（jsc 运行，无需 node）
var elStub = {
  textContent: "", innerHTML: "", value: "", style: {}, dataset: {},
  classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } },
  setAttribute: function () {}, getAttribute: function () { return null; },
  addEventListener: function () {}, appendChild: function () {},
  querySelectorAll: function () { return []; }, querySelector: function () { return null; },
};
var document = {
  documentElement: elStub, body: elStub, title: "",
  querySelectorAll: function () { return []; }, querySelector: function () { return null; },
  getElementById: function () { return null; }, createElement: function () { return elStub; },
  addEventListener: function () {},
};
var localStorage = { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} };
var navigator = { language: "zh-CN", languages: ["zh-CN"] };
var window = { I18N: null, document: document, localStorage: localStorage, navigator: navigator, addEventListener: function () {}, location: { search: "", hash: "", href: "" } };
load("i18n.js");
var zh = window.I18N.zh, en = window.I18N.en;
var kz = Object.keys(zh), ke = Object.keys(en);
var missEn = kz.filter(function (k) { return !(k in en); });
var missZh = ke.filter(function (k) { return !(k in zh); });
print("zh keys=" + kz.length + " en keys=" + ke.length);
print("missing in en: " + (missEn.length ? missEn.join(", ") : "none"));
print("missing in zh: " + (missZh.length ? missZh.join(", ") : "none"));

function ph(s) {
  var out = [], m, re = /\{(\w+)\}/g;
  while ((m = re.exec(String(s))) !== null) out.push(m[1]);
  return out.sort().join(",");
}
var bad = [];
kz.forEach(function (k) {
  if (!(k in en)) return;
  if (ph(zh[k]) !== ph(en[k])) bad.push(k + " [zh:" + ph(zh[k]) + "] [en:" + ph(en[k]) + "]");
});
print("placeholder mismatch: " + (bad.length ? "\n  " + bad.join("\n  ") : "none"));

// 新增 adv.map.* 键完整性
var need = ["adv.map.sec", "adv.map.note", "adv.map.th.price", "adv.map.th.gap",
  "adv.map.th.cond", "adv.map.th.act", "adv.map.th.after", "adv.map.nowGap",
  "adv.map.nowCond", "adv.map.nowAct", "adv.map.tail", "adv.map.cond.cut",
  "adv.map.act.cut", "adv.map.cond.peak", "adv.map.act.peak", "adv.map.cond.add",
  "adv.map.act.add", "adv.map.cond.bottom", "adv.map.act.bottom", "adv.map.bt.sec",
  "adv.map.bt.note", "adv.map.bt.th.bottom", "adv.map.bt.now", "adv.map.bt.lv",
  "adv.map.bt.invalid"];
var lack = need.filter(function (k) { return !(k in zh) || !(k in en); });
print("adv.map.* missing: " + (lack.length ? lack.join(", ") : "none"));
if (missEn.length || missZh.length || bad.length || lack.length) throw new Error("i18n check failed");
print("I18N OK");