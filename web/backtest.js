// SMH / SOXL 补仓减仓策略回测引擎（由 backtest.py 逐行移植为纯前端 JS）
// 规则与 Python 版严格一致，见原文件 docstring。

const DRAWDOWN_LEVELS = [15, 25, 35, 45, 50];
const REBOUND_LEVELS = [50, 100, 200];
const TROUGH_TRIGGER_PCT = 25.0;
// 初始有效底部的回看窗口（交易日）：建仓日的初始反弹基准 = 建仓日及其之前该天数
// 区间内的最低收盘价。用区间最低价而非建仓日单点价，可避免「进场日悬崖」——同一轮
// 行情里相邻几周进场、最终收益相差数倍。与 backtest.py 的同名常量一致。
const INIT_TROUGH_DAYS = 60;
// 仅用于「当前处于哪个阶段」的文案判定：自有效底部回升超过该幅度视为"底部反弹"，
// 否则视为仍在"探底"。不参与任何交易判定，与 backtest.py 的同名常量一致。
const PHASE_REBOUND_PCT = 10.0;

// 文案取自 i18n（i18n.js 先加载）；缺失时回退到键名，保证引擎可独立运行
function BT_T(key, vars) {
  if (typeof window !== "undefined" && typeof window.T === "function") return window.T(key, vars);
  return key;
}

// 把 window.PRICE_DATA[key] 的 {dates,closes} 转成 {date: close} 映射
function seriesMap(key) {
  const s = window.PRICE_DATA[key];
  const m = {};
  if (!s) return m;
  for (let i = 0; i < s.dates.length; i++) m[s.dates[i]] = s.closes[i];
  return m;
}

// 两标的日期交集（升序）
function commonDates(keyA, keyB) {
  const a = window.PRICE_DATA[keyA], b = window.PRICE_DATA[keyB];
  if (!a || !b) return [];
  const setB = new Set(b.dates);
  return a.dates.filter((d) => setB.has(d)).sort();
}

// 把某标的价格前向填充对齐到给定交易日序列。
// 用途：对比基准（如沪深300）与美股交易日不重合，取「当日或之前最近一个收盘价」。
// 目标日早于该标的最早数据时返回 null（前端不画这段）。
function alignForwardFill(targetDates, key) {
  const s = window.PRICE_DATA[key];
  const out = new Array(targetDates.length).fill(null);
  if (!s || !s.dates || !s.dates.length) return out;
  let j = 0, last = null;
  for (let i = 0; i < targetDates.length; i++) {
    const d = targetDates[i];
    while (j < s.dates.length && s.dates[j] <= d) { last = s.closes[j]; j++; }
    out[i] = last > 0 ? last : null;
  }
  return out;
}

// 简单移动均线：沿给定交易日序列滚动计算，不足周期返回 null。
// 必须喂「全历史交易日」而不是回测区间，否则回测起点后的头 N 天拿不到均线，
// 趋势过滤会在最该起作用的开头失效。
function smaSeries(dates, series, period) {
  const out = {};
  let sum = 0;
  const q = [];
  for (const d of dates) {
    const v = series[d];
    q.push(v);
    sum += v;
    if (q.length > period) sum -= q.shift();
    out[d] = q.length === period ? sum / period : null;
  }
  return out;
}

