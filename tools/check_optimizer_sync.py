"""对拍：optimize_group_10y 的 fast_total / fast_total_slow 与 backtest.run_backtest
在软化参数（初始底部回看 60 日 + 创新高当日参与减仓）下是否一致。"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import backtest as bt  # noqa: E402
import optimize_group_10y as og  # noqa: E402

DD = [0, 45, 100, 0, 0]   # 15/25/35/45/50
RB = [0, 0, 100]          # 50/100/200
DD_MAP = {15: 0, 25: 45, 35: 100, 45: 0, 50: 0}
RB_MAP = {50: 0, 100: 0, 200: 100}

for window in ("10y", "all"):
    ctx = og.build_ctx("smh", window, 0.0)
    fast = og.fast_total(ctx, DD, RB)
    slow = og.fast_total_slow(ctx, DD, RB)
    res = bt.run_backtest(
        smh_capital=og.CAP_A, smh3_capital=og.CAP_B,
        drawdowns=DD_MAP, rebounds=RB_MAP,
        smh_csv=og.GROUPS["smh"]["csv_a"],
        smh3_csv=og.GROUPS["smh"]["csv_b"],
        start_date=ctx["common"][0],
        name_a="SMH", name_b="SOXL",
    )
    ref = res["final_total"]
    print(
        f"{window:>4}  start={ctx['common'][0]}  init_trough={ctx['init_trough']:.2f}"
        f"  fast={fast:,.2f}  slow={slow:,.2f}  backtest={ref:,.2f}"
        f"  diff_fast={abs(fast - ref) / ref * 100:.4f}%"
        f"  diff_slow={abs(slow - ref) / ref * 100:.4f}%"
    )
    print(
        "      backtest 初始底部 =",
        f"{res['troughs'][0][1]:.2f}",
        "| 交易笔数 =", len(res["trades"]),
    )