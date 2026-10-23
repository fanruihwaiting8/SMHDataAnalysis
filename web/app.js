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

  const $ = (id) => document.getElementById(id);
  const chart = echarts.init($("chart"), "dark");

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
  function fillRecommend() {
    const rec = REC_BY_SOURCE[$("source").value] || { dd: REC_DD, rb: REC_RB };
    document.querySelectorAll(".dd").forEach((el) => el.value = rec.dd[+el.dataset.lv]);
    document.querySelectorAll(".rb").forEach((el) => el.value = rec.rb[+el.dataset.lv]);
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

    // 补仓模块顶部：现价较历史最高点的跌幅（创新高当日为 0%）
    $("ddStatus").innerHTML = st.ddPct <= 0
      ? `截至 ${st.latestDate}：${src.na} 现价 <b>${fmtPrice(st.latestPrice)}</b>`
        + `，正处历史最高点（${st.peakDate}），较峰值跌幅 <b>0.00%</b>`
      : `截至 ${st.latestDate}：${src.na} 现价 <b>${fmtPrice(st.latestPrice)}</b>`
        + `，较历史最高 ${fmtPrice(st.peak)}（${st.peakDate}）跌幅 <b>${st.ddPct.toFixed(2)}%</b>`;

    // 减仓模块顶部：现价较有效底部的涨幅（处于底部为 0%）
    $("rbStatus").innerHTML = st.rbPct <= 0
      ? `截至 ${st.latestDate}：${src.na} 现价 <b>${fmtPrice(st.latestPrice)}</b>`
        + `，正处有效底部（${st.troughDate}），较底部涨幅 <b>0.00%</b>`
      : `截至 ${st.latestDate}：${src.na} 现价 <b>${fmtPrice(st.latestPrice)}</b>`
        + `，较有效底部 ${fmtPrice(st.activeTrough)}（${st.troughDate}）涨幅 <b>${st.rbPct.toFixed(2)}%</b>`;

    // 各回撤档：跌到多少钱触发补仓 + 距触发还需跌多少
    DD.forEach((lv) => {
      const el = $(`ddTrig-${lv}`);
      if (!el) return;
      const tp = st.ddTriggerPrices[lv];
      const gap = ((st.latestPrice - tp) / st.latestPrice) * 100.0;
      if (gap <= 0) {
        el.className = "trig hit";
        el.innerHTML = `跌到 ${fmtPrice(tp)} 补仓<br/>✓ 已达（现价已低于触发价）`;
      } else {
        el.className = "trig";
        el.innerHTML = `跌到 ${fmtPrice(tp)} 补仓<br/>还需跌 ${gap.toFixed(2)}%`;
      }
    });

    // 各反弹档：涨到多少钱触发减仓 + 距触发还需涨多少
    RB.forEach((lv) => {
      const el = $(`rbTrig-${lv}`);
      if (!el) return;
      const tp = st.rbTriggerPrices[lv];
      const gap = ((tp - st.latestPrice) / st.latestPrice) * 100.0;
      if (gap <= 0) {
        el.className = "trig hit";
        el.innerHTML = `涨到 ${fmtPrice(tp)} 减仓<br/>✓ 已达（现价已高于触发价）`;
      } else {
        el.className = "trig";
        el.innerHTML = `涨到 ${fmtPrice(tp)} 减仓<br/>还需涨 ${gap.toFixed(2)}%`;
      }
    });
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

    let res;
    try {
      res = BT.runBacktest({
        keyA: src.a, keyB: src.b, capA, capB,
        drawdowns: dd, rebounds: rb, startDate, endDate,
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
  }

  // ---- 指标卡 ----
  function renderMetrics(res) {
    const m = BT.calcMetrics(res.equityDates, res.equityStrategy);
    const base = BT.calcMetrics(res.equityDates, res.equity5050);
    if (!m) return;
    const excess = m.finalTotal - base.finalTotal;
    const cards = [
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
    const rows = groups.map((g) => {
    // 该组的起点 = max(用户起点, 该组自身最晚上市日)；无用户起点时用兜底起点。
      const gFirst = unifiedStart([g]);
      const startDate = uStart ? (uStart > gFirst ? uStart : gFirst) : autoStart;
      let res;
      try {
        res = BT.runBacktest({
          keyA: g.a, keyB: g.b, capA, capB, drawdowns: dd, rebounds: rb,
          startDate, endDate: uEnd,
        });
      } catch (e) {
        return `<tr><td>${g.label}</td><td colspan="8" class="neg">${e.message}</td></tr>`;
      }
      const m = BT.calcMetrics(res.equityDates, res.equityStrategy);
      const base = BT.calcMetrics(res.equityDates, res.equity5050);
      const excessCls = m.finalTotal >= base.finalTotal ? "pos" : "neg";
      return `<tr>
        <td>${g.label}</td>
        <td class="note">${res.startDate} ~ ${res.endDate}</td>
        <td class="${excessCls}">${fmtMoney(m.finalTotal)}</td>
        <td class="${m.cagr >= 0 ? "pos" : "neg"}">${fmtPct(m.cagr)}</td>
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