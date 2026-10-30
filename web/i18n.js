// ===== 中英双语词典与切换引擎（web 版） =====
// 约定：
//   · 词典键用点分命名，zh / en 必须一一对应；缺失时按 当前语言 -> zh -> key 回退。
//   · 标的名（SMH / SOXL / QQQ / TQQQ / USD）与数字、货币符号不翻译。
//   · 静态文案写在 index.html 的 data-i18n / data-i18n-html / data-i18n-title /
//     data-i18n-aria 属性里，由 applyStaticI18n() 统一刷新；
//     动态文案（app.js、backtest.js）一律调用 T(key, vars) 生成。
//   · 当前语言存 localStorage['smh_lang']，默认 zh；切换时同步 <html lang>。
window.I18N = { zh: {}, en: {} };

// ---------- 页头 / 全局 ----------
Object.assign(window.I18N.zh, {
  "doc.title": "SMH 回撤补仓策略回测",
  "lang.zh": "中文",
  "lang.en": "English",
  "hdr.h1": "半导体 ETF · 回撤补仓策略回测",
  "hdr.sub": '纯浏览器运行，调参后实时重算。SMH=1x 基准端，SOXL/TQQQ/USD=杠杆端。<br/>'
    + '历史数据模拟回测，非市场预测，不构成投资建议 —— 请阅读<a href="#disclaimer" style="color:#f0883e">页面底部免责声明</a>。',
  "btn.update": "🔄 更新最新数据",
});
Object.assign(window.I18N.en, {
  "doc.title": "SMH Drawdown Rebalancing Backtest",
  "lang.zh": "中文",
  "lang.en": "English",
  "hdr.h1": "Semiconductor ETF · Drawdown Rebalancing Backtest",
  "hdr.sub": 'Runs entirely in your browser; every parameter change is recomputed live. SMH = 1x base leg, SOXL/TQQQ/USD = leveraged leg.<br/>'
    + 'Historical simulation only — not a market forecast and not investment advice. Please read the <a href="#disclaimer" style="color:#f0883e">disclaimer at the bottom of this page</a>.',
  "btn.update": "🔄 Update market data",
});

// ---------- 使用指引 ----------
Object.assign(window.I18N.zh, {
  "guide.summary": '📖 第一次使用？点开看这里 <span class="hint">（不看也能直接点「运行回测」）</span>',
  "guide.tldr": '<b>一句话：</b>测「大跌时把一部分钱换成杠杆 ETF、大涨后再换回来」长期比死拿多赚多少、多扛多少回撤。<br/>'
    + '<b>最快上手：</b>点 <code>填入推荐参数</code> → 点 <code>运行回测</code>，先看结果再回来看规则。<br/>'
    + '<span class="warn">⚠️ 本策略放大下跌、不保护下跌</span>，参数基于历史最优存在过拟合，<b>不构成投资建议</b>。',
  "guide.s1.title": "策略只有两条规则",
  "guide.s1.li1": '<b>回撤补仓（越跌越上杠杆）</b>：基准端（如 SMH）从历史最高点跌到 -15%/-25%/-35%… 某一档时，卖掉当时基准端市值的指定比例，全部买入杠杆端（如 SOXL）。每档在同一轮下跌中只触发一次。',
  "guide.s1.li2": '<b>反弹减仓（涨回来就落袋）</b>：基准端从「有效底部」反弹 +50%/+100%/+200% 某一档时，卖掉当时杠杆端市值的指定比例，换回基准端。',
  "guide.s1.li3": '<b>有效底部</b>＝本轮自高点回撤超过 25% 后出现的最低价。小幅回调不算新底部，避免刚跌一点就被误判成「抄到底」。',
  "guide.s2.title": "四步跑出第一个结果",
  "guide.s2.li1": '<b>选数据源</b>：SMH/SOXL（半导体 3 倍）、QQQ/TQQQ（纳指 3 倍）、SMH/USD（半导体 2 倍）。',
  "guide.s2.li2": '<b>填投入金额</b>：基准端与杠杆端各投多少美元，默认各 5 万。',
  "guide.s2.li3": '<b>设置档位百分比</b>：不确定填多少就直接点 <code>填入推荐参数</code>（该数据源近 10 年收益最优的网格搜索结果）。填 <code>0</code> 表示这一档不操作。',
  "guide.s2.li4": '点 <code>运行回测</code>。改任何参数后重新点一次即可。',
  "guide.s3.title": "结果怎么看",
  "guide.s3.li1": '<b>参数区的状态条与小字</b>：显示当前最新价、距峰值跌幅、距有效底部涨幅，以及每一档<b>还要跌/涨到多少钱才会触发</b>——这是把回测结论用到实盘的地方。',
  "guide.s3.li2": '<b>关键指标</b>：最终总资金、CAGR 年化、最大回撤（越小越好）、夏普、最长套牢天数。',
  "guide.s3.li3": '<b>净值曲线</b>：动态策略 vs 50-50 不动 vs 纯持基准 vs 纯持杠杆，四条线同口径对比；红三角＝补仓、绿箭头＝减仓；鼠标悬停看当日各条曲线数值与当日成交价。资金差距过大时勾上「对数坐标」更易读。',
  "guide.s3.li4": '<b>组合横向对比</b>：同一区间内几组标的谁更强。',
  "guide.s3.li5": '<b>逐笔交易明细</b>：每次换仓的日期、方向、换了多少钱、<b>当天两端的成交价</b>（本模型按当日收盘价成交）、成交后总资金。',
  "guide.s3.li6": '<b>进场建议</b>（页面最底部）：按当前选中组合的真实状态，给出此刻两端配比与之后各档的触发价与金额。',
  "guide.s3.li7": '<b>每月定投</b>（运行回测那一栏的勾选框）：勾上后每月第一个交易日注入「起始资金的 1%」全额买入基准端，四条对比曲线用同一现金流。此时点「填入推荐参数」会填入<b>按定投口径重新网格搜索</b>出的加减仓比例（参数区下方会列出与一次性投入的差异），指标也换成 XIRR / TWR + 累计投入、净盈亏，因为陆续投钱时净值倍数已不可比。勾选框右侧会显示<b>截止回测末日的累计定投总额</b>（期数 × 每月金额）以及「起始本金 + 定投 = 累计投入」。',
  "guide.s4.title": "必须知道的三点（风险）",
  "guide.s4.li1": '<span class="warn">本策略放大下跌、不保护下跌</span>：越跌越加杠杆，极端行情下可能在最低点满仓杠杆，回撤远大于纯持基准。',
  "guide.s4.li2": '参数是在历史数据上找最优，<b>存在过拟合</b>，未来不会原样重现。',
  "guide.s4.li3": '在线版行情为发布时的快照；想抓最新数据请克隆仓库后用 <code>python web/serve.py</code> 本地运行。结果仅为研究用途，<b>不构成投资建议</b>。',
});
Object.assign(window.I18N.en, {
  "guide.summary": '📖 First time here? Open this <span class="hint">(or just hit “Run backtest”)</span>',
  "guide.tldr": '<b>In one line:</b> it measures how much extra return — and how much extra drawdown — you get by rotating part of your money into a leveraged ETF on big declines and rotating back after big rebounds, versus simply holding.<br/>'
    + '<b>Fastest start:</b> click <code>Fill recommended</code> → click <code>Run backtest</code>; look at the output first, read the rules later.<br/>'
    + '<span class="warn">⚠️ This strategy amplifies declines and offers no downside protection.</span> The parameters are historically optimised and therefore overfitted. <b>Not investment advice.</b>',
  "guide.s1.title": "The strategy has only two rules",
  "guide.s1.li1": '<b>Drawdown add-on (more leverage as it falls)</b>: when the base leg (e.g. SMH) is down -15% / -25% / -35% … from its all-time high, sell the specified share of the current base-leg value and put all of it into the leveraged leg (e.g. SOXL). Each level fires only once per decline.',
  "guide.s1.li2": '<b>Rebound trim (bank it once it recovers)</b>: when the base leg has rebounded +50% / +100% / +200% off the “valid bottom”, sell the specified share of the current leveraged-leg value and rotate it back into the base leg.',
  "guide.s1.li3": '<b>Valid bottom</b> = the lowest price reached after the base leg has fallen more than 25% from its high. Shallow pullbacks do not create a new bottom, so a small dip is never mistaken for “the bottom is in”.',
  "guide.s2.title": "Four steps to your first result",
  "guide.s2.li1": '<b>Pick a data source</b>: SMH/SOXL (semis, 3x), QQQ/TQQQ (Nasdaq-100, 3x), SMH/USD (semis, 2x).',
  "guide.s2.li2": '<b>Enter the capital</b> allocated to the base leg and the leveraged leg in USD; the default is 50,000 each.',
  "guide.s2.li3": '<b>Set the level percentages</b>. Not sure what to use? Just click <code>Fill recommended</code> (the grid-search optimum of the last 10 years for that data source). A <code>0</code> means that level is skipped.',
  "guide.s2.li4": 'Click <code>Run backtest</code>. After changing any parameter, just click it again.',
  "guide.s3.title": "How to read the output",
  "guide.s3.li1": '<b>Status bars and fine print in the parameter card</b>: current price, drawdown from the peak, rebound off the valid bottom, and for every level <b>the exact price it would trigger at</b> — this is where the backtest meets live trading.',
  "guide.s3.li2": '<b>Key metrics</b>: final total equity, CAGR, max drawdown (lower is better), Sharpe, and the longest underwater streak.',
  "guide.s3.li3": '<b>Equity curves</b>: dynamic strategy vs 50-50 buy & hold vs base leg only vs leveraged leg only, all on the same cash-flow basis. Red triangle = add-on, green arrow = trim; hover to read every curve plus that day’s fill prices. When the gap gets large, switch on “Log scale”.',
  "guide.s3.li4": '<b>Pair comparison</b>: which pair was stronger over the same window.',
  "guide.s3.li5": '<b>Trade log</b>: date, direction, amount rotated, <b>both fill prices of that day</b> (this model fills at the daily close), and the total equity after the trade.',
  "guide.s3.li6": '<b>Entry plan</b> (bottom of the page): based on the real current state of the selected pair, it gives today’s split between the two legs plus the trigger price and amount of every later level.',
  "guide.s3.li7": '<b>Monthly contributions</b> (the checkbox next to Run backtest): on the first trading day of each month, 1% of the starting capital is added and fully invested in the base leg; all four curves use the same cash flow. With it on, “Fill recommended” loads ratios from a <b>grid search re-run on the contribution basis</b> (the differences versus the lump-sum optimum are listed below the parameter card), and the metrics switch to XIRR / TWR plus total invested and net P/L, because equity multiples are no longer comparable once money is added over time. To the right of the checkbox you get the <b>total contributed up to the backtest end date</b> (periods × monthly amount) plus “starting capital + contributions = total invested”.',
  "guide.s4.title": "Three things you must know (risk)",
  "guide.s4.li1": '<span class="warn">This strategy amplifies declines and offers no downside protection.</span> It adds leverage as prices fall, so in extreme markets you can end up fully leveraged at the lows, with a drawdown far worse than holding the base leg.',
  "guide.s4.li2": 'The parameters are optimised on historical data and are therefore <b>overfitted</b>; the future will not repeat them exactly.',
  "guide.s4.li3": 'The online build ships a price snapshot taken at publish time. To pull fresh data, clone the repo and run <code>python web/serve.py</code> locally. Results are for research only and are <b>not investment advice</b>.',
});

