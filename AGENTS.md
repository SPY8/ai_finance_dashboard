# AGENTS.md — Publish 版本（无隐私）

这是一个跑在浏览器里的家庭财务看板（HTML + JS + JSON 的纯静态站点）。本文件是给协作/AI 的“上手地图”，不包含任何个人金额、姓名、账号、房产信息。

**核心口径**

- RMB 计价，三币种物理隔离（RMB / USD / HKD）；人民币池与海外池不互相补位
- 三本账：资产快照（history/target）+ 负债/刚性（liabilities/recurring）+ 年度现金流（transactions）

**Tab 与模块**

- 📊 资产全景：[app.js](file:///Users/bigcat/Library/Mobile%20Documents/com~apple~CloudDocs/Muse/projects/ai-finance-dashboard/app.js)
- 🎯 战略与规划 / 📈 趋势与复盘（含目标配置 & 变更历史）：[target.js](file:///Users/bigcat/Library/Mobile%20Documents/com~apple~CloudDocs/Muse/projects/ai-finance-dashboard/target.js)
- 💸 负债与刚性：[liabilities.js](file:///Users/bigcat/Library/Mobile%20Documents/com~apple~CloudDocs/Muse/projects/ai-finance-dashboard/liabilities.js)
- 🌊 现金流追踪：[cashflow.js](file:///Users/bigcat/Library/Mobile%20Documents/com~apple~CloudDocs/Muse/projects/ai-finance-dashboard/cashflow.js)
- 🛡️ 风险与防守（策略/政策武器库 + 风险图谱）：[risk_policy.js](file:///Users/bigcat/Library/Mobile%20Documents/com~apple~CloudDocs/Muse/projects/ai-finance-dashboard/risk_policy.js)
- 🧮 税务计算：[tax.js](file:///Users/bigcat/Library/Mobile%20Documents/com~apple~CloudDocs/Muse/projects/ai-finance-dashboard/tax.js)

**数据与隐私**

- `data/` 与 `config.js` 默认被忽略，不允许入库
- `demo_data/` 是公开示例数据
- 读取路径由 [core.js:getDataPath](file:///Users/bigcat/Library/Mobile%20Documents/com~apple~CloudDocs/Muse/projects/ai-finance-dashboard/core.js) 决定：数值类走 `dataDir`，知识/策略类走 `sharedDir`

**开发与验证**

- 本地预览：`python3 -m http.server 8765`，浏览器打开 `http://127.0.0.1:8765`
- 单元/轻集成：`node --test scripts/test_core.mjs`
- 数据体检（改完数据必跑，复用 core.js 同源逻辑）：`node scripts/validate_data.mjs`
- 浏览器级冒烟（assets/strategy/defense/tax + 主题切换）：`node scripts/smoke_tabs.mjs`

**改动 SOP（数据相关）**

> 完整流程见 [skills/finance-data-update.md](file:///Users/bigcat/Library/Mobile%20Documents/com~apple~CloudDocs/Muse/projects/ai-finance-dashboard/skills/finance-data-update.md)（脚本优先，给任意 AI 用的安全通道）。

- **报数（只改数值）走脚本**：`python3 scripts/add_snapshot.py --show-keys` 看 key，再 `--set key.field=value` 报数。脚本自动备份 + 只 append 不覆盖 + 写后校验，别手改 `history.json`
- **手动改 JSON**（补流水 / 新增品种 / 改战略 / 改 changelog）前先 `python3 scripts/backup_data.py "说明"`（写入 `data/_backups/`，不入库）
- 改完一律 `node scripts/validate_data.mjs` 体检，再刷新页面确认无“加载失败/渲染异常”
