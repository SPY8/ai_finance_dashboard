#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
新 snapshot 助手：按快照日期抓取历史汇率 + 询问关键股价 + 输出 snapshot 模板。
将输出粘到 history.json 的 snapshots 数组末尾即可。

用法：
    python3 scripts/new_snapshot.py
    python3 scripts/new_snapshot.py --date 2024-01-15 --skip-prompt
"""
import argparse
import json
from datetime import date
from pathlib import Path

from rates import fetch_historical_rates

# 自动获取相对于当前脚本的 data 目录
DATA_DIR = str(Path(__file__).parent.parent / "data")


def load_last():
    with open(f"{DATA_DIR}/history.json") as f:
        d = json.load(f)
    snaps = d.get("snapshots", [])
    if not snaps:
        return None
    snaps.sort(key=lambda s: s["date"])
    return snaps[-1]


def prompt(label, default=None):
    suffix = f" [{default}]" if default else ""
    val = input(f"{label}{suffix}: ").strip()
    return val or default


def main():
    parser = argparse.ArgumentParser(description="按快照日期生成新 snapshot 模板")
    parser.add_argument("--date", default=str(date.today()), help="快照日期 YYYY-MM-DD，默认今天；汇率按此日期查询")
    parser.add_argument("--skip-prompt", action="store_true", help="价格沿用上次，不交互提问")
    args = parser.parse_args()
    snapshot_date = date.fromisoformat(args.date).isoformat()
    rate_result = fetch_historical_rates(snapshot_date)
    rates = rate_result["rates"]
    print(f"\n📡 汇率（快照日期 {snapshot_date}）：USD→RMB {rates['USD']} · HKD→RMB {rates['HKD']}")
    print(f"   源：{rate_result['source']}\n")

    last = load_last()
    last_prices = (last or {}).get("prices", {})
    last_holdings = (last or {}).get("holdings", {})

    snap = {
        "date": snapshot_date,
        "rates": rates,
        "ratesSource": rate_result["source"],
        "comment": "TODO 备注",
        "cashFlow": {"deposits": 0, "withdrawals": 0, "note": ""},
        "prices": {},
        "holdings": {},
    }

    # 询问关键股价
    keys_to_ask = [
        ("voo", "USD", "VOO 标普"),
        ("qqqm", "USD", "QQQM 纳指"),
        ("brk_b", "USD", "BRK.B 伯克希尔"),
        ("iau_gold", "USD", "IAU 黄金"),
        ("hstech", "HKD", "恒生科技 03032"),
        ("hsi_dividend_efund", "HKD", "易方达亚太高股息 03483"),
        ("etf_515450", "RMB", "大盘红利低波 515450"),
        ("etf_563020", "RMB", "红利低波（低费率）563020"),
        ("high_div_bluechip", "RMB", "长江电力 600900"),
    ]

    if args.skip_prompt:
        for k, ccy, name in keys_to_ask:
            last_p = last_prices.get(k, {}).get("price")
            if last_p is None and k == "etf_563020":
                last_p = last_prices.get("etf_512890", {}).get("price")
            snap["prices"][k] = {"ccy": ccy, "price": last_p}
        print("⏭  跳过提问；价格沿用上次。请编辑 prices/holdings 后写入 history.json。\n")
    else:
        print("📋 输入当前价（直接回车 = 沿用上次价格）：")
        for k, ccy, name in keys_to_ask:
            last_p = last_prices.get(k, {}).get("price")
            if last_p is None and k == "etf_563020":
                last_p = last_prices.get("etf_512890", {}).get("price")
            v = prompt(f"  {name} ({ccy})", str(last_p) if last_p else None)
            try:
                snap["prices"][k] = {"ccy": ccy, "price": float(v) if v else last_p}
            except ValueError:
                snap["prices"][k] = {"ccy": ccy, "price": last_p}

    # holdings 沿用上次
    snap["holdings"] = last_holdings

    print("\n========== 复制以下 JSON，append 到 history.json 的 snapshots 数组末尾 ==========\n")
    print(json.dumps(snap, ensure_ascii=False, indent=2))
    print("\n========== END ==========\n")
    print("👉 完成后运行 `python3 scripts/edit_server.py 8765` 刷新看板验证")


if __name__ == "__main__":
    main()