// ---------- 参数区 ----------
Object.assign(window.I18N.zh, {
  "param.h2": "策略参数",
  "param.source": "数据源",
  "param.src.SMH": "SMH / SOXL（半导体·3x）",
  "param.src.QQQ": "QQQ / TQQQ（纳指100·3x）",
  "param.src.USD": "SMH / USD（半导体·2x）",
  "param.capA": "基准端投入 ($)",
  "param.capB": "杠杆端投入 ($)",
  "param.start": "起始日期",
  "param.end": "截止日期",
  "aria.startY": "起始年", "aria.startM": "起始月", "aria.startD": "起始日",
  "aria.endY": "截止年", "aria.endM": "截止月", "aria.endD": "截止日",
  "param.allocAdvise": "💡 初始配比推荐",
  "param.allocAdvise.title": "按当前数据源、总投入与起始日期在历史价格空间中的位置，推荐开局的基准端/杠杆端配比",
  "param.ddLbl": "▼ 回撤补仓：基准端相对峰值回撤达标时，卖出基准端市值的百分比转买杠杆端",
  "param.rbLbl": "▲ 反弹减仓：基准端相对有效底部反弹达标时，卖出杠杆端市值的百分比转买基准端",
  "btn.run": "运行回测",
  "btn.recommend": "填入推荐参数",
  "dca.label": "每月定投（起始资金的 1%）",
  "dca.title": "每月第一个交易日注入「基准端+杠杆端起始资金之和」的 1%，全额买入基准端，之后是否换成杠杆端仍由上面的回撤档位决定",
});
Object.assign(window.I18N.en, {
  "param.h2": "Strategy parameters",
  "param.source": "Data source",
  "param.src.SMH": "SMH / SOXL (semis · 3x)",
  "param.src.QQQ": "QQQ / TQQQ (Nasdaq-100 · 3x)",
  "param.src.USD": "SMH / USD (semis · 2x)",
  "param.capA": "Base leg capital ($)",
  "param.capB": "Leveraged leg capital ($)",
  "param.start": "Start date",
  "param.end": "End date",
  "aria.startY": "Start year", "aria.startM": "Start month", "aria.startD": "Start day",
  "aria.endY": "End year", "aria.endM": "End month", "aria.endD": "End day",
  "param.allocAdvise": "💡 Suggest initial split",
  "param.allocAdvise.title": "Suggests the opening base-leg / leveraged-leg split based on the selected data source, total capital and where the start date sits in the historical price range",
  "param.ddLbl": "▼ Drawdown add-on: when the base leg hits a drawdown level versus its peak, sell this share of the base-leg value and buy the leveraged leg",
  "param.rbLbl": "▲ Rebound trim: when the base leg hits a rebound level off the valid bottom, sell this share of the leveraged-leg value and buy back the base leg",
  "btn.run": "Run backtest",
  "btn.recommend": "Fill recommended",
  "dca.label": "Monthly contribution (1% of starting capital)",
  "dca.title": "On the first trading day of each month, 1% of the combined starting capital is added and fully invested in the base leg; whether it later rotates into the leveraged leg is still decided by the drawdown levels above",
});

