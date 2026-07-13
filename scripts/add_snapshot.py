#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
非交互报数脚本 —— 给自动化 / 能力较弱的 AI 用的「安全报数」入口。

替代交互式的 new_snapshot.py：无需任何键盘输入，全部走命令行参数，
脚本负责「继承上一条快照 → 抓实时汇率 → 应用变更 → 自动备份 → append → JSON 校验」，
让调用方很难把 history.json 搞坏（永不覆盖旧快照、写前强制备份）。

核心安全保证：
- history.json 的 snapshots 只 **append**，绝不修改/删除旧快照
- 写入前自动调用 backup_data.py 做整目录快照
- 写入后立即重新解析 JSON，失败则报错（但备份已在，可回滚）
- 默认操作真实数据目录 data/；若不存在直接报错，绝不误写 demo_data

用法示例：
    # 看有哪些 key 可以报（不写任何东西）
    python3 scripts/add_snapshot.py --show-keys

    # 报数：微众活期 8.5 万、VOO 现价 685、港股现价 460
    python3 scripts/add_snapshot.py \\
        --set weizhong_demand.raw=85000 \\
        --set voo.price=685 \\
        --set hk_xxx.price=460 \\
        --deposit 20000 \\
        --comment "6 月底常规报数"

    # 只预览将要写入的 snapshot，不落盘
    python3 scripts/add_snapshot.py --set voo.price=685 --dry-run

字段说明（--set key.field=value）：
    field ∈ { raw, shares, cost, price }
      - raw            现金类持仓的原币种金额（写入 holdings[key].raw）
      - shares / cost  证券类持仓的股数 / 每股成本（写入 holdings[key]）
      - price          当前股价（写入 prices[key].price）
    key 为持仓代码（如 voo / weizhong_demand），见 --show-keys。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import urllib.request
from copy import deepcopy
from datetime import date
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
BASE = SCRIPT_DIR.parent  # 项目根
VALID_FIELDS = {"raw", "shares", "cost", "price"}
RATES_URL = "https://open.er-api.com/v6/latest/USD"


def die(msg: str) -> "NoReturn":  # type: ignore[name-defined]
    print(f"❌ {msg}", file=sys.stderr)
    raise SystemExit(1)


