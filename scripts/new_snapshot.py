#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
新 snapshot 助手：抓汇率 + 询问关键股价 + 输出 snapshot 模板。
将输出粘到 history.json 的 snapshots 数组末尾即可。

用法：
    python3 scripts/new_snapshot.py
    python3 scripts/new_snapshot.py --skip-prompt    # 只生成模板，价格留空
"""
import json, sys, urllib.request
from datetime import date
from pathlib import Path

# 自动获取相对于当前脚本的 data 目录
DATA_DIR = str(Path(__file__).parent.parent / "data")


def fetch_rates():
    with urllib.request.urlopen("https://open.er-api.com/v6/latest/USD", timeout=10) as resp:
        data = json.load(resp)
    rates = data["rates"]
    usd_rmb = round(rates["CNY"], 4)
    hkd_rmb = round(rates["CNY"] / rates["HKD"], 4)
    return {"USD": usd_rmb, "HKD": hkd_rmb, "_source": data.get("time_last_update_utc", "")}


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
    skip = "--skip-prompt" in sys.argv
    rates = fetch_rates()
    print(f"\n📡 实时汇率：USD→RMB {rates['USD']} · HKD→RMB {rates['HKD']}")
    print(f"   源：{rates['_source']}\n")

    last = load_last()
    last_prices = (last or {}).get("prices", {})
    last_holdings = (last or {}).get("holdings", {})

    snap = {
        "date": str(date.today()),
        "rates": {"USD": rates["USD"], "HKD": rates["HKD"]},
        "ratesSource": f"open.er-api.com ({rates['_source']})",
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
        ("tencent_futu", "HKD", "腾讯（富途/中银/招商共用价）"),
        ("hstech", "HKD", "恒生科技 03032"),
        ("hsi_dividend_efund", "HKD", "易方达亚太高股息 03483"),
        ("etf_512890", "RMB", "红利低波 512890"),
        ("high_div_bluechip", "RMB", "长江电力 600900"),
    ]

    if skip:
        for k, ccy, name in keys_to_ask:
            last_p = last_prices.get(k, {}).get("price")
            snap["prices"][k] = {"ccy": ccy, "price": last_p}
        print("⏭  跳过提问；价格沿用上次。请编辑 prices/holdings 后写入 history.json。\n")
    else:
        print("📋 输入当前价（直接回车 = 沿用上次价格）：")
        for k, ccy, name in keys_to_ask:
            last_p = last_prices.get(k, {}).get("price")
            v = prompt(f"  {name} ({ccy})", str(last_p) if last_p else None)
            try:
                snap["prices"][k] = {"ccy": ccy, "price": float(v) if v else last_p}
            except ValueError:
                snap["prices"][k] = {"ccy": ccy, "price": last_p}
        # 腾讯共享价
        tprice = snap["prices"]["tencent_futu"]["price"]
        snap["prices"]["tencent_zhongyin"]  = {"ccy": "HKD", "price": tprice}
        snap["prices"]["tencent_zhaoshang"] = {"ccy": "HKD", "price": tprice}

    # holdings 沿用上次
    snap["holdings"] = last_holdings

    print("\n========== 复制以下 JSON，append 到 history.json 的 snapshots 数组末尾 ==========\n")
    print(json.dumps(snap, ensure_ascii=False, indent=2))
    print("\n========== END ==========\n")
    print("👉 完成后运行 `python3 -m http.server 8765` 刷新看板验证")


if __name__ == "__main__":
    main()
