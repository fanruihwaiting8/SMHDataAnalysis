// 页面交互：表单渲染、回测触发、图表 / 指标 / 交易表更新
(function () {
  const BT = window.SMH_BT;
  const DD = BT.DRAWDOWN_LEVELS, RB = BT.REBOUND_LEVELS;

  // 数据源 -> (基准key, 杠杆key, 显示名)
  const SOURCES = {
    SMH: { a: "SMH", b: "SOXL", na: "SMH", nb: "SOXL" },
    QQQ: { a: "QQQ", b: "TQQQ", na: "QQQ", nb: "TQQQ" },
    USD: { a: "SMH", b: "USD", na: "SMH", nb: "USD" },
  };
  // 推荐参数（各数据源各自“最近 10 年窗口”收益最大化网格搜索结果，
  // 与 Python 脚本 optimize_group_10y.py / optimize_qqq_10y.py 及 main.py 的
  // DATA_SOURCES 推荐值完全一致）。
  // 默认 REC_DD/REC_RB 用 SMH 口径（页面初始数据源即 SMH）。
  const REC_DD = { 15: 0, 25: 35, 35: 100, 45: 0, 50: 0 };
  const REC_RB = { 50: 0, 100: 0, 200: 100 };
  // 按数据源区分的推荐参数（未列出的源回退到上面的 REC_DD/REC_RB）
  const REC_BY_SOURCE = {
    // SMH/SOXL（最近 10 年 2016-10~2026-10，共 2513 日）：
    // 回撤 -25% 换 35%、-35% 剩余全换 SOXL，反弹 +200% 全撤回 SMH。
    SMH: {
      dd: { 15: 0, 25: 35, 35: 100, 45: 0, 50: 0 },
      rb: { 50: 0, 100: 0, 200: 100 },
    },
    // QQQ/TQQQ（最近 10 年 2016-10~2026-10）：回撤 -15% 换 60%、-35% 剩余全换 TQQQ，
    // 反弹 +100% 全撤回 QQQ。
    QQQ: {
      dd: { 15: 60, 25: 0, 35: 100, 45: 0, 50: 0 },
      rb: { 50: 0, 100: 100, 200: 0 },
    },
    // SMH/USD（最近 10 年 2016-10~2026-10）：回撤 -25% 换 45%、-35% 剩余全换 USD，
    // 反弹 +200% 全撤回 SMH。
    USD: {
      dd: { 15: 0, 25: 45, 35: 100, 45: 0, 50: 0 },
      rb: { 50: 0, 100: 0, 200: 100 },
    },
  };

  // 每月定投比例（占「基准端+杠杆端」起始资金之和的百分比）。
  // 勾上页面的「每月定投」后，每月第一个交易日注入 起始资金 × DCA_PCT%，
  // 注入额全部买入基准端（是否换成杠杆端仍由回撤档位规则决定）。
  const DCA_PCT = 1;
  // 定投口径下重新做的网格搜索结果（tools/optimize_dca.js，最近 10 年窗口、
  // 起始 20000+20000、每月注入 400，目标同样是末日总资金最大化）。
  // 与一次性投入相比，主要差别是深档（-45%）的价值显著上升：
  // 持续有新钱流入基准端，深跌时仍有弹药可换，故 -45% 档从 0% 提到 100%。
  const REC_DCA_BY_SOURCE = {
    // SMH/SOXL：final 21,264,332（同口径不调仓 1,115,472）
    SMH: {
      dd: { 15: 0, 25: 40, 35: 100, 45: 100, 50: 0 },
      rb: { 50: 0, 100: 0, 200: 100 },
    },
    // QQQ/TQQQ：final 1,974,580（同口径不调仓 734,778）
    QQQ: {
      dd: { 15: 55, 25: 0, 35: 100, 45: 0, 50: 0 },
      rb: { 50: 0, 100: 100, 200: 0 },
    },
    // SMH/USD：final 8,910,936（同口径不调仓 1,765,094）
    USD: {
      dd: { 15: 0, 25: 50, 35: 100, 45: 100, 50: 0 },
      rb: { 50: 0, 100: 0, 200: 100 },
    },
  };

  const $ = (id) => document.getElementById(id);
  const chart = echarts.init($("chart"), "dark");
  const dcaOn = () => !!($("dca") && $("dca").checked);
  // 当前生效的每月注入金额（未勾选定投时为 0）
  function monthlyPctNow() { return dcaOn() ? DCA_PCT : 0; }

  // ---- 下拉式日期选择器：年/月/日三段下拉 <-> 隐藏 input(YYYY-MM-DD) 双向同步 ----
  // 用可选交易日集合(setDates)约束：只列出区间内真实存在数据的年/月/日，
  // 选年即可一键跳转，无需像原生日历那样逐月点箭头。
  function DateSel(selId, hiddenId, onChange) {
    const box = $(selId);
    const ys = box.querySelector(".d-y");
    const ms = box.querySelector(".d-m");
    const ds = box.querySelector(".d-d");
    const hidden = $(hiddenId);
    let all = [];          // 有效日期字符串数组(升序)
    let set = new Set();   // 快速判定某 YYYY-MM-DD 是否有效

    const pad = (n) => String(n).padStart(2, "0");
    const opt = (v, t) => `<option value="${v}">${t}</option>`;

    // 找 >= wanted 的最近有效日；没有则取 <= wanted 的最近有效日
    function nearest(wanted) {
      if (set.has(wanted)) return wanted;
      let up = null, down = null;
      for (const d of all) { if (d >= wanted) { up = d; break; } down = d; }
      return up || down || (all[0] || "");
    }

    function years() {
      const seen = new Set();
      return all.map((d) => d.slice(0, 4)).filter((y) => !seen.has(y) && seen.add(y));
    }
    function monthsOf(y) {
      const seen = new Set();
      return all.filter((d) => d.startsWith(y + "-"))
        .map((d) => d.slice(5, 7)).filter((m) => !seen.has(m) && seen.add(m));
    }
    function daysOf(y, m) {
      return all.filter((d) => d.startsWith(`${y}-${m}-`)).map((d) => d.slice(8, 10));
    }

    function fillYears() { ys.innerHTML = years().map((y) => opt(y, T("date.year", { y: y }))).join(""); }
    function fillMonths(y) { ms.innerHTML = monthsOf(y).map((m) => opt(m, T("date.month", { m: +m }))).join(""); }
    function fillDays(y, m) { ds.innerHTML = daysOf(y, m).map((d) => opt(d, T("date.day", { d: +d }))).join(""); }

    // 把三段下拉对齐到某个有效日期
    function setValue(dateStr) {
      const v = nearest(dateStr);
      if (!v) { hidden.value = ""; return; }
      const [y, m, d] = v.split("-");
      fillYears(); ys.value = y;
      fillMonths(y); ms.value = m;
      fillDays(y, m); ds.value = d;
      hidden.value = v;
    }

    function current() { return `${ys.value}-${ms.value}-${ds.value}`; }

    ys.addEventListener("change", () => {
      const y = ys.value;
      fillMonths(y); const m = ms.value = monthsOf(y)[0];
      fillDays(y, m); ds.value = daysOf(y, m)[0];
      hidden.value = nearest(current()); onChange && onChange();
    });
    ms.addEventListener("change", () => {
      const y = ys.value, m = ms.value;
      fillDays(y, m); ds.value = daysOf(y, m)[0];
      hidden.value = nearest(current()); onChange && onChange();
    });
    ds.addEventListener("change", () => {
      hidden.value = nearest(current()); onChange && onChange();
    });

    return {
      // 重设可选日期集合；keepVal=true 时尽量保留旧值(切数据源且旧值仍在区间内)
      setDates(dates, fallback, keepVal) {
        all = dates.slice(); set = new Set(all);
        const old = hidden.value;
        setValue(keepVal && old && set.has(old) ? old : fallback);
      },
      get value() { return hidden.value; },
      set value(v) { setValue(v); },
    };
  }

  let startSel, endSel;

  // ---- 动态生成补仓/减仓输入框 ----
  function buildInputs() {
    $("ddRow").innerHTML = DD.map((lv) =>
      `<div class="field"><label>${T("inp.ddLabel", { lv: lv })}</label>
       <input class="dd" data-lv="${lv}" type="number" value="${REC_DD[lv]}" />
       <div class="trig" id="ddTrig-${lv}"></div></div>`
    ).join("");
    $("rbRow").innerHTML = RB.map((lv) =>
      `<div class="field"><label>${T("inp.rbLabel", { lv: lv })}</label>
       <input class="rb" data-lv="${lv}" type="number" value="${REC_RB[lv]}" />
       <div class="trig" id="rbTrig-${lv}"></div></div>`
    ).join("");
  }

  function readParams() {
    const dd = {}, rb = {};
    document.querySelectorAll(".dd").forEach((el) => dd[+el.dataset.lv] = +el.value || 0);
  document.querySelectorAll(".rb").forEach((el) => rb[+el.dataset.lv] = +el.value || 0);
    return { dd, rb };
  }

  // 把当前数据源的推荐档位填入补仓/减仓输入框（与桌面 GUI 行为一致）
  // 勾上「每月定投」时改用定投口径重新优化出的推荐参数。
  function recOf(srcKey, dca) {
    const table = dca ? REC_DCA_BY_SOURCE : REC_BY_SOURCE;
    return table[srcKey] || REC_BY_SOURCE[srcKey] || { dd: REC_DD, rb: REC_RB };
  }
  function fillRecommend() {
    const rec = recOf($("source").value, dcaOn());
    document.querySelectorAll(".dd").forEach((el) => el.value = rec.dd[+el.dataset.lv]);
    document.querySelectorAll(".rb").forEach((el) => el.value = rec.rb[+el.dataset.lv]);
  }

  // ---- 起始日在历史价格空间中的位置 ----
  // phaseTimeline 的 peak / activeTrough 是从数据最早一天累积的，正好能回答
  // 「我选的起始日，当时价格处在历史的什么位置」。
  const _tlCache = {};
  function timelineOf(src) {
    const k = src.a + "|" + src.b;
    if (!_tlCache[k]) _tlCache[k] = BT.phaseTimeline(src.a, src.b) || [];
    return _tlCache[k];
  }
  function startPosition(src) {
    const tl = timelineOf(src);
    if (!tl.length) return null;
    const sd = $("startDate").value || null;
    let rec = null;
    if (sd) {
      for (let i = 0; i < tl.length; i++) {
        if (tl[i].date >= sd) { rec = tl[i]; break; }
      }
      if (!rec) rec = tl[tl.length - 1];
    } else {
      rec = tl[0];
    }
    // 起始日之前（含当日）的历史分位：当日价高于多少比例的历史交易日
    let le = 0, n = 0;
    for (let i = 0; i < tl.length && tl[i].index <= rec.index; i++) {
      n++; if (tl[i].price <= rec.price) le++;
    }
    return { rec, pctile: n ? (le / n) * 100 : 0, nDays: n };
  }
  // 把「起始日已有的回撤」按补仓档位预先推演一遍，得到开局就该持有的杠杆端比例。
  // 逻辑与引擎一致：每档卖掉当时基准端市值的 dd[lv]% 换成杠杆端。
  function allocFromPosition(dd, ddPct) {
    let remain = 100, wB = 0;
    const fired = [];
    DD.forEach((lv) => {
      if (ddPct >= lv && (dd[lv] || 0) > 0) {
        const amt = remain * dd[lv] / 100;
        remain -= amt; wB += amt; fired.push(lv);
      }
    });
    return { wA: remain, wB, fired };
  }

  // 两端投入框下方的建议配比：结合「起始日处在历史价格空间的什么位置」与当前补仓档位
  // （默认即推荐参数），折算出建议的开局金额。
  // 基线结论来自多起点网格回测：从高位起步时全放基准端最优（策略会在下跌中自动换杠杆，
  // 开局持杠杆只是白担损耗）；起始日本身已深度回撤时，按已越过的档位开局就持杠杆。
  function renderAllocTip() {
    const ha = $("hintA"), hb = $("hintB");
    if (!ha || !hb) return;
    const srcKey = $("source").value;
    const src = SOURCES[srcKey];
    const total = (+$("capA").value || 0) + (+$("capB").value || 0);
    if (!(total > 0)) {
      ha.className = "allocHint dim"; hb.className = "allocHint dim";
      ha.textContent = T("alloc.needCapital"); hb.textContent = "";
      return;
    }
    let pos = null;
    try { pos = startPosition(src); } catch (e) { pos = null; }
    let dd = null;
    try { dd = readParams().dd; } catch (e) { dd = null; }
    if (!dd) dd = recOf(srcKey, dcaOn()).dd;
    const wB = pos ? Math.round(allocFromPosition(dd, pos.rec.ddPct).wB) : 0;
    const wA = 100 - wB;
    const m = (p) => fmtMoney(Math.round(total * p / 100));
    ha.className = "allocHint"; hb.className = "allocHint";
    ha.textContent = T("alloc.suggest", { m: m(wA), p: wA });
    hb.textContent = T("alloc.suggest", { m: m(wB), p: wB });
  }
  // 只在建议已经展示过（用户点过「初始配比推荐」）时才同步刷新，避免未点按钮就自动出现
  function refreshAllocTip() {
    const ha = $("hintA");
    if (ha && ha.textContent) renderAllocTip();
  }


  // 定投勾选后，在参数区下方列出「一次性投入推荐」与「定投推荐」的档位对比，
  // 差异档位高亮，方便直接看出定投条件下该怎么调加减仓比例。
  function renderDcaRec() {
    const box = $("dcaRec");
    if (!box) return;
    const wrap = $("dcaWrap");
    if (wrap) wrap.classList.toggle("on", dcaOn());
    if (!dcaOn()) { box.style.display = "none"; box.innerHTML = ""; return; }
    const srcKey = $("source").value;
    const src = SOURCES[srcKey];
    const one = recOf(srcKey, false), dca = recOf(srcKey, true);
    const total = (+$("capA").value || 0) + (+$("capB").value || 0);
    const row = (label, a, b) => {
      const cls = a === b ? "" : " class=\"hit\"";
      return `<tr><td>${label}</td><td>${a}%</td><td${cls}>${b}%</td></tr>`;
    };
    const rows = DD.map((lv) => row(T("dca.rec.rowDd", { lv }), one.dd[lv], dca.dd[lv]))
      .concat(RB.map((lv) => row(T("dca.rec.rowRb", { lv }), one.rb[lv], dca.rb[lv])));
    box.innerHTML = '<div class="note" style="margin-bottom:8px">'
      + T("dca.rec.note1", { pct: DCA_PCT })
      + (total > 0 ? T("dca.rec.note2", { amt: fmtMoney(total * DCA_PCT / 100) }) : "")
      + T("dca.rec.note3", { na: src.na, nb: src.nb })
      + T("dca.rec.note4")
      + `</div><table><thead><tr><th>${T("dca.rec.th.level")}</th><th>${T("dca.rec.th.one")}</th>`
      + `<th>${T("dca.rec.th.dca", { pct: DCA_PCT })}</th></tr></thead><tbody>`
      + rows.join("") + "</tbody></table>";
    box.style.display = "";
  }

  // 勾选框右侧：截止回测末日为止，实际已注入的定投总额（期数 × 每月金额），
  // 并给出「起始本金 + 定投 = 累计投入」，避免只看最终资金时忽略陆续投进去的钱。
  // 用回测返回的真实现金流（flows）统计，而不是按月份数估算，口径与引擎完全一致。
  function renderDcaSum(res) {
    const el = $("dcaSum");
    if (!el) return;
    if (!dcaOn() || !res || !res.flows || !(res.monthlyCash > 0)) {
      el.style.display = "none"; el.innerHTML = ""; return;
    }
    let n = 0, sum = 0;
    for (let i = 1; i < res.flows.length; i++) {
      const f = res.flows[i];
      if (f > 0) { n++; sum += f; }
    }
    const principal = (res.totalInvested || 0) - sum;
    const lastDate = res.equityDates[res.equityDates.length - 1];
    el.innerHTML = T("dca.sum", {
      date: lastDate,
      sum: fmtMoney(sum),
      n: n,
      per: fmtMoney(res.monthlyCash),
      principal: fmtMoney(principal),
      total: fmtMoney(res.totalInvested),
    });
    el.style.display = "";
  }

  function fmtMoney(v) {
    return "$" + Math.round(v).toLocaleString("en-US");
  }  function fmtPct(v) { return (v * 100).toFixed(1) + "%"; }

  // ---- 更新数据源可选日期范围提示 ----
  // resetDates=true 时（如切换数据源）强制把起止日对齐到新区间的两端，
  // 否则切到区间更宽的组合时旧的较晚日期不会被重置，看起来像"没生效"。
  function updateRange(resetDates) {
    const src = SOURCES[$("source").value];
    const common = BT.commonDates(src.a, src.b);
    if (common.length) {
      const lo = common[0], hi = common[common.length - 1];
      // 起止日各自喂入有效交易日集合：起始日默认落到 lo，截止日默认落到 hi。
      // 非强制重置时(切到更宽区间)尽量保留旧值，越界则由 DateSel 自动兜底到最近有效日。
      startSel.setDates(common, lo, !resetDates);
      endSel.setDates(common, hi, !resetDates);
      $("rangeNote").textContent = T("range.note", { lo: lo, hi: hi, n: common.length });
    }
  }

  // ---- 实时状态：当前价 vs 峰值跌幅 / 底部涨幅 + 各档触发价 ----
  // 与桌面 GUI 的「计算触发价」按钮等价，但在网页上始终自动显示，无需点击。
  // 触发价只取决于价格基准（peak / 有效底部），与投入资金和换仓比例无关，
  // 因此切换数据源时才需要重算，改资金/比例不影响。
  //
  // 关键：展示前先分清「当前处于下跌还是上涨阶段」，否则会给出误导性价格——
  // · 现价距峰值回撤未达 25%（创新高 / 高位回调）→ 有效底部还是上一轮下跌留下的，
  //   减仓触发价早被现价穿过，必须标注「暂不适用」，等跌出新底部才重新计时；
  // · 已进入深度回撤 / 底部反弹 → 本轮已触发过的回撤档不会再次补仓
  //   （须创新高后才重置），也不能照旧展示「跌到 $X 补仓」。
  function fmtPrice(v) { return "$" + v.toFixed(2); }

  function renderLiveState() {
    const src = SOURCES[$("source").value];
    let st = null;
    try { st = BT.computeLiveState(src.a, src.b); } catch (e) { st = null; }
    if (!st) {
      $("ddStatus").textContent = "";
      $("rbStatus").textContent = "";
      return;
    }
    const ddFired = new Set(st.ddFired);
    const rbFired = new Set(st.rbFired);
    const stale = st.troughStale;
    const head = T("live.head", { date: st.latestDate, phase: st.phaseLabel });

    // 补仓模块顶部：现价较历史最高点的跌幅（创新高当日为 0%）+ 本轮已用掉的档位
    let ddTxt = head + "<br/>" + (st.ddPct <= 0
      ? T("live.dd.atPeak", {
          na: src.na, price: fmtPrice(st.latestPrice), peakDate: st.peakDate,
        })
      : T("live.dd.below", {
          na: src.na, price: fmtPrice(st.latestPrice), peak: fmtPrice(st.peak),
          peakDate: st.peakDate, dd: st.ddPct.toFixed(2),
        }));
    ddTxt += "<br/>" + (st.ddFired.length
      ? T("live.dd.fired", { lvs: st.ddFired.map((lv) => `-${lv}%`).join("/") })
      : T("live.dd.none"));
    $("ddStatus").innerHTML = ddTxt;

    // 减仓模块顶部：有效底部是否还属于本轮，决定触发价有没有参考价值
    let rbTxt;
    if (stale) {
      const need = st.peak * (1 - BT.TROUGH_TRIGGER_PCT / 100.0);
      rbTxt = head + "<br/>" + T("live.rb.stale", {
        trough: fmtPrice(st.activeTrough), troughDate: st.troughDate,
        rb: st.rbPct.toFixed(2), trig: BT.TROUGH_TRIGGER_PCT.toFixed(0),
        need: fmtPrice(need),
      });
    } else {
      rbTxt = head + "<br/>" + (st.rbPct <= 0
        ? T("live.rb.atTrough", {
            na: src.na, price: fmtPrice(st.latestPrice), troughDate: st.troughDate,
          })
        : T("live.rb.above", {
            na: src.na, price: fmtPrice(st.latestPrice),
            trough: fmtPrice(st.activeTrough), troughDate: st.troughDate,
            rb: st.rbPct.toFixed(2),
          }));
      rbTxt += "<br/>" + (st.rbFired.length
        ? T("live.rb.fired", { lvs: st.rbFired.map((lv) => `+${lv}%`).join("/") })
        : T("live.rb.none"));
    }
    $("rbStatus").innerHTML = rbTxt;

    // 各回撤档：跌到多少钱触发补仓 + 距触发还需跌多少
    // 本轮已触发过的档位不再展示触发价，避免误以为跌到该价还会加杠杆。
    DD.forEach((lv) => {
      const el = $(`ddTrig-${lv}`);
      if (!el) return;
      const tp = st.ddTriggerPrices[lv];
      const gap = ((st.latestPrice - tp) / st.latestPrice) * 100.0;
      if (ddFired.has(lv)) {
        el.className = "trig fired";
        el.innerHTML = T("trig.dd.fired", { price: fmtPrice(tp) });
      } else if (gap <= 0) {
        el.className = "trig hit";
        el.innerHTML = T("trig.dd.hit", { price: fmtPrice(tp) });
      } else {
        el.className = "trig";
        el.innerHTML = T("trig.dd.wait", { price: fmtPrice(tp), gap: gap.toFixed(2) });
      }
    });

    // 各反弹档：底部失效时整体标灰，本轮已触发的档位单独标注
    RB.forEach((lv) => {
      const el = $(`rbTrig-${lv}`);
      if (!el) return;
      const tp = st.rbTriggerPrices[lv];
      const gap = ((tp - st.latestPrice) / st.latestPrice) * 100.0;
      if (stale) {
        el.className = "trig stale";
        el.innerHTML = T("trig.rb.stale", { price: fmtPrice(tp) });
      } else if (rbFired.has(lv)) {
        el.className = "trig fired";
        el.innerHTML = T("trig.rb.fired", { price: fmtPrice(tp) });
      } else if (gap <= 0) {
        el.className = "trig hit";
        el.innerHTML = T("trig.rb.hit", { price: fmtPrice(tp) });
      } else {
        el.className = "trig";
        el.innerHTML = T("trig.rb.wait", { price: fmtPrice(tp), gap: gap.toFixed(2) });
      }
    });
  }

  // ---- 进场建议：假设此刻入场，怎么买 / 什么价位买 ----
  // 思路：当下的状态（阶段 + 距峰值跌幅 / 距底部涨幅）在历史上反复出现过，
  // 把那些「长得像今天」的日期当成进场日，各自向后持有固定一段时间做回测；
  // 补仓/减仓参数沿用上方设定不动，只改「初始杠杆端占比」，看哪个占比未来结果最好。
  const ADVICE_W_STEP = 5;                        // 初始杠杆端占比搜索步长(%)
  const ADVICE_SHOW_STEP = 10;                    // 结果表展示步长(%)
  const ADVICE_HOLD_CANDIDATES = [756, 504, 252]; // 持有期候选(交易日，≈3年/2年/1年)
  const ADVICE_MIN_SAMPLES = 5;                   // 样本少于此数则只给规则型提示
  const ADVICE_MAX_SAMPLES = 30;                  // 样本上限(控制计算量)
  const ADVICE_SAMPLE_GAP = 20;                   // 样本起点最小间隔(交易日)，避免高度重叠
  const ADVICE_DD_TOL = 5;                        // 下跌阶段：跌幅匹配容差(个百分点)
  const ADVICE_RB_TOL = 15;                       // 反弹阶段：涨幅匹配容差(个百分点)
  const ADVICE_TIE_TOL = 0.02;                    // 中位数终值相差 ≤2% 视为并列，取回撤更小者
  const SIM_WIN = 126;                            // 相似度观察窗口(交易日，≈半年)
  const SIM_TOP = 3;                              // 展示最相似的历史阶段个数
  const SIM_GAP = 60;                             // 相似日之间最小间隔(交易日)，避免挑出同一段行情
  const SIM_RMSE_SCALE = 0.12;                    // 路径偏离度 -> 相似度的衰减尺度(对数收益)
  const SIM_FWD = [126, 252];                     // 相似日之后观察的区间(半年/一年)

  function median(arr) {
    const a = arr.slice().sort((x, y) => x - y), n = a.length;
    if (!n) return NaN;
    return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
  }

  function priceOn(key, date) {
    const d = window.PRICE_DATA[key];
    if (!d) return null;
    const i = d.dates.indexOf(date);
    return i < 0 ? null : d.closes[i];
  }

  // 从历史逐日阶段序列里挑「与当下同阶段、幅度接近」且后面还有足够行情的进场日
  function pickSamples(tl, st, holdDays) {
    const useDd = st.troughStale;  // 底部属上一轮时按距峰值跌幅匹配，否则按距底部涨幅匹配
    const cand = [];
    for (let i = 0; i < tl.length - holdDays; i++) {
      const d = tl[i];
      if (d.phase !== st.phase) continue;
      if (useDd) { if (Math.abs(d.ddPct - st.ddPct) > ADVICE_DD_TOL) continue; }
      else if (Math.abs(d.rbPct - st.rbPct) > ADVICE_RB_TOL) continue;
      const prev = cand[cand.length - 1];
      if (prev && d.index - prev.index < ADVICE_SAMPLE_GAP) continue;
      cand.push({ index: d.index, start: d.date, end: tl[i + holdDays].date });
    }
    if (cand.length <= ADVICE_MAX_SAMPLES) return cand;
    // 样本过多时沿时间轴均匀抽样，保证覆盖不同年代而不是只压在某几年
    const out = [], step = (cand.length - 1) / (ADVICE_MAX_SAMPLES - 1);
    for (let k = 0; k < ADVICE_MAX_SAMPLES; k++) out.push(cand[Math.round(k * step)]);
    return out;
  }

  // 固定一个初始杠杆端占比 w(%)，在所有样本上回测并聚合统计
  // monthlyPct > 0 时样本内也按月注入，倍数口径改为「终值 / 该样本累计投入」，
  // 否则定投样本的倍数会被陆续投入的新钱稀释，无法横向比较。
  function evalWeight(src, dd, rb, samples, w, total, monthlyPct) {
    const capB = total * w / 100, capA = total - capB;
    const mults = [], dds = [];
    let wins = 0, used = 0;
    for (const s of samples) {
      let r;
      try {
        r = BT.runBacktest({
          keyA: src.a, keyB: src.b, capA, capB,
          drawdowns: dd, rebounds: rb, startDate: s.start, endDate: s.end,
          monthlyPct: monthlyPct || 0,
        });
      } catch (e) { continue; }
      const m = (monthlyPct > 0)
        ? BT.calcFlowMetrics(r.equityDates, r.equityStrategy, r.flows)
        : BT.calcMetrics(r.equityDates, r.equityStrategy);
      if (!m) continue;
      used += 1;
      mults.push(r.finalTotal / (r.totalInvested || total));
      dds.push(Math.abs(m.maxDD) * 100);
      if (r.finalTotal >= r.equityHoldA[r.equityHoldA.length - 1]) wins += 1;
    }
    if (!used) return null;
    return {
      w, n: used,
      medMult: median(mults),
      worstMult: Math.min.apply(null, mults),
      bestMult: Math.max.apply(null, mults),
      medDD: median(dds),
      winRate: wins / used,
    };
  }

  // 加杠杆清单：继续下跌时，跌到哪个价位、把多少钱从基准端换成杠杆端。
  // 价格基准沿用策略真实状态（历史峰值 + 本轮已触发档），与上方触发价完全一致。
  function adviceAddTable(src, st, dd, capA) {
    const lvs = DD.filter((lv) => (dd[lv] || 0) > 0);
    if (!lvs.length) {
      return `<div class="note">${T("adv.add.allZero", { na: src.na, nb: src.nb })}</div>`;
    }
    const fired = new Set(st.ddFired);
    let h = `<table class="cmp-tbl"><thead><tr><th>${T("adv.add.th.level")}</th>`
      + `<th>${T("adv.th.trigger")}</th><th>${T("adv.th.gap")}</th>`
      + `<th>${T("adv.add.th.buy", { nb: src.nb })}</th>`
      + `<th>${T("adv.add.th.left", { na: src.na })}</th></tr></thead><tbody>`;
    let remain = capA;
    lvs.forEach((lv) => {
      const tp = st.ddTriggerPrices[lv];
      if (fired.has(lv)) {
        h += `<tr style="opacity:.55"><td>-${lv}%</td><td>${fmtPrice(tp)}</td>`
          + `<td colspan="3">${T("adv.add.firedRow")}</td></tr>`;
        return;
      }
      const gap = ((st.latestPrice - tp) / st.latestPrice) * 100;
      const amt = remain * dd[lv] / 100;
      remain -= amt;
      h += `<tr><td>-${lv}%</td><td><b>${fmtPrice(tp)}</b></td>`
        + `<td>${gap > 0 ? T("adv.add.needFall", { gap: gap.toFixed(2) }) : T("adv.add.canNow")}</td>`
        + `<td><b>${fmtMoney(amt)}</b>${T("adv.amtNote", { k: src.na, p: dd[lv] })}</td>`
        + `<td>${fmtMoney(remain)}</td></tr>`;
    });
    return h + "</tbody></table>";
  }

  // 减杠杆清单：自有效底部反弹到哪个价位、把多少钱从杠杆端换回基准端
  function adviceCutTable(src, st, rb, capB) {
    const lvs = RB.filter((lv) => (rb[lv] || 0) > 0);
    if (!lvs.length) {
      return `<div class="note">${T("adv.cut.allZero", { na: src.na, nb: src.nb })}</div>`;
    }
    const fired = new Set(st.rbFired);
    let h = `<table class="cmp-tbl"><thead><tr><th>${T("adv.cut.th.level")}</th>`
      + `<th>${T("adv.th.trigger")}</th><th>${T("adv.th.gap")}</th>`
      + `<th>${T("adv.cut.th.sell", { na: src.na, nb: src.nb })}</th>`
      + `<th>${T("adv.cut.th.left", { nb: src.nb })}</th></tr></thead><tbody>`;
    let remain = capB;
    lvs.forEach((lv) => {
      const tp = st.rbTriggerPrices[lv];
      if (fired.has(lv)) {
        h += `<tr style="opacity:.55"><td>+${lv}%</td><td>${fmtPrice(tp)}</td>`
          + `<td colspan="3">${T("adv.cut.firedRow")}</td></tr>`;
        return;
      }
      const gap = ((tp - st.latestPrice) / st.latestPrice) * 100;
      const amt = remain * rb[lv] / 100;
      remain -= amt;
      h += `<tr><td>+${lv}%</td><td><b>${fmtPrice(tp)}</b></td>`
        + `<td>${gap > 0 ? T("adv.cut.needRise", { gap: gap.toFixed(2) }) : T("adv.cut.canNow")}</td>`
        + `<td><b>${fmtMoney(amt)}</b>${T("adv.amtNote", { k: src.nb, p: rb[lv] })}</td>`
        + `<td>${fmtMoney(remain)}</td></tr>`;
    });
    return h + "</tbody></table>";
  }

  // 进场后的动作清单：按当前阶段决定先看加杠杆还是先看减杠杆
  function renderAdviceActions(src, st, dd, rb, capA, capB) {
    const stale = st.troughStale;   // true = 有效底部属上一轮，主线是继续等补仓
    const need = st.peak * (1 - BT.TROUGH_TRIGGER_PCT / 100);

    const mainTag = T("adv.main");
    const addBlk = `<div class="adv-sec">`
      + T("adv.sec.add", { nb: src.nb, main: stale ? mainTag : "" })
      + "</div>"
      + '<div class="note" style="margin-bottom:8px">'
      + T("adv.add.baseNote", { peak: fmtPrice(st.peak), pd: st.peakDate })
      + "</div>"
      + adviceAddTable(src, st, dd, capA);

    let cutBlk = `<div class="adv-sec">`
      + T("adv.sec.cut", { na: src.na, nb: src.nb, main: stale ? "" : mainTag })
      + "</div>";
    if (stale) {
      cutBlk += `<div class="note">` + T("adv.cut.staleNote", {
        trough: fmtPrice(st.activeTrough), td: st.troughDate,
        rb: st.rbPct.toFixed(2), trig: BT.TROUGH_TRIGGER_PCT.toFixed(0),
        need: fmtPrice(need),
      }) + "</div>";
    } else {
      cutBlk += '<div class="note" style="margin-bottom:8px">'
        + T("adv.cut.baseNote", {
            trough: fmtPrice(st.activeTrough), td: st.troughDate,
          })
        + "</div>"
        + adviceCutTable(src, st, rb, capB);
    }
    return stale ? addBlk + cutBlk : cutBlk + addBlk;
  }

  // 单个方案框：初始买法 + 该配比在样本上的表现
  function advicePlanBox(title, tag, r, src, total, best) {
    const capB = total * r.w / 100, capA = total - capB;
    return `<div class="adv-box${best ? " best" : ""}">`
      + `<h3>${title}${tag ? `<span class="tag">${tag}</span>` : ""}</h3>`
      + '<div class="adv-kv">'
      + `${T("adv.box.wLabel")} <span class="big">${r.w}%</span><br/>`
      + T("adv.box.buyA", { na: src.na, amt: fmtMoney(capA) }) + "<br/>"
      + T("adv.box.buyB", { nb: src.nb, amt: fmtMoney(capB) }) + "<br/>"
      + T("adv.box.med", {
          m: r.medMult.toFixed(2), w: r.worstMult.toFixed(2), b: r.bestMult.toFixed(2),
        }) + "<br/>"
      + T("adv.box.dd", {
          dd: r.medDD.toFixed(1), wr: (r.winRate * 100).toFixed(0),
        })
      + "</div></div>";
  }

  // 「阶梯自洽占比」：这就是此刻该拿多少杠杆端的上限。
  // 设想一个人在峰值那天满仓基准端进场，然后严格按上方补仓/减仓参数走到今天：
  // 本轮已触发的补仓档逐级把基准端换成杠杆端，已触发的减仓档再换回来，
  // 剩下的基准端是留给后面 -25%/-35%/… 档的弹药，不能在进场当天就花掉。
  function ladderWeight(st, dd, rb) {
    const ddFired = new Set(st.ddFired), rbFired = new Set(st.rbFired);
    let base = 100, lev = 0;
    DD.forEach((lv) => {
      if (!ddFired.has(lv) && st.ddPct < lv) return;
      const amt = base * (dd[lv] || 0) / 100;
      base -= amt; lev += amt;
    });
    if (!st.troughStale) {
      RB.forEach((lv) => {
        if (!rbFired.has(lv) && st.rbPct < lv) return;
        const amt = lev * (rb[lv] || 0) / 100;
        lev -= amt; base += amt;
      });
    }
    return Math.max(0, Math.min(100, lev));
  }

  // ---- 「历史上哪一天的前半年，走得和最近半年最像」 ----
  // 做法：把窗口内的收盘价转成「相对窗口首日的对数收益路径」，消掉绝对价位差异，
  // 再与当下这半年的路径逐点比对：
  //   corr = 两条路径的相关系数 -> 形状(先跌后涨 / 一路下行 / 高位横盘…)是否吻合
  //   rmse = 逐点偏离的均方根   -> 涨跌幅度是否也相当
  // 相似度 = max(0,corr) × exp(-rmse / SIM_RMSE_SCALE)，形状和幅度都像才拿高分。
  function logPath(closes, end, win) {
    const s = end - win + 1;
    if (s < 0) return null;
    const p0 = closes[s];
    if (!(p0 > 0)) return null;
    const v = [];
    for (let i = s; i <= end; i++) {
      const p = closes[i];
      if (!(p > 0)) return null;
      v.push(Math.log(p / p0));
    }
    return v;
  }

  function corrOf(a, b) {
    const n = a.length;
    let ma = 0, mb = 0;
    for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    let sab = 0, sa = 0, sb = 0;
    for (let i = 0; i < n; i++) {
      const da = a[i] - ma, db = b[i] - mb;
      sab += da * db; sa += da * da; sb += db * db;
    }
    if (!(sa > 0) || !(sb > 0)) return 0;
    return sab / Math.sqrt(sa * sb);
  }

  // 一个窗口（以 end 结尾、长 win）的概况：半年涨跌幅、窗口内距最高点回撤、之后表现
  function winStat(closes, dates, end, win, last) {
    const s = end - win + 1;
    let hi = closes[s];
    for (let i = s; i <= end; i++) if (closes[i] > hi) hi = closes[i];
    return {
      date: dates[end], startDate: dates[s],
      chg: (closes[end] / closes[s] - 1) * 100,
      dd: (closes[end] / hi - 1) * 100,
      fwd: SIM_FWD.map((n) => {
        const k = end + n;
        return k <= last ? (closes[k] / closes[end] - 1) * 100 : null;
      }),
    };
  }

  function similarAnalysis(key, win, topN) {
    const d = window.PRICE_DATA && window.PRICE_DATA[key];
    if (!d || !d.closes || d.closes.length < win * 2) return null;
    const closes = d.closes, dates = d.dates, last = closes.length - 1;
    const now = logPath(closes, last, win);
    if (!now) return null;
    const cand = [];
    // 候选结束日至少比今天早一个完整窗口，否则会和「最近半年」自身重叠
    for (let j = win - 1; j <= last - win; j++) {
      const v = logPath(closes, j, win);
      if (!v) continue;
      let se = 0;
      for (let i = 0; i < win; i++) { const e = v[i] - now[i]; se += e * e; }
      const rmse = Math.sqrt(se / win);
      const corr = corrOf(v, now);
      cand.push({ j, rmse, corr, score: Math.max(0, corr) * Math.exp(-rmse / SIM_RMSE_SCALE) });
    }
    if (!cand.length) return null;
    cand.sort((x, y) => y.score - x.score);
    const picked = [];
    for (const c of cand) {
      // 相邻日期的窗口几乎一样，隔开 SIM_GAP 才算另一段行情
      if (picked.some((p) => Math.abs(p.j - c.j) < SIM_GAP)) continue;
      picked.push(c);
      if (picked.length >= topN) break;
    }
    return {
      now: winStat(closes, dates, last, win, last),
      list: picked.map((c) => Object.assign(
        winStat(closes, dates, c.j, win, last),
        { score: c.score, corr: c.corr, rmse: c.rmse },
      )),
    };
  }

  function fmtSignedPct(v) {
    if (v === null || v === undefined || !isFinite(v)) return "—";
    return (v > 0 ? "+" : "") + v.toFixed(1) + "%";
  }

  function renderAdviceSimilar(src, sim) {
    let h = `<div class="adv-sec">${T("adv.sim.sec", { win: SIM_WIN })}</div>`;
    if (!sim || !sim.list.length) return h + `<div class="note">${T("adv.sim.none")}</div>`;
    h += `<div class="note" style="margin-bottom:8px">${T("adv.sim.note", { na: src.na })}</div>`
      + '<div class="tbl-wrap"><table class="cmp-tbl"><thead><tr>'
      + `<th>${T("adv.sim.th.date")}</th><th>${T("adv.sim.th.score")}</th>`
      + `<th>${T("adv.sim.th.shape")}</th><th>${T("adv.sim.th.gapAvg")}</th>`
      + `<th>${T("adv.sim.th.chg")}</th>`
      + `<th>${T("adv.sim.th.dd")}</th><th>${T("adv.sim.th.fwd6")}</th>`
      + `<th>${T("adv.sim.th.fwd12")}</th>`
      + "</tr></thead><tbody>";
    const n = sim.now;
    h += `<tr style="font-weight:700"><td>${T("adv.sim.nowRow", { d: n.date, s: n.startDate })}</td>`
      + `<td>—</td><td>—</td><td>—</td><td>${fmtSignedPct(n.chg)}</td><td>${fmtSignedPct(n.dd)}</td>`
      + `<td>—</td><td>—</td></tr>`;
    sim.list.forEach((s) => {
      h += `<tr><td><b>${s.date}</b><br/><span class="note">${T("adv.sim.fromRow", { s: s.startDate })}</span></td>`
        + `<td><b>${(s.score * 100).toFixed(0)}%</b></td>`
        + `<td>${(s.corr * 100).toFixed(0)}%</td>`
        + `<td>${(s.rmse * 100).toFixed(1)}%</td>`
        + `<td>${fmtSignedPct(s.chg)}</td><td>${fmtSignedPct(s.dd)}</td>`
        + `<td>${fmtSignedPct(s.fwd[0])}</td><td>${fmtSignedPct(s.fwd[1])}</td></tr>`;
    });
    h += "</tbody></table></div>";
    const best = sim.list[0];
    h += `<div class="note" style="margin-top:6px">`
      + T("adv.sim.after", {
          d: best.date, f6: fmtSignedPct(best.fwd[0]), f12: fmtSignedPct(best.fwd[1]),
          na: src.na,
        })
      + "</div>";
    return h;
  }

  function renderAdvicePlans(src, rec, total, holdDays, capNote) {
    let h = '<div class="adv-plan">';
    h += advicePlanBox(T("adv.plan.rec"), T("adv.plan.recTag"), rec, src, total, true);
    h += "</div>";
    if (capNote) h += `<div class="note" style="margin-bottom:8px">${capNote}</div>`;
    h += '<div class="note" style="margin-bottom:4px">'
      + T("adv.plan.note", { n: holdDays }) + "</div>";
    return h;
  }

  function renderAdviceTable(rows, rec, cap) {
    const keep = rows.filter((r) => r.w % ADVICE_SHOW_STEP === 0 || r.w === rec.w);
    let h = `<div class="adv-sec">${T("adv.tbl.sec")}</div>`
      + '<div class="tbl-wrap"><table class="cmp-tbl"><thead><tr>'
      + `<th>${T("adv.tbl.th.w")}</th><th>${T("adv.tbl.th.med")}</th>`
      + `<th>${T("adv.tbl.th.worst")}</th><th>${T("adv.tbl.th.best")}</th>`
      + `<th>${T("adv.tbl.th.medDD")}</th><th>${T("adv.tbl.th.win")}</th>`
      + `<th>${T("adv.tbl.th.n")}</th>`
      + "</tr></thead><tbody>";
    keep.forEach((r) => {
      const over = r.w > cap;
      const mark = r.w === rec.w
        ? T("adv.mark.rec") : (over ? T("adv.mark.overCap") : "");
      h += `<tr${r.w === rec.w ? ' style="font-weight:700"' : (over ? ' style="opacity:.55"' : "")}>`
        + `<td>${r.w}%${mark}</td><td>${r.medMult.toFixed(2)}×</td>`
        + `<td>${r.worstMult.toFixed(2)}×</td><td>${r.bestMult.toFixed(2)}×</td>`
        + `<td>${r.medDD.toFixed(1)}%</td><td>${(r.winRate * 100).toFixed(0)}%</td>`
        + `<td>${r.n}</td></tr>`;
    });
    return h + "</tbody></table></div>";
  }

  // 组装「进场建议」卡片内容
  function buildAdvice(src, dd, rb, total, monthlyPct) {
    const body = $("adviceBody"), sub = $("adviceSub");
    const st = BT.computeLiveState(src.a, src.b);
    if (!st || !(total > 0)) {
      sub.textContent = "";
      body.innerHTML = `<div class="note">${T("adv.noData")}</div>`;
      return;
    }
    const pxA = st.latestPrice, pxB = priceOn(src.b, st.latestDate);

    // 1) 找历史上与当下同阶段的进场日；持有期从长到短退让，优先保证样本量
    const tl = BT.phaseTimeline(src.a, src.b);
    let holdDays = ADVICE_HOLD_CANDIDATES[0], samples = [];
    for (const h of ADVICE_HOLD_CANDIDATES) {
      const s = pickSamples(tl, st, h);
      if (s.length >= ADVICE_MIN_SAMPLES) { holdDays = h; samples = s; break; }
      if (s.length > samples.length) { holdDays = h; samples = s; }
    }

    // 2) 逐个占比在全部样本上回测
    const rows = [];
    if (samples.length >= ADVICE_MIN_SAMPLES) {
      for (let w = 0; w <= 100; w += ADVICE_W_STEP) {
        const r = evalWeight(src, dd, rb, samples, w, total, monthlyPct);
        if (r) rows.push(r);
      }
    }

    const matchTxt = st.troughStale
      ? T("adv.match.dd", { p: st.ddPct.toFixed(2), tol: ADVICE_DD_TOL })
      : T("adv.match.rb", { p: st.rbPct.toFixed(2), tol: ADVICE_RB_TOL });
    const holdYear = (holdDays / 252).toFixed(0);

    let html = '<div class="note" style="margin-bottom:10px">'
      + T("adv.scopeNote", { na: src.na, nb: src.nb })
      + '</div><div class="adv-kv" style="margin-bottom:12px">'
      + T("adv.kv.entry", { d: st.latestDate, na: src.na, pa: fmtPrice(pxA) })
      + (pxB ? T("adv.kv.entryB", { nb: src.nb, pb: fmtPrice(pxB) }) : "")
      + "<br/>"
      + T("adv.kv.phase", {
          phase: st.phaseLabel, match: matchTxt, total: fmtMoney(total),
        })
      + (monthlyPct > 0
        ? T("adv.kv.dca", { amt: fmtMoney(total * monthlyPct / 100), na: src.na })
        : "")
      + "<br/>"
      + T("adv.kv.samples", { n: samples.length, d: holdDays, y: holdYear })
      + "</div>";

    if (rows.length === 0) {
      sub.textContent = T("adv.sub.few");
      html += `<div class="note">`
        + T("adv.few.note", { n: samples.length, min: ADVICE_MIN_SAMPLES })
        + "</div>";
      html += renderAdviceSimilar(src, similarAnalysis(src.a, SIM_WIN, SIM_TOP));
      html += renderAdviceActions(src, st, dd, rb, total, 0);
      body.innerHTML = html;
      return;
    }

    // 3) 选优：只取一个，但必须与补仓阶梯自洽。
    //    先算「阶梯自洽占比」cap——按上方参数走到今天本该有多少在杠杆端；
    //    再在 0..cap 里挑历史同阶段样本中位数终值最高的那个（并列时取回撤更小）。
    //    不设这个上限的话，样本期半导体整体上行，中位数收益会随杠杆占比单调递增，
    //    结论必然退化成「永远 100% 杠杆」——那等于放弃后面的补仓档位，不是优势。
    const capRaw = ladderWeight(st, dd, rb);
    const cap = Math.max(0, Math.min(100,
      Math.round(capRaw / ADVICE_W_STEP) * ADVICE_W_STEP));
    const pool = rows.filter((r) => r.w <= cap);
    const usable = pool.length ? pool : rows.filter((r) => r.w === 0);
    const byMult = usable.slice().sort((x, y) => y.medMult - x.medMult);
    const top = byMult[0];
    const tie = usable.filter((r) => r.medMult >= top.medMult * (1 - ADVICE_TIE_TOL));
    const recommended = tie.slice().sort((x, y) => x.medDD - y.medDD)[0] || top;
    const full = rows.filter((r) => r.w === 100)[0];

    const firedTxt = st.ddFired.length
      ? st.ddFired.map((lv) => `-${lv}%`).join("、") : T("adv.cap.none");
    const capNote = T("adv.cap.note", {
      cap: cap, rest: 100 - cap, ddp: st.ddPct.toFixed(2), fired: firedTxt,
      nb: src.nb, na: src.na,
    }) + (full ? T("adv.cap.full", {
      m: full.medMult.toFixed(2), dd: full.medDD.toFixed(1),
      m2: recommended.medMult.toFixed(2), dd2: recommended.medDD.toFixed(1),
    }) : "");

    sub.textContent = T("adv.sub.based", { n: samples.length });
    html += renderAdvicePlans(src, recommended, total, holdDays, capNote);
    html += renderAdviceSimilar(src, similarAnalysis(src.a, SIM_WIN, SIM_TOP));
    html += renderAdviceTable(rows, recommended, cap);
    const recW = recommended.w;
    html += renderAdviceActions(src, st, dd, rb, total * (100 - recW) / 100, total * recW / 100);
    body.innerHTML = html;
  }

  function renderEntryAdvice(src, dd, rb, total, monthlyPct) {
    const body = $("adviceBody");
    if (!body) return;
    $("adviceSub").textContent = "";
    body.innerHTML = `<div class="note">${T("adv.computing")}</div>`;
    // 计算量较大（样本 × 占比档位次回测），放到下一帧避免阻塞首屏渲染
    setTimeout(function () {
      try { buildAdvice(src, dd, rb, total, monthlyPct || 0); }
      catch (e) { body.innerHTML = `<div class="note">${T("adv.failed", { e: e.message })}</div>`; }
    }, 0);
  }

  // ---- 主流程 ----
  let lastResult = null;
  function run() {
    const src = SOURCES[$("source").value];
    // 先刷新实时状态（触发价与回测是否成功无关，放在最前面保证总能显示）
    renderLiveState();
    const { dd, rb } = readParams();
    const capA = +$("capA").value || 0;
    const capB = +$("capB").value || 0;
    const startDate = $("startDate").value || null;
    const endDate = $("endDate").value || null;
    const monthlyPct = monthlyPctNow();
    renderDcaRec();
    refreshAllocTip();

    let res;
    try {
      res = BT.runBacktest({
        keyA: src.a, keyB: src.b, capA, capB,
        drawdowns: dd, rebounds: rb, startDate, endDate, monthlyPct,
      });
    } catch (e) {
      alert(T("run.failed", { e: e.message }));
      return;
    }
    lastResult = { res, src };
    renderDcaSum(res);
    renderMetrics(res);
    renderChart(res, src);
    renderTrades(res, src);
    renderCompare(capA, capB);
    // 页面最底端的进场建议：用同一套补仓/减仓参数，只搜索初始配比
    renderEntryAdvice(src, dd, rb, capA + capB, monthlyPct);
  }

  // ---- 指标卡 ----
  // 有月度定投时，净值倍数口径失效（钱是陆续投进去的），必须改用
  // 资金流指标：CAGR 用 TWR（时间加权，剔除注入节奏影响），另外给出
  // XIRR（资金加权年化，才是你这笔钱真实的年化收益）与累计投入/净盈亏。
  function renderMetrics(res) {
    const hasFlow = !!(res.flows && res.totalInvested && res.monthlyCash > 0);
    const m = hasFlow
      ? BT.calcFlowMetrics(res.equityDates, res.equityStrategy, res.flows)
      : BT.calcMetrics(res.equityDates, res.equityStrategy);
    const base = hasFlow
      ? BT.calcFlowMetrics(res.equityDates, res.equity5050, res.flows)
      : BT.calcMetrics(res.equityDates, res.equity5050);
    if (!m) return;
    const excess = m.finalTotal - base.finalTotal;
    const cards = hasFlow ? [
      { k: T("m.final"), v: fmtMoney(m.finalTotal) },
      { k: T("m.invested"), v: fmtMoney(m.invested) },
      { k: T("m.profit"), v: (m.profit >= 0 ? "+" : "") + fmtMoney(m.profit), cls: m.profit >= 0 ? "pos" : "neg" },
      { k: T("m.xirr"), v: m.xirr === null ? "—" : fmtPct(m.xirr), cls: (m.xirr || 0) >= 0 ? "pos" : "neg" },
      { k: T("m.twr"), v: fmtPct(m.twrCagr), cls: m.twrCagr >= 0 ? "pos" : "neg" },
      { k: T("m.maxdd"), v: fmtPct(m.maxDD), cls: "neg" },
      { k: T("m.sharpe"), v: m.sharpe.toFixed(2) },
      { k: T("m.underwater"), v: T("m.days", { n: m.maxUnderwaterDays }) },
      { k: T("m.vs5050"), v: (excess >= 0 ? "+" : "") + fmtMoney(excess), cls: excess >= 0 ? "pos" : "neg" },
    ] : [
      { k: T("m.final"), v: fmtMoney(m.finalTotal) },
      { k: T("m.cagr"), v: fmtPct(m.cagr), cls: m.cagr >= 0 ? "pos" : "neg" },
      { k: T("m.maxdd"), v: fmtPct(m.maxDD), cls: "neg" },
      { k: T("m.sharpe"), v: m.sharpe.toFixed(2) },
      { k: T("m.underwater"), v: T("m.days", { n: m.maxUnderwaterDays }) },
      { k: T("m.vs5050"), v: (excess >= 0 ? "+" : "") + fmtMoney(excess), cls: excess >= 0 ? "pos" : "neg" },
    ];
    $("metrics").innerHTML = cards.map((c) =>
      `<div class="metric"><div class="k">${c.k}</div>
       <div class="v ${c.cls || ""}">${c.v}</div></div>`
    ).join("");
  }

  // ---- 净值曲线 ----
  function activeCurves() {
    const on = {};
    document.querySelectorAll("#curveToggle span").forEach((s) => on[s.dataset.k] = s.classList.contains("on"));
    return on;
  }

  function renderChart(res, src) {
    const on = activeCurves();
    const series = [];
    const defs = [
      { k: "strategy", name: T("curve.strategy"), data: res.equityStrategy, color: "#f85149" },
      { k: "hold5050", name: T("curve.hold5050"), data: res.equity5050, color: "#8b949e" },
      { k: "holdA", name: T("curve.holdOnly", { k: src.na }), data: res.equityHoldA, color: "#1f6feb" },
      { k: "holdB", name: T("curve.holdOnly", { k: src.nb }), data: res.equityHoldB, color: "#d29922" },
    ];
    defs.forEach((d) => {
      if (!on[d.k]) return;
      series.push({
        name: d.name, type: "line", showSymbol: false, smooth: false,
        lineStyle: { width: 1.6, color: d.color }, itemStyle: { color: d.color },
        data: d.data.map((v) => Math.round(v)),
      });
    });

    // 交易标记点叠加到策略曲线上
    // tradeByDate：当日交易索引，供 tooltip 显示该日成交类型与双边成交价
    const tradeByDate = {};
    res.tradeMarks.forEach((t) => { tradeByDate[t.date] = t; });
    if (on.strategy && res.tradeMarks.length) {
      const dateIdx = {};
      res.equityDates.forEach((d, i) => dateIdx[d] = i);
      const markData = res.tradeMarks.map((t) => ({
        name: T("trade.kind." + t.kind), xAxis: dateIdx[t.date], yAxis: Math.round(t.equity),
        symbol: t.kind === "add" ? "triangle" : "arrow",
        symbolRotate: t.kind === "add" ? 180 : 0,
        itemStyle: { color: t.kind === "add" ? "#f85149" : "#3fb950" },
      }));
      series[0].markPoint = { symbolSize: 10, data: markData, label: { show: false } };
    }

    chart.setOption({
      backgroundColor: "transparent",
      tooltip:{
        trigger: "axis",
        formatter: (ps) => {
          let s = ps[0].axisValueLabel + "<br/>";
          ps.forEach((p) => { s += `${p.marker}${p.seriesName}: $${(+p.value).toLocaleString()}<br/>`; });
          // 该日若发生补仓/减仓，附带当日成交价（收盘价即成交价）
          const tr = tradeByDate[ps[0].axisValueLabel];
          if (tr) {
            const col = tr.kind === "add" ? "#f85149" : "#3fb950";
            s += `<span style="color:${col}">● ${T("trade.kind." + tr.kind)}</span> `
              + `${src.na} ${fmtPrice(tr.priceA)} / ${src.nb} ${fmtPrice(tr.priceB)}<br/>`;
          }
          return s;
        },
      },
      legend: { textStyle: { color: "#e6edf3" }, top: 0 },
      grid: { left: 60, right: 24, top: 40, bottom: 60 },
      xAxis: { type: "category", data: res.equityDates, axisLabel: { color: "#8b949e" } },
      yAxis: {
        type: on.log ? "log" : "value",
        axisLabel: { color: "#8b949e", formatter: (v) => "$" + (v / 1000) + "k" },
        splitLine: { lineStyle: { color: "#21262d" } },
      },
      dataZoom: [
        { type: "inside", start: 0, end: 100 },
        { type: "slider", start: 0, end: 100, height: 18, bottom: 24 },
      ],
      series,
    }, true);
  }

  // ---- 逐笔交易表 ----
  function renderTrades(res, src) {
    // 表头的价格列名随数据源变化（如 SMH 成交价 / SOXL 成交价）
    $("thPriceA").textContent = T("trade.th.priceDyn", { k: src.na });
    $("thPriceB").textContent = T("trade.th.priceDyn", { k: src.nb });
    // 计算每笔成交后总资金：用 tradeMarks 的 equity（与 trades 一一对应）
    // trades 元素为 [日期, 类型, 说明, 基准端成交价, 杠杆端成交价]，
    // 价格即成交当日两标的收盘价（本模型按收盘价换仓）。
    const rows = res.trades.map((t, i) => {
      const eq = res.tradeMarks[i] ? fmtMoney(res.tradeMarks[i].equity) : "-";
      const cls = t[1] === "add" ? "buy" : "sell";
      const pa = t[3] != null ? fmtPrice(t[3]) : "-";
      const pb = t[4] != null ? fmtPrice(t[4]) : "-";
      const kind = T("trade.kind." + t[1]);
      const desc = t[2] && t[2].k ? T(t[2].k, t[2].v) : (t[2] || "");
      return `<tr><td>${t[0]}</td><td class="${cls}">${kind}</td><td>${desc}</td><td>${pa}</td><td>${pb}</td><td>${eq}</td></tr>`;
    });
    $("tradeBody").innerHTML = rows.join("") || `<tr><td colspan="6">${T("trade.none")}</td></tr>`;
    $("tradeCount").textContent = T("trade.count", { n: res.trades.length });
  }

  // ---- 组合横向对比（可勾选，各组共用动态统一起点） ----
  const CMP_GROUPS = [
    { key: "SMH", a: "SMH", b: "SOXL", label: "SMH / SOXL" },
    { key: "QQQ", a: "QQQ", b: "TQQQ", label: "QQQ / TQQQ" },
    { key: "USD", a: "SMH", b: "USD", label: "SMH / USD" },
  ];

  function checkedCmpGroups() {
    const on = {};
    document.querySelectorAll("#cmpToggle span").forEach((s) => on[s.dataset.k] = s.classList.contains("on"));
    return CMP_GROUPS.filter((g) => on[g.key]);
  }

  // 勾选组合共用的统一起点 = 所涉及全部标的中"最晚的起始日"（它们共同都有数据的最早一天）。
  // 例如只勾 QQQ/TQQQ 时起点可追溯到很早；
  // 一旦勾上含 SMH 的组，起点会被顶到 SMH 数据首日（Nasdaq 接口仅回溯 10 年）。
  function unifiedStart(groups) {
    const keys = new Set();
    groups.forEach((g) => { keys.add(g.a); keys.add(g.b); });
    let latest = null;
    keys.forEach((k) => {
      const s = window.PRICE_DATA[k];
      if (s && s.dates.length) {
        const first = s.dates[0];
        if (latest === null || first > latest) latest = first;
      }
    });
    return latest;
  }

  function renderCompare(capA, capB) {
    const { dd, rb } = readParams();
    const monthlyPct = monthlyPctNow();
    const groups = checkedCmpGroups();
    if (!groups.length) {
      $("cmpBody").innerHTML = `<tr><td colspan="9" class="note">${T("cmp.none")}</td></tr>`;
      $("cmpNote").textContent = "";
      return;
    }
    // 用户在上方设定的起止日期作为对比区间的约束。
    const uStart = $("startDate").value || null;
    const uEnd = $("endDate").value || null;
    // 各组自动兜底的统一起点（涉及标的中最晚上市日）——仅当用户没设起点、
    // 或用户起点早于某组上市日时兜底用；否则一律尊重用户设定的范围。
    const autoStart = unifiedStart(groups);
    $("cmpNote").textContent = uStart
      ? T("cmp.rangeUser", { s: uStart, e: uEnd || T("cmp.latest") })
      : T("cmp.rangeAuto", { s: autoStart });
    if (monthlyPct > 0) {
      $("cmpNote").textContent += T("cmp.dcaNote", { pct: DCA_PCT });
    }
    const rows = groups.map((g) => {
    // 该组的起点 = max(用户起点, 该组自身最晚上市日)；无用户起点时用兜底起点。
      const gFirst = unifiedStart([g]);
      const startDate = uStart ? (uStart > gFirst ? uStart : gFirst) : autoStart;
      let res;
      try {
        res = BT.runBacktest({
          keyA: g.a, keyB: g.b, capA, capB, drawdowns: dd, rebounds: rb,
          startDate, endDate: uEnd, monthlyPct,
        });
      } catch (e) {
        return `<tr><td>${g.label}</td><td colspan="8" class="neg">${e.message}</td></tr>`;
      }
      const hasFlow = monthlyPct > 0;
      const m = hasFlow
        ? BT.calcFlowMetrics(res.equityDates, res.equityStrategy, res.flows)
        : BT.calcMetrics(res.equityDates, res.equityStrategy);
      const base = hasFlow
        ? BT.calcFlowMetrics(res.equityDates, res.equity5050, res.flows)
        : BT.calcMetrics(res.equityDates, res.equity5050);
      const excessCls = m.finalTotal >= base.finalTotal ? "pos" : "neg";
      const cagrShown = hasFlow ? (m.xirr === null ? m.twrCagr : m.xirr) : m.cagr;
      return `<tr>
        <td>${g.label}</td>
        <td class="note">${res.startDate} ~ ${res.endDate}</td>
        <td class="${excessCls}">${fmtMoney(m.finalTotal)}</td>
        <td class="${cagrShown >= 0 ? "pos" : "neg"}">${fmtPct(cagrShown)}</td>
        <td class="neg">${fmtPct(m.maxDD)}</td>
        <td>${m.sharpe.toFixed(2)}</td>
        <td>${fmtMoney(res.holdAllSmh)}</td>
        <td>${fmtMoney(res.holdAllSmh3)}</td>
        <td>${res.trades.length}</td>
      </tr>`;
    });
    $("cmpBody").innerHTML = rows.join("");
  }

  // ---- 事件绑定 ----
  function bind() {
    $("run").addEventListener("click", run);
    $("source").addEventListener("change", () => { fillRecommend(); updateRange(true); run(); });
    $("recommend").addEventListener("click", () => { fillRecommend(); run(); });
    // 初始配比推荐：选好起始日期后点按钮才计算并展示（点一次后，改金额/日期会同步刷新）
    if ($("allocAdvise")) {
      $("allocAdvise").addEventListener("click", renderAllocTip);
    }
    // 改动两端投入金额时，同比刷新初始配比建议（不重跑回测，避免输入过程中频繁计算）
    ["capA", "capB"].forEach((id) => {
      if ($(id)) $(id).addEventListener("input", refreshAllocTip);
    });
    // 勾选/取消定投：切换到对应口径的推荐参数并立即重跑，省掉手动点一次推荐
    if ($("dca")) {
      $("dca").addEventListener("change", () => { fillRecommend(); run(); });
    }
    document.querySelectorAll("#curveToggle span").forEach((s) => {
      s.addEventListener("click", () => {
        s.classList.toggle("on");
        if (lastResult) renderChart(lastResult.res, lastResult.src);
      });
    });
    document.querySelectorAll("#cmpToggle span").forEach((s) => {
      s.addEventListener("click", () => {
        s.classList.toggle("on");
        renderCompare(+$("capA").value || 0, +$("capB").value || 0);
      });
    });
    window.addEventListener("resize", () => chart.resize());
    // 语言切换：回填静态文案 + 重绘动态文案。
    // 注意不要调 buildInputs()，否则会把用户改过的档位数值重置回推荐值；
    // 这里只改 label 文本，日期下拉的年/月/日文案由 updateRange() 重填。
    window.addEventListener("smh:langchange", () => {
      if (window.I18N) I18N.applyStatic();
      document.querySelectorAll("#ddRow .field").forEach((f) => {
        const el = f.querySelector(".dd"), lb = f.querySelector("label");
        if (el && lb) lb.textContent = T("inp.ddLabel", { lv: el.dataset.lv });
      });
      document.querySelectorAll("#rbRow .field").forEach((f) => {
        const el = f.querySelector(".rb"), lb = f.querySelector("label");
        if (el && lb) lb.textContent = T("inp.rbLabel", { lv: el.dataset.lv });
      });
      updateRange();
      if (window.__ready) run();
    });
  }

  // ---- 启动 ----
  if (!window.PRICE_DATA) {
    document.body.innerHTML = "<p style='color:#f85149;padding:40px'>" + T("boot.noData") + "</p>";
    return;
  }
  // 初始化两个下拉式日期选择器；用户改动任一段即触发重算(与原生 change 行为一致)
  startSel = DateSel("startSel", "startDate", () => { if (window.__ready) run(); });
  endSel = DateSel("endSel", "endDate", () => { if (window.__ready) run(); });
  buildInputs();
  updateRange();
  bind();
  window.__ready = true;
  run();
})();