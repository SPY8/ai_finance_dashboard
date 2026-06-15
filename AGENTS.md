# AGENTS.md — 资产看板模块导读

> 这是 `memory/areas/life_planning/asset_dashboard/` 目录的工作指南，读完再动手改任何文件。

---

## 你在哪

这是大猫的家庭财务看板，跑在浏览器里（HTML + JS + JSON 的纯静态站点），用来跟踪：

- **资产配置** — 三本账之一：股票/现金/房产分布、目标偏离、模块/子项告警
- **负债与刚性支出** — 三本账之二：保险、房租、利息、循环开销
- **现金流追踪** — 三本账之三：年度收支按类目/人员汇总，含工资/股票兑现/退休时间线

口径：**RMB 计价，三币种物理隔离（RMB / USD / HKD），人民币池和海外池资金不互相补位。**

---

## 如何把项目交给 AI

- 只让 AI **理解项目怎么用**：给 GitHub 仓库地址通常就够了，让它先读 README.md 和 AGENTS.md
- 让 AI **真正动手改文件/跑脚本/起预览**：必须给它一个**本地项目副本**（直接打开本地文件夹、`git clone`、或下载 zip 解压都可以；zip 只是兜底方案）

---

## 文件结构

```
asset_dashboard/
├── index.html                  # 三 Tab 主入口
├── core.js                     # 共享工具：fmt/fmtK/pct/parseDate/enrichSnapshot/healthCheck/reconcile/...
├── app.js                      # Tab 1: 资产配置（KPI/模块/告警/趋势/池分离/增长预测/Target/里程碑/腾讯阶梯）
├── liabilities.js              # Tab 2: 负债与刚性（KPI/负债清单/月度循环/保单日历/20年瀑布）
├── cashflow.js                 # Tab 3: 现金流追踪（年度KPI/类目分布/人员分布/预算 vs 实际/明细）
├── README.md                   # 数据建模原则
├── AGENTS.md                   # 本文件 — 给下一个 AI 看
├── data/                       # **被 .gitignore 屏蔽**，仅靠 iCloud 同步
│   ├── target.json             # 终局目标（modules / philosophy / redLines / inflation / retirement / milestones）
│   ├── history.json            # append-only 快照数组
│   ├── liabilities.json        # 父亲借款 + 妈妈月存（软性负债）
│   ├── recurring.json          # 循环收支：工资 / 房租 / 保险 / 利息 / 退休后零散收入
│   ├── income_events.json      # 一次性事件：股票兑现 / 离职大礼包 / 项目分红
│   ├── categories.json         # 支出/收入分类 + 人员
│   ├── transactions/index.json # 年度账单索引
│   ├── transactions/yearly/    # 每年一份 YYYY.json
│   ├── _schemas.example.json   # **唯一上 git 的数据示例文件**（脱敏，给新机器/新 AI 参考）
│   ├── .gitkeep                # 目录占位
│   └── _backups/               # 自动备份（不上 git，仅本地）
└── scripts/
    ├── fetch_rates.py          # 抓 USD/HKD 汇率
    ├── new_snapshot.py         # 报数助手
    └── backup_data.py          # **每次改 data/ 之前先跑一次**
```

---

## 改动 SOP（必读）

**任何对 data/ 的修改之前，先备份。**

```bash
cd memory/areas/life_planning/asset_dashboard
python3 scripts/backup_data.py "本次改动的简短说明"
```

会复制当前 data/ 到 `data/_backups/<时间戳>/`，自动保留最近 20 份。

修改完之后：

1. 跑 `python3 -c "import json; [json.load(open(f'data/{p}')) for p in ('target.json','history.json','recurring.json','liabilities.json','categories.json','income_events.json','transactions/index.json','transactions/yearly/2025.json','transactions/yearly/2026.json')]; print('OK')"` 验证 JSON
2. 浏览器刷新看板，看健康检查 banner 有没有红色 / 看 console 有无报错
3. 在 `target.json` 的 `changelog` 里 append 一条变更说明（数据级别的版本号）

---

## 安全红线