def load_json(path: Path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def fetch_rates():
    """抓实时汇率；失败返回 None（调用方决定沿用上次）。"""
    try:
        with urllib.request.urlopen(RATES_URL, timeout=10) as resp:
            data = json.load(resp)
        rates = data["rates"]
        return {
            "USD": round(rates["CNY"], 4),
            "HKD": round(rates["CNY"] / rates["HKD"], 4),
            "_source": f"open.er-api.com ({data.get('time_last_update_utc', '')})",
        }
    except Exception as err:  # noqa: BLE001 网络问题不应让报数崩掉
        print(f"⚠️  抓汇率失败（{err}），将沿用上一条快照的汇率。", file=sys.stderr)
        return None


def build_ccy_map(target: dict, last_prices: dict) -> dict:
    """key -> 币种。优先 target.json 的 sub.ccy，回退上一条 prices 的 ccy。"""
    ccy = {}
    for mod in target.get("modules", []):
        for sub in mod.get("subs", []):
            if sub.get("key") and sub.get("ccy"):
                ccy[sub["key"]] = sub["ccy"]
    for key, p in (last_prices or {}).items():
        if key not in ccy and isinstance(p, dict) and p.get("ccy"):
            ccy[key] = p["ccy"]
    return ccy


def parse_set(expr: str):
    """'voo.shares=50' -> ('voo', 'shares', 50.0)"""
    if "=" not in expr:
        die(f"--set 语法错误：{expr}（应为 key.field=value）")
    lhs, rhs = expr.split("=", 1)
    if "." not in lhs:
        die(f"--set 语法错误：{lhs}（应为 key.field，如 voo.price）")
    key, field = lhs.rsplit(".", 1)
    if field not in VALID_FIELDS:
        die(f"--set 字段非法：{field}（仅支持 {sorted(VALID_FIELDS)}）")
    try:
        value = float(rhs)
    except ValueError:
        die(f"--set 值不是数字：{rhs}")
    return key, field, value


def show_keys(target: dict, last: dict):
    print("📋 可报数的 key（来自 target.json + 上一条快照）：\n")
    seen = set()
    for mod in target.get("modules", []):
        rows = []
        for sub in mod.get("subs", []):
            k = sub.get("key")
            if not k:
                continue
            seen.add(k)
            holds = (last or {}).get("holdings", {}).get(k, {})
            kind = "现金(raw)" if "raw" in holds or sub.get("ccy") and "shares" not in holds else ""
            if "shares" in holds:
                kind = "证券(shares/cost/price)"
            elif "raw" in holds:
                kind = "现金(raw)"
            else:
                kind = "—未持有—"
            rows.append(f"    {k:<24} {sub.get('ccy',''):<4} {kind}  · {sub.get('name','')}")
        if rows:
            print(f"  【{mod.get('name', mod.get('key',''))}】")
            print("\n".join(rows))
            print()
    # 上一条快照里有、但 target 没列的游离 key
    orphans = [k for k in (last or {}).get("holdings", {}) if k not in seen]
    if orphans:
        print("  【游离持仓（target 未列出）】")
        for k in orphans:
            print(f"    {k}")
        print()


def main():
    ap = argparse.ArgumentParser(
        description="非交互报数：append 一条新快照到 history.json（自动备份+校验）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--set", action="append", default=[], metavar="key.field=value",
                    help="设置某个持仓字段，可多次。field ∈ raw/shares/cost/price")
    ap.add_argument("--comment", default="", help="本次快照备注")
    ap.add_argument("--deposit", type=float, default=0, help="本期净注入资金（入金）")
    ap.add_argument("--withdraw", type=float, default=0, help="本期净赎回资金（出金）")
    ap.add_argument("--date", default=str(date.today()), help="快照日期 YYYY-MM-DD，默认今天")
    ap.add_argument("--data-dir", default=str(BASE / "data"),
                    help="数据目录，默认 <项目>/data（真实数据）")
    ap.add_argument("--no-rates", action="store_true", help="不抓实时汇率，直接沿用上一条")
    ap.add_argument("--show-keys", action="store_true", help="只列出可报数的 key 后退出")
    ap.add_argument("--dry-run", action="store_true", help="只打印将写入的 snapshot，不落盘")
    args = ap.parse_args()

    data_dir = Path(args.data_dir)
    history_path = data_dir / "history.json"
    target_path = data_dir / "target.json"
    if not history_path.exists():
        die(f"找不到 {history_path}。真实数据目录不存在？用 --data-dir 指定，"
            f"或确认 config.js 的 dataDir。（不会自动写 demo_data，以免污染示例）")

    history = load_json(history_path)
    snaps = history.get("snapshots", [])
    if not snaps:
        die("history.json 没有任何快照，无法继承基底。请先手动建第一条。")
    snaps_sorted = sorted(snaps, key=lambda s: s.get("date", ""))
    last = snaps_sorted[-1]

    target = load_json(target_path) if target_path.exists() else {"modules": []}

    if args.show_keys:
        show_keys(target, last)
        return

    if not args.set and not args.comment and not args.deposit and not args.withdraw:
        die("没有任何变更（--set / --deposit / --withdraw / --comment 至少给一个）。"
            "想看 key 用 --show-keys。")

    ccy_map = build_ccy_map(target, last.get("prices", {}))

    # —— 以上一条快照为基底（全量继承 holdings + prices）——
    new_holdings = deepcopy(last.get("holdings", {}))
    new_prices = deepcopy(last.get("prices", {}))

    # 汇率
    if args.no_rates:
        rates = dict(last.get("rates", {}))
        rates_source = last.get("ratesSource", "沿用上一条（--no-rates）")
    else:
        r = fetch_rates()
        if r:
            rates = {"USD": r["USD"], "HKD": r["HKD"]}
            rates_source = r["_source"]
        else:
            rates = dict(last.get("rates", {}))
            rates_source = last.get("ratesSource", "") + " (沿用·抓取失败)"

    # 应用 --set
    changed = []
    for expr in args.set:
        key, field, value = parse_set(expr)
        if field == "price":
            ccy = ccy_map.get(key) or (new_prices.get(key, {}) or {}).get("ccy")
            if not ccy:
                die(f"无法确定 {key} 的币种（target.json 和上一条都没有）。"
                    f"该 key 是否拼错？")
            new_prices.setdefault(key, {})["ccy"] = ccy
            new_prices[key]["price"] = value
            changed.append(f"{key}.price={value} ({ccy})")
        else:  # raw / shares / cost
            new_holdings.setdefault(key, {})[field] = value
            changed.append(f"{key}.{field}={value}")

    snap = {
        "date": args.date,
        "rates": rates,
        "ratesSource": rates_source,
        "comment": args.comment or "（未填备注）",
        "cashFlow": {
            "deposits": args.deposit,
            "withdrawals": args.withdraw,
            "note": "",
        },
        "prices": new_prices,
        "holdings": new_holdings,
    }

    print("📡 汇率：USD→RMB {} · HKD→RMB {}  ({})".format(
        rates.get("USD"), rates.get("HKD"), rates_source))
    print(f"🗓  日期：{snap['date']}")
    print("✏️  本次变更：")
    for c in changed:
        print(f"    - {c}")
    if not changed:
        print("    （仅更新汇率/现金流/备注，无持仓字段变更）")

    if args.dry_run:
        print("\n—— DRY RUN：以下为将 append 的 snapshot（未写入）——\n")
        print(json.dumps(snap, ensure_ascii=False, indent=2))
        return

    # 写前强制备份
    print("\n💾 备份 data/ ...")
    bk = subprocess.run(
        [sys.executable, str(SCRIPT_DIR / "backup_data.py"), f"add_snapshot {snap['date']}"],
        capture_output=True, text=True,
    )
    print(bk.stdout.strip() or bk.stderr.strip())
    if bk.returncode != 0:
        die("备份失败，已中止写入（数据未改动）。")

    # append + 写回
    history.setdefault("snapshots", []).append(snap)
    tmp = history_path.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, indent=2)
    # 校验新文件可被解析
    try:
        load_json(tmp)
    except Exception as err:  # noqa: BLE001
        tmp.unlink(missing_ok=True)
        die(f"写出的 JSON 无法解析（{err}），已放弃。原文件未动，备份在 data/_backups/。")
    tmp.replace(history_path)

    print(f"\n✅ 已 append 第 {len(history['snapshots'])} 条快照到 {history_path.name}")
    print("👉 下一步：`node scripts/validate_data.mjs` 体检，再 "
          "`python3 -m http.server 8765` 刷新看板确认。")


if __name__ == "__main__":
    main()
