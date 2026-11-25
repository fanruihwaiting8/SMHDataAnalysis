"""Python 侧对拍脚本：与 tools/test_js_engine.js 用同一组用例跑 run_backtest。

用法（在项目根目录）：
    .venv/bin/python tools/test_py_engine.py
    /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc \
        tools/test_js_engine.js

两边输出应逐行完全相同；若不同，优先确认 web/data.js 是否已由最新 CSV 重新生成
（数据末日不一致会让倍数对不上，与引擎逻辑无关）。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backtest import run_backtest  # noqa: E402

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_A = os.path.join(BASE, "Input", "SMH_full_history.csv")
CSV_B = os.path.join(BASE, "Input", "SOXL_full_history.csv")

DD = {15: 0, 25: 45, 35: 100, 45: 0, 50: 0}
RB = {50: 0, 100: 0, 200: 100}

CASES = [
    ("2022-10-05", 0, 10000, 0, 1.0),
    ("2022-10-12", 0, 10000, 0, 1.0),
    ("2022-10-14", 0, 10000, 0, 1.0),
    ("2022-10-21", 0, 10000, 0, 1.0),
    ("2022-11-10", 0, 10000, 0, 1.0),
    ("2021-12-27", 5000, 5000, 0, 1.0),
    ("2010-03-11", 5000, 5000, 0, 1.0),
    ("2010-03-11", 5000, 5000, 756, 1.0),
    ("2010-03-11", 5000, 5000, 504, 0.5),
    ("2016-11-23", 5000, 5000, 378, 1.0),
]

print("start        hold    multiple  trades  initTrough")
for start, cap_a, cap_b, hold_days, hold_ratio in CASES:
    r = run_backtest(cap_a, cap_b, DD, RB, CSV_A, CSV_B,
                     start_date=start, name_a="SMH", name_b="SOXL",
                     hold_days=hold_days, hold_ratio=hold_ratio)
    mult = r["final_total"] / (cap_a + cap_b)
    print(f'{r["start_date"]}  {hold_days}/{hold_ratio:g}  {mult:.4f}  '
          f'{len(r["trades"])}  {r["troughs"][0][1]:.2f}')