// ---------- 指标 / 曲线 / 组合对比 / 交易明细 ----------
Object.assign(window.I18N.zh, {
  "metrics.h2": "关键指标（动态策略）",
  "chart.h2": "净值曲线",
  "curve.strategy": "动态策略",
  "curve.hold5050": "50-50 不动",
  "curve.holdA": "纯持基准",
  "curve.holdB": "纯持杠杆",
  "curve.log": "对数坐标",
  "cmp.h2": "组合横向对比（跟随上方设定的日期区间）",
  "cmp.note": "勾选想对比的组合。对比区间跟随上方「起始/截止日期」的设定：各组均在你设定的范围内计算，便于同期对比。若某组的标的数据晚于你设定的起点（如 SMH 仅有近 10 年数据），则该组从其数据首日起算。未设起点时，才会兜底为勾选组合涉及标的中最晚的上市日。",
  "cmp.th.group": "组合",
  "cmp.th.range": "区间",
  "cmp.th.final": "最终资金",
  "cmp.th.cagr": "CAGR",
  "cmp.th.maxdd": "最大回撤",
  "cmp.th.sharpe": "夏普",
  "cmp.th.holdA": "纯持基准",
  "cmp.th.holdB": "纯持杠杆",
  "cmp.th.trades": "交易数",
  "trade.h2": "逐笔交易明细",
  "trade.th.date": "成交日",
  "trade.th.type": "类型",
  "trade.th.desc": "说明",
  "trade.th.priceA": "基准端成交价",
  "trade.th.priceB": "杠杆端成交价",
  "trade.th.equity": "成交后总资金",
  "risk.note": "⚠ 本策略放大下跌、不保护下跌：越跌越加杠杆，意味着可能在最低点满仓杠杆。夏普未扣无风险利率，仅供本工具内部横向比较。SOXL 为美股上市 3 倍半导体 ETF（Direxion Daily Semiconductor Bull 3X），跟踪 ICE 半导体指数，与 SMH 持仓口径不完全一致。",
});
Object.assign(window.I18N.en, {
  "metrics.h2": "Key metrics (dynamic strategy)",
  "chart.h2": "Equity curves",
  "curve.strategy": "Dynamic strategy",
  "curve.hold5050": "50-50 buy & hold",
  "curve.holdA": "Base leg only",
  "curve.holdB": "Leveraged leg only",
  "curve.log": "Log scale",
  "cmp.h2": "Pair comparison (uses the date range set above)",
  "cmp.note": "Tick the pairs you want to compare. The comparison window follows the start/end dates set above, so every pair is measured over the same period. If a pair's data starts later than your start date (e.g. SMH only has about 10 years of history), that pair starts from its own first data day. Only when no start date is set does it fall back to the latest inception date among the selected tickers.",
  "cmp.th.group": "Pair",
  "cmp.th.range": "Window",
  "cmp.th.final": "Final equity",
  "cmp.th.cagr": "CAGR",
  "cmp.th.maxdd": "Max drawdown",
  "cmp.th.sharpe": "Sharpe",
  "cmp.th.holdA": "Base leg only",
  "cmp.th.holdB": "Leveraged leg only",
  "cmp.th.trades": "Trades",
  "trade.h2": "Trade log",
  "trade.th.date": "Date",
  "trade.th.type": "Type",
  "trade.th.desc": "Detail",
  "trade.th.priceA": "Base leg fill",
  "trade.th.priceB": "Leveraged leg fill",
  "trade.th.equity": "Equity after trade",
  "risk.note": "⚠ This strategy amplifies declines and offers no downside protection: it adds leverage as prices fall, which means you can be fully leveraged at the lows. Sharpe is shown without subtracting a risk-free rate and is only meant for internal comparison within this tool. SOXL is a US-listed 3x semiconductor ETF (Direxion Daily Semiconductor Bull 3X) tracking the ICE Semiconductor Index, whose holdings do not exactly match SMH.",
});

// ---------- 进场建议 / 免责声明 ----------
Object.assign(window.I18N.zh, {
  "advice.h2": "进场建议：此刻入场怎么买、什么价位买",
  "advice.note": '以当前数据源的<b>最新交易日收盘价</b>为进场价，在上方「补仓/减仓参数」保持不变的前提下，'
    + '从历史上<b>与当下同阶段</b>（同为创新高 / 高位回调 / 深度回撤探底 / 底部反弹，且回撤或反弹幅度接近）'
    + '的若干个日期分别起算，逐一回测不同的「初始杠杆端占比」，挑出未来表现最优的配比。'
    + '价位清单沿用<b>策略真实状态</b>（历史峰值 / 本轮有效底部 + 本轮已触发档），'
    + '与上方「补仓/减仓触发价」完全一致，可直接对照执行。'
    + '<br/>这里给出的配比与价位只是<b>历史数据的计算结果</b>，不是预测、更不构成投资建议，请先读页面底部的免责声明。',
  "disc.h2": "⚠️ 免责声明",
  "disc.li1": '本工具是<b>历史数据模拟回测</b>，所有结论都来自过去的收盘价推演，<b>不是对未来市场的预测</b>。真实市场会出现历史上从未有过的走势。',
  "disc.li2": '模型做了简化：按<b>当日收盘价成交</b>、不计佣金/点差/滑点/税费，不计杠杆 ETF 的<b>日内再平衡损耗、管理费与长期衰减</b>，也不考虑停牌、流动性不足与退市风险。实际成交结果会与此处数字有差异。',
  "disc.li3": '「推荐参数」「进场建议」均由历史数据择优得到，<b>存在过拟合</b>，只是基于既有数据的一种计算结果，<b>仅供研究与参考</b>。',
  "disc.li4": '杠杆 ETF 属高风险品种，本策略越跌越加杠杆，<span class="warn">放大下跌、不保护下跌</span>，极端行情下可能出现远大于标的本身的巨额亏损。',
  "disc.li5": '本页面及作者<b>不构成任何投资建议、要约或收益承诺</b>，不对行情数据的准确性、及时性与完整性负责，也不对任何人依据本工具做出的投资决策及其盈亏承担责任。投资有风险，决策与后果由使用者自行承担。',
});
Object.assign(window.I18N.en, {
  "advice.h2": "Entry plan: how much to buy now and at what prices",
  "advice.note": 'The entry price is the <b>latest closing price</b> of the selected data source. Keeping the add-on / trim parameters above unchanged, '
    + 'the tool starts from a set of historical dates that were in <b>the same phase as today</b> '
    + '(all-time high / high-level pullback / deep-drawdown bottoming / rebound off the bottom, with a similar drawdown or rebound magnitude), '
    + 'backtests a range of “initial leveraged-leg weights” from each of them, and picks the weight with the best forward outcome. '
    + 'The price list reuses the <b>real strategy state</b> (historical peak / current valid bottom + levels already fired), '
    + 'so it matches the trigger prices shown above exactly and can be followed as-is.'
    + '<br/>These weights and prices are purely <b>the output of historical data</b> — not a forecast and definitely not investment advice. Please read the disclaimer at the bottom of the page first.',
  "disc.h2": "⚠️ Disclaimer",
  "disc.li1": 'This tool is a <b>historical simulation</b>; every conclusion comes from replaying past closing prices and is <b>not a forecast of future markets</b>. Real markets will produce paths that have never occurred before.',
  "disc.li2": 'The model is simplified: it <b>fills at the daily close</b> and ignores commissions, spreads, slippage and taxes, as well as the <b>intraday rebalancing cost, management fees and long-term decay</b> of leveraged ETFs, plus halts, thin liquidity and delisting risk. Real fills will differ from the numbers here.',
  "disc.li3": 'Both “recommended parameters” and the “entry plan” are selected as the best fit on historical data, are therefore <b>overfitted</b>, and are only one computation on existing data — <b>for research and reference only</b>.',
  "disc.li4": 'Leveraged ETFs are high-risk instruments, and this strategy adds leverage as prices fall: it <span class="warn">amplifies declines and offers no downside protection</span>, so extreme markets can produce losses far larger than the underlying itself.',
  "disc.li5": 'Neither this page nor its author <b>provides any investment advice, offer or promise of return</b>. No guarantee is made about the accuracy, timeliness or completeness of the market data, and no responsibility is accepted for any investment decision made with this tool or its profit and loss. Investing carries risk; decisions and consequences are entirely the user’s own.',
});

