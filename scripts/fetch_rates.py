#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""查最新汇率，或按指定日期查询历史汇率 / 输出 snapshot 模板。

用法：
    python3 scripts/fetch_rates.py                     # 查询最新汇率
    python3 scripts/fetch_rates.py --date 2024-01-15    # 查询指定日期汇率
    python3 scripts/fetch_rates.py --json --date 2024-01-15  # 输出带历史汇率的模板
"""
import argparse
import json
import urllib.request
from datetime import date

from rates import fetch_historical_rates


def fetch():
    with urllib.request.urlopen("https://open.er-api.com/v6/latest/USD", timeout=10) as resp:
        data = json.load(resp)
    rates = data["rates"]
    usd_rmb = round(rates["CNY"], 4)
    usd_hkd = rates["HKD"]
    hkd_rmb = round(rates["CNY"] / rates["HKD"], 4)
    return {
        "USD": usd_rmb,
        "HKD": hkd_rmb,
        "_source": data.get("time_last_update_utc", ""),
        "_usd_to_hkd": round(usd_hkd, 4),
    }


def main():
    parser = argparse.ArgumentParser(description="查询汇率；模板模式按快照日期查历史汇率")
    parser.add_argument("--json", action="store_true", help="输出 snapshot 模板（按日期取历史汇率）")
    parser.add_argument("--date", help="汇率/快照日期 YYYY-MM-DD；默认今天")
    args = parser.parse_args()

    if args.json or args.date:
        snapshot_date = date.fromisoformat(args.date or str(date.today())).isoformat()
        result = fetch_historical_rates(snapshot_date)
        r = result["rates"]
        if args.json:
            snap = {
                "date": snapshot_date,
                "rates": r,
                "ratesSource": result["source"],
                "comment": "TODO 写一句备注",
                "holdings": {"TODO_sub_key": {"raw": 0}},
            }
            print(json.dumps(snap, ensure_ascii=False, indent=2))
        else:
            print(f"date      : {snapshot_date} (rate date {result['date']})")
            print(f"USD → RMB : {r['USD']}")
            print(f"HKD → RMB : {r['HKD']}")
            print(f"source    : {result['source']}")
        return

    r = fetch()
    print(f"USD → RMB : {r['USD']}")
    print(f"HKD → RMB : {r['HKD']}")
    print(f"USD → HKD : {r['_usd_to_hkd']}")
    print(f"source    : {r['_source']}")


if __name__ == "__main__":
    main()
