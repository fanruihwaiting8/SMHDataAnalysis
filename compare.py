"""
标的对比看板 - 独立 Toplevel 窗口

基于主界面输入的本金与「同一时间区间」，对 SMH 组、QQQ 组、USD 组分别跑
补仓减仓策略回测，得到 9 条“资金走势”曲线，每条独立可勾选叠加对比：

  SMH 组：全买 SMH / 动态策略 / 全买 SMH3
  QQQ 组：全买 QQQ / 动态策略 / 全买 TQQQ
  USD 组：全买 SMH / 动态策略 / 全买 USD（SMH=1倍基准端，USD=2倍杠杆端）

三组回测区间保持一致（均使用主界面约束的起止日期）。
"""
import os
import tkinter as tk
from tkinter import ttk, messagebox
from datetime import datetime

from matplotlib.figure import Figure
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
import matplotlib.dates as mdates

from backtest import run_backtest

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
INPUT_DIR = os.path.join(BASE_DIR, "Input")

# 三组回测配置：组 key -> (基准CSV, 杠杆CSV, 基准名, 杠杆名)
GROUPS = {
    "SMH": ("SMH_full_history.csv", "SMH3_full_history.csv", "SMH", "SMH3"),
    "QQQ": ("QQQ_full_history.csv", "TQQQ_full_history.csv", "QQQ", "TQQQ"),
    "USD": ("SMH_full_history.csv", "USD_full_history.csv", "SMH", "USD"),
}

# 9 条曲线定义：curve_key -> (显示名, 组key, result中equity字段, 颜色)
CURVES = [
    ("SMH_hold_a",  "全买 SMH",      "SMH", "equity_hold_smh",  "#d62728"),
    ("SMH_strat",   "SMH 动态策略",  "SMH", "equity_strategy",  "#8b0000"),
    ("SMH_hold_b",  "全买 SMH3",     "SMH", "equity_hold_smh3", "#ff7f0e"),
    ("QQQ_hold_a",  "全买 QQQ",      "QQQ", "equity_hold_smh",  "#1f77b4"),
    ("QQQ_strat",   "QQQ 动态策略",  "QQQ", "equity_strategy",  "#0b3d91"),
    ("QQQ_hold_b",  "全买 TQQQ",     "QQQ", "equity_hold_smh3", "#2ca02c"),
    ("USD_hold_a",  "全买 SMH",      "USD", "equity_hold_smh",  "#9467bd"),
    ("USD_strat",   "USD+SMH 策略",  "USD", "equity_strategy",  "#4b0082"),
    ("USD_hold_b",  "全买 USD",      "USD", "equity_hold_smh3", "#17becf"),
]

DEF_CAPITAL = 50000.0  # 每标的默认投入（主界面未填时兜底）
DEF_DRAWDOWNS = {15: 0, 25: 20, 35: 100, 45: 0, 50: 0}
DEF_REBOUNDS = {50: 0, 100: 61, 200: 100}


def _csv(name: str) -> str:
    return os.path.join(INPUT_DIR, name)


def _to_dt(s: str):
    try:
        return datetime.strptime(str(s)[:10], "%Y-%m-%d")
    except Exception:
        return None


def _csv_first_date(name: str):
    """读取 CSV 首个数据行日期（YYYY-MM-DD），失败返回 None。"""
    path = _csv(name)
    try:
        with open(path, "r", encoding="utf-8") as f:
            f.readline()  # 跳过表头
            line = f.readline().strip()
        return line.split(",")[0] if line else None
    except Exception:
        return None


def common_earliest_date():
    """五标的都存在数据的最早日 = 各首日中的最大值。

    USD 从 2007 起、SMH 从 2021-12-10 起，均早于 SMH3(2021-12-14)，
    故实际公共起点仍由 SMH3 决定，加入 USD 不改变结果。
    """
    files = ["QQQ_full_history.csv", "TQQQ_full_history.csv",
             "SMH_full_history.csv", "SMH3_full_history.csv",
             "USD_full_history.csv"]
    firsts = [d for d in (_csv_first_date(n) for n in files) if d]
    return max(firsts) if firsts else None


class CompareWindow:
    """标的资金走势对比看板。"""

    def __init__(self, master, cap_a=DEF_CAPITAL, cap_b=DEF_CAPITAL,
                 start_date=None, end_date=None):
        # 本金允许为 0（资金输入可为 0），仅 None 时才用默认兜底
        self.cap_a = DEF_CAPITAL if cap_a is None else cap_a
        self.cap_b = DEF_CAPITAL if cap_b is None else cap_b
        self.end_date = end_date

        # 统一区间约束：起点不得早于「四标的都有数据的最早日」，
        # 否则某标的早期无数据。取用户起点与公共最早日中较晚者。
        self.common_start = common_earliest_date()
        if start_date and self.common_start:
            self.start_date = max(start_date, self.common_start)
        else:
            self.start_date = start_date or self.common_start

        self.top = tk.Toplevel(master)
        self.top.title("标的对比看板")
        self.top.geometry("1040x860")

        # 6 条曲线勾选状态（默认全选）
        self.vars = {c[0]: tk.BooleanVar(value=True) for c in CURVES}
        self.var_log = tk.BooleanVar(value=True)

        # 缓存两组回测结果
        self.results = {}

        self._build_widgets()
        self._run_backtests()
        self._draw_chart()
        self._fill_summary()

    # ---------- UI ----------
    def _build_widgets(self):
        top = self.top

        info = (f"回测区间：{self.start_date or '数据起点'} ~ "
                f"{self.end_date or '数据末尾'}　|　"
                f"基准每档投入 {self.cap_a:,.0f}　杠杆每档投入 {self.cap_b:,.0f}")
        ttk.Label(top, text=info, foreground="#444").pack(
            anchor="w", padx=18, pady=(10, 2))

        pick = ttk.LabelFrame(top, text="选择要对比的资金走势曲线（可任意勾选叠加）")
        pick.pack(fill="x", padx=16, pady=(4, 6))

        grid = ttk.Frame(pick)
        grid.pack(fill="x", padx=12, pady=8)
        # 三组各占一行排列
        for i, (ckey, name, gkey, _f, color) in enumerate(CURVES):
            r, c = divmod(i, 3)
            ttk.Checkbutton(grid, text=name, variable=self.vars[ckey],
                            command=self._draw_chart).grid(
                row=r, column=c, sticky="w", padx=(0, 24), pady=3)
        ttk.Checkbutton(grid, text="对数坐标", variable=self.var_log,
                        command=self._draw_chart).grid(
            row=0, column=3, rowspan=3, sticky="w", padx=(20, 0))

        # 先把「最终资金对比」固定在窗口底部，保证任何窗口高度下都完整可见
        # （否则图表 expand 会把它挤出可视区域）。
        res = ttk.LabelFrame(top, text="最终资金对比")
        res.pack(side="bottom", fill="x", padx=16, pady=(6, 12))
        self.summary_grid = ttk.Frame(res)
        self.summary_grid.pack(fill="x", padx=12, pady=10)

        chart = ttk.LabelFrame(top, text="资金走势对比（纵轴=账户资金）")
        chart.pack(fill="both", expand=True, padx=16, pady=6)
        self.fig = Figure(figsize=(9, 4.2), dpi=100)
        self.ax = self.fig.add_subplot(111)
        self.canvas = FigureCanvasTkAgg(self.fig, master=chart)
        self.canvas.get_tk_widget().pack(fill="both", expand=True,
                                         padx=8, pady=8)
        self.canvas.mpl_connect("motion_notify_event", self._on_hover)

    # ---------- 回测 ----------
    def _run_backtests(self):
        self.results = {}
        for gkey, (csv_a, csv_b, na, nb) in GROUPS.items():
            try:
                self.results[gkey] = run_backtest(
                    smh_capital=self.cap_a, smh3_capital=self.cap_b,
                    drawdowns=DEF_DRAWDOWNS, rebounds=DEF_REBOUNDS,
                    smh_csv=_csv(csv_a), smh3_csv=_csv(csv_b),
                    start_date=self.start_date, end_date=self.end_date,
                    name_a=na, name_b=nb)
            except Exception as e:
                self.results[gkey] = {"error": str(e)}

    # ---------- 曲线 ----------
    def _draw_chart(self):
        self.ax.clear()
        self._hover_series = []   # [(name, color, xs_num, ys)]
        self._hover_cursor = None
        self._hover_annot = None
        plotted = 0
        for ckey, name, gkey, field, color in CURVES:
            if not self.vars[ckey].get():
                continue
            res = self.results.get(gkey)
            if not res or "error" in res:
                continue
            dates = res.get("equity_dates", [])
            ys = res.get(field, [])
            if not dates or not ys:
                continue
            xs = [_to_dt(d) for d in dates]
            self.ax.plot(xs, ys, lw=1.4, color=color, label=name)
            self._hover_series.append(
                (name, color, [mdates.date2num(x) for x in xs], list(ys)))
            plotted += 1

        if plotted == 0:
            self.ax.set_title("请至少勾选一条曲线")
            self.canvas.draw()
            return

        self.ax.set_title("账户资金走势对比")
        self.ax.set_ylabel("账户资金")
        if self.var_log.get():
            self.ax.set_yscale("log")
        self.ax.grid(True, which="both", alpha=0.3)
        self.ax.legend(loc="upper left")
        self.fig.autofmt_xdate()

        # 悬停竖线游标 + 信息框
        self._hover_cursor = self.ax.axvline(
            x=self._hover_series[0][2][0], color="#888",
            lw=0.8, ls="--", visible=False)
        self._hover_annot = self.ax.annotate(
            "", xy=(0, 0), xycoords="data",
            xytext=(12, 12), textcoords="offset points",
            bbox=dict(boxstyle="round,pad=0.5", fc="#ffffe0",
                      ec="#999", alpha=0.95),
            fontsize=8, visible=False, zorder=20)
        self.canvas.draw()

    # ---------- 悬停显示 ----------
    def _on_hover(self, event):
        if (not getattr(self, "_hover_series", None)
                or event.inaxes != self.ax
                or event.xdata is None):
            if getattr(self, "_hover_cursor", None) is not None \
                    and self._hover_cursor.get_visible():
                self._hover_cursor.set_visible(False)
                self._hover_annot.set_visible(False)
                self.canvas.draw_idle()
            return

        xnum = event.xdata
        # 以第一条曲线的 x 轴为基准找最近日期索引
        base_xs = self._hover_series[0][2]
        idx = min(range(len(base_xs)),
                  key=lambda i: abs(base_xs[i] - xnum))
        snap_x = base_xs[idx]
        cur_date = mdates.num2date(snap_x).strftime("%Y-%m-%d")

        lines = [cur_date]
        for name, color, xs, ys in self._hover_series:
            j = min(range(len(xs)), key=lambda i: abs(xs[i] - snap_x))
            lines.append(f"{name}: {ys[j]:,.0f}")
        text = "\n".join(lines)

        self._hover_cursor.set_xdata([snap_x, snap_x])
        self._hover_cursor.set_visible(True)
        self._hover_annot.xy = (snap_x, event.ydata)
        self._hover_annot.set_text(text)
        self._hover_annot.set_visible(True)
        self.canvas.draw_idle()

    # ---------- 最终资金汇总 ----------
    def _fill_summary(self):
        for w in self.summary_grid.winfo_children():
            w.destroy()

        headers = ["组别", "回测区间", "动态策略", "纯持基准", "纯持杠杆", "交易次数"]
        for c, h in enumerate(headers):
            ttk.Label(self.summary_grid, text=h, font=("", 10, "bold")).grid(
                row=0, column=c, sticky="w", padx=8, pady=4)

        for r, (gkey, (csv_a, csv_b, na, nb)) in enumerate(GROUPS.items(), 1):
            res = self.results.get(gkey, {})
            if "error" in res:
                ttk.Label(self.summary_grid, text=f"{gkey} 组: {res['error']}",
                          foreground="red").grid(
                    row=r, column=0, columnspan=6, sticky="w", padx=8)
                continue
            vals = [
                f"{gkey} 组",
                f"{res['start_date']} ~ {res['end_date']}",
                f"{res['final_total']:,.0f}",
                f"{na} {res['hold_all_smh']:,.0f}",
                f"{nb} {res['hold_all_smh3']:,.0f}",
                str(len(res["trades"])),
            ]
            for c, v in enumerate(vals):
                ttk.Label(self.summary_grid, text=v).grid(
                    row=r, column=c, sticky="w", padx=8, pady=3)


def open_compare_window(master, cap_a=None, cap_b=None,
                        start_date=None, end_date=None) -> "CompareWindow":
    """供主界面调用：传入本金与统一时间区间，打开资金走势对比看板。"""
    return CompareWindow(master, cap_a=cap_a, cap_b=cap_b,
                         start_date=start_date, end_date=end_date)