// ---------- 数据更新（云端 / 本地） ----------
Object.assign(window.I18N.zh, {
  "upd.cloud.btn": "🔄 更新最新数据（云端）",
  "upd.cloud.btnTitle": "调用 GitHub Actions 在云端抓取最新行情并更新本页数据（需 GitHub 令牌；按住 Shift 点击可重设令牌）",
  "upd.cloud.hint": "在线版数据由 GitHub Actions 维护：每个交易日收盘后自动刷新，也可点左侧按钮立即更新（需仓库令牌）。",
  "upd.token.prompt": "请输入 GitHub 个人访问令牌（Fine-grained PAT，只需对仓库 {repo} 开 Actions = Read and write）。\n令牌仅保存在你自己的浏览器里，不会写入仓库或上传第三方。",
  "upd.cancelled": "已取消（未提供令牌）。",
  "upd.cloud.confirm": "将在 GitHub 云端抓取 SMH/SOXL/QQQ/TQQQ/USD 最新行情并更新页面数据，约需 3~6 分钟。是否继续？",
  "upd.cloud.progress": "⏳ 云端更新中…已用时 {s} 秒",
  "upd.cloud.progressHint": "（可在 Actions 页查看进度）",
  "upd.viewLog": "查看日志",
  "upd.err.token": "令牌无效或权限不足（需 Actions=Read and write），已清除，请重新点击按钮输入。",
  "upd.err.workflow": "未找到工作流 {wf}，或令牌无该仓库权限。",
  "upd.err.dispatch": "触发失败 HTTP {status} {body}",
  "upd.cloud.timeout": "⌛ 等待超时，请到 Actions 页查看运行结果。",
  "upd.cloud.ok": "✅ 云端数据已更新，等待 Pages 发布完成（约 1 分钟）后自动刷新…",
  "upd.cloud.failed": "❌ 云端运行结束但未成功（{c}）。",
  "upd.cloud.queryFail": "❌ 查询运行状态失败：{e}",
  "upd.local.confirm": "将联网抓取 SMH/SOXL/QQQ/TQQQ/USD 的最新行情并重建数据，约需 1 分钟，期间请勿关闭页面。是否继续？",
  "upd.local.progress": "⏳ 更新中，请稍候（约 1 分钟）…",
  "upd.local.progressElapsed": "⏳ 更新中，请稍候…已用时 {s} 秒",
  "upd.local.item": "{k}：{state}（至 {last}）",
  "upd.local.sep": "；",
  "upd.local.ok": "✅ 更新完成 —— {parts}。正在刷新页面…",
  "upd.local.failed": "❌ 更新失败：{e}",
  "upd.local.reqFail": "❌ 请求失败：{e}（请通过“本地预览(serve.py)”启动，勿直接双击 index.html）",
  "upd.err.unknown": "未知错误",
});
Object.assign(window.I18N.en, {
  "upd.cloud.btn": "🔄 Update market data (cloud)",
  "upd.cloud.btnTitle": "Triggers GitHub Actions to fetch the latest prices in the cloud and refresh this page's data (a GitHub token is required; Shift-click to reset the token)",
  "upd.cloud.hint": "Data for the online build is maintained by GitHub Actions: it refreshes automatically after each trading day's close, or click the button on the left to update now (requires a repo token).",
  "upd.token.prompt": "Enter a GitHub personal access token (fine-grained PAT; it only needs Actions = Read and write on repository {repo}).\nThe token is stored only in your own browser — it is never committed to the repo or sent to a third party.",
  "upd.cancelled": "Cancelled (no token provided).",
  "upd.cloud.confirm": "This will fetch the latest SMH/SOXL/QQQ/TQQQ/USD prices in the GitHub cloud and refresh this page's data. It takes about 3-6 minutes. Continue?",
  "upd.cloud.progress": "⏳ Updating in the cloud… {s}s elapsed",
  "upd.cloud.progressHint": " (progress is visible on the Actions page)",
  "upd.viewLog": "View log",
  "upd.err.token": "The token is invalid or lacks permission (Actions = Read and write is required). It has been cleared — please click the button again to enter a new one.",
  "upd.err.workflow": "Workflow {wf} was not found, or the token has no access to that repository.",
  "upd.err.dispatch": "Dispatch failed, HTTP {status} {body}",
  "upd.cloud.timeout": "⌛ Timed out while waiting — please check the result on the Actions page.",
  "upd.cloud.ok": "✅ Cloud data updated. Waiting for the Pages deployment (about 1 minute), then reloading automatically…",
  "upd.cloud.failed": "❌ The cloud run finished but did not succeed ({c}).",
  "upd.cloud.queryFail": "❌ Failed to query the run status: {e}",
  "upd.local.confirm": "This will fetch the latest SMH/SOXL/QQQ/TQQQ/USD prices online and rebuild the dataset. It takes about 1 minute — please keep this page open. Continue?",
  "upd.local.progress": "⏳ Updating, please wait (about 1 minute)…",
  "upd.local.progressElapsed": "⏳ Updating, please wait… {s}s elapsed",
  "upd.local.item": "{k}: {state} (through {last})",
  "upd.local.sep": "; ",
  "upd.local.ok": "✅ Update complete — {parts}. Reloading the page…",
  "upd.local.failed": "❌ Update failed: {e}",
  "upd.local.reqFail": "❌ Request failed: {e} (start the page via “Local preview (serve.py)” instead of opening index.html directly)",
  "upd.err.unknown": "Unknown error",
});