1. **绝不把 data/ 任何文件提交到 git。** 它们包含真实持仓、工资、保单号、保险账号密码（recurring.json 的备注字段里）。已经在根 `.gitignore` 里 `memory/areas/life_planning/asset_dashboard/data/` 屏蔽。
2. **绝不在对话里复述 data/ 里的具体金额、保单号、账号、价格。** 用户没主动问就不要主动报。
3. **绝不在脚本里硬编码任何凭据。** 现在没有，未来也不许加。
4. data/ 里的注释字段如果含账号密码（比如 AIA 内部账号），保持原样不要清理 — 那是大猫自己留给自己的。但**不要复述出来**。

---

## 收入流的扇形（重要）

大猫现在的"收入河"分成三段，分别落在不同文件里：

### A. 工作期（现在 → 2027-06，退休前）

- `recurring.json` 的 `incomes`：
  - `salary_self` — 大猫月薪 4.5w（含 13 薪平均），endDate 设为 `2027-06`
  - `salary_wife` — 马总月薪 1.8w，endDate 同步
- `income_events.json`：
  - `tencent_vest_2026` / `tencent_vest_2027` — 腾讯归属股票兑现，按 RSU 分批
  - `severance_2027` — 离职大礼包（N+1 或协议价），税后净额

### B. 退休后稳态（2027-07 起）

- `recurring.json` 的 `incomes`：
  - `qianhai_rent` — 前海租金 8888/月
  - `mom_deposit` — 妈妈月存 1000/月（软负债同时是软收入）
  - `side_gig_post_retire` — 退休后零散收入估月 3000，跑 5 年（2027-07 → 2032-12）
- 投资收益：通过资产配置 Tab 的"金融盘预期年化"反映，不在 recurring.json

### C. 偶发（任何时点）

- `income_events.json` 任意 year 都可以塞条目，只要 `amount > 0` 就会入到瀑布图当年的收入条 + 蓝色 💎 chip

### 双重计算保护

如果一笔工资/房租在 `recurring.json` 里定义了，又在 `transactions/yearly/YYYY.json` 里实绩记录了，请在 yearly 那条上加 `recurring: <key>` 字段。`cashflow.js` 会优先用实绩，跳过 recurring 那侧。保险池的 key 用 `_insurance_pool`。

---

## 退休假设的影响面

`target.json` 的 `retirement` 字段：

```json
{
  "selfRetireYear": 2027,
  "wifeRetireYear": 2027,
  "selfSalaryAnnual": 540000,
  "wifeSalaryAnnual": 216000,
  "stayInChina": true,
  "kidsAbroad": false
}
```

这个对象被以下地方读取：

- `app.js` → 退休缺口 KPI（年开销 vs 被动收入）
- `liabilities.js` → 瀑布图的"🎯 退休"里程碑标记 + 过渡期/稳态净流 KPI
- `liabilities.js` → 排除 salary 类型的退休稳态计算

如果改 `selfRetireYear`，**还要同步改 `recurring.json` 里 salary_* 的 endDate**。

---

## 调试

- 本地预览：`python3 -m http.server 8765` 然后 `http://127.0.0.1:8765`（已经在跑就别再起）
- 改 JS 后浏览器硬刷新 Cmd+Shift+R
- 控制台错误大概率是 JSON 数据问题；先 `python3 -c "import json; json.load(open('data/xxx.json'))"` 验证
- 如果改坏了，从 `data/_backups/` 选最近一份恢复：`cp -r data/_backups/<时间戳>/* data/`

---

## 哲学

不是基金组合，是一台"家庭被动现金流机器"：房租 + 股息 + 国债票息 + 黄金/科技对冲。

Target 是终局态，假设鼎太已变现并完成重分配。RMB 池 vs USD/HKD 池物理隔离。子项阈值仅作"看一眼"提醒，唯一强制触发的是红线和大类阈值。

收益率假设保守版用于 FIRE 安全测算；标普 6% / 黄金 4% / 房产仅算租金 yield 不算升值。

---

## 维护节奏

- **季度末**：报一次数（append history.json snapshot），看 Health Check banner 是否有红线告警
- **年底**：补一份 `transactions/yearly/YYYY.json` 完整账单，把 partial_with_projection 改 complete
- **里程碑**：达成时把 target.json 的 milestones 改 `done: true` 并加 note
- **重大假设变化**（如不退休/孩子改留学/加大 RMB 红线）：改 target.json 的 assumptions/redLines，写 changelog
