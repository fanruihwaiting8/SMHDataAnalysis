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

    function fillYears() { ys.innerHTML = years().map((y) => opt(y, y + "年")).join(""); }
    function fillMonths(y) { ms.innerHTML = monthsOf(y).map((m) => opt(m, +m + "月")).join(""); }
    function fillDays(y, m) { ds.innerHTML = daysOf(y, m).map((d) => opt(d, +d + "日")).join(""); }

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
      `<div class="field"><label>回撤 -${lv}%</label>
       <input class="dd" data-lv="${lv}" type="number" value="${REC_DD[lv]}" />
       <div class="trig" id="ddTrig-${lv}"></div></div>`
    ).join("");
    $("rbRow").innerHTML = RB.map((lv) =>
      `<div class="field"><label>反弹 +${lv}%</label>
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
    const rows = DD.map((lv) => row(`▼ 回撤 -${lv}%`, one.dd[lv], dca.dd[lv]))
      .concat(RB.map((lv) => row(`▲ 反弹 +${lv}%`, one.rb[lv], dca.rb[lv])));
    box.innerHTML = '<div class="note" style="margin-bottom:8px">'
      + `已开启每月定投：每月第一个交易日注入起始资金的 <b>${DCA_PCT}%</b>`
      + (total > 0 ? ` = <b>${fmtMoney(total * DCA_PCT / 100)}</b>/月` : "")
      + `，全额买入 ${src.na}；是否换成 ${src.nb} 仍由下列回撤档位决定。`
      + "下表右列是按定投现金流重新做网格搜索（最近 10 年窗口、末日总资金最大化）得到的推荐值，"
      + "<b>橙色</b>为与一次性投入不同的档位。点「填入推荐参数」即按右列填入。"
      + '</div><table><thead><tr><th>档位</th><th>一次性投入推荐</th>'
      + `<th>定投(${DCA_PCT}%/月)推荐</th></tr></thead><tbody>`
      + rows.join("") + "</tbody></table>";
    box.style.display = "";
  }

  function fmtMoney(v) {
    return "$" + Math.round(v).toLocaleString("en-US");
  }
  function fmtPct(v) { return (v * 100).toFixed(1) + "%"; }

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
      $("rangeNote").textContent = `可选区间 ${lo} ~ ${hi}（共 ${common.length} 个交易日）`;
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
    const head = `截至 ${st.latestDate}｜当前阶段：<b>${st.phaseLabel}</b>`;

    // 补仓模块顶部：现价较历史最高点的跌幅（创新高当日为 0%）+ 本轮已用掉的档位
    let ddTxt = st.ddPct <= 0
      ? `${head}<br/>${src.na} 现价 <b>${fmtPrice(st.latestPrice)}</b>`
        + `，正处历史最高点（${st.peakDate}），较峰值跌幅 <b>0.00%</b>`
      : `${head}<br/>${src.na} 现价 <b>${fmtPrice(st.latestPrice)}</b>`
        + `，较历史最高 ${fmtPrice(st.peak)}（${st.peakDate}）跌幅 <b>${st.ddPct.toFixed(2)}%</b>`;
    ddTxt += st.ddFired.length
      ? `<br/>└ ${st.ddFired.map((lv) => `-${lv}%`).join("/")} 档自上次创新高以来`
        + `已触发过，本轮不会再次补仓；其余档位触发价仍然有效`
      : `<br/>└ 五档均未触发，下方触发价全部有效`;
    $("ddStatus").innerHTML = ddTxt;

    // 减仓模块顶部：有效底部是否还属于本轮，决定触发价有没有参考价值
    let rbTxt;
    if (stale) {
      const need = st.peak * (1 - BT.TROUGH_TRIGGER_PCT / 100.0);
      rbTxt = `${head}<br/>有效底部 ${fmtPrice(st.activeTrough)}（${st.troughDate}）`
        + `<b>来自上一轮下跌</b>，现价已高出 <b>${st.rbPct.toFixed(2)}%</b>`
        + `——下方减仓触发价当前不适用`
        + `<br/>└ 需先自峰值回撤超过 ${BT.TROUGH_TRIGGER_PCT.toFixed(0)}% 跌出新底部`
        + `（即跌破 ${fmtPrice(need)}），减仓档位才会重新计时`;
    } else {
      rbTxt = st.rbPct <= 0
        ? `${head}<br/>${src.na} 现价 <b>${fmtPrice(st.latestPrice)}</b>`
          + `，正处本轮有效底部（${st.troughDate}），较底部涨幅 <b>0.00%</b>`
        : `${head}<br/>${src.na} 现价 <b>${fmtPrice(st.latestPrice)}</b>`
          + `，较本轮有效底部 ${fmtPrice(st.activeTrough)}（${st.troughDate}）`
          + `涨幅 <b>${st.rbPct.toFixed(2)}%</b>`;
      rbTxt += st.rbFired.length
        ? `<br/>└ ${st.rbFired.map((lv) => `+${lv}%`).join("/")} 档对该底部已触发过，`
          + `本轮不会再次减仓；其余档位触发价仍然有效`
        : `<br/>└ 各档均未触发，下方触发价全部有效`;
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
        el.innerHTML = `本轮已触发（${fmtPrice(tp)}）<br/>须创新高后才重置`;
      } else if (gap <= 0) {
        el.className = "trig hit";
        el.innerHTML = `跌到 ${fmtPrice(tp)} 补仓<br/>✓ 已达（现价已低于触发价）`;
      } else {
        el.className = "trig";
        el.innerHTML = `跌到 ${fmtPrice(tp)} 补仓<br/>还需跌 ${gap.toFixed(2)}%`;
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
        el.innerHTML = `暂不适用（${fmtPrice(tp)}）<br/>底部属上一轮，待跌出新底部`;
      } else if (rbFired.has(lv)) {
        el.className = "trig fired";
        el.innerHTML = `本轮已触发（${fmtPrice(tp)}）<br/>须跌出新底部后才重置`;
      } else if (gap <= 0) {
        el.className = "trig hit";
        el.innerHTML = `涨到 ${fmtPrice(tp)} 减仓<br/>✓ 已达（现价已高于触发价）`;
      } else {
        el.className = "trig";
        el.innerHTML = `涨到 ${fmtPrice(tp)} 减仓<br/>还需涨 ${gap.toFixed(2)}%`;
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
  const ADVICE_SAFE_DD = 55;                      // 均衡方案可接受的中位数最大回撤上限(%)

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
      return `<div class="note">当前补仓参数各档均为 0%，不会再把 ${src.na} 换成 ${src.nb}。</div>`;
    }
    const fired = new Set(st.ddFired);
    let h = '<table class="cmp-tbl"><thead><tr><th>回撤档</th><th>触发价</th><th>距现价</th>'
      + `<th>买入 ${src.nb}</th><th>剩余 ${src.na}</th></tr></thead><tbody>`;
    let remain = capA;
    lvs.forEach((lv) => {
      const tp = st.ddTriggerPrices[lv];
      if (fired.has(lv)) {
        h += `<tr style="opacity:.55"><td>-${lv}%</td><td>${fmtPrice(tp)}</td>`
          + '<td colspan="3">本轮已触发过（须创新高后才重置）——进场后不用再等这一档</td></tr>';
        return;
      }
      const gap = ((st.latestPrice - tp) / st.latestPrice) * 100;
      const amt = remain * dd[lv] / 100;
      remain -= amt;
      h += `<tr><td>-${lv}%</td><td><b>${fmtPrice(tp)}</b></td>`
        + `<td>${gap > 0 ? `还需跌 ${gap.toFixed(2)}%` : "✓ 现价已低于该价，可立即执行"}</td>`
        + `<td><b>${fmtMoney(amt)}</b>（当时 ${src.na} 的 ${dd[lv]}%）</td>`
        + `<td>${fmtMoney(remain)}</td></tr>`;
    });
    return h + "</tbody></table>";
  }

  // 减杠杆清单：自有效底部反弹到哪个价位、把多少钱从杠杆端换回基准端
  function adviceCutTable(src, st, rb, capB) {
    const lvs = RB.filter((lv) => (rb[lv] || 0) > 0);
    if (!lvs.length) {
      return `<div class="note">当前减仓参数各档均为 0%，不会把 ${src.nb} 换回 ${src.na}。</div>`;
    }
    const fired = new Set(st.rbFired);
    let h = '<table class="cmp-tbl"><thead><tr><th>反弹档</th><th>触发价</th><th>距现价</th>'
      + `<th>卖 ${src.nb} 换回 ${src.na}</th><th>剩余 ${src.nb}</th></tr></thead><tbody>`;
    let remain = capB;
    lvs.forEach((lv) => {
      const tp = st.rbTriggerPrices[lv];
      if (fired.has(lv)) {
        h += `<tr style="opacity:.55"><td>+${lv}%</td><td>${fmtPrice(tp)}</td>`
          + '<td colspan="3">对该底部已触发过（须跌出新底部后才重置）</td></tr>';
        return;
      }
      const gap = ((tp - st.latestPrice) / st.latestPrice) * 100;
      const amt = remain * rb[lv] / 100;
      remain -= amt;
      h += `<tr><td>+${lv}%</td><td><b>${fmtPrice(tp)}</b></td>`
        + `<td>${gap > 0 ? `还需涨 ${gap.toFixed(2)}%` : "✓ 现价已高于该价，可立即执行"}</td>`
        + `<td><b>${fmtMoney(amt)}</b>（当时 ${src.nb} 的 ${rb[lv]}%）</td>`
        + `<td>${fmtMoney(remain)}</td></tr>`;
    });
    return h + "</tbody></table>";
  }

  // 进场后的动作清单：按当前阶段决定先看加杠杆还是先看减杠杆
  function renderAdviceActions(src, st, dd, rb, capA, capB) {
    const stale = st.troughStale;   // true = 有效底部属上一轮，主线是继续等补仓
    const need = st.peak * (1 - BT.TROUGH_TRIGGER_PCT / 100);

    const addBlk = `<div class="adv-sec">继续下跌时：跌到多少买 ${src.nb}`
      + `${stale ? "（当前阶段的主线）" : ""}</div>`
      + '<div class="note" style="margin-bottom:8px">'
      + `价格基准是历史最高 ${fmtPrice(st.peak)}（${st.peakDate}），`
      + "与上方「补仓触发价」完全一致；金额按上面的推荐配比推演（未计中途涨跌）。</div>"
      + adviceAddTable(src, st, dd, capA);

    let cutBlk = `<div class="adv-sec">反弹走高时：涨到多少把 ${src.nb} 换回 ${src.na}`
      + `${stale ? "" : "（当前阶段的主线）"}</div>`;
    if (stale) {
      cutBlk += `<div class="note">当前有效底部 ${fmtPrice(st.activeTrough)}`
        + `（${st.troughDate}）来自上一轮下跌，现价已高出 ${st.rbPct.toFixed(2)}%，`
        + "减仓档位暂不适用：需先自峰值回撤超过 "
        + `${BT.TROUGH_TRIGGER_PCT.toFixed(0)}%（跌破 <b>${fmtPrice(need)}</b>）跌出新底部，`
        + "减仓才重新计时，届时上方「减仓触发价」会按新底部给出具体价格。</div>";
    } else {
      cutBlk += '<div class="note" style="margin-bottom:8px">价格基准是本轮有效底部 '
        + `${fmtPrice(st.activeTrough)}（${st.troughDate}），`
        + "与上方「减仓触发价」完全一致；金额按上面的推荐配比推演（未计中途涨跌）。</div>"
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
      + `杠杆端初始占比 <span class="big">${r.w}%</span><br/>`
      + `${src.na}（基准端）买入 <b>${fmtMoney(capA)}</b><br/>`
      + `${src.nb}（杠杆端）买入 <b>${fmtMoney(capB)}</b><br/>`
      + `样本中位数终值 <b>${r.medMult.toFixed(2)}×</b>`
      + `（最差 ${r.worstMult.toFixed(2)}× / 最好 ${r.bestMult.toFixed(2)}×）<br/>`
      + `中位数最大回撤 <b>${r.medDD.toFixed(1)}%</b>`
      + `　|　跑赢纯持基准 <b>${(r.winRate * 100).toFixed(0)}%</b>`
      + "</div></div>";
  }

  function renderAdvicePlans(src, agg, bal, total, holdDays) {
    let h = '<div class="adv-plan">';
    if (agg.w === bal.w) {
      h += advicePlanBox(
        "推荐配比",
        `中位数收益最高，且回撤 ≤ ${ADVICE_SAFE_DD}%`,
        agg, src, total, true);
    } else {
      h += advicePlanBox("进取方案", "样本中位数收益最高", agg, src, total, true);
      h += advicePlanBox(
        "均衡方案", `中位数最大回撤 ≤ ${ADVICE_SAFE_DD}%`, bal, src, total, false);
    }
    h += "</div>";
    h += '<div class="note" style="margin-bottom:4px">'
      + `终值倍数 = 持有 ${holdDays} 个交易日后的总资金 ÷ 进场本金；`
      + "取各样本的中位数，比平均值更不容易被个别极端行情带偏。</div>";
    return h;
  }

  function renderAdviceTable(rows, agg, bal) {
    const same = agg.w === bal.w;
    const keep = rows.filter((r) => r.w % ADVICE_SHOW_STEP === 0
      || r.w === agg.w || r.w === bal.w);
    let h = '<div class="adv-sec">各初始配比在历史同阶段样本上的表现</div>'
      + '<div class="tbl-wrap"><table class="cmp-tbl"><thead><tr>'
      + "<th>杠杆端初始占比</th><th>中位数终值</th><th>最差</th><th>最好</th>"
      + "<th>中位数最大回撤</th><th>跑赢纯持基准</th><th>样本数</th>"
      + "</tr></thead><tbody>";
    keep.forEach((r) => {
      let mark = "";
      if (same && r.w === agg.w) mark = " ← 推荐";
      else if (r.w === agg.w) mark = " ← 进取";
      else if (r.w === bal.w) mark = " ← 均衡";
      h += `<tr${mark ? ' style="font-weight:700"' : ""}>`
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
      body.innerHTML = '<div class="note">暂无可用数据或投入资金为 0，无法给出建议。</div>';
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
      ? `距峰值跌幅 ${st.ddPct.toFixed(2)}% ±${ADVICE_DD_TOL} 个百分点`
      : `距有效底部涨幅 ${st.rbPct.toFixed(2)}% ±${ADVICE_RB_TOL} 个百分点`;
    const holdYear = (holdDays / 252).toFixed(0);

    let html = '<div class="note" style="margin-bottom:10px">'
      + `以下结论只针对当前选中的 <b>${src.na} / ${src.nb}</b> 组合，回撤/反弹档位取该组合自己的推荐参数，不与其他组合横向比较。`
      + '</div><div class="adv-kv" style="margin-bottom:12px">'
      + `进场日：<b>${st.latestDate}</b>（数据源最新交易日）`
      + `　|　进场价：${src.na} <b>${fmtPrice(pxA)}</b>`
      + (pxB ? `、${src.nb} <b>${fmtPrice(pxB)}</b>` : "")
      + `<br/>当前阶段：<b>${st.phaseLabel}</b>（${matchTxt}）`
      + `　|　可投入总资金：<b>${fmtMoney(total)}</b>`
      + (monthlyPct > 0
        ? `（另每月定投 <b>${fmtMoney(total * monthlyPct / 100)}</b> 买入 ${src.na}，下表倍数＝终值 / 累计投入）`
        : "")
      + `<br/>历史同阶段样本：<b>${samples.length}</b> 个进场日`
      + `，每个样本向后持有 <b>${holdDays}</b> 个交易日（约 ${holdYear} 年）后结算`
      + "</div>";

    if (rows.length === 0) {
      sub.textContent = "（历史同阶段样本不足，仅给规则型提示）";
      html += '<div class="note">当前阶段在历史数据里出现得太少（可匹配样本 '
        + `${samples.length} 个，少于 ${ADVICE_MIN_SAMPLES} 个），`
        + "按样本择优会严重过拟合，故不给出具体配比。"
        + "可退一步按策略本身的逻辑执行：此刻先全额买入基准端，"
        + "把杠杆端额度留到下方各档补仓价再投入。</div>";
      html += renderAdviceActions(src, st, dd, rb, total, 0);
      body.innerHTML = html;
      return;
    }

    // 3) 选优：进取 = 中位数终值最高；均衡 = 回撤可接受范围内终值最高
    const byMult = rows.slice().sort((x, y) => y.medMult - x.medMult);
    const aggressive = byMult[0];
    const safePool = rows.filter((r) => r.medDD <= ADVICE_SAFE_DD);
    const balanced = safePool.length
      ? safePool.slice().sort((x, y) => y.medMult - x.medMult)[0]
      : rows.slice().sort((x, y) => x.medDD - y.medDD)[0];

    sub.textContent = `（基于 ${samples.length} 个历史同阶段样本）`;
    html += renderAdvicePlans(src, aggressive, balanced, total, holdDays);
    html += renderAdviceTable(rows, aggressive, balanced);
    const recW = aggressive.w;
    html += renderAdviceActions(src, st, dd, rb, total * (100 - recW) / 100, total * recW / 100);
    body.innerHTML = html;
  }

  function renderEntryAdvice(src, dd, rb, total, monthlyPct) {
    const body = $("adviceBody");
    if (!body) return;
    $("adviceSub").textContent = "";
    body.innerHTML = '<div class="note">正在用历史同阶段样本检验各档配比…</div>';
    // 计算量较大（样本 × 占比档位次回测），放到下一帧避免阻塞首屏渲染
    setTimeout(function () {
      try { buildAdvice(src, dd, rb, total, monthlyPct || 0); }
      catch (e) { body.innerHTML = `<div class="note">建议计算失败：${e.message}</div>`; }
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

    let res;
    try {
      res = BT.runBacktest({
        keyA: src.a, keyB: src.b, capA, capB,
        drawdowns: dd, rebounds: rb, startDate, endDate, monthlyPct,
      });
    } catch (e) {
      alert("回测失败：" + e.message);
      return;
    }
    lastResult = { res, src };
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
      { k: "最终总资金", v: fmtMoney(m.finalTotal) },
      { k: "累计投入", v: fmtMoney(m.invested) },
      { k: "净盈亏", v: (m.profit >= 0 ? "+" : "") + fmtMoney(m.profit), cls: m.profit >= 0 ? "pos" : "neg" },
      { k: "XIRR 资金加权年化", v: m.xirr === null ? "—" : fmtPct(m.xirr), cls: (m.xirr || 0) >= 0 ? "pos" : "neg" },
      { k: "TWR 年化", v: fmtPct(m.twrCagr), cls: m.twrCagr >= 0 ? "pos" : "neg" },
      { k: "最大回撤", v: fmtPct(m.maxDD), cls: "neg" },
      { k: "夏普(未扣无风险)", v: m.sharpe.toFixed(2) },
      { k: "最长套牢", v: m.maxUnderwaterDays + " 天" },
      { k: "vs 50-50不动", v: (excess >= 0 ? "+" : "") + fmtMoney(excess), cls: excess >= 0 ? "pos" : "neg" },
    ] : [
      { k: "最终总资金", v: fmtMoney(m.finalTotal) },
      { k: "CAGR 年化", v: fmtPct(m.cagr), cls: m.cagr >= 0 ? "pos" : "neg" },
      { k: "最大回撤", v: fmtPct(m.maxDD), cls: "neg" },
      { k: "夏普(未扣无风险)", v: m.sharpe.toFixed(2) },
      { k: "最长套牢", v: m.maxUnderwaterDays + " 天" },
      { k: "vs 50-50不动", v: (excess >= 0 ? "+" : "") + fmtMoney(excess), cls: excess >= 0 ? "pos" : "neg" },
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
      { k: "strategy", name: "动态策略", data: res.equityStrategy, color: "#f85149" },
      { k: "hold5050", name: "50-50 不动", data: res.equity5050, color: "#8b949e" },
      { k: "holdA", name: "纯持 " + src.na, data: res.equityHoldA, color: "#1f6feb" },
      { k: "holdB", name: "纯持 " + src.nb, data: res.equityHoldB, color: "#d29922" },
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
        name: t.kind, xAxis: dateIdx[t.date], yAxis: Math.round(t.equity),
        symbol: t.kind === "补仓" ? "triangle" : "arrow",
        symbolRotate: t.kind === "补仓" ? 180 : 0,
        itemStyle: { color: t.kind === "补仓" ? "#f85149" : "#3fb950" },
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
            const col = tr.kind === "补仓" ? "#f85149" : "#3fb950";
            s += `<span style="color:${col}">● ${tr.kind}</span> `
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
    $("thPriceA").textContent = `${src.na} 成交价`;
    $("thPriceB").textContent = `${src.nb} 成交价`;
    // 计算每笔成交后总资金：用 tradeMarks 的 equity（与 trades 一一对应）
    // trades 元素为 [日期, 类型, 说明, 基准端成交价, 杠杆端成交价]，
    // 价格即成交当日两标的收盘价（本模型按收盘价换仓）。
    const rows = res.trades.map((t, i) => {
      const eq = res.tradeMarks[i] ? fmtMoney(res.tradeMarks[i].equity) : "-";
      const cls = t[1] === "补仓" ? "buy" : "sell";
      const pa = t[3] != null ? fmtPrice(t[3]) : "-";
      const pb = t[4] != null ? fmtPrice(t[4]) : "-";
      return `<tr><td>${t[0]}</td><td class="${cls}">${t[1]}</td><td>${t[2]}</td><td>${pa}</td><td>${pb}</td><td>${eq}</td></tr>`;
    });
    $("tradeBody").innerHTML = rows.join("") || `<tr><td colspan="6">当前参数下无交易</td></tr>`;
    $("tradeCount").textContent = `共 ${res.trades.length} 笔`;
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
      $("cmpBody").innerHTML = `<tr><td colspan="9" class="note">未勾选任何组合</td></tr>`;
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
      ? `对比区间：${uStart} ~ ${uEnd || "最新"}（按上方设定；某组若上市晚于起点，则从其上市日起算）`
      : `统一起点：${autoStart}（未设起点，由勾选组合涉及标的的最晚上市日兜底）`;
    if (monthlyPct > 0) {
      $("cmpNote").textContent += `；已开启每月定投 ${DCA_PCT}%，各组现金流相同，年化列为 XIRR（资金加权）`;
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
  }

  // ---- 启动 ----
  if (!window.PRICE_DATA) {
    document.body.innerHTML = "<p style='color:#f85149;padding:40px'>数据未加载：请确认 data.js 存在。</p>";
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