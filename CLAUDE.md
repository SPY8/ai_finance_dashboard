# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

本仓库是一个**纯静态、无构建、无依赖**的家庭财务看板（HTML + 原生 JS + JSON）。所有计算在浏览器端完成，无后端。详见 [README.md](README.md)（数据建模原则）和 [AGENTS.md](AGENTS.md)（改动 SOP + 安全红线，**必读**）。

## 运行与预览

必须用本地 HTTP 服务打开，**不能用 `file://`**（各 Tab 用 `fetch()` 读 JSON，会被浏览器拦）：

```bash
python3 -m http.server 8765
# 浏览器打开 http://127.0.0.1:8765
```

改完 JS 后浏览器硬刷新（Cmd/Ctrl+Shift+R）。截图脚本：`node scripts/take_screenshots.mjs [port] [scale]`（需 puppeteer-core，依赖在 `/tmp/puppeteer-test`）。

## 数据双层：demo_data（公开）vs data（私有，被 gitignore）

- 仓库默认加载 `demo_data/`（虚构数据，任何人 clone 即可运行）。
- 真实数据在 `data/`，被 `.gitignore` 屏蔽，**绝不提交**。`config.js`（也被 gitignore）通过 `window.AFD_CONFIG.dataDir` 切换目录，缺省回退 `demo_data`。
- 页面右上角有数据源下拉（`data` ↔ `demo_data`），选择写入 `localStorage` 的 `afd_data_dir` 后 reload。
- `data/` 与 `demo_data/` **结构必须一致**（同名 JSON 文件），改其中一份时通常要同步另一份以免看板在 demo 下崩。

## 改动 SOP（改任何 data/ 之前必做）

1. 先备份：`python3 scripts/backup_data.py "改动说明"` → 复制 `data/` 到 `data/_backups/<时间戳>/`，保留最近 20 份。
2. 改完验证 JSON：`python3 -c "import json; [json.load(open(f'data/{p}')) for p in ('target.json','history.json',...)]"`。
3. 刷新看板，看 Health Check banner 是否有红线告警、console 是否报错。
4. 在 `target.json` 的 `changelog` append 一条变更说明。

## 安全红线（来自 AGENTS.md）

- 绝不把 `data/` 任何文件提交 git（含真实持仓、工资、保单号、recurring.json 备注里的账号密码）。
- **绝不在对话里复述 data/ 里的具体金额、保单号、账号、价格**；用户没问就不要主动报。`core.js` 有隐私模式（`localStorage` 的 `afd_hide_amounts=1`，`fmt/fmtK` 返回 `••••`）。
- 脚本里不硬编码任何凭据。`data/` 注释字段里的账号密码保持原样，不要清理也不要复述。

## 架构

### Tab 结构（index.html 顶部导航 `data-tab`）
六个 Tab，每个 Tab 对应一个 IIFE 模块文件，挂载到 `#tab-<name>` pane：

| Tab key | 文件 | 数据源 |
|---|---|---|
| `assets` 资产配置 | [app.js](app.js) | target.json + history.json |
| `target` 目标配置 | [target.js](target.js) | target.json + history.json |
| `liab` 负债与刚性 | [liabilities.js](liabilities.js) | liabilities.json + recurring.json + target.json + history.json + income_events.json |
| `cash` 现金流追踪 | [cashflow.js](cashflow.js) | transactions/index.json + transactions/yearly/YYYY.json + categories.json + recurring.json + history.json + income_events.json |
| `tax` 税务计算 | [tax.js](tax.js) | 内置税率规则库 `TaxRules`（港股通/富途/美股预扣税），少外部数据 |
| `risk` 风控与政策 | [risk_policy.js](risk_policy.js) | risks.json + policies.json |

所有 Tab 共享 [core.js](core.js)（`window.AssetCore`）。每个模块开头 `const C = window.AssetCore` 取工具函数，用 `C.getDataPath("xxx.json")` 拼数据路径（自动跟 `AFD_CONFIG.dataDir`）。

### core.js 是计算核心
所有 Tab 共用，关键导出：
- `enrichSnapshot(snap, target)` — **最关键**。把一条 history snapshot + target 配置，算出每个 module/sub 的 RMB 值、占比、状态（ok/over/under/blocked/exit/planned/pending）、币种分布、金融盘 vs 整体盘。包含"游离持仓"（target 未列出的 holdings 自动归入 `_orphan` 模块）和 key 别名（`etf_563020` ↔ `etf_512890`）。
- `healthCheck(cur, target)` — 红线告警（腾讯单一敞口 >5%、RMB 占比 >70%、大类偏离、待变现资产）。
- `reconcile(prev, cur)` — 两次 snapshot 间总盘变化拆分为"净注入 + 真实回报"。
- `runAssertions(cur, target)` — 启动断言：总盘在 50w–10 亿、模块权重和=100%、子项权重和=大类目标。
- 格式化：`fmt/fmtK`（受隐私模式影响）、`pct`、`parseDate`、`isActive`/`activeMonthsInYear`、`inflate/deflate`。

### 计算口径（贯穿全看板）
- **RMB 计价，三币种物理隔离**（RMB / USD / HKD），人民币池和海外池不互相补位。
- `sub.rmb = sub.raw × rates[sub.ccy]`；份额持仓用 `shares × price × rate`，`costRMB` 与 `marketValue` 分开。
- 双层阈值：大类 `module.thresholdPct`（强制触发）+ 子项 `sub.subThresholdPct`（仅提醒）。红色 over / 黄色 under / 静音 ok。
- 汇率每次报数都抓新的写进 snapshot 的 `rates`，永不复用旧汇率。

### 数据文件职责
- `target.json` — 终局战略配置（modules/subs 目标权重与阈值、philosophy、redLines、inflation、retirement、milestones、assumptions、changelog）。改这里 = 改战略。`retirement.selfRetireYear` 改了要同步改 `recurring.json` 里 `salary_*` 的 `endDate`。
- `history.json` — **append-only** 快照数组，每条 `{date, rates, prices, holdings, cashFlow, comment}`。改这里 = 报新数值。缺的 holdings key 按 0 算。
- `recurring.json` — 循环收支（工资/房租/保险/利息/退休后零散收入），`incomes`/`expenses` 各带 `startDate/endDate/frequency`。保险项（`kind:"insurance"`）可带 `cashValueSchedule`（`{年份:金额}`，金额用保单 ccy，缺失年份线性插值）记录现金价值年度时间序列；`core.js` 的 `injectInsuranceCashValue` 会把所有保单当年现金价值合计注入 snapshot 的 `insurance_cashvalue` holdings，由"防御现金"模块的 `insurance_cashvalue` sub 承接，参与总盘。
- `income_events.json` — 一次性事件（股票归属兑现、离职大礼包）。
- `transactions/yearly/YYYY.json` — 年度实绩账单；如果某笔已在 `recurring.json` 定义，yearly 那条加 `recurring: <key>` 字段，`cashflow.js` 优先用实绩跳过 recurring 侧（保险池 key 用 `_insurance_pool`）。

### 报新数值（最常见工作流）
抓实时汇率 + 生成 snapshot 模板，append 到 `history.json`，不动 `target.json`：

```bash
python3 scripts/fetch_rates.py            # 看汇率
python3 scripts/fetch_rates.py --json     # 输出 snapshot 模板片段
python3 scripts/new_snapshot.py           # 抓汇率 + 交互式问价 + 输出完整 snapshot
python3 scripts/new_snapshot.py --skip-prompt  # 价格沿用上次
```

## 维护节奏

- 季度末：append 一条 history snapshot，看 Health Check 红线。
- 年底：补一份 `transactions/yearly/YYYY.json` 完整账单，把 `partial_with_projection` 改 `complete`。
- 里程碑达成：`target.json` 的 `milestones.items` 改 `done: true` + note。
- 重大假设变化：改 target.json 的 `assumptions/redLines`，写 changelog。