/* ---------- 回测引擎 / 阶段 / 交易 ---------- */
Object.assign(window.I18N.zh, {
  "bt.err.noCommon": "两标的没有共同交易日",
  "bt.err.startLate": "起点 {d} 晚于全部数据",
  "bt.err.endEarly": "截止 {d} 早于起始交易日",
  "bt.err.badPrice": "起始日价格异常",
  "phase.peak": "创新高",
  "phase.pullback": "高位回调",
  "phase.bottoming": "深度回撤探底",
  "phase.rebound": "底部反弹",
  "trough.note": "回撤≥25%区间最低点（反弹点）",
  "trough.init": "建仓日初始底部（反弹点）",
  "trade.kind.add": "补仓",
  "trade.kind.cut": "减仓",
  "trade.desc.add": "{a}回撤-{lv}%，卖出{a}市值{move}买入{b}",
  "trade.desc.cut": "{a}反弹+{lv}%，卖出{b}市值{move}买入{a}",
  "date.year": "{y}年",
  "date.month": "{m}月",
  "date.day": "{d}日",
  "inp.ddLabel": "回撤 -{lv}%",
  "inp.rbLabel": "反弹 +{lv}%",
  "alloc.needCapital": "请先填写投入金额",
  "alloc.suggest": "建议 {m}（{p}%）",
  "range.note": "可选区间 {lo} ~ {hi}（共 {n} 个交易日）",
});
Object.assign(window.I18N.en, {
  "bt.err.noCommon": "The two tickers have no overlapping trading days",
  "bt.err.endEarly": "End date {d} is earlier than the first trading day",
  "bt.err.startLate": "Start date {d} is later than all available data",
  "bt.err.badPrice": "Invalid price on the start date",
  "phase.peak": "New high",
  "phase.pullback": "Pullback from high",
  "phase.bottoming": "Deep drawdown / bottoming",
  "phase.rebound": "Rebound off the bottom",
  "trough.note": "Lowest point of the ≥25% drawdown window (rebound anchor)",
  "trough.init": "Initial bottom on the entry date (rebound anchor)",
  "trade.kind.add": "Add",
  "trade.kind.cut": "Trim",
  "trade.desc.add": "{a} drawdown -{lv}%: sell ${move} of {a} and buy {b}",
  "trade.desc.cut": "{a} rebound +{lv}%: sell ${move} of {b} and buy {a}",
  "date.year": "{y}",
  "date.month": "{m}",
  "date.day": "{d}",
  "inp.ddLabel": "Drawdown -{lv}%",
  "inp.rbLabel": "Rebound +{lv}%",
  "alloc.needCapital": "Enter the investment amount first",
  "alloc.suggest": "Suggested {m} ({p}%)",
  "range.note": "Available range {lo} ~ {hi} ({n} trading days)",
});

/* ---------- 定投推荐 / 定投累计 ---------- */
Object.assign(window.I18N.zh, {
  "dca.rec.rowDd": "▼ 回撤 -{lv}%",
  "dca.rec.rowRb": "▲ 反弹 +{lv}%",
  "dca.rec.note1": "已开启每月定投：每月第一个交易日注入起始资金的 <b>{pct}%</b>",
  "dca.rec.note2": " = <b>{amt}</b>/月",
  "dca.rec.note3": "，全额买入 {na}；是否换成 {nb} 仍由下列回撤档位决定。",
  "dca.rec.note4": "下表右列是按定投现金流重新做网格搜索（最近 10 年窗口、末日总资金最大化）得到的推荐值，<b>橙色</b>为与一次性投入不同的档位。点「填入推荐参数」即按右列填入。",
  "dca.rec.th.level": "档位",
  "dca.rec.th.one": "一次性投入推荐",
  "dca.rec.th.dca": "定投({pct}%/月)推荐",
  "dca.sum": "截止 {date} 累计定投 <b>{sum}</b>（{n} 期 × {per}/月）；起始本金 {principal} + 定投 = 累计投入 <b>{total}</b>",
});
Object.assign(window.I18N.en, {
  "dca.rec.rowDd": "▼ Drawdown -{lv}%",
  "dca.rec.rowRb": "▲ Rebound +{lv}%",
  "dca.rec.note1": "Monthly contributions are on: <b>{pct}%</b> of the starting capital is added on the first trading day of each month",
  "dca.rec.note2": " = <b>{amt}</b>/month",
  "dca.rec.note3": ", fully invested in {na}; whether it is switched into {nb} is still decided by the drawdown levels below.",
  "dca.rec.note4": "The right column below comes from re-running the grid search on the contribution cash flow (10-year window, maximizing final equity). <b>Orange</b> marks levels that differ from the lump-sum setting. Clicking “Fill recommended values” applies the right column.",
  "dca.rec.th.level": "Level",
  "dca.rec.th.one": "Lump-sum recommendation",
  "dca.rec.th.dca": "Contributions ({pct}%/mo) recommendation",
  "dca.sum": "Through {date}, contributions total <b>{sum}</b> ({n} payments × {per}/mo); starting capital {principal} + contributions = total invested <b>{total}</b>",
});

