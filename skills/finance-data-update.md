---
name: finance-data-update
description: 资产配置看板「报数 / 改数据」SOP —— 脚本优先，给任意 AI（含能力较弱的）一条很难搞砸的安全通道
tags: [finance, dashboard, data, sop]
created: 2026-06-14
updated: 2026-06-28
---

# 资产配置看板 · 数据更新 SOP

> 本 skill 跟随项目走（与 `scripts/`、`data/` 同仓）。所有路径都是**项目根的相对路径**，请先 `cd` 到项目根再执行。
>
> 核心原则：**能用脚本就别手搓 JSON**。脚本负责备份、append、校验，调用方很难把数据搞坏。

---

## 🟢 快速通道（90% 的「报数」走这里）

用户说「今天微众活期 X 万、富途货基 Y 美元、港股现价 Z……」这类**只是更新数值**的场景，**一律走脚本**，不要手改 `history.json`：

```bash
# 1. 先看有哪些 key 能报（不写任何东西）
python3 scripts/add_snapshot.py --show-keys

# 2. 报数（按需 --set，可多个）
python3 scripts/add_snapshot.py \
    --set weizhong_demand.raw=85000 \
    --set voo.price=685 \
    --set hk_xxx.price=460 \
    --deposit 20000 \
    --comment "6 月底常规报数"

# 3. 体检：绿了才算完
node scripts/validate_data.mjs
```

`add_snapshot.py` 自动做：继承上一条快照 → 抓实时汇率 → **写前强制备份** → **只 append 不覆盖** → 写后重新解析校验。
不确定要不要落盘时先加 `--dry-run` 看一眼。

**`--set key.field=value` 字段**：
- `raw` 现金类原币种金额
- `shares` / `cost` 证券股数 / 每股成本
- `price` 当前股价

---

## 🟡 手动通道（脚本覆盖不了的场景）

以下场景脚本搞不定，需要**手动改 JSON**，改完务必 `node scripts/validate_data.mjs` 兜底：

### 1️⃣ 交易流水 —— `data/transactions/yearly/YYYY.json`

每笔真实买卖 / 入金 / 出金 / 换汇都要记一条：
- [ ] 至少含：日期、动作、标的、数量、价格、资金来源/去向
- [ ] 标记 `exclude: true`（或 `excludeFromCashflow: true`），避免污染现金流 KPI / 年化推算
- [ ] `category` 建议 `investment_ops`（不存在就先加到 `categories.json`）

### 2️⃣ 新增品种 —— `data/target.json`

新标的不在现有 `modules[].subs[]` 里时：
- [ ] 在对应大类下加一个 `sub`（含 `key` / `name` / `ccy` / `subTargetPct`），或归入游离持仓
- [ ] 加完确认大类内 `subTargetPct` 之和 == 大类 `targetPct`（`validate_data.mjs` 会校验）

### 3️⃣ 改战略 —— `data/target.json`

用户明确调整配置策略（如「黄金目标从 9% 上调到 13%」）：
- [ ] 改对应 `targetPct` / `subTargetPct`
- [ ] 确认所有大类 `targetPct` 之和 == 100%
- [ ] 在 `changelog` 数组**最前面**插一条 `{ "date","version","changes":[...] }`，并同步文件头 `version` / `updated`

### 4️⃣ 风控 / 政策 / 对冲 —— `demo_data/policies.json` · `demo_data/risks.json`

新增「策略/工具」层面的东西（Sell Put、跨境工具、对冲组合）时同步补充，确保看板「风险与防守」页能找到（分类、标签、优缺点、规则、适用场景）。

---

## 关键约定（红线，别违反）

- **只 append 不覆盖**：`history.json` 的 `snapshots` 是时间序列，永远在末尾追加旧的原封不动
- **汇率每次都抓**：报数走脚本会自动抓；手动场景用 `python3 scripts/fetch_rates.py`，永不复用旧汇率
- **成本价用交易价**：新建仓 `cost = 交易价`；加仓用加权均价 `(old_shares*old_cost + new_shares*new_price) / total_shares`
- **清仓记录**：`shares=0, cost=0`，在 note 里写清仓日期/价格/盈亏
- **改 data/ 前先备份**：脚本会自动备份；手动改前先 `python3 scripts/backup_data.py "说明"`
- **512890 ≡ 563020**：512890 是 563020 的高费率版（同指数），已在 `core.js` KEY_ALIASES 映射，新数据统一用 `etf_563020`

## 校验清单（收尾必做）

```bash
node scripts/validate_data.mjs        # 数据体检：JSON / 快照时序 / 权重和 / 红线（退出码区分致命错误）
node --test scripts/test_core.mjs     # 核心逻辑单测
```

绿了，再给用户一份本次更新摘要（表格：操作 / 标的 / 数量 / 价格）。

## 修订历史

- 2026-06-14：[Miu 创建] 基于长江电力/512890/563020 等多笔交易更新时的遗漏，总结出完整清单 SOP
- 2026-06-28：[Miu 改版] 清单版 → 脚本优先版，新增 🟢 快速通道（`add_snapshot.py` + `validate_data.mjs`）；并将本 skill 从 muse 的 `memory/skills/` 迁入项目仓库，随项目一起版本管理