// 主回测：keyA=基准(1x), keyB=杠杆(3x/2x)
function runBacktest(opts) {
  const {
    keyA, keyB, capA, capB, drawdowns, rebounds,
    startDate = null, endDate = null,
    // 月度定投：每月第一个交易日注入「起始总资金 × monthlyPct%」的新现金。
    // 口径（固定且唯一，便于解释与参数优化）：
    //   · 策略组：注入额全部买入基准端（现实中你每月定投的就是 1 倍 ETF），
    //     之后是否换成杠杆端完全由回撤档位规则决定，不额外择时；
    //   · 纯持基准 / 纯持杠杆：注入额分别全买各自标的；
    //   · 50-50 不动：严格按 50%:50% 分摊注入（与你设的初始配比无关，见下）。
    // 四条曲线的外部现金流完全一致，才能公平对比。
    monthlyPct = 0,
    // 时间兜底（可选，0=关闭）：连续持有杠杆端满 holdDays 个交易日仍未触发任何
    // 反弹减仓档时，强制按 holdRatio（0~1）比例换回基准端。用于堵住「+200% 换回
    // 线高于历史新高 → 长熊里永不触发 → 无限期满杠杆」的漏洞。历史回测中它是纯
    // 成本（末值明显下降），故默认关闭，仅作为风险上限工具。
    holdDays = 0,
    holdRatio = 1,
    // ===== 200 日均线趋势过滤（高级模式，默认关闭）=====
    // 思路出自《Leverage for the Long Run》：杠杆 ETF 的毁灭性亏损几乎全部发生在
    // 长期均线之下的熊市区间；牛市（价在 200 日均线上方）满杠杆吃复利、熊市去杠杆，
    // 长期结果远好于一直满杠杆。这里叠加「均线包络带 + 阶梯分批离场」以降低震荡
    // 行情里的假突破摩擦：
    //   · trendShort 短均线破位 → 先减 trendShortCut% 杠杆（预警，不清仓）；
    //   · 收盘价跌破 trendLong×(1−trendBuf%) 且连续 trendConfirm 个交易日 → 清空杠杆；
    //   · 收盘价重新站上 trendLong → 解除风控（trendReenter=true 时重置回撤档位，
    //     允许按当前回撤重新建立杠杆仓位）。
    trendOn = false,
    trendLong = 200,
    trendShort = 50,
    trendBuf = 3,
    trendConfirm = 2,
    trendShortCut = 30,
    trendBlockAdd = true,
    trendDeepDD = 0,
    trendReenter = true,
    // 保护退场年限（0=不退场）：进场满 N 年后关闭趋势过滤，持仓原样交给
    // 回撤补仓/反弹减仓的动态策略继续跑（「前几年要保护、长期要复利」的折中）。
    trendOffYears = 0,
  } = opts;

const smhSeries = seriesMap(keyA);
  const smh3Series = seriesMap(keyB);

  let allCommon = commonDates(keyA, keyB);
  if (allCommon.length === 0) throw new Error(BT_T("bt.err.noCommon"));

  let common = allCommon;
  if (startDate) {
    const c = allCommon.filter((d) => d >= startDate);
    if (c.length === 0) throw new Error(BT_T("bt.err.startLate", { d: startDate }));
    common = c;
  }
  if (endDate) {
    const w = common.filter((d) => d <= endDate);
    if (w.length === 0) throw new Error(BT_T("bt.err.endEarly", { d: endDate }));
    common = w;
  }

  const start = common[0], end = common[common.length - 1];
  const p0a = smhSeries[start], p0b = smh3Series[start];
  if (p0a <= 0 || p0b <= 0) throw new Error(BT_T("bt.err.badPrice"));

  let smhShares = capA / p0a;
  let smh3Shares = capB / p0b;

  let peak = p0a;
  // 初始有效底部：取建仓日及其之前 INIT_TROUGH_DAYS 个交易日的区间最低价
  // （数据不足则按实有天数），消除「买在哪一天」对换回触发价的单点敏感。
  const i0 = allCommon.indexOf(start);
  let activeTrough = p0a;
  for (const d of allCommon.slice(Math.max(0, i0 - INIT_TROUGH_DAYS), i0 + 1)) {
    const v = smhSeries[d];
    if (v > 0 && v < activeTrough) activeTrough = v;
  }
  const ddFired = new Set();
  const rbFired = new Set();

  const trades = [];
  // 备注存 i18n 机器键，渲染时再翻译
  const troughs = [[start, activeTrough, "trough.init"]];
  let segActive = false;
  let segLow = null;
  // 时间兜底计数：连续持有杠杆端的交易日数（减仓清空杠杆端即复位）
  const holdN = Math.max(0, Math.floor(Number(holdDays) || 0));
  const holdR = Math.min(1, Math.max(0, Number(holdRatio) || 0));
  let leverDays = 0;

  // ===== 趋势过滤状态 =====
  const trOn = !!trendOn;
  const trLong = Math.max(2, Math.floor(Number(trendLong) || 200));
  const trShort = Math.max(2, Math.floor(Number(trendShort) || 50));
  const trBuf = Math.max(0, Number(trendBuf) || 0) / 100;
  const trConfirm = Math.max(1, Math.floor(Number(trendConfirm) || 1));
  const trCut1 = Math.min(1, Math.max(0, (Number(trendShortCut) || 0) / 100));
  const trBlock = trendBlockAdd !== false;
  const trReenter = trendReenter !== false;
  // 深跌交接阈值（0=关闭）：基准端回撤达到该幅度且仍在长均线下方时，趋势过滤
  // 让位给「深跌加杠杆」的回撤补仓阶梯，直到价格重新站回长均线才交还。
  const trDeepDD = Math.max(0, Number(trendDeepDD) || 0);
  // 均线一律建在基准端（1 倍标的）上：杠杆端自身波动被放大，均线噪声大得多
  const maL = trOn ? smaSeries(allCommon, smhSeries, trLong) : null;
  const maS = trOn ? smaSeries(allCommon, smhSeries, trShort) : null;
  // trStage：0=趋势内满配 1=已短均线减仓 2=已清空杠杆（风控中）
  let trStage = 0;
  let trBelow = 0;
  // 短均线减仓前的杠杆端占比：站回短均线时按它把仓位买回原比例
  let trWeightBefore = null;
  // 是否处于深跌交接模式（此期间趋势过滤不干预，补仓阶梯接管）
  let trDeep = false;
  // 保护退场：进场满 trOffY 年后的第一个交易日起停用趋势过滤
  const trOffY = Math.max(0, Number(trendOffYears) || 0);
  const trOffDate = (trOn && trOffY > 0)
    ? (Number(start.slice(0, 4)) + Math.floor(trOffY)) + start.slice(4)
    : null;
  let trSwitched = false;
  let deepEnters = 0, deepDays = 0;
  // 纯「长均线轮动」对照组用独立状态机，不受深跌交接影响
  let rotStage = 0, rotBelow = 0;
  if (trOn) {
    const m0 = maL[start], s0 = maS[start];
    if (m0 != null && m0 > 0 && p0a < m0 * (1 - trBuf)) { trStage = 2; trBelow = trConfirm; }
    else if (s0 != null && s0 > 0 && p0a < s0) { trStage = 1; }
    rotStage = trStage; rotBelow = trBelow;
  }
  // 纯「200 日均线轮动」对照组：同样的现金流，趋势内 100% 杠杆端、
  // 短均线破位降到 (1−trendShortCut)、跌破包络带 100% 基准端。
  const trTargetB = () => (rotStage === 0 ? 1 : rotStage === 1 ? 1 - trCut1 : 0);
  // 均线状态机单步推进（策略与对照组共用同一套判定规则）
  function stepStage(stage, below, price, mL, mS) {
    if (mL == null || !(mL > 0)) return [stage, below];
    let bl = price < mL * (1 - trBuf) ? below + 1 : 0;
    let st = stage;
    if (st === 2) {
      if (price > mL) st = 0;
    } else if (bl >= trConfirm) {
      st = 2;
    } else if (st === 0) {
      if (mS != null && mS > 0 && price < mS) st = 1;
    } else if (mS != null && mS > 0 && price > mS) {
      st = 0;
    }
    return [st, bl];
  }

  const total = capA + capB;
  let holdAShares = total / p0a;
  let holdBShares = total / p0b;
  // 50-50 不动：严格把总资金一半买基准端、一半买杠杆端后不再调仓，
  // 与用户设置的初始配比 capA:capB 无关（否则这条线叫「50-50」就名不副实）。
  let fixedAShares = (total * 0.5) / p0a;
  let fixedBShares = (total * 0.5) / p0b;

  // 轮动对照组初始建仓：按建仓日的趋势状态直接摆到目标权重
  let rotAShares = 0, rotBShares = 0;
  if (trOn) {
    const tb = trTargetB();
    rotBShares = (total * tb) / p0b;
    rotAShares = (total * (1 - tb)) / p0a;
  }

  // 定投相关：每期注入额（50-50 对照按 50%:50% 分摊，见上）
  const monthlyCash = total * (monthlyPct || 0) / 100.0;
  let lastMonth = start.slice(0, 7);
  let totalInvested = total;

  const equityDates = [start];
  const equityStrategy = [smhShares * p0a + smh3Shares * p0b];
  const equityHoldA = [holdAShares * p0a];
  const equityHoldB = [holdBShares * p0b];
  const equity5050 = [fixedAShares * p0a + fixedBShares * p0b];
  // 纯 200 日均线轮动对照曲线（仅趋势开关打开时有值）
  const equityTrendRotate = trOn ? [rotAShares * p0a + rotBShares * p0b] : null;
  // 对比基准（同期沪深300）：与其他曲线完全一致的现金流（首日本金 + 每月定投）
  // 全部投入该基准（CNY 计价，不做汇率换算）。A 股与美股交易日不重合，价格按
  // 前向填充对齐；回测起点早于该基准数据起点时该段为 null（图上断开），期间注入
  // 的现金先记为待投，等首个可用价格再一次性买入。
  const benches = ["CSI300"].map((key) => {
    const prices = alignForwardFill(common, key);
    const ok = prices[0] > 0;
    return {
      key, prices,
      shares: ok ? total / prices[0] : 0,
      cash: ok ? 0 : total,
      equity: [ok ? total : null],
    };
  });
  // 外部现金流（与 equityDates 对齐）：首日为初始本金，其后为当日定投注入额。
  // 有外部注入时净值曲线不能直接当收益看，须配合 calcFlowMetrics 使用。
  const flows = [total];
  const tradeMarks = [];

  for (let i = 1; i < common.length; i++) {
    const date = common[i];
    const pa = smhSeries[date], pb = smh3Series[date];

    // 月度定投：进入新月份的第一个共同交易日注入，按当日收盘价买入
    let inflow = 0;
    const ym = date.slice(0, 7);
    if (monthlyCash > 0 && ym !== lastMonth) {
      inflow = monthlyCash;
      lastMonth = ym;
      totalInvested += inflow;
      smhShares += inflow / pa;                 // 策略组：全买基准端
      holdAShares += inflow / pa;
      holdBShares += inflow / pb;
      fixedAShares += (inflow * 0.5) / pa;
      fixedBShares += (inflow * 0.5) / pb;
      if (trOn) {
        // 轮动组：注入现金按当前目标权重买入
        const tb = trTargetB();
        rotBShares += (inflow * tb) / pb;
        rotAShares += (inflow * (1 - tb)) / pa;
      }
      for (const b of benches) b.cash += inflow;  // 对比基准：待投现金
    }
    flows.push(inflow);

    equityDates.push(date);
    equityStrategy.push(smhShares * pa + smh3Shares * pb);
    equityHoldA.push(holdAShares * pa);
    equityHoldB.push(holdBShares * pb);
    equity5050.push(fixedAShares * pa + fixedBShares * pb);

    // 时间兜底计数：当日仍持有杠杆端则累加持有天数
    if (smh3Shares * pb > 1e-9) leverDays += 1;
    else leverDays = 0;

    for (const b of benches) {
      const pc = b.prices[i];
      if (pc > 0) {
        if (b.cash > 0) { b.shares += b.cash / pc; b.cash = 0; }
        b.equity.push(b.shares * pc);
      } else {
        b.equity.push(null);
      }
    }

    // 创新高当日仍要判断反弹减仓（高点恰落在创新高当日时不应整日跳过）；
    // 当日回撤为 0，补仓与底部刷新本就不会触发。
    const isNewHigh = pa > peak;
    let ddPct = 0.0;
    if (isNewHigh) {
      peak = pa;
      ddFired.clear();
      segActive = false;
      segLow = null;
    } else {
      if (segLow === null || pa < segLow) segLow = pa;
      ddPct = ((peak - pa) / peak) * 100.0;
    }

    // ===== 趋势过滤（长均线轮动 + 均线包络带阶梯离场）=====
    // 放在回撤补仓之前：风控中（stage=2）时当日的补仓档位直接被拦截，
    // 避免「先补进去、再被清掉」的来回摩擦。
    let trendNoAdd = false;
    // 保护退场日之后趋势过滤停用（纯均线轮动对照线仍继续走完整段）
    const trActive = trOn && (trOffDate === null || date < trOffDate);
    if (trOn) {
      const mL = maL[date], mS = maS[date];

      // --- 纯均线轮动对照组：独立状态机，不受深跌交接影响 ---
      const rotPrev = rotStage;
      const rs = stepStage(rotStage, rotBelow, pa, mL, mS);
      rotStage = rs[0]; rotBelow = rs[1];
      if (rotStage !== rotPrev) {
        const tb = trTargetB();
        const rv = rotAShares * pa + rotBShares * pb;
        rotBShares = (rv * tb) / pb;
        rotAShares = (rv * (1 - tb)) / pa;
      }
      equityTrendRotate.push(rotAShares * pa + rotBShares * pb);

      if (!trActive) {
        // 保护退场：切换当日只复位一次趋势状态，持仓与回撤档位记录原样保留，
        // 之后完全交给动态策略（回撤补仓 / 反弹减仓）。
        if (!trSwitched) { trSwitched = true; trDeep = false; trStage = 0; trBelow = 0; trWeightBefore = null; }
      } else {

      // --- 深跌交接：回撤足够深且仍在长均线下方时，趋势过滤让位给「深跌加杠杆」的
      // 补仓阶梯；直到价格重新站回长均线才交还给趋势过滤。两个条件互斥（跌破/站上
      // 长均线），所以不会在阈值边界反复切换。
      if (trDeepDD > 0 && mL != null && mL > 0) {
        if (!trDeep && ddPct >= trDeepDD && pa < mL) {
          trDeep = true;
          trStage = 0; trBelow = 0; trWeightBefore = null;
          // 把补仓阶梯的已触发记录清空，让它按当前回撤深度重新逐档接管仓位
          ddFired.clear();
          deepEnters += 1;
        } else if (trDeep && pa > mL) {
          trDeep = false;
          trStage = 0; trBelow = 0; trWeightBefore = null;
        }
      }
      if (trDeep) deepDays += 1;

      if (!trDeep) {
      const prevStage = trStage;
      const ts = stepStage(trStage, trBelow, pa, mL, mS);
      trStage = ts[0]; trBelow = ts[1];

      // 清仓：写成幂等条件（而非只在状态跳变时执行），这样「回测起点就已在
      // 风控中」也能把初始杠杆仓位换回基准端。
      if (trStage === 2 && smh3Shares * pb > 1e-9) {
        const eq0 = smhShares * pa + smh3Shares * pb;
        // 记下清仓前的杠杆占比（若 stage1 已记过就保留更早的满配比例），
        // 转多时按这个比例一次性买回。
        if (trWeightBefore == null) trWeightBefore = eq0 > 0 ? (smh3Shares * pb) / eq0 : null;
        const move = smh3Shares * pb;
        smh3Shares = 0;
        smhShares += move / pa;
        trades.push([date, "cut",
                     { k: "trade.desc.trendExit", v: { a: keyA, b: keyB, ma: trLong, buf: (trBuf * 100).toFixed(1), days: trConfirm, move: move.toFixed(2) } },
                     pa, pb, smhShares * pa, smh3Shares * pb]);
        tradeMarks.push({ date, kind: "cut", equity: smhShares * pa + smh3Shares * pb, priceA: pa, priceB: pb });
        leverDays = 0;
      } else if (trStage === 1 && prevStage === 0 && trCut1 > 0 && smh3Shares * pb > 1e-9) {
        // 短均线破位：先减一档杠杆，并记下减仓前的杠杆占比，站回短均线时按这个
        // 比例买回（不能指望回撤档位去补——牛市小回调根本够不到 15% 档，
        // 那样每跌破一次 50MA 杠杆就少一块，永远回不来）。
        const eq = smhShares * pa + smh3Shares * pb;
        trWeightBefore = eq > 0 ? (smh3Shares * pb) / eq : null;
        const move = smh3Shares * pb * trCut1;
        smh3Shares -= move / pb;
        smhShares += move / pa;
        trades.push([date, "cut",
                     { k: "trade.desc.trendCut", v: { a: keyA, b: keyB, ma: trShort, pct: (trCut1 * 100).toFixed(0), move: move.toFixed(2) } },
                     pa, pb, smhShares * pa, smh3Shares * pb]);
        tradeMarks.push({ date, kind: "cut", equity: smhShares * pa + smh3Shares * pb, priceA: pa, priceB: pb });
        leverDays = 0;
      } else if (trStage === 0 && prevStage !== 0 && trReenter && trWeightBefore != null) {
        // 站回均线（50MA 回补 / 200MA 转多）：把杠杆占比恢复到减仓前的水平。
        const eq = smhShares * pa + smh3Shares * pb;
        const want = eq * trWeightBefore;
        const move = Math.min(want - smh3Shares * pb, smhShares * pa);
        if (move > 1e-9) {
          smhShares -= move / pa;
          smh3Shares += move / pb;
          trades.push([date, "add",
                       { k: "trade.desc.trendBack", v: { a: keyA, b: keyB, ma: prevStage === 2 ? trLong : trShort, move: move.toFixed(2) } },
                       pa, pb, smhShares * pa, smh3Shares * pb]);
          tradeMarks.push({ date, kind: "add", equity: smhShares * pa + smh3Shares * pb, priceA: pa, priceB: pb });
        }
        trWeightBefore = null;
      } else if (trStage === 0 && prevStage !== 0) {
        trWeightBefore = null;
      }

      trendNoAdd = trBlock && trStage === 2;
      }
      }
    }

    for (const lv of DRAWDOWN_LEVELS) {
      if (ddFired.has(lv)) continue;
      if (ddPct >= lv) {
        const ratio = (drawdowns[lv] || 0) / 100.0;
        if (ratio > 0 && smhShares > 0 && !trendNoAdd) {
          const smhValue = smhShares * pa;
          const move = smhValue * ratio;
          smhShares -= move / pa;
          smh3Shares += move / pb;
          // 末两位＝本笔成交后两端的持仓市值（按当日收盘价计），便于看清换仓后的仓位分布
          trades.push([date, "add", { k: "trade.desc.add", v: { a: keyA, b: keyB, lv: lv, move: move.toFixed(2) } },
                       pa, pb, smhShares * pa, smh3Shares * pb]);
          tradeMarks.push({ date, kind: "add", equity: smhShares * pa + smh3Shares * pb, priceA: pa, priceB: pb });
        }
        ddFired.add(lv);
      }
    }

    if (ddPct >= TROUGH_TRIGGER_PCT) {
      if (!segActive) {
        segActive = true;
        activeTrough = segLow;
        rbFired.clear();
        troughs.push([date, activeTrough, "trough.note"]);
      } else if (segLow < activeTrough) {
        activeTrough = segLow;
        rbFired.clear();
        troughs[troughs.length - 1] = [date, activeTrough, "trough.note"];
      }
    }

    let rbPct = 0.0;
    if (activeTrough !== null && activeTrough > 0) {
      rbPct = ((pa - activeTrough) / activeTrough) * 100.0;
    }
    for (const lv of REBOUND_LEVELS) {
      if (rbFired.has(lv)) continue;
      if (rbPct >= lv) {
        const ratio = (rebounds[lv] || 0) / 100.0;
        if (ratio > 0 && smh3Shares > 0) {
          const smh3Value = smh3Shares * pb;
          const move = smh3Value * ratio;
          smh3Shares -= move / pb;
          smhShares += move / pa;
          trades.push([date, "cut", { k: "trade.desc.cut", v: { a: keyA, b: keyB, lv: lv, move: move.toFixed(2) } },
                       pa, pb, smhShares * pa, smh3Shares * pb]);
          tradeMarks.push({ date, kind: "cut", equity: smhShares * pa + smh3Shares * pb, priceA: pa, priceB: pb });
          leverDays = 0;
        }
        rbFired.add(lv);
      }
    }

    // 时间兜底强制减仓（holdN=0 时关闭）
    if (holdN > 0 && holdR > 0 && leverDays >= holdN && smh3Shares * pb > 1e-9) {
      const move = smh3Shares * pb * holdR;
      smh3Shares -= move / pb;
      smhShares += move / pa;
      trades.push([date, "cut",
                   { k: "trade.desc.timeExit", v: { a: keyA, b: keyB, days: holdN, move: move.toFixed(2) } },
                   pa, pb, smhShares * pa, smh3Shares * pb]);
      tradeMarks.push({ date, kind: "cut", equity: smhShares * pa + smh3Shares * pb, priceA: pa, priceB: pb });
      leverDays = 0;
    }
  }

  const pEndA = smhSeries[end], pEndB = smh3Series[end];
  const finalSmh = smhShares * pEndA;
  const finalSmh3 = smh3Shares * pEndB;

  return {
    startDate: start, endDate: end,
    finalSmh, finalSmh3, finalTotal: finalSmh + finalSmh3,
    holdAllSmh: holdAShares * pEndA,
    holdAllSmh3: holdBShares * pEndB,
    trades, troughs,
    equityDates, equityStrategy,
    equityHoldA, equityHoldB, equity5050,
    equityTrendRotate,
    trendOn: trOn,
    trendDeepEnters: deepEnters,
    trendDeepDays: deepDays,
    equityCSI300: benches[0].equity,
    tradeMarks,
    flows, totalInvested, monthlyPct: monthlyPct || 0, monthlyCash,
  };
}

// ===== 绩效指标：CAGR / 最大回撤 / 夏普 / 最长套牢 =====
function calcMetrics(dates, equity) {
  const n = equity.length;
  if (n < 2) return null;
  const first = equity[0], last = equity[n - 1];

  // 年数（按日历天）
  const d0 = new Date(dates[0]), d1 = new Date(dates[n - 1]);
  const years = (d1 - d0) / (365.25 * 24 * 3600 * 1000);
  const cagr = years > 0 ? Math.pow(last / first, 1 / years) - 1 : 0;

  // 最大回撤 + 最长套牢天数
  let peak = equity[0], maxDD = 0;
  let peakDate = dates[0], maxUnderwaterDays = 0;
  for (let i = 0; i < n; i++) {
    if (equity[i] > peak) {
      peak = equity[i];
      peakDate = dates[i];
    } else {
      const dd = equity[i] / peak - 1;
      if (dd < maxDD) maxDD = dd;
      const days = (new Date(dates[i]) - new Date(peakDate)) / (24 * 3600* 1000);
      if (days > maxUnderwaterDays) maxUnderwaterDays = days;
    }
  }

  // 日收益 -> 年化波动 -> 夏普（未扣无风险利率）
  const rets = [];
  for (let i = 1; i < n; i++) rets.push(equity[i] / equity[i - 1] - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varr = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
  const stdDaily = Math.sqrt(varr);
  const annVol = stdDaily * Math.sqrt(252);
  const sharpe = annVol > 0 ? cagr / annVol : 0;

  return {
    cagr, maxDD, sharpe,
    maxUnderwaterDays: Math.round(maxUnderwaterDays),
    finalTotal: last,
  };
}

// ===== 有外部现金流（月度定投）时的绩效指标 =====
// 每月注入新现金会把净值曲线抬高，直接套用 calcMetrics 会把「本金变多」
// 误算成「赚钱」，CAGR/最大回撤都会失真。这里分两套口径：
//   · TWR 时间加权单位净值：剔除注入影响，用于 CAGR / 最大回撤 / 夏普 / 套牢天数；
//   · XIRR 资金加权年化：把每笔注入按实际发生日贴现，反映真实年化回报。
// flows 与 dates/equity 对齐：flows[0] 为初始本金，其后为当日注入额。
function calcFlowMetrics(dates, equity, flows) {
  const n = equity.length;
  if (n < 2) return null;
  const hasFlow = !!(flows && flows.some((f, i) => i > 0 && f > 0));

  if (!hasFlow) {
    const m = calcMetrics(dates, equity);
    if (!m) return null;
    return Object.assign({}, m, {
      invested: equity[0], profit: equity[n - 1] - equity[0],
      xirr: m.cagr, twrCagr: m.cagr, hasFlow: false,
    });
  }

  // 单位净值：当日注入按当日收盘价买入，故注入额先并入期初基数
  const unit = [1];
  for (let i = 1; i < n; i++) {
    const base = equity[i - 1] + (flows[i] || 0);
    unit.push(base > 0 ? unit[i - 1] * (equity[i] / base) : unit[i - 1]);
  }
  const mt = calcMetrics(dates, unit);
  if (!mt) return null;

  const invested = flows.reduce((a, b) => a + (b || 0), 0);
  const last = equity[n - 1];

  // XIRR：二分求使净现值归零的年化利率
  const t0 = new Date(dates[0]).getTime();
  const YEAR = 365.25 * 24 * 3600 * 1000;
  const yearsOf = (d) => (new Date(d).getTime() - t0) / YEAR;
  const tEnd = yearsOf(dates[n - 1]);
  function gap(r) {
    let v = last / Math.pow(1 + r, tEnd);
    for (let i = 0; i < n; i++) {
      const f = flows[i] || 0;
      if (f > 0) v -= f / Math.pow(1 + r, yearsOf(dates[i]));
    }
    return v;
  }
  let xirr = NaN;
  let lo = -0.9999, hi = 10;
  if (gap(lo) > 0 && gap(hi) < 0) {
    for (let k = 0; k < 80; k++) {
      const mid = (lo + hi) / 2;
      if (gap(mid) > 0) lo = mid; else hi = mid;
    }
    xirr = (lo + hi) / 2;
  }

  return {
    cagr: mt.cagr, twrCagr: mt.cagr, xirr,
    maxDD: mt.maxDD, sharpe: mt.sharpe,
    maxUnderwaterDays: mt.maxUnderwaterDays,
    finalTotal: last, invested, profit: last - invested,
    hasFlow: true,
  };
}

// ===== 阶段判定（与 backtest.py 同一套规则）=====
// segActive=true 表示「自最近一次新高以来已回撤超过 TROUGH_TRIGGER_PCT」，
// 此时 activeTrough 属于当前这一轮下跌，反弹减仓参考才有效；
// segActive=false 则有效底部来自上一轮，减仓触发价没有实际参考意义。
// 而在 segActive=true 的这一轮里，ddFired 的档位已经用掉，须创新高才重置。
function classifyPhase(price, peak, rbPct, segActive) {
  // phaseLabel 在调用时按当前语言取词，语言切换后重跑即自动更新
  if (price >= peak) return { phase: "peak", phaseLabel: BT_T("phase.peak") };
  if (!segActive) return { phase: "pullback", phaseLabel: BT_T("phase.pullback") };
  if (rbPct < PHASE_REBOUND_PCT) return { phase: "bottoming", phaseLabel: BT_T("phase.bottoming") };
  return { phase: "rebound", phaseLabel: BT_T("phase.rebound") };
}

// ===== 价格基准状态机（唯一实现）=====
// 由 backtest.py 的 compute_live_state 逐行移植。只跟踪价格基准状态
// （peak / activeTrough / segLow / dd_fired / rb_fired），不做任何资金计算——
// 触发价只与价格基准有关，与投入资金和换仓比例无关。
// onDay 可选：逐日回调当天状态快照，供 computeLiveState / phaseTimeline 共用。
function replayState(keyA, keyB, onDay) {
  const sa = seriesMap(keyA);
  const all = commonDates(keyA, keyB);
  if (all.length === 0) return null;

  const start = all[0];
  const p0 = sa[start];
  if (!(p0 > 0)) return null;

  let peak = p0, peakDate = start;
  let activeTrough = p0, troughDate = start;
  const ddFired = new Set(), rbFired = new Set();
  let segActive = false, segLow = null, segLowDate = null;

  for (let i = 1; i < all.length; i++) {
    const date = all[i], price = sa[date];

    // 创新高：peak 上移、清 ddFired、结束本段最低点跟踪
    if (price > peak) {
      peak = price; peakDate = date;
      ddFired.clear();
      segActive = false; segLow = null; segLowDate = null;
    } else {

    if (segLow === null || price < segLow) { segLow = price; segLowDate = date; }

    const ddPct = ((peak - price) / peak) * 100.0;
    for (const lv of DRAWDOWN_LEVELS) {
      if (!ddFired.has(lv) && ddPct >= lv) ddFired.add(lv);
    }

    // 形成/刷新有效底部（自峰值回撤≥25% 才构成新底部）
    if (ddPct >= TROUGH_TRIGGER_PCT) {
      if (!segActive) {
        segActive = true; activeTrough = segLow; troughDate = segLowDate;
        rbFired.clear();
      } else if (segLow < activeTrough) {
        activeTrough = segLow; troughDate = segLowDate;
        rbFired.clear();
      }
    }

    } // end else（非创新高日）

    // 反弹档触发判定：创新高当日同样参与（与 runBacktest / backtest.py 一致）
    const rbPct = activeTrough > 0
      ? ((price - activeTrough) / activeTrough) * 100.0 : 0.0;
    for (const lv of REBOUND_LEVELS) {
      if (!rbFired.has(lv) && rbPct >= lv) rbFired.add(lv);
    }

    if (onDay) {
      // 对外暴露的跌幅/涨幅统一把负值夹到 0（与桌面 GUI 一致）
      const ddShow = peak > 0 ? Math.max(0, ((peak - price) / peak) * 100.0) : 0;
      const rbShow = activeTrough > 0
        ? Math.max(0, ((price - activeTrough) / activeTrough) * 100.0) : 0;
      const ph = classifyPhase(price, peak, rbShow, segActive);
      onDay({
        index: i, date, price, ddPct: ddShow, rbPct: rbShow, segActive,
        troughStale: !segActive, phase: ph.phase, phaseLabel: ph.phaseLabel,
        peak, peakDate, activeTrough, troughDate, ddFired, rbFired,
      });
    }
  }

  const latestDate = all[all.length - 1];
  return {
    dates: all, series: sa,
    peak, peakDate, activeTrough, troughDate,
    segActive, ddFired, rbFired,
    latestDate, latestPrice: sa[latestDate],
  };
}

// ===== 实时状态：当前峰值 / 有效底部 / 各档触发价 =====
function computeLiveState(keyA, keyB) {
  const st = replayState(keyA, keyB, null);
  if (!st) return null;

  const peak = st.peak, activeTrough = st.activeTrough;
  const latestPrice = st.latestPrice, segActive = st.segActive;

  const ddTriggerPrices = {}, rbTriggerPrices = {};
  for (const lv of DRAWDOWN_LEVELS) ddTriggerPrices[lv] = peak * (1 - lv / 100.0);
  for (const lv of REBOUND_LEVELS) rbTriggerPrices[lv] = activeTrough * (1 + lv / 100.0);

  // 当前价相对峰值的跌幅 / 相对有效底部的涨幅（负值夹到 0，与桌面 GUI 一致）
  const ddPct = peak > 0
    ? Math.max(0, ((peak - latestPrice) / peak) * 100.0) : 0;
  const rbPct = activeTrough > 0
    ? Math.max(0, ((latestPrice - activeTrough) / activeTrough) * 100.0) : 0;

  const ph = classifyPhase(latestPrice, peak, rbPct, segActive);

  return {
    peak, peakDate: st.peakDate, activeTrough, troughDate: st.troughDate,
    latestPrice, latestDate: st.latestDate,
    ddTriggerPrices, rbTriggerPrices,
    ddFired: Array.from(st.ddFired).sort((x, y) => x - y),
    rbFired: Array.from(st.rbFired).sort((x, y) => x - y),
    ddPct, rbPct, segActive,
    // 有效底部是否属于上一轮下跌（true 时反弹减仓参考无实际意义）
    troughStale: !segActive,
    phase: ph.phase, phaseLabel: ph.phaseLabel,
  };
}

// ===== 逐日阶段序列：给「进场建议」挑历史同阶段样本用 =====
// 返回轻量记录数组（不含 Set 引用），顺序与 commonDates 一致。
function phaseTimeline(keyA, keyB) {
  const out = [];
  const st = replayState(keyA, keyB, function (d) {
    out.push({
      index: d.index, date: d.date, price: d.price,
      ddPct: d.ddPct, rbPct: d.rbPct,
      segActive: d.segActive, troughStale: d.troughStale, phase: d.phase,
    });
  });
  return st ? out : [];
}

// ===== 历史同档减仓时，杠杆端涨了多少 =====
// 回答「基准端(如 SMH)自有效底部反弹 +200%、我该减仓的那一刻，杠杆端(如 SOXL)
// 大概涨了多少倍」。做法：复用 replayState 的价格基准状态机，逐日监听各减仓档
// 首次达标的那一天，取「同一有效底部日 -> 达标日」区间内杠杆端的涨幅。
//
// 口径说明：
// · 有效底部刷新(创出更低点)时 rbFired 会清空，同一档可在不同底部各统计一次；
// · onlyReal=true 剔除「数据首日那个兜底底部」产生的伪样本——它不是真实下跌打出来的
//   底部，只是没有历史可依时的初始基准（注意不能用 segActive 过滤：+200% 达标时
//   价格早已创新高、segActive 已复位，那样会把所有高档样本都误杀）；
// · 杠杆端涨幅用两端收盘价直接算，含日度复利损耗与跟踪误差，是真实可观测值。
function reboundLeverageStats(keyA, keyB, onlyReal) {
  const sa = seriesMap(keyA), sb = seriesMap(keyB);
  const all = commonDates(keyA, keyB);
  const firstDate = all.length ? all[0] : null;
  const only = onlyReal !== false;
  const samples = {};
  for (const lv of REBOUND_LEVELS) samples[lv] = [];

  let curTrough = null;
  let seen = new Set();
  const st = replayState(keyA, keyB, function (d) {
    // 有效底部换了(新一轮下跌)就重新计数，与引擎清空 rbFired 的时点一致
    if (d.troughDate !== curTrough) { curTrough = d.troughDate; seen = new Set(); }
    for (const lv of REBOUND_LEVELS) {
      if (!d.rbFired.has(lv) || seen.has(lv)) continue;
      seen.add(lv);
      if (only && d.troughDate === firstDate) continue;
      const a0 = sa[d.troughDate], b0 = sb[d.troughDate], b1 = sb[d.date];
      if (!(a0 > 0) || !(b0 > 0) || !(b1 > 0)) continue;
      samples[lv].push({
        troughDate: d.troughDate, date: d.date,
        gainA: (d.price / a0 - 1) * 100.0,
        gainB: (b1 / b0 - 1) * 100.0,
        ratio: (b1 / b0 - 1) / (d.price / a0 - 1),
        days: Math.round((new Date(d.date) - new Date(d.troughDate)) / 86400000),
      });
    }
  });
  if (!st) return null;

  const out = {};
  for (const lv of REBOUND_LEVELS) {
    const s = samples[lv];
    if (!s.length) { out[lv] = { level: lv, n: 0, samples: [] }; continue; }
    const gb = s.map((x) => x.gainB);
    const avg = gb.reduce((a, b) => a + b, 0) / gb.length;
    const sorted = gb.slice().sort((x, y) => x - y);
    const mid = Math.floor(sorted.length / 2);
    out[lv] = {
      level: lv, n: s.length, samples: s,
      avgB: avg, minB: sorted[0], maxB: sorted[sorted.length - 1],
      medianB: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
      avgRatio: s.reduce((a, x) => a + x.ratio, 0) / s.length,
    };
  }
  return out;
}

// ===== 历史同档补仓时，杠杆端跌了多少 =====
// 与 reboundLeverageStats 对称：回答「基准端(如 SMH)自历史高点回撤 -35%、我该补仓的
// 那一刻，杠杆端(如 SOXL)已经跌了多少」。做法同样复用 replayState，逐日监听各补仓档
// 首次达标的那一天，取「同一峰值日 -> 达标日」区间内杠杆端的跌幅。
//
// 口径说明：
// · 创新高时引擎会清空 ddFired，同一档可在不同峰值各统计一次；
// · onlyReal=true 剔除「数据首日那个兜底峰值」产生的伪样本——真正的峰值可能在数据
//   起点之前，从首日起算会低估跌幅；
// · 跌幅为正数表示下跌，杠杆端用两端收盘价直接算，含日度复利损耗（跌幅通常明显
//   大于名义倍数 × 基准端跌幅）。
function drawdownLeverageStats(keyA, keyB, onlyReal) {
  const sa = seriesMap(keyA), sb = seriesMap(keyB);
  const all = commonDates(keyA, keyB);
  const firstDate = all.length ? all[0] : null;
  const only = onlyReal !== false;
  const samples = {};
  for (const lv of DRAWDOWN_LEVELS) samples[lv] = [];

  let curPeak = null;
  let seen = new Set();
  const st = replayState(keyA, keyB, function (d) {
    // 峰值换了(创新高)就重新计数，与引擎清空 ddFired 的时点一致
    if (d.peakDate !== curPeak) { curPeak = d.peakDate; seen = new Set(); }
    for (const lv of DRAWDOWN_LEVELS) {
      if (!d.ddFired.has(lv) || seen.has(lv)) continue;
      seen.add(lv);
      if (only && d.peakDate === firstDate) continue;
      const a0 = sa[d.peakDate], b0 = sb[d.peakDate], b1 = sb[d.date];
      if (!(a0 > 0) || !(b0 > 0) || !(b1 > 0)) continue;
      const dropA = (1 - d.price / a0) * 100.0;
      const dropB = (1 - b1 / b0) * 100.0;
      if (!(dropA > 0)) continue;
      samples[lv].push({
        peakDate: d.peakDate, date: d.date,
        dropA, dropB, ratio: dropB / dropA,
        days: Math.round((new Date(d.date) - new Date(d.peakDate)) / 86400000),
      });
    }
  });
  if (!st) return null;

  const out = {};
  for (const lv of DRAWDOWN_LEVELS) {
    const s = samples[lv];
    if (!s.length) { out[lv] = { level: lv, n: 0, samples: [] }; continue; }
    const db = s.map((x) => x.dropB);
    const avg = db.reduce((a, b) => a + b, 0) / db.length;
    const sorted = db.slice().sort((x, y) => x - y);
    const mid = Math.floor(sorted.length / 2);
    out[lv] = {
      level: lv, n: s.length, samples: s,
      avgB: avg, minB: sorted[0], maxB: sorted[sorted.length - 1],
      medianB: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
      avgRatio: s.reduce((a, x) => a + x.ratio, 0) / s.length,
    };
  }
  return out;
}

window.SMH_BT = {
  runBacktest, calcMetrics, calcFlowMetrics, commonDates, computeLiveState,
  classifyPhase, replayState, phaseTimeline, seriesMap, alignForwardFill,
  reboundLeverageStats, drawdownLeverageStats,
  DRAWDOWN_LEVELS, REBOUND_LEVELS, TROUGH_TRIGGER_PCT, PHASE_REBOUND_PCT,
};