/* ---------- 实时状态 / 触发价 ---------- */
Object.assign(window.I18N.zh, {
  "live.head": "截至 {date}｜当前阶段：<b>{phase}</b>",
  "live.dd.atPeak": "{na} 现价 <b>{price}</b>，正处历史最高点（{peakDate}），较峰值跌幅 <b>0.00%</b>",
  "live.dd.below": "{na} 现价 <b>{price}</b>，较历史最高 {peak}（{peakDate}）跌幅 <b>{dd}%</b>",
  "live.dd.fired": "└ {lvs} 档自上次创新高以来已触发过，本轮不会再次补仓；其余档位触发价仍然有效",
  "live.dd.none": "└ 五档均未触发，下方触发价全部有效",
  "live.rb.stale": "有效底部 {trough}（{troughDate}）<b>来自上一轮下跌</b>，现价已高出 <b>{rb}%</b>——下方减仓触发价当前不适用<br/>└ 需先自峰值回撤超过 {trig}% 跌出新底部（即跌破 {need}），减仓档位才会重新计时",
  "live.rb.atTrough": "{na} 现价 <b>{price}</b>，正处本轮有效底部（{troughDate}），较底部涨幅 <b>0.00%</b>",
  "live.rb.above": "{na} 现价 <b>{price}</b>，较本轮有效底部 {trough}（{troughDate}）涨幅 <b>{rb}%</b>",
  "live.rb.fired": "└ {lvs} 档对该底部已触发过，本轮不会再次减仓；其余档位触发价仍然有效",
  "live.rb.none": "└ 各档均未触发，下方触发价全部有效",
  "trig.dd.fired": "本轮已触发（{price}）<br/>须创新高后才重置",
  "trig.dd.hit": "跌到 {price} 补仓<br/>✓ 已达（现价已低于触发价）",
  "trig.dd.wait": "跌到 {price} 补仓<br/>还需跌 {gap}%",
  "trig.rb.stale": "暂不适用（{price}）<br/>底部属上一轮，待跌出新底部",
  "trig.rb.fired": "本轮已触发（{price}）<br/>须跌出新底部后才重置",
  "trig.rb.hit": "涨到 {price} 减仓<br/>✓ 已达（现价已高于触发价）",
  "trig.rb.wait": "涨到 {price} 减仓<br/>还需涨 {gap}%",
});
Object.assign(window.I18N.en, {
  "live.head": "As of {date} | current phase: <b>{phase}</b>",
  "live.dd.atPeak": "{na} at <b>{price}</b> — an all-time high ({peakDate}), <b>0.00%</b> below the peak",
  "live.dd.below": "{na} at <b>{price}</b>, <b>{dd}%</b> below the all-time high of {peak} ({peakDate})",
  "live.dd.fired": "└ The {lvs} level(s) have already fired since the last all-time high, so no further adds this cycle; the remaining trigger prices are still valid",
  "live.dd.none": "└ None of the five levels has fired — every trigger price below is valid",
  "live.rb.stale": "The active bottom {trough} ({troughDate}) <b>belongs to the previous decline</b>, and the price is already <b>{rb}%</b> above it — the trim triggers below do not apply right now<br/>└ The price must first fall more than {trig}% from the peak to set a new bottom (i.e. below {need}) before the trim levels restart",
  "live.rb.atTrough": "{na} at <b>{price}</b> — the active bottom of this cycle ({troughDate}), <b>0.00%</b> above it",
  "live.rb.above": "{na} at <b>{price}</b>, <b>{rb}%</b> above this cycle's active bottom of {trough} ({troughDate})",
  "live.rb.fired": "└ The {lvs} level(s) have already fired against this bottom, so no further trims this cycle; the remaining trigger prices are still valid",
  "live.rb.none": "└ No level has fired — every trigger price below is valid",
  "trig.dd.fired": "Already fired this cycle ({price})<br/>Resets only after a new high",
  "trig.dd.hit": "Add at {price}<br/>✓ Reached (price is below the trigger)",
  "trig.dd.wait": "Add at {price}<br/>Needs another {gap}% drop",
  "trig.rb.stale": "Not applicable ({price})<br/>Bottom is from the previous cycle; wait for a new one",
  "trig.rb.fired": "Already fired this cycle ({price})<br/>Resets only after a new bottom",
  "trig.rb.hit": "Trim at {price}<br/>✓ Reached (price is above the trigger)",
  "trig.rb.wait": "Trim at {price}<br/>Needs another {gap}% rise",
});

/* ---------- 进场建议：清单表 ---------- */
Object.assign(window.I18N.zh, {
  "adv.add.allZero": "当前补仓参数各档均为 0%，不会再把 {na} 换成 {nb}。",
  "adv.cut.allZero": "当前减仓参数各档均为 0%，不会把 {nb} 换回 {na}。",
  "adv.add.th.level": "回撤档",
  "adv.cut.th.level": "反弹档",
  "adv.th.trigger": "触发价",
  "adv.th.gap": "距现价",
  "adv.add.th.buy": "买入 {nb}",
  "adv.add.th.left": "剩余 {na}",
  "adv.cut.th.sell": "卖 {nb} 换回 {na}",
  "adv.cut.th.left": "剩余 {nb}",
  "adv.add.firedRow": "本轮已触发过（须创新高后才重置）——进场后不用再等这一档",
  "adv.cut.firedRow": "对该底部已触发过（须跌出新底部后才重置）",
  "adv.add.needFall": "还需跌 {gap}%",
  "adv.add.canNow": "✓ 现价已低于该价，可立即执行",
  "adv.cut.needRise": "还需涨 {gap}%",
  "adv.cut.canNow": "✓ 现价已高于该价，可立即执行",
  "adv.amtNote": "（当时 {k} 的 {p}%）",
});
Object.assign(window.I18N.en, {
  "adv.add.allZero": "Every add level is set to 0%, so no more {na} will be switched into {nb}.",
  "adv.cut.allZero": "Every trim level is set to 0%, so no {nb} will be switched back into {na}.",
  "adv.add.th.level": "Drawdown level",
  "adv.cut.th.level": "Rebound level",
  "adv.th.trigger": "Trigger price",
  "adv.th.gap": "Vs. current price",
  "adv.add.th.buy": "Buy {nb}",
  "adv.add.th.left": "{na} remaining",
  "adv.cut.th.sell": "Sell {nb} back into {na}",
  "adv.cut.th.left": "{nb} remaining",
  "adv.add.firedRow": "Already fired this cycle (resets only after a new high) — no need to wait for this level after entering",
  "adv.cut.firedRow": "Already fired against this bottom (resets only after a new bottom)",
  "adv.add.needFall": "Needs another {gap}% drop",
  "adv.add.canNow": "✓ Price is already below this level — can be executed now",
  "adv.cut.needRise": "Needs another {gap}% rise",
  "adv.cut.canNow": "✓ Price is already above this level — can be executed now",
  "adv.amtNote": " ({p}% of {k} at that time)",
});

/* ---------- 进场建议：动作清单 / 方案框 / 配比表 ---------- */
Object.assign(window.I18N.zh, {
  "adv.sec.add": "继续下跌时：跌到多少买 {nb}{main}",
  "adv.sec.cut": "反弹走高时：涨到多少把 {nb} 换回 {na}{main}",
  "adv.main": "（当前阶段的主线）",
  "adv.add.baseNote": "价格基准是历史最高 {peak}（{pd}），与上方「补仓触发价」完全一致；金额按上面的推荐配比推演（未计中途涨跌）。",
  "adv.cut.staleNote": "当前有效底部 {trough}（{td}）来自上一轮下跌，现价已高出 {rb}%，减仓档位暂不适用：需先自峰值回撤超过 {trig}%（跌破 <b>{need}</b>）跌出新底部，减仓才重新计时，届时上方「减仓触发价」会按新底部给出具体价格。",
  "adv.cut.baseNote": "价格基准是本轮有效底部 {trough}（{td}），与上方「减仓触发价」完全一致；金额按上面的推荐配比推演（未计中途涨跌）。",
  "adv.box.wLabel": "杠杆端初始占比",
  "adv.box.buyA": "{na}（基准端）买入 <b>{amt}</b>",
  "adv.box.buyB": "{nb}（杠杆端）买入 <b>{amt}</b>",
  "adv.box.med": "样本中位数终值 <b>{m}×</b>（最差 {w}× / 最好 {b}×）",
  "adv.box.dd": "中位数最大回撤 <b>{dd}%</b>　|　跑赢纯持基准 <b>{wr}%</b>",
  "adv.plan.rec": "推荐配比",
  "adv.plan.recTag": "与补仓阶梯自洽，且在上限内收益最优",
  "adv.cap.none": "暂无",
  "adv.cap.note": "<b>为什么不是 100% 杠杆：</b>杠杆端占比上限 <b>{cap}%</b> 来自上方补仓阶梯本身——当前自峰值回撤 {ddp}%，已触发的补仓档为 {fired}。设想在峰值那天满仓 {na} 进场、严格按上方参数走到今天，此刻应有约 {cap}% 换成了 {nb}，剩下 {rest}% 必须留着，等跌到 -25%/-35%/-45%/-50% 各档时再分批换。进场当天就把钱全押在 {nb} 上，等于把后面所有补仓档位作废。",
  "adv.cap.full": "若去掉这个上限、只比收益，结论必然是 100% 杠杆（{m}× / 回撤 {dd}%）：样本期半导体整体上行，中位数收益随杠杆占比单调递增，这是样本口径决定的，不是对未来的判断。阶梯自洽配比的代价是中位数终值 {m2}×，换来的是回撤从 {dd}% 降到 {dd2}%，以及继续下跌时还有子弹。",
  "adv.plan.note": "终值倍数 = 持有 {n} 个交易日后的总资金 ÷ 进场本金；取各样本的中位数，比平均值更不容易被个别极端行情带偏。只给这一个配比：它在「不破坏补仓阶梯」的前提下，历史同阶段样本里向后持有的中位数结果最好（若有多个配比收益几乎相同，取其中回撤更小的）。",
  "adv.tbl.sec": "各初始配比在历史同阶段样本上的表现",
  "adv.tbl.th.w": "杠杆端初始占比",
  "adv.tbl.th.med": "中位数终值",
  "adv.tbl.th.worst": "最差",
  "adv.tbl.th.best": "最好",
  "adv.tbl.th.medDD": "中位数最大回撤",
  "adv.tbl.th.win": "跑赢纯持基准",
  "adv.tbl.th.n": "样本数",
  "adv.mark.rec": " ← 推荐",
  "adv.mark.overCap": " （超出阶梯上限）",
});
Object.assign(window.I18N.en, {
  "adv.sec.add": "If it keeps falling: at what price to buy {nb}{main}",
  "adv.sec.cut": "If it rebounds: at what price to switch {nb} back into {na}{main}",
  "adv.main": " (the main path in the current phase)",
  "adv.add.baseNote": "Prices are anchored to the all-time high of {peak} ({pd}), exactly matching the “add trigger prices” above; amounts are projected from the recommended split above (ignoring moves in between).",
  "adv.cut.staleNote": "The active bottom {trough} ({td}) comes from the previous decline and the price is already {rb}% above it, so the trim levels do not apply yet: the price must first fall more than {trig}% from the peak (below <b>{need}</b>) to set a new bottom before the trim levels restart, at which point the “trim trigger prices” above will be based on the new bottom.",
  "adv.cut.baseNote": "Prices are anchored to this cycle's active bottom of {trough} ({td}), exactly matching the “trim trigger prices” above; amounts are projected from the recommended split above (ignoring moves in between).",
  "adv.box.wLabel": "Initial leveraged weight",
  "adv.box.buyA": "Buy <b>{amt}</b> of {na} (base leg)",
  "adv.box.buyB": "Buy <b>{amt}</b> of {nb} (leveraged leg)",
  "adv.box.med": "Median final multiple <b>{m}×</b> (worst {w}× / best {b}×)",
  "adv.box.dd": "Median max drawdown <b>{dd}%</b>　|　Beats buy-and-hold base <b>{wr}%</b>",
  "adv.plan.rec": "Recommended split",
  "adv.plan.recTag": "Consistent with the add-on ladder, best return within that cap",
  "adv.cap.none": "none yet",
  "adv.cap.note": "<b>Why not 100% leveraged:</b> the cap of <b>{cap}%</b> on the leveraged leg comes from the add-on ladder above — the current drawdown from the peak is {ddp}% and the levels fired so far are {fired}. Imagine entering fully in {na} on the peak day and following the parameters above to today: about {cap}% would have been switched into {nb} by now, and the remaining {rest}% must be kept as ammunition for the -25%/-35%/-45%/-50% levels. Going all-in on {nb} at entry would void every remaining add-on level.",
  "adv.cap.full": "Without this cap, ranking by return alone always ends at 100% leveraged ({m}× / drawdown {dd}%): semiconductors trended up over the sample window, so the median return rises monotonically with leverage — that is an artifact of the sample, not a forecast. The ladder-consistent split gives up some upside (median {m2}×) in exchange for cutting the drawdown from {dd}% to {dd2}% and keeping dry powder if the decline continues.",
  "adv.plan.note": "Final multiple = total equity after holding {n} trading days ÷ capital at entry; the median across samples is used because it is less distorted by a few extreme runs than the average. Only this one split is shown: without breaking the add-on ladder, it delivered the best median forward result across historical samples in the same phase (if several splits are nearly tied on return, the one with the smaller drawdown is picked).",
  "adv.tbl.sec": "How each initial split performed on historical samples in the same phase",
  "adv.tbl.th.w": "Initial leveraged weight",
  "adv.tbl.th.med": "Median final multiple",
  "adv.tbl.th.worst": "Worst",
  "adv.tbl.th.best": "Best",
  "adv.tbl.th.medDD": "Median max drawdown",
  "adv.tbl.th.win": "Beats buy-and-hold base",
  "adv.tbl.th.n": "Samples",
  "adv.mark.rec": " ← recommended",
  "adv.mark.overCap": " (above ladder cap)",
});

/* ----------进场建议：概览与样本说明 ---------- */
Object.assign(window.I18N.zh, {
  "adv.noData": "暂无可用数据或投入资金为 0，无法给出建议。",
  "adv.match.dd": "距峰值跌幅 {p}% ±{tol} 个百分点",
  "adv.match.rb": "距有效底部涨幅 {p}% ±{tol} 个百分点",
  "adv.scopeNote": "以下结论只针对当前选中的 <b>{na} / {nb}</b> 组合，回撤/反弹档位取该组合自己的推荐参数，不与其他组合横向比较。",
  "adv.kv.entry": "进场日：<b>{d}</b>（数据源最新交易日）　|　进场价：{na} <b>{pa}</b>",
  "adv.kv.entryB": "、{nb} <b>{pb}</b>",
  "adv.kv.phase": "当前阶段：<b>{phase}</b>（{match}）　|　可投入总资金：<b>{total}</b>",
  "adv.kv.dca": "（另每月定投 <b>{amt}</b> 买入 {na}，下表倍数＝终值 / 累计投入）",
  "adv.kv.samples": "历史同阶段样本：<b>{n}</b> 个进场日，每个样本向后持有 <b>{d}</b> 个交易日（约 {y} 年）后结算",
  "adv.sub.few": "（历史同阶段样本不足，仅给规则型提示）",
  "adv.few.note": "当前阶段在历史数据里出现得太少（可匹配样本 {n} 个，少于 {min} 个），按样本择优会严重过拟合，故不给出具体配比。可退一步按策略本身的逻辑执行：此刻先全额买入基准端，把杠杆端额度留到下方各档补仓价再投入。",
  "adv.sub.based": "（基于 {n} 个历史同阶段样本）",
  "adv.computing": "正在用历史同阶段样本检验各档配比…",
  "adv.failed": "建议计算失败：{e}",
});
Object.assign(window.I18N.en, {
  "adv.noData": "No data available or the invested amount is 0 — no recommendation can be given.",
  "adv.match.dd": "{p}% below the peak, ±{tol} percentage points",
  "adv.match.rb": "{p}% above the active bottom, ±{tol} percentage points",
  "adv.scopeNote": "The conclusions below apply only to the selected <b>{na} / {nb}</b> pair; the drawdown/rebound levels are that pair's own recommended values and are not compared across pairs.",
  "adv.kv.entry": "Entry date: <b>{d}</b> (latest trading day in the data)　|　Entry price: {na} <b>{pa}</b>",
  "adv.kv.entryB": ", {nb} <b>{pb}</b>",
  "adv.kv.phase": "Current phase: <b>{phase}</b> ({match})　|　Total capital available: <b>{total}</b>",
  "adv.kv.dca": " (plus <b>{amt}</b> contributed monthly into {na}; multiples below = final equity / total invested)",
  "adv.kv.samples": "Historical samples in the same phase: <b>{n}</b> entry dates, each held <b>{d}</b> trading days (about {y} years) before settling",
  "adv.sub.few": "(too few historical samples in this phase — rule-based guidance only)",
  "adv.few.note": "This phase appears too rarely in the historical data ({n} matching samples, fewer than {min}), so picking the best split from samples would badly overfit and no specific split is given. A safer fallback is the strategy's own logic: put everything into the base leg now and keep the leveraged allocation for the add levels listed below.",
  "adv.sub.based": "(based on {n} historical samples in the same phase)",
  "adv.computing": "Testing each split against historical samples in the same phase…",
  "adv.failed": "Failed to compute the recommendation: {e}",
});

/* ---------- 指标卡 / 图表 / 交易表 / 组合对比 ---------- */
Object.assign(window.I18N.zh, {
  "run.failed": "回测失败：{e}",
  "m.final": "最终总资金",
  "m.invested": "累计投入",
  "m.profit": "净盈亏",
  "m.xirr": "XIRR 资金加权年化",
  "m.twr": "TWR 年化",
  "m.cagr": "CAGR 年化",
  "m.maxdd": "最大回撤",
  "m.sharpe": "夏普(未扣无风险)",
  "m.underwater": "最长套牢",
  "m.days": "{n} 天",
  "m.vs5050": "vs 50-50不动",
  "curve.holdOnly": "纯持 {k}",
  "trade.th.priceDyn": "{k} 成交价",
  "trade.none": "当前参数下无交易",
  "trade.count": "共 {n} 笔",
  "cmp.none": "未勾选任何组合",
  "cmp.rangeUser": "对比区间：{s} ~ {e}（按上方设定；某组若上市晚于起点，则从其上市日起算）",
  "cmp.latest": "最新",
  "cmp.rangeAuto": "统一起点：{s}（未设起点，由勾选组合涉及标的的最晚上市日兜底）",
  "cmp.dcaNote": "；已开启每月定投 {pct}%，各组现金流相同，年化列为 XIRR（资金加权）",
  "boot.noData": "数据未加载：请确认 data.js 存在。",
});
Object.assign(window.I18N.en, {
  "run.failed": "Backtest failed: {e}",
  "m.final": "Final total equity",
  "m.invested": "Total invested",
  "m.profit": "Net profit/loss",
  "m.xirr": "XIRR (money-weighted)",
  "m.twr": "TWR annualized",
  "m.cagr": "CAGR",
  "m.maxdd": "Max drawdown",
  "m.sharpe": "Sharpe (no risk-free)",
  "m.underwater": "Longest underwater",
  "m.days": "{n} days",
  "m.vs5050": "vs 50-50 hold",
  "curve.holdOnly": "Hold {k} only",
  "trade.th.priceDyn": "{k} fill price",
  "trade.none": "No trades under the current settings",
  "trade.count": "{n} trades",
  "cmp.none": "No pair selected",
  "cmp.rangeUser": "Comparison range: {s} ~ {e} (per the settings above; a pair listed later starts from its own first trading day)",
  "cmp.latest": "latest",
  "cmp.rangeAuto": "Unified start: {s} (no start date set — falls back to the latest listing date among the selected tickers)",
  "cmp.dcaNote": "; monthly contributions of {pct}% are on, cash flows are identical across pairs, and the annualized column shows XIRR (money-weighted)",
  "boot.noData": "Data not loaded: please make sure data.js exists.",
});

/* ==================== 引擎 ==================== */
(function () {
  var LS_KEY = "smh_lang";
  var DEFAULT = "zh";
  var cur = DEFAULT;
  try {
    var saved = localStorage.getItem(LS_KEY);
    if (saved === "zh" || saved === "en") cur = saved;
  } catch (e) { /* 隐身模式等禁用 localStorage 时忽略 */ }

  function getLang() { return cur; }

  // 取词：当前语言 → 中文 → 原样返回 key（便于发现漏翻）
  function raw(key) {
    var d = window.I18N[cur];
    if (d && Object.prototype.hasOwnProperty.call(d, key)) return d[key];
    var z = window.I18N[DEFAULT];
    if (z && Object.prototype.hasOwnProperty.call(z, key)) return z[key];
    return key;
  }

  // T("a.b", {x: 1})：把模板里的 {x} 占位替换掉；未提供的占位保持原样
  function T(key, vars) {
    var s = raw(key);
    if (!vars) return s;
    return s.replace(/\{(\w+)\}/g, function (m, name) {
      return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m;
    });
  }

  // 扫描带 data-i18n* 的静态节点并回填文案
  function applyStaticI18n(root) {
    var scope = root || document;
    scope.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = T(el.getAttribute("data-i18n"));
    });
    scope.querySelectorAll("[data-i18n-html]").forEach(function (el) {
      el.innerHTML = T(el.getAttribute("data-i18n-html"));
    });
    scope.querySelectorAll("[data-i18n-title]").forEach(function (el) {
      el.title = T(el.getAttribute("data-i18n-title"));
    });
    scope.querySelectorAll("[data-i18n-aria]").forEach(function (el) {
      el.setAttribute("aria-label", T(el.getAttribute("data-i18n-aria")));
    });
    document.documentElement.lang = cur === "en" ? "en" : "zh-CN";
    document.title = T("doc.title");
  }

  // 切语言：落盘 + 回填静态文案 + 通知页面重渲染动态内容
  function setLang(lang) {
    if (lang !== "zh" && lang !== "en") return;
    if (lang === cur) return;
    cur = lang;
    try { localStorage.setItem(LS_KEY, lang); } catch (e) { /* 忽略 */ }
    applyStaticI18n();
    document.querySelectorAll("[data-lang-btn]").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-lang-btn") === cur);
    });
    window.dispatchEvent(new CustomEvent("smh:langchange", { detail: { lang: cur } }));
  }

  window.T = T;
  window.I18N.t = T;
  window.I18N.getLang = getLang;
  window.I18N.setLang = setLang;
  window.I18N.applyStatic = applyStaticI18n;

  // 初始化：绑定右上角语言按钮 + 首次回填静态文案（本脚本在 body 末尾加载，DOM 已就绪）
  function boot() {
    document.querySelectorAll("[data-lang-btn]").forEach(function (b) {
      var lang = b.getAttribute("data-lang-btn");
      b.classList.toggle("on", lang === cur);
      b.addEventListener("click", function () { setLang(lang); });
    });
    applyStaticI18n();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();