#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SMH 数据分析助手 - GUI 入口

功能：
  - 提供策略参数输入表单：
      · SMH 投入资金（纯数字）
      · SOXL 投入资金（纯数字）
      ·SMH 回撤 -15% / -25% / -35% / -45% / -50% 时，
        SMH 卖出补仓至 SOXL 的百分比（纯数字，无需 % 号）
  - 校验输入、保存/恢复上次输入
  - 汇总参数并调用分析逻辑（见 analysis.py）
"""
import os
import sys
import json
import datetime
import calendar
import threading
import tkinter as tk
from tkinter import ttk, messagebox, scrolledtext

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backtest import (
    run_backtest, get_default_start_date, get_common_dates, compute_live_state)

# matplotlib 用于在 GUI 中嵌入净值曲线对比图。必须在导入后端前指定 TkAgg。
# 注意：这里只用面向对象接口（Figure + FigureCanvasTkAgg），不导入 pyplot，
# 以避免 pyplot 自建的图形管理器与 tkinter 主循环冲突导致窗口无法打开。
import matplotlib
matplotlib.use("TkAgg")
from matplotlib.figure import Figure
from matplotlib.backends.backend_tkagg import (
    FigureCanvasTkAgg, NavigationToolbar2Tk)
import matplotlib.dates as mdates

# 让 matplotlib 正常显示中文与负号（macOS 优先系统中文字体，缺失则回退）
matplotlib.rcParams["font.sans-serif"] = [
    "PingFang SC", "Arial Unicode MS", "Heiti SC", "STHeiti",
    "Microsoft YaHei", "SimHei", "sans-serif"]
matplotlib.rcParams["axes.unicode_minus"] = False

APP_TITLE = "SMH 数据分析助手"
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LAST_INPUT_FILE =os.path.join(BASE_DIR, "last_input.json")

# 主题色
PRIMARY = "#1F6FEB"
PRIMARY_HOVER = "#1A5FCC"

# 回撤档位（用于动态生成补仓百分比输入框）
DRAWDOWN_LEVELS = [15, 25, 35, 45, 50]

# 从底部反弹（上涨）档位（用于动态生成 卖出杠杆端减仓百分比输入框）
REBOUND_LEVELS = [50, 100, 200]

# 回测优化得到的推荐比例（虚化显示在输入框右侧，供参考）
# SMH/SOXL 最近 10 年窗口收益最大化：回撤 -25% 换 35% 到 SOXL，
# 再跌到 -35% 把剩余 SMH 全换；反弹 +200% 把 SOXL 全换回 SMH
# （详见 optimize_group_10y.py smh）
RECOMMEND_DRAWDOWNS = {15: 0, 25: 35, 35: 100, 45: 0, 50: 0}
# 减仓：反弹 +50/+100/+200% 对应 0/0/100%
RECOMMEND_REBOUNDS = {50: 0, 100: 0, 200: 100}
# 反弹基准点（trough）刷新阈值：回撤达到该百分比时锁定反弹最低点，默认 25%
DEFAULT_RESET_THRESHOLD = 25.0

# ===== 可切换数据源配置 =====
# 同一套补仓减仓模型可作用于不同标的对（低杠杆基准 A / 高杠杆标的 B）。
# GUI 顶部下拉切换数据源时，CSV 路径、界面标签、推荐值均按此表动态取值。
DATA_SOURCES = {
    "SMH": {
        "label": "SMH / SOXL（半导体·3倍）",
        "csv_a": "SMH_full_history.csv",
        "csv_b": "SOXL_full_history.csv",
        "name_a": "SMH",
        "name_b": "SOXL",
        # 最近 10 年窗口（2016-10~2026-10 共 2513 日）网格搜索收益最大化档位，
        # 由 optimize_group_10y.py smh 得出：策略末值≈1924万，
        # 远超全程SOXL(140万)/50-50(103万)/全程SMH(66万)。
        # 补仓：SMH 回撤 -25% 换 35% 到 SOXL，再跌到 -35% 把剩余 SMH 全换；
        # 减仓：SMH 自有效底部反弹 +200% 时把 SOXL 全换回 SMH。
        "recommend_dd": {15: 0, 25: 35, 35: 100, 45: 0, 50: 0},
        "recommend_rb": {50: 0, 100: 0, 200: 100},
        "reset_threshold": 25.0,
    },
    "QQQ": {
        "label": "QQQ / TQQQ（纳指100）",
        "csv_a": "QQQ_full_history.csv",
        "csv_b": "TQQQ_full_history.csv",
        "name_a": "QQQ",
        "name_b": "TQQQ",
        # 最近 10 年窗口(2016-10~2026-10)网格搜索的收益最大化档位，
        # 由 optimize_qqq_10y.py 得出：策略末值≈190万，远超全程TQQQ(127万)/50-50(76万)。
        # 补仓：QQQ 回撤 -15% 换 60% 到 TQQQ，再跌到 -35% 把剩余 QQQ 全换；
        # 减仓：QQQ 自有效底部反弹 +100% 时把 TQQQ 全换回 QQQ。
        "recommend_dd": {15: 60, 25: 0, 35: 100, 45: 0, 50: 0},
        "recommend_rb": {50: 0, 100: 100, 200: 0},
        "reset_threshold": 25.0,
    },
    "USD": {
        "label": "SMH / USD（半导体·2倍）",
        "csv_a": "SMH_full_history.csv",
        "csv_b": "USD_full_history.csv",
        "name_a": "SMH",
        "name_b": "USD",
        # 最近 10 年窗口（2016-10~2026-10 共 2512 日）网格搜索收益最大化档位，
        # 由 optimize_group_10y.py usd 得出：策略末值≈809万，
        # 远超全程USD(319万)/50-50(196万)/全程SMH(73万)。
        # 补仓：SMH 回撤 -25% 换 45% 到 USD，再跌到 -35% 把剩余 SMH 全换；
        # 减仓：SMH 自有效底部反弹 +200% 时把 USD 全换回 SMH。
        "recommend_dd": {15: 0, 25: 45, 35: 100, 45: 0, 50: 0},
        "recommend_rb": {50: 0, 100: 0, 200: 100},
        "reset_threshold": 25.0,
    },
}
DEFAULT_SOURCE = "SMH"


def load_last_input() -> dict:
    if not os.path.exists(LAST_INPUT_FILE):
        return {}
    try:
        with open(LAST_INPUT_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_last_input(data: dict):
    try:
        with open(LAST_INPUT_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"save_last_input 失败: {e}")


def parse_number(text: str, field_name: str, allow_zero: bool = True) -> float:
    """把文本解析为非负浮点数，失败抛 ValueError。"""
    text = (text or "").strip()
    if text == "":
        raise ValueError(f"“{field_name}”不能为空")
    try:
        val = float(text)
    except ValueError:
        raise ValueError(f"“{field_name}”必须是纯数字（当前：{text}）")
    if val < 0:
        raise ValueError(f"“{field_name}”不能为负数")
    if not allow_zero and val == 0:
        raise ValueError(f"“{field_name}”必须大于 0")
    return val


class SMHApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        root.title(APP_TITLE)
        root.geometry("860x680")
        root.minsize(760, 600)

        # 当前数据源（可通过顶部下拉切换 SMH↔QQQ）
        self.var_source = tk.StringVar(value=DEFAULT_SOURCE)

        # 存放各输入框的 StringVar
        self.var_smh_capital = tk.StringVar()
        self.var_smh3_capital = tk.StringVar()
        self.var_drawdowns = {lv: tk.StringVar() for lv in DRAWDOWN_LEVELS}
        self.var_rebounds = {lv: tk.StringVar() for lv in REBOUND_LEVELS}
        # 反弹最低点刷新阈值（回撤达到该 % 时锁定反弹基准点）
        self.var_reset_threshold = tk.StringVar(
            value=str(int(DEFAULT_RESET_THRESHOLD)))

        # 默认买入日期 = 日期交集首日（两标的共同起点）
        self.default_start_date = self._compute_default_start_date()
        self.var_buy_date = tk.StringVar(value=self.default_start_date)
        # 年/月/日三个下拉框对应的变量
        dy, dm, dd = self._split_date(self.default_start_date)
        self.var_year = tk.StringVar(value=str(dy))
        self.var_month = tk.StringVar(value=f"{dm:02d}")
        self.var_day = tk.StringVar(value=f"{dd:02d}")

        # 默认截止日期 = 日期交集末日（最新交易日）
        self.default_end_date = self._compute_default_end_date()
        ey, em, ed = self._split_date(self.default_end_date)
        self.var_end_year = tk.StringVar(value=str(ey))
        self.var_end_month = tk.StringVar(value=f"{em:02d}")
        self.var_end_day = tk.StringVar(value=f"{ed:02d}")

        # 输出结果（三个 output 显示框）
        self.var_out_smh = tk.StringVar(value="—")
        self.var_out_smh3 = tk.StringVar(value="—")
        self.var_out_total = tk.StringVar(value="—")
        # 两个“假设收益”对照：全程只买基准端 / 只买杠杆端，不做任何补仓减仓
        self.var_out_hold_smh = tk.StringVar(value="—")
        self.var_out_hold_smh3 = tk.StringVar(value="—")

        self._build_style()
        self._build_widgets()
        self._restore_last_input()
        self._refresh_status_labels()

    def _compute_default_start_date(self) -> str:
        """默认买入日期 = 日期交集首日；失败回退固定值。"""
        try:
            return get_default_start_date(self._csv_a(), self._csv_b())
        except Exception:
            return "2021-12-14"

    def _compute_default_end_date(self) -> str:
        """默认截止日期 = 日期交集末日（最新交易日）；失败回退今天。"""
        try:
            return get_common_dates(self._csv_a(), self._csv_b())[-1]
        except Exception:
            return datetime.date.today().strftime("%Y-%m-%d")

    # ===== 数据源辅助 =====
    def _ds(self) -> dict:
        """返回当前选中数据源的配置字典。"""
        return DATA_SOURCES.get(
            self.var_source.get(), DATA_SOURCES[DEFAULT_SOURCE])

    def _csv_a(self) -> str:
        """当前数据源基准标的（A）CSV 绝对路径。"""
        return os.path.join(BASE_DIR, "Input", self._ds()["csv_a"])

    def _csv_b(self) -> str:
        """当前数据源杠杆标的（B）CSV 绝对路径。"""
        return os.path.join(BASE_DIR, "Input", self._ds()["csv_b"])

    def _name_a(self) -> str:
        """当前数据源基准标的显示名（如 SMH / QQQ）。"""
        return self._ds()["name_a"]

    def _name_b(self) -> str:
        """当前数据源杠杆标的显示名（如 SOXL / TQQQ）。"""
        return self._ds()["name_b"]

    @staticmethod
    def _split_date(date_str: str):
        """把 YYYY-MM-DD 拆成 (year, month, day) 整数元组。"""
        try:
            y, m, d = (int(x) for x in date_str.split("-"))
            return y, m, d
        except Exception:
            t = datetime.date.today()
            return t.year, t.month, t.day

    def _year_range(self):
        """依据历史数据日期交集确定可选年份范围；失败则用默认年附近。"""
        try:
            common = get_common_dates(self._csv_a(), self._csv_b())
            y0 = int(common[0][:4])
            y1 = int(common[-1][:4])
            return list(range(y0, y1 + 1))
        except Exception:
            base = self._split_date(self.default_start_date)[0]
            return list(range(base, base + 6))

    def _build_style(self):
        style = ttk.Style()
        try:
            style.theme_use("clam")
        except Exception:
            pass
        style.configure("Primary.TButton", foreground="white",
                        background=PRIMARY, padding=8,
                        font=("Helvetica", 12, "bold"))
        style.map("Primary.TButton", background=[("active", PRIMARY_HOVER)])
        style.configure("TLabel", font=("Helvetica", 12))
        style.configure("Header.TLabel", font=("Helvetica", 16, "bold"))
        style.configure("Sub.TLabel", font=("Helvetica", 11), foreground="#666")
        # 虚化推荐提示：浅灰斜体，弱化视觉存在感
        style.configure("Hint.TLabel", font=("Helvetica", 10, "italic"),
                        foreground="#777777")
        # 顶部状态标签：跌幅用深红、涨幅用深绿，醒目易读
        style.configure("StatusDd.TLabel", font=("Helvetica", 11),
                        foreground="#C62828")
        style.configure("StatusRb.TLabel", font=("Helvetica", 11),
                        foreground="#2E7D32")
        style.configure("TEntry", padding=4)

    def _build_widgets(self):
        # ===== 底部固定区（按钮 + 计算结果 + 状态栏）先打包，保证始终可见 =====
        # 状态栏（最底）
        self.status = tk.StringVar(value="就绪")
        ttk.Label(self.root, textvariable=self.status,
                  relief="sunken", anchor="w").pack(fill="x", side="bottom")

        # 计算结果输出区（三个只读框，固定在状态栏之上）
        output_frame = ttk.LabelFrame(self.root, text="计算结果")
        output_frame.pack(fill="x", padx=16, pady=(0, 8), side="bottom")
        out_grid = ttk.Frame(output_frame)
        out_grid.pack(fill="x", padx=12, pady=10)
        out_grid.columnconfigure(1, weight=1)
        out_specs = [
            (f"最终 {self._name_a()} 的资金：", self.var_out_smh),
            (f"最终 {self._name_b()} 的资金：", self.var_out_smh3),
            (f"最终总资金（{self._name_a()} + {self._name_b()}）：", self.var_out_total),
            (f"假设全买 {self._name_a()}（不操作）：", self.var_out_hold_smh),
            (f"假设全买 {self._name_b()}（不操作）：", self.var_out_hold_smh3),
        ]
        self.lbl_out = []
        for i, (label, var) in enumerate(out_specs):
            lb = ttk.Label(out_grid, text=label)
            lb.grid(row=i, column=0, sticky="w", pady=5)
            self.lbl_out.append(lb)
            ttk.Entry(out_grid, textvariable=var, width=28,
                      state="readonly").grid(row=i, column=1, sticky="w", pady=5)

        # 按钮区（固定在计算结果之上）
        btn_frame = ttk.Frame(self.root)
        btn_frame.pack(fill="x", padx=16, pady=6, side="bottom")
        self.analyze_btn = ttk.Button(
            btn_frame, text="开始分析", style="Primary.TButton",
            command=self.on_analyze)
        self.analyze_btn.pack(side="left", padx=(0, 8))
        ttk.Button(btn_frame, text="重置参数",
                   command=self.on_reset_recommend).pack(side="left", padx=8)
        ttk.Button(btn_frame, text="清空",
                   command=self.on_clear).pack(side="left", padx=8)

        # ===== 可滚动主区域（标题 + 参数输入 + 分析结果），填充剩余空间 =====
        outer = ttk.Frame(self.root)
        outer.pack(fill="both", expand=True, side="top")
        canvas = tk.Canvas(outer, highlightthickness=0)
        vbar = ttk.Scrollbar(outer, orient="vertical", command=canvas.yview)
        canvas.configure(yscrollcommand=vbar.set)
        vbar.pack(side="right", fill="y")
        canvas.pack(side="left", fill="both", expand=True)

        body = ttk.Frame(canvas)
        body_id = canvas.create_window((0, 0), window=body, anchor="nw")
        body.bind("<Configure>",
                  lambda e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.bind("<Configure>",
                    lambda e: canvas.itemconfigure(body_id, width=e.width))

        def _on_wheel(event):
            if event.delta:
                canvas.yview_scroll(int(-1 * (event.delta / abs(event.delta))),
                                    "units")
        canvas.bind_all("<MouseWheel>", _on_wheel)

        # 标题
        header = ttk.Label(body, text=APP_TITLE, style="Header.TLabel")
        header.pack(pady=(16, 2))
        ttk.Label(body, text="配置补仓策略参数，点击“开始分析”生成结果",
                  style="Sub.TLabel").pack(pady=(0, 8))

        # ===== 数据源选择区 =====
        source_frame = ttk.LabelFrame(body, text="数据源（标的对）")
        source_frame.pack(fill="x", padx=16, pady=(0, 4))
        src_row = ttk.Frame(source_frame)
        src_row.pack(fill="x", padx=12, pady=10)
        ttk.Label(src_row, text="选择数据源：").pack(side="left")
        cb_source = ttk.Combobox(
            src_row, textvariable=self.var_source,
            values=[DATA_SOURCES[k]["label"] for k in DATA_SOURCES],
            width=24, state="readonly")
        # Combobox 显示 label，但 var_source 存 key，需做映射
        self._source_labels = {DATA_SOURCES[k]["label"]: k for k in DATA_SOURCES}
        cb_source.set(self._ds()["label"])
        cb_source.pack(side="left", padx=(4, 0))
        cb_source.bind("<<ComboboxSelected>>",
                       lambda e: self.on_source_change(cb_source.get()))
        ttk.Label(src_row,
                  text="（切换后自动重置日期、推荐值与标的名）",
                  style="Sub.TLabel").pack(side="left", padx=(8, 0))
        ttk.Button(src_row, text="📊 标的对比看板",
                   command=self.open_compare).pack(side="right")
        ttk.Button(src_row, text="🔄 更新数据",
                   command=self.update_data).pack(side="right", padx=(0, 8))

        # ===== 参数输入区 =====
        input_frame = ttk.LabelFrame(body, text="策略参数输入")
        input_frame.pack(fill="x", padx=16, pady=8)

        # 用 grid 布局对齐 label + entry
        grid = ttk.Frame(input_frame)
        grid.pack(fill="x", padx=12, pady=12)
        grid.columnconfigure(1, weight=1)

        row = 0
        # 买入日期（初始资金买入的时间节点）
        ttk.Label(grid, text="买入日期：").grid(
            row=row, column=0, sticky="w", pady=4)
        self._build_date_picker(grid, row)
        ttk.Label(grid, text="（初始资金买入时点，默认起始交易日）",
                  style="Sub.TLabel").grid(
            row=row, column=2, sticky="w", padx=8)
        row += 1

        # 截止日期（回测计算区间的结束时间节点）
        ttk.Label(grid, text="截止日期：").grid(
            row=row, column=0, sticky="w", pady=4)
        self._build_date_picker(
            grid, row, self.var_end_year, self.var_end_month,
            self.var_end_day, which="end")
        ttk.Label(grid, text="（回测计算截止时点，默认最新交易日）",
                  style="Sub.TLabel").grid(
            row=row, column=2, sticky="w", padx=8)
        row += 1

        # A 标的（基准）投入资金
        self.lbl_cap_a = ttk.Label(
            grid, text=f"{self._name_a()} 投入资金：")
        self.lbl_cap_a.grid(row=row, column=0, sticky="w", pady=4)
        ttk.Entry(grid, textvariable=self.var_smh_capital,
                  width=18).grid(row=row, column=1, sticky="w", pady=4)
        row += 1

        # B 标的（杠杆）投入资金
        self.lbl_cap_b = ttk.Label(
            grid, text=f"{self._name_b()} 投入资金：")
        self.lbl_cap_b.grid(row=row, column=0, sticky="w", pady=4)
        ttk.Entry(grid, textvariable=self.var_smh3_capital,
                  width=18).grid(row=row, column=1, sticky="w", pady=4)
        row += 1

        # 分隔线
        ttk.Separator(grid, orient="horizontal").grid(
            row=row, column=0, columnspan=3, sticky="ew", pady=6)
        row += 1

        # 回撤补仓标题（卖 A 买 B，输入 %）+ 计算触发价按钮
        dd_title_row = ttk.Frame(grid)
        dd_title_row.grid(
            row=row, column=0, columnspan=3, sticky="ew", pady=(0, 2))
        self.lbl_dd_title = ttk.Label(
            dd_title_row,
            text=f"回撤补仓（卖 {self._name_a()} 买 {self._name_b()}，填百分比）",
            style="Sub.TLabel")
        self.lbl_dd_title.pack(side="left")
        ttk.Button(dd_title_row, text="计算触发价",
                   command=self._calc_dd_prices).pack(side="right")
        row += 1

        # 补仓模块顶部：当前价较历史最高点的跌幅（上涨空间则 0%）
        self.lbl_dd_status = ttk.Label(grid, text="", style="StatusDd.TLabel")
        self.lbl_dd_status.grid(
            row=row, column=0, columnspan=3, sticky="w", pady=(0, 4))
        row += 1

        # 各回撤档位补仓百分比
        self.lbl_recommend_dd = {}
        for lv in DRAWDOWN_LEVELS:
            ttk.Label(grid, text=f"回撤 -{lv}%：").grid(
                row=row, column=0, sticky="w", pady=3)
            ttk.Entry(grid, textvariable=self.var_drawdowns[lv],
                      width=18).grid(row=row, column=1, sticky="w", pady=3)
            hint = ttk.Label(
                grid, text=f"推荐 {self._ds()['recommend_dd'][lv]}%",
                style="Hint.TLabel")
            hint.grid(row=row, column=2, sticky="w", padx=(8, 0), pady=3)
            self.lbl_recommend_dd[lv] = hint
            row += 1

        # 分隔线（回撤补仓 与 反弹减仓 之间）
        ttk.Separator(grid, orient="horizontal").grid(
            row=row, column=0, columnspan=3, sticky="ew", pady=6)
        row += 1

        # 反弹减仓标题（卖 B 买 A，输入 %）+ 计算触发价按钮
        rb_title_row = ttk.Frame(grid)
        rb_title_row.grid(
            row=row, column=0, columnspan=3, sticky="ew", pady=(0, 2))
        self.lbl_rb_title = ttk.Label(
            rb_title_row,
            text=f"反弹减仓（卖 {self._name_b()} 买 {self._name_a()}，填百分比）",
            style="Sub.TLabel")
        self.lbl_rb_title.pack(side="left")
        ttk.Button(rb_title_row, text="计算触发价",
                   command=self._calc_rb_prices).pack(side="right")
        row += 1

        # 减仓模块顶部：当前价较历史底部（有效底部）的涨幅（下跌空间则 0%）
        self.lbl_rb_status = ttk.Label(grid, text="", style="StatusRb.TLabel")
        self.lbl_rb_status.grid(
            row=row, column=0, columnspan=3, sticky="w", pady=(0, 4))
        row += 1

        # 各反弹档位卖出 B 减仓百分比
        self.lbl_recommend_rb = {}
        for lv in REBOUND_LEVELS:
            ttk.Label(grid, text=f"反弹 +{lv}%：").grid(
                row=row, column=0, sticky="w", pady=3)
            ttk.Entry(grid, textvariable=self.var_rebounds[lv],
                      width=18).grid(row=row, column=1, sticky="w", pady=3)
            hint = ttk.Label(
                grid, text=f"推荐 {self._ds()['recommend_rb'][lv]}%",
                style="Hint.TLabel")
            hint.grid(row=row, column=2, sticky="w", padx=(8, 0), pady=3)
            self.lbl_recommend_rb[lv] = hint
            row += 1

        # 注：反弹基准点刷新阈值固定使用默认值 DEFAULT_RESET_THRESHOLD，
        # 不在 GUI 上暴露输入框（按需求隐藏“反弹最低点(%)”）。

        # ===== 分析结果文本区（挂在可滚动 body 上）=====
        result_frame = ttk.LabelFrame(body, text="分析结果")
        result_frame.pack(fill="both", expand=True, padx=16, pady=8)

        self.result_text = scrolledtext.ScrolledText(
            result_frame, height=12, font=("Menlo", 12),
            wrap="word", state="disabled")
        self.result_text.pack(fill="both", expand=True, padx=8, pady=8)

        # ===== 净值曲线对比图（挂在可滚动 body 上）=====
        chart_frame = ttk.LabelFrame(body, text="净值曲线对比图")
        chart_frame.pack(fill="both", expand=True, padx=16, pady=8)

        self.fig = Figure(figsize=(9, 4.5), dpi=100)
        self.ax = self.fig.add_subplot(111)
        self.ax.set_title("净值曲线（点击“开始分析”后生成）")
        self.chart_canvas = FigureCanvasTkAgg(self.fig, master=chart_frame)
        self.chart_canvas.get_tk_widget().pack(
            fill="both", expand=True, padx=8, pady=(8, 0))
        self.chart_canvas.mpl_connect(
            "motion_notify_event", self._on_chart_hover)
        toolbar = NavigationToolbar2Tk(self.chart_canvas, chart_frame)
        toolbar.update()
        self.chart_canvas.get_tk_widget().pack(fill="both", expand=True)

    # ===== 事件 =====
    def open_compare(self):
        """打开标的对比看板窗口：沿用主界面当前的本金与起止日期，两组同区间回测。"""
        try:
            from compare import open_compare_window, DEF_CAPITAL

            def _parse_cap(raw: str) -> float:
                # 资金可为 0；空白或非法一律按 0 处理
                try:
                    return float((raw or "").replace(",", "").strip() or "0")
                except Exception:
                    return 0.0

            cap_a = _parse_cap(self.var_smh_capital.get())
            cap_b = _parse_cap(self.var_smh3_capital.get())
            open_compare_window(
                self.root,
                cap_a=cap_a,
                cap_b=cap_b,
                start_date=self._get_buy_date(),
                end_date=self._get_end_date(),
            )
        except Exception as e:
            messagebox.showerror("对比看板打开失败", str(e))

    def update_data(self):
        """点击后按源数据获取方式刷新五标的（QQQ/TQQQ/SMH/SOXL/USD）最新 CSV 到 Input。"""
        win = tk.Toplevel(self.root)
        win.title("更新数据")
        win.geometry("560x420")
        ttk.Label(win, text="正在从数据源抓取最新行情，请稍候……",
                  font=("", 11, "bold")).pack(anchor="w", padx=14, pady=(12, 4))
        box = scrolledtext.ScrolledText(win, height=18, wrap="word")
        box.pack(fill="both", expand=True, padx=14, pady=8)
        btn = ttk.Button(win, text="关闭", command=win.destroy, state="disabled")
        btn.pack(pady=(0, 12))

        def log(msg):
            self.root.after(0, lambda: (box.insert("end", msg + "\n"),
                                        box.see("end")))

        def worker():
            try:
                from update_data import update_all
                results = update_all(log=log)
                lines = ["", "=== 更新完成 ==="]
                for sym, (ok, skipped, n, a, b) in results.items():
                    if skipped:
                        state = "已最新(跳过)"
                    elif ok:
                        state = "已更新"
                    else:
                        state = "失败"
                    lines.append(f"{sym}: {state} "
                                 f"{n} 条 {a or '-'} ~ {b or '-'}")
                for ln in lines:
                    log(ln)
            except Exception as e:
                log(f"\n更新出错：{e}")
            finally:
                self.root.after(
                    0, lambda: (btn.config(state="normal"),
                                self._refresh_status_labels()))

        threading.Thread(target=worker, daemon=True).start()

    def _fill_recommend_values(self):
        """把当前数据源的推荐补仓/减仓档位自动填入输入框。"""
        ds = self._ds()
        for lv in DRAWDOWN_LEVELS:
            self.var_drawdowns[lv].set(str(ds["recommend_dd"][lv]))
        for lv in REBOUND_LEVELS:
            self.var_rebounds[lv].set(str(ds["recommend_rb"][lv]))

    def _refresh_status_labels(self):
        """刷新补仓/减仓模块顶部的跌幅/涨幅状态标签（自动）。

        补仓顶部：当前价较历史最高点(peak)的跌幅，创新高则 0%；
        减仓顶部：当前价较有效底部(active_trough)的涨幅，处于底部则 0%。
        数据不可用时清空标签。
        """
        try:
            state = compute_live_state(self._csv_a(), self._csv_b())
        except Exception:
            self.lbl_dd_status.config(text="")
            self.lbl_rb_status.config(text="")
            return
        latest = state["latest_price"]
        peak = state["peak"]
        trough = state["active_trough"]
        date = state["latest_date"]

        # 补仓：较最高点跌幅（上涨空间/创新高 → 0%）
        if latest >= peak:
            dd_text = (f"截至 {date}：当前 ${latest:.2f} 创新高"
                       f"（{state['peak_date']}），跌幅 0%")
        else:
            dd_pct = (peak - latest) / peak * 100.0
            dd_text = (f"截至 {date}：当前 ${latest:.2f}，"
                       f"较最高点 ${peak:.2f}（{state['peak_date']}）"
                       f"跌幅 {dd_pct:.2f}%")
        self.lbl_dd_status.config(text=dd_text)

        # 减仓：较有效底部涨幅（下跌空间/处于底部 → 0%）
        if trough is None or latest <= trough:
            rb_text = (f"截至 {date}：当前 ${latest:.2f} 处于底部"
                       f"（{state['trough_date']}），涨幅 0%")
        else:
            rb_pct = (latest - trough) / trough * 100.0
            rb_text = (f"截至 {date}：当前 ${latest:.2f}，"
                       f"较底部 ${trough:.2f}（{state['trough_date']}）"
                       f"涨幅 {rb_pct:.2f}%")
        self.lbl_rb_status.config(text=rb_text)

    def _calc_dd_prices(self):
        """点击按钮：计算各回撤档位触发价，显示在输入框旁。

        触发价 = 当前 peak × (1 - 档位/100)，即"跌到多少元触发补仓"。
        输入框有值时显示用户输入的百分比，空值回退推荐值。
        """
        try:
            state = compute_live_state(self._csv_a(), self._csv_b())
        except Exception:
            return
        dd_prices = state["dd_trigger_prices"]
        rec_dd = self._ds()["recommend_dd"]
        for lv, lbl in self.lbl_recommend_dd.items():
            p = dd_prices.get(lv)
            if p is None:
                lbl.config(text=f"推荐 {rec_dd[lv]}%")
                continue
            raw = self.var_drawdowns[lv].get().strip()
            if raw:
                lbl.config(text=f"{raw}%｜跌到 ${p:.2f} 补仓")
            else:
                lbl.config(text=f"推荐 {rec_dd[lv]}%｜跌到 ${p:.2f} 补仓")

    def _calc_rb_prices(self):
        """点击按钮：计算各反弹档位触发价，显示在输入框旁。

        触发价 = 当前有效底部 × (1 + 档位/100)，即"涨到多少元触发减仓"。
        输入框有值时显示用户输入的百分比，空值回退推荐值。
        """
        try:
            state = compute_live_state(self._csv_a(), self._csv_b())
        except Exception:
            return
        rb_prices = state["rb_trigger_prices"]
        rec_rb = self._ds()["recommend_rb"]
        for lv, lbl in self.lbl_recommend_rb.items():
            p = rb_prices.get(lv)
            if p is None:
                lbl.config(text=f"推荐 {rec_rb[lv]}%")
                continue
            raw = self.var_rebounds[lv].get().strip()
            if raw:
                lbl.config(text=f"{raw}%｜涨到 ${p:.2f} 减仓")
            else:
                lbl.config(text=f"推荐 {rec_rb[lv]}%｜涨到 ${p:.2f} 减仓")

    def on_source_change(self, label: str):
        """切换数据源：更新 key、重置日期/年份范围/推荐值/标的名标签。"""
        key = self._source_labels.get(label, DEFAULT_SOURCE)
        if key == self.var_source.get():
            return
        self.var_source.set(key)

        # 重新计算该数据源的默认日期与年份范围
        self.default_start_date = self._compute_default_start_date()
        self.default_end_date = self._compute_default_end_date()

        # 刷新年份下拉可选值（买入/截止两个日期选择器）
        years = [str(y) for y in self._year_range()]
        for cb in (getattr(self, "cb_year", None),
                   getattr(self, "cb_end_year", None)):
            if cb is not None:
                cb["values"] = years

        # 日期重置到新数据源的交集首/末日
        self._set_buy_date(self.default_start_date)
        self._set_end_date(self.default_end_date)

        # 更新标的名相关标签
        self.lbl_cap_a.config(text=f"{self._name_a()} 投入资金：")
        self.lbl_cap_b.config(text=f"{self._name_b()} 投入资金：")
        self.lbl_dd_title.config(
            text=f"回撤补仓（卖 {self._name_a()} 买 {self._name_b()}，填百分比）")
        self.lbl_rb_title.config(
            text=f"反弹减仓（卖 {self._name_b()} 买 {self._name_a()}，填百分比）")

        # 更新推荐值提示
        for lv, lbl in self.lbl_recommend_dd.items():
            lbl.config(text=f"推荐 {self._ds()['recommend_dd'][lv]}%")
        for lv, lbl in self.lbl_recommend_rb.items():
            lbl.config(text=f"推荐 {self._ds()['recommend_rb'][lv]}%")

        # 切换数据源后，把该源的推荐档位自动填入补仓/减仓输入框
        self._fill_recommend_values()
        # 刷新顶部跌幅/涨幅状态标签
        self._refresh_status_labels()

        # 更新计算结果区标签
        out_labels = [
            f"最终 {self._name_a()} 的资金：",
            f"最终 {self._name_b()} 的资金：",
            f"最终总资金（{self._name_a()} + {self._name_b()}）：",
            f"假设全买 {self._name_a()}（不操作）：",
            f"假设全买 {self._name_b()}（不操作）：",
        ]
        for lb, txt in zip(getattr(self, "lbl_out", []), out_labels):
            lb.config(text=txt)

        # 清空上一数据源残留的资金/结果，避免混淆
        self.var_smh_capital.set("")
        self.var_smh3_capital.set("")
        self.var_out_smh.set("—")
        self.var_out_smh3.set("—")
        self.var_out_total.set("—")
        self.var_out_hold_smh.set("—")
        self.var_out_hold_smh3.set("—")
        self._set_result("")
        self.ax.clear()
        self.ax.set_title("净值曲线（点击“开始分析”后生成）")
        self.chart_canvas.draw()
        self.status.set(f"已切换数据源：{self._ds()['label']}")

    def collect_params(self) -> dict:
        """读取并校验所有输入，返回参数字典；校验失败抛 ValueError。"""
        smh_capital = parse_number(
            self.var_smh_capital.get(), f"{self._name_a()} 的投入资金", allow_zero=False)
        smh3_capital = parse_number(
            self.var_smh3_capital.get(), f"{self._name_b()} 的投入资金", allow_zero=False)

        drawdowns = {}
        for lv in DRAWDOWN_LEVELS:
            pct = parse_number(
                self.var_drawdowns[lv].get(),
                f"{self._name_a()} 回撤 -{lv}% 的补仓百分比", allow_zero=True)
            if pct > 100:
                raise ValueError(
                    f"“{self._name_a()} 回撤 -{lv}% 的补仓百分比”不能大于 100")
            drawdowns[lv] = pct

        rebounds = {}
        for lv in REBOUND_LEVELS:
            pct = parse_number(
                self.var_rebounds[lv].get(),
                f"{self._name_a()} 从底部上涨 +{lv}% 的减仓百分比", allow_zero=True)
            if pct > 100:
                raise ValueError(
                    f"“{self._name_a()} 从底部上涨 +{lv}% 的减仓百分比”不能大于 100")
            rebounds[lv] = pct

        reset_threshold = parse_number(
            self.var_reset_threshold.get(),
            "反弹最低点(%)", allow_zero=False)
        if reset_threshold <= 0 or reset_threshold > 100:
            raise ValueError("“反弹最低点(%)”需在 0~100 之间")

        return {
            "smh_capital": smh_capital,
            "smh3_capital": smh3_capital,
            "drawdowns": drawdowns,
            "rebounds": rebounds,
            "reset_threshold": reset_threshold,
            "buy_date": self._get_buy_date(),
            "end_date": self._get_end_date(),
        }

    def on_analyze(self):
        try:
            params = self.collect_params()
        except ValueError as e:
            messagebox.showwarning(APP_TITLE, str(e))
            self.status.set("输入有误")
            return

        self.status.set("分析中...")
        self.root.update_idletasks()

        # 调用回测引擎（CSV 路径按当前数据源动态取值）
        smh_csv = self._csv_a()
        smh3_csv = self._csv_b()
        if not os.path.exists(smh_csv) or not os.path.exists(smh3_csv):
            messagebox.showerror(
                APP_TITLE,
                f"缺少历史数据文件，请确认 Input/ 下存在 "
                f"{self._ds()['csv_a']} 与 {self._ds()['csv_b']}")
            self.status.set("缺少数据文件")
            return

        try:
            result = run_backtest(
                params["smh_capital"], params["smh3_capital"],
                params["drawdowns"], params["rebounds"],
                smh_csv, smh3_csv,
                start_date=params["buy_date"],
                end_date=params["end_date"],
                reset_threshold=params["reset_threshold"],
                name_a=self._name_a(), name_b=self._name_b())
        except Exception as e:
            messagebox.showerror(APP_TITLE, f"回测失败：{e}")
            self.status.set("回测失败")
            return

        # 填充计算结果输出框
        self.var_out_smh.set(f"{result['final_smh']:.2f}")
        self.var_out_smh3.set(f"{result['final_smh3']:.2f}")
        self.var_out_total.set(f"{result['final_total']:.2f}")
        self.var_out_hold_smh.set(f"{result['hold_all_smh']:.2f}")
        self.var_out_hold_smh3.set(f"{result['hold_all_smh3']:.2f}")

        # 生成结果摘要
        init_total = params["smh_capital"] + params["smh3_capital"]
        # 所选日期与实际买入交易日（非交易日已顺延至下一交易日）
        actual_buy = result["start_date"]
        if actual_buy == params["buy_date"]:
            buy_line = f"买入日期 ： {params['buy_date']}（交易日）"
        else:
            buy_line = (f"买入日期 ： {params['buy_date']}"
                        f"（非交易日，顺延至 {actual_buy}）")
        # 截止日期（非交易日已向前取最近交易日）
        actual_end = result["end_date"]
        if actual_end == params["end_date"]:
            end_line = f"截止日期 ： {params['end_date']}（交易日）"
        else:
            end_line = (f"截止日期 ： {params['end_date']}"
                        f"（非交易日，向前取 {actual_end}）")
        lines = [
            "===== 策略参数摘要 =====",
            buy_line,
            end_line,
            f"{self._name_a()} 投入资金 ： {params['smh_capital']:.2f}",
            f"{self._name_b()} 投入资金： {params['smh3_capital']:.2f}",
            f"合计投入资金 ： {init_total:.2f}",
            "",
            f"反弹最低点阈值： 回撤 -{params['reset_threshold']:.2f}% 锁定反弹基准点",
            "",
            f"----- 各回撤档位补仓比例（卖 {self._name_a()} 买 {self._name_b()}）-----",
        ]
        for lv in DRAWDOWN_LEVELS:
            lines.append(
                f"{self._name_a()} 回撤 -{lv}%： {params['drawdowns'][lv]:.2f}%")
        lines.append("")
        lines.append(f"----- 各反弹档位减仓比例（卖 {self._name_b()} 买 {self._name_a()}）-----")
        for lv in REBOUND_LEVELS:
            lines.append(
                f"{self._name_a()} 从底部上涨 +{lv}%： {params['rebounds'][lv]:.2f}%")

        gain = result["final_total"] - init_total
        gain_pct = (gain / init_total * 100.0) if init_total else 0.0
        hold_smh_gain = result["hold_all_smh"] - init_total
        hold_smh_pct = (hold_smh_gain / init_total * 100.0) if init_total else 0.0
        hold_smh3_gain = result["hold_all_smh3"] - init_total
        hold_smh3_pct = (hold_smh3_gain / init_total * 100.0) if init_total else 0.0
        lines += [
            "",
            "===== 回测结果 =====",
            f"回测区间   ： {result['start_date']} ~ {result['end_date']}",
            f"最终 {self._name_a()} 资金 ： {result['final_smh']:.2f}",
            f"最终 {self._name_b()} 资金： {result['final_smh3']:.2f}",
            f"最终总资金    ： {result['final_total']:.2f}",
            f"总盈亏        ： {gain:+.2f}（{gain_pct:+.2f}%）",
            "",
            "----- 假设收益对照（合并初始资金、不做任何补仓减仓）-----",
            f"假设全买 {self._name_a()} ： {result['hold_all_smh']:.2f}"
            f"（{hold_smh_gain:+.2f}／{hold_smh_pct:+.2f}%）",
            f"假设全买 {self._name_b()}： {result['hold_all_smh3']:.2f}"
            f"（{hold_smh3_gain:+.2f}／{hold_smh3_pct:+.2f}%）",
            "",
            f"交易次数      ： {len(result['trades'])}",
        ]
        if result["trades"]:
            lines.append("")
            lines.append("----- 交易明细 -----")
            for d, action, detail, price_a, price_b in result["trades"]:
                lines.append(
                    f"[{d}] {action}｜{detail}"
                    f"｜成交价 {self._name_a()} {price_a:.2f} / "
                    f"{self._name_b()} {price_b:.2f}")

        # 模型认定的底部（反弹基准点 trough）及其日期
        troughs = result.get("troughs", [])
        if troughs:
            lines.append("")
            lines.append("----- 模型认定的底部（反弹基准点）-----")
            for d, price, note in troughs:
                lines.append(f"[{d}] {self._name_a()} 价 {price:.2f}｜{note}")

        self._set_result("\n".join(lines))
        self._draw_equity_chart(result)
        self._save_current_input()
        self.status.set("分析完成")

    def on_reset_recommend(self):
        """重置补仓/减仓档位为当前数据源的推荐参数。"""
        self._fill_recommend_values()
        self.status.set("已重置参数")

    def on_clear(self):
        self.var_smh_capital.set("")
        self.var_smh3_capital.set("")
        for lv in DRAWDOWN_LEVELS:
            self.var_drawdowns[lv].set("")
        for lv in REBOUND_LEVELS:
            self.var_rebounds[lv].set("")
        self._set_buy_date(self.default_start_date)
        self._set_end_date(self.default_end_date)
        self.var_reset_threshold.set(str(int(DEFAULT_RESET_THRESHOLD)))
        self.var_out_smh.set("")
        self.var_out_smh3.set("")
        self.var_out_total.set("")
        self.var_out_hold_smh.set("")
        self.var_out_hold_smh3.set("")
        self._set_result("")
        self.ax.clear()
        self.ax.set_title("净值曲线（点击“开始分析”后生成）")
        self.chart_canvas.draw()
        self.status.set("已清空")

    # ===== 工具 =====
    def _build_date_picker(self, parent, row, var_year=None,
                           var_month=None, var_day=None, which="start"):
        """在 parent 的 (row, 1) 放置年/月/日三个下拉框，方便选择日期。"""
        if var_year is None:
            var_year, var_month, var_day = (
                self.var_year, self.var_month, self.var_day)

        holder = ttk.Frame(parent)
        holder.grid(row=row, column=1, sticky="w", pady=4)

        years = [str(y) for y in self._year_range()]
        cb_year = ttk.Combobox(holder, textvariable=var_year,
                               values=years, width=6, state="readonly")
        cb_year.pack(side="left")
        ttk.Label(holder, text="年").pack(side="left", padx=(2, 6))

        months = [f"{m:02d}" for m in range(1, 13)]
        cb_month = ttk.Combobox(holder, textvariable=var_month,
                                values=months, width=4, state="readonly")
        cb_month.pack(side="left")
        ttk.Label(holder, text="月").pack(side="left", padx=(2, 6))

        cb_day = ttk.Combobox(holder, textvariable=var_day,
                              width=4, state="readonly")
        cb_day.pack(side="left")
        ttk.Label(holder, text="日").pack(side="left", padx=(2, 0))

        if which == "end":
            self.cb_end_day = cb_day
        else:
            self.cb_day = cb_day

        # 保存年份下拉引用，供切换数据源时刷新可选年份
        if which == "end":
            self.cb_end_year = cb_year
        else:
            self.cb_year = cb_year
        # 年/月变化时刷新“日”的可选范围（处理大小月与闰年）
        handler = (lambda e=None: self._refresh_day_choices(which=which))
        cb_year.bind("<<ComboboxSelected>>", handler)
        cb_month.bind("<<ComboboxSelected>>", handler)
        self._refresh_day_choices(which=which)

    def _refresh_day_choices(self, event=None, which="start"):
        """根据当前年/月刷新“日”下拉框的可选值，并修正超出的日。"""
        if which == "end":
            var_year, var_month, var_day = (
                self.var_end_year, self.var_end_month, self.var_end_day)
            cb_day = getattr(self, "cb_end_day", None)
        else:
            var_year, var_month, var_day = (
                self.var_year, self.var_month, self.var_day)
            cb_day = getattr(self, "cb_day", None)
        try:
            y = int(var_year.get())
            m = int(var_month.get())
        except Exception:
            return
        max_day = calendar.monthrange(y, m)[1]
        days = [f"{d:02d}" for d in range(1, max_day + 1)]
        if cb_day is not None:
            cb_day["values"] = days
        try:
            cur = int(var_day.get())
        except Exception:
            cur = 1
        if cur > max_day:
            cur = max_day
        var_day.set(f"{cur:02d}")

    def _get_buy_date(self) -> str:
        """读取当前选择的买入日期，返回 YYYY-MM-DD 字符串。"""
        try:
            y = int(self.var_year.get())
            m = int(self.var_month.get())
            d = int(self.var_day.get())
            return f"{y:04d}-{m:02d}-{d:02d}"
        except Exception:
            return self.default_start_date

    def _set_buy_date(self, date_str: str):
        """设置买入日期到年/月/日三个下拉框。"""
        y, m, d = self._split_date(
            (date_str or "").strip() or self.default_start_date)
        self.var_year.set(str(y))
        self.var_month.set(f"{m:02d}")
        self.var_day.set(f"{d:02d}")
        if getattr(self, "cb_day", None) is not None:
            self._refresh_day_choices(which="start")

    def _get_end_date(self) -> str:
        """读取当前选择的截止日期，返回 YYYY-MM-DD 字符串。"""
        try:
            y = int(self.var_end_year.get())
            m = int(self.var_end_month.get())
            d = int(self.var_end_day.get())
            return f"{y:04d}-{m:02d}-{d:02d}"
        except Exception:
            return self.default_end_date

    def _set_end_date(self, date_str: str):
        """设置截止日期到年/月/日三个下拉框。"""
        y, m, d = self._split_date(
            (date_str or "").strip() or self.default_end_date)
        self.var_end_year.set(str(y))
        self.var_end_month.set(f"{m:02d}")
        self.var_end_day.set(f"{d:02d}")
        if getattr(self, "cb_end_day", None) is not None:
            self._refresh_day_choices(which="end")

    def _draw_equity_chart(self, result: dict):
        """在下方图表区绘制净值曲线对比图。

        三条曲线：策略 / 纯持基准端 / 纯持杠杆端；
        补仓用红色上三角、减仓用绿色下三角标记；纵轴对数刻度。
        """
        from datetime import datetime

        dates_raw = result.get("equity_dates") or []
        strat = result.get("equity_strategy") or []
        hold_smh = result.get("equity_hold_smh") or []
        hold_smh3 = result.get("equity_hold_smh3") or []
        marks = result.get("trade_marks") or []

        self.ax.clear()

        if not dates_raw or not strat:
            self.ax.set_title("无数据可绘制")
            self.chart_canvas.draw()
            return

        def to_dt(s):
            try:
                return datetime.strptime(str(s)[:10], "%Y-%m-%d")
            except Exception:
                return None

        xs = [to_dt(d) for d in dates_raw]

        self.ax.plot(xs, strat, color="#1f77b4", lw=1.6, label="补仓减仓策略")
        self.ax.plot(xs, hold_smh, color="#d62728", lw=1.2,
                     label=f"纯持{self._name_a()}")
        self.ax.plot(xs, hold_smh3, color="#2ca02c", lw=1.2,
                     label=f"纯持{self._name_b()}")

        buy_x, buy_y, sell_x, sell_y = [], [], [], []
        for m in marks:
            mx = to_dt(m.get("date"))
            my = m.get("equity")
            if mx is None or my is None:
                continue
            if m.get("kind") == "补仓":
                buy_x.append(mx)
                buy_y.append(my)
            else:
                sell_x.append(mx)
                sell_y.append(my)
        if buy_x:
            self.ax.scatter(buy_x, buy_y, marker="^", s=70,
                            color="#c0392b", zorder=5, label="补仓")
        if sell_x:
            self.ax.scatter(sell_x, sell_y, marker="v", s=70,
                            color="#27ae60", zorder=5, label="减仓")

        self.ax.set_yscale("log")
        self.ax.set_title("净值曲线对比（对数坐标）")
        self.ax.set_xlabel("日期")
        self.ax.set_ylabel("账户净值（美元，对数）")
        self.ax.grid(True, which="both", ls="--", alpha=0.3)
        self.ax.legend(loc="upper left", fontsize=9)
        self.fig.autofmt_xdate()
        self.fig.tight_layout()

        # 缓存曲线用于悬停查询 + 初始化竖线游标与信息框
        self._eq_hover = {
            "xnums": [mdates.date2num(x) for x in xs if x is not None],
            "series": [
                ("补仓减仓策略", list(strat)),
                (f"纯持{self._name_a()}", list(hold_smh)),
                (f"纯持{self._name_b()}", list(hold_smh3)),
            ],
        }
        self._eq_cursor = self.ax.axvline(
            x=self._eq_hover["xnums"][0], color="#888",
            lw=0.8, ls="--", visible=False)
        self._eq_annot = self.ax.annotate(
            "", xy=(0, 0), xycoords="data",
            xytext=(12, 12), textcoords="offset points",
            bbox=dict(boxstyle="round,pad=0.5", fc="#ffffe0",
                      ec="#999", alpha=0.95),
            fontsize=8, visible=False, zorder=20)
        self.chart_canvas.draw()

    def _on_chart_hover(self, event):
        """鼠标悬停净值曲线时，显示该日期各曲线的净值。"""
        hover = getattr(self, "_eq_hover", None)
        cursor = getattr(self, "_eq_cursor", None)
        if (not hover or cursor is None
                or event.inaxes != self.ax or event.xdata is None):
            if cursor is not None and cursor.get_visible():
                cursor.set_visible(False)
                self._eq_annot.set_visible(False)
                self.chart_canvas.draw_idle()
            return

        xnums = hover["xnums"]
        if not xnums:
            return
        idx = min(range(len(xnums)),
                  key=lambda i: abs(xnums[i] - event.xdata))
        snap_x = xnums[idx]
        cur_date = mdates.num2date(snap_x).strftime("%Y-%m-%d")

        lines = [cur_date]
        for name, ys in hover["series"]:
            if idx < len(ys) and ys[idx] is not None:
                lines.append(f"{name}: {ys[idx]:,.0f}")
        text = "\n".join(lines)

        cursor.set_xdata([snap_x, snap_x])
        cursor.set_visible(True)
        self._eq_annot.xy = (snap_x, event.ydata)
        self._eq_annot.set_text(text)
        self._eq_annot.set_visible(True)
        self.chart_canvas.draw_idle()

    def _set_result(self, text: str):
        self.result_text.config(state="normal")
        self.result_text.delete("1.0", "end")
        self.result_text.insert("1.0", text)
        self.result_text.config(state="disabled")

    def _save_current_input(self):
        data = {
            "smh_capital": self.var_smh_capital.get().strip(),
            "smh3_capital": self.var_smh3_capital.get().strip(),
            "buy_date": self._get_buy_date(),
            "end_date": self._get_end_date(),
            "reset_threshold": self.var_reset_threshold.get().strip(),
            "drawdowns": {
                str(lv): self.var_drawdowns[lv].get().strip()
                for lv in DRAWDOWN_LEVELS
            },
            "rebounds": {
                str(lv): self.var_rebounds[lv].get().strip()
                for lv in REBOUND_LEVELS
            },
        }
        save_last_input(data)

    def _restore_last_input(self):
        data = load_last_input()
        if not data:
            # 首次启动没有历史输入时，自动填入当前数据源的推荐档位
            self._fill_recommend_values()
            return
        self.var_smh_capital.set(data.get("smh_capital", ""))
        self.var_smh3_capital.set(data.get("smh3_capital", ""))
        self._set_buy_date(data.get("buy_date", self.default_start_date))
        self._set_end_date(data.get("end_date", self.default_end_date))
        self.var_reset_threshold.set(
            data.get("reset_threshold", str(int(DEFAULT_RESET_THRESHOLD))))
        dd = data.get("drawdowns", {})
        for lv in DRAWDOWN_LEVELS:
            self.var_drawdowns[lv].set(dd.get(str(lv), ""))
        rb = data.get("rebounds", {})
        for lv in REBOUND_LEVELS:
            self.var_rebounds[lv].set(rb.get(str(lv), ""))


def main():
    root = tk.Tk()
    SMHApp(root)
    # 确保窗口置顶显示（macOS 下有时会隐藏在后台）
    root.update()
    root.lift()
    root.attributes("-topmost", True)
    root.after(500, lambda: root.attributes("-topmost", False))
    root.mainloop()


if __name__ == "__main__":
    main()