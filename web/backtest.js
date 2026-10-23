// SMH / SOXL 补仓减仓策略回测引擎（由 backtest.py 逐行移植为纯前端 JS）
// 规则与 Python 版严格一致，见原文件 docstring。

const DRAWDOWN_LEVELS = [15, 25, 35, 45, 50];
const REBOUND_LEVELS = [50, 100, 200];
const TROUGH_TRIGGER_PCT = 25.0;

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

// 主回测：keyA=基准(1x), keyB=杠杆(3x/2x)
function runBacktest(opts) {
  const {
    keyA, keyB, capA, capB, drawdowns, rebounds,
    startDate = null, endDate = null,
  } = opts;

const smhSeries = seriesMap(keyA);
  const smh3Series = seriesMap(keyB);

  let allCommon = commonDates(keyA, keyB);
  if (allCommon.length === 0) throw new Error("两标的没有共同交易日");

  let common = allCommon;
  if (startDate) {
    const c = allCommon.filter((d) => d >= startDate);
    if (c.length === 0) throw new Error(`起点 ${startDate} 晚于全部数据`);
    common = c;
  }
  if (endDate) {
    const w = common.filter((d) => d <= endDate);
    if (w.length === 0) throw new Error(`截止 ${endDate} 早于起始交易日`);
    common = w;
  }

  const start = common[0], end = common[common.length - 1];
  const p0a = smhSeries[start], p0b = smh3Series[start];
  if (p0a <= 0 || p0b <= 0) throw new Error("起始日价格异常");

  let smhShares = capA / p0a;
  let smh3Shares = capB / p0b;

  let peak = p0a;
  let activeTrough = p0a;
  const ddFired = new Set();
  const rbFired = new Set();

  const trades = [];
  const troughs = [[start, activeTrough, "建仓日初始底部（反弹点）"]];
  let segActive = false;
  let segLow = null;

  const total = capA + capB;
  const holdAShares = total / p0a;
  const holdBShares = total / p0b;
  const fixedAShares = smhShares, fixedBShares = smh3Shares;

  const equityDates = [start];
  const equityStrategy = [smhShares * p0a + smh3Shares * p0b];
  const equityHoldA = [holdAShares * p0a];
  const equityHoldB = [holdBShares * p0b];
  const equity5050 = [fixedAShares * p0a + fixedBShares * p0b];
  const tradeMarks = [];

  for (let i = 1; i < common.length; i++) {
    const date = common[i];
    const pa = smhSeries[date], pb = smh3Series[date];

    equityDates.push(date);
    equityStrategy.push(smhShares * pa + smh3Shares * pb);
    equityHoldA.push(holdAShares * pa);
    equityHoldB.push(holdBShares * pb);
    equity5050.push(fixedAShares * pa + fixedBShares * pb);

    if (pa > peak) {
      peak = pa;
      ddFired.clear();
      segActive = false;
      segLow = null;
      continue;
    }

    if (segLow === null || pa < segLow) segLow = pa;

    const ddPct = ((peak - pa) / peak) * 100.0;
    for (const lv of DRAWDOWN_LEVELS) {
      if (ddFired.has(lv)) continue;
      if (ddPct >= lv) {
        const ratio = (drawdowns[lv] || 0) / 100.0;
        if (ratio > 0 && smhShares > 0) {
          const smhValue = smhShares * pa;
          const move = smhValue * ratio;
          smhShares -= move / pa;
          smh3Shares += move / pb;
          trades.push([date, "补仓", `${keyA}回撤-${lv}%，卖出${keyA}市值${move.toFixed(2)}买入${keyB}`]);
          tradeMarks.push({ date, kind: "补仓", equity: smhShares * pa + smh3Shares * pb });
        }
        ddFired.add(lv);
      }
    }

    if (ddPct >= TROUGH_TRIGGER_PCT) {
      if (!segActive) {
        segActive = true;
        activeTrough = segLow;
        rbFired.clear();
        troughs.push([date, activeTrough, "回撤≥25%区间最低点（反弹点）"]);
      } else if (segLow < activeTrough) {
        activeTrough = segLow;
        rbFired.clear();
        troughs[troughs.length - 1] = [date, activeTrough, "回撤≥25%区间最低点（反弹点）"];
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
          trades.push([date, "减仓", `${keyA}反弹+${lv}%，卖出${keyB}市值${move.toFixed(2)}买入${keyA}`]);
          tradeMarks.push({ date, kind: "减仓", equity: smhShares * pa + smh3Shares * pb });
        }
        rbFired.add(lv);
      }
    }
  }

  const pEndA = smhSeries[end], pEndB = smh3Series[end];
  const finalSmh = smhShares * pEndA;
  const finalSmh3 = smh3Shares * pEndB;

  return {
    startDate: start, endDate: end,
    finalSmh, finalSmh3, finalTotal: finalSmh + finalSmh3,
    holdAllSmh: (total / p0a) * pEndA,
    holdAllSmh3: (total / p0b) * pEndB,
    trades, troughs,
    equityDates, equityStrategy,
    equityHoldA, equityHoldB, equity5050,
    tradeMarks,
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

window.SMH_BT = { runBacktest, calcMetrics, commonDates, DRAWDOWN_LEVELS, REBOUND_LEVELS };