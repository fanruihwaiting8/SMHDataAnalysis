#!/usr/bin/env python3
"""
SMH 数据分析核心逻辑（占位实现）

后续根据具体需求在此扩展：数据解析、统计、图表、导出等。
目前提供一个最小可用的示例：统计输入文本的基本信息。
"""


def analyze_data(raw: str) -> str:
    """对输入的原始数据进行分析，返回可读的结果字符串。

    参数:
        raw: 用户在 GUI 中输入的原始文本数据。
    返回:
        分析结果文本。
    """
    lines = [ln for ln in raw.splitlines() if ln.strip()]
    chars = len(raw)
    words = len(raw.split())

    numbers = []
    for token in raw.replace(",", " ").split():
        try:
            numbers.append(float(token))
        except ValueError:
            pass

    report = []
    report.append("===== 基础统计（占位示例）=====")
    report.append(f"非空行数: {len(lines)}")
    report.append(f"字符数:   {chars}")
    report.append(f"词数:     {words}")
    if numbers:
        report.append(f"识别到数值: {len(numbers)} 个")
        report.append(f"数值求和:   {sum(numbers):.4g}")
        report.append(f"数值均值:   {sum(numbers) / len(numbers):.4g}")
    report.append("")
    report.append("提示：这是基础框架的占位分析，请告诉我具体分析需求后完善。")
    return "\n".join(report)