# 资产配置看板 · asset_dashboard

> 配套文档：[[资产配置V2_0_战术执行手册]]
> 入口：`index.html` · 通过本地 HTTP 服务打开

## 如何把项目交给 AI

- 只让 AI **理解项目怎么用**：给 GitHub 仓库地址通常就够了，让它先读 README.md 和 AGENTS.md
- 让 AI **真正帮你改数据/跑脚本/起本地预览/做校验**：必须给它一个**本地项目副本**（直接打开本地文件夹、`git clone`、或下载 zip 解压都可以；zip 只是兜底方案）

## 文件结构

```
asset_dashboard/
├── index.html
├── app.js                     # 视图渲染（无依赖）
├── data/
│   ├── target.json            # 理想化目标 ← 改这里 = 改战略
│   └── history.json           # 历史快照（append-only） ← 改这里 = 报新数值
├── scripts/
│   └── fetch_rates.py         # 抓实时汇率
└── README.md
```

## 数据建模原则

### 1. 一个账户/标的 = 一个 sub
不再合并。例如腾讯持仓在 3 个账户里：

| key | 名称 | 账户 | 币种 |
|---|---|---|---|
| `tencent_futu`      | 腾讯（富途·HK）       | 富途牛牛  | HKD |
| `tencent_zhongyin`  | 腾讯（中银证券·港股通）| 中银证券  | RMB |
| `tencent_zhaoshang` | 腾讯（招商证券·港股通）| 招商证券  | RMB |

看板顶部 KPI 会把 `key` 以 `tencent_` 开头的所有子项合并算"单一公司红线"。

### 2. 汇率每次都抓
每次报数前都抓一次实时汇率，写进 snapshot 的 `rates` 字段，永不复用旧汇率：

```bash
cd memory/areas/life_planning/asset_dashboard
python3 scripts/fetch_rates.py            # 看一眼
python3 scripts/fetch_rates.py --json     # 输出 snapshot 模板
```

### 3. history.json append-only
每次报数 = append 一条新 snapshot，旧的原封不动。

```jsonc
{
  "snapshots": [
    { "date": "2026-05-16", "rates": {...}, "holdings": {...} },
    {
      "date": "2026-08-31",
      "rates": { "USD": 7.10, "HKD": 0.91 },
      "ratesSource": "open.er-api.com (...)",
      "comment": "Q3 复盘 / 卖了腾讯 80 万",
      "holdings": {
        "tencent_futu":     { "raw": 1800000 },
        "tencent_zhongyin": { "raw": 800000 }
      }
    }
  ]
}
```

> 缺失的 holdings key 按 0 计算。一次只填变化的资产即可，但建议每次都填全（防止遗忘）。

### 4. liabilities.json 负债清单

本金 + 利率 + 到期日。`type:"hard"`（硬性，扣减净资产）或 `"soft"`（软性，如向亲属借款无固定还款日，不计入净资产扣减）。**注意：当前看板按初始本金恒定展示，不按 `endDate` 做逐月摊销递减，利息按 `本金 × 利率` 静态估算。**

```jsonc
{
  "liabilities": [
    {
      "name": "房贷（自住房）",     // 表格项目列
      "type": "hard",              // hard=扣减净资产 / soft=软性不扣减
      "ccy": "RMB",                // 币种，按 rates 折 RMB 计入总负债
      "principal": 2000000,        // 本金（折 RMB 后进总负债合计）
      "interestRate": 0.042,       // 年化利率，表格利率列 pct() 展示
      "monthlyInterest": 7000,     // 月利息列（=本金×利率÷12，手填）
      "annualInterest": 84000,     // 年利息列 + KPI「年利息」合计
      "deductFromNet": true,       // true=从净资产扣减（与 type:"hard" 一致）
      "startDate": "2021-06",      // 生效起（accrual=monthly_inflow 类用动态累计，普通房贷不用）
      "endDate": "2046-06",        // 到期日（仅展示，不做摊销）
      "note": "占位示例，请替换为真实数据"
    }
  ]
}
```

字段对应 `liabilities.js` 的渲染列：本金 / 利率 / 月利息 / 年利息 / 性质（硬性·软性）/ 备注。

### 5. recurring.json 循环收支（工资 / 房租 / 保险 / 利息）

记录**规律性、可预测**的收入与支出（区别于 `transactions/yearly/*.json` 的逐笔实绩账单）。被三个 Tab 消费：负债与刚性 Tab（月度净流、年化保费、保单现金价值 KPI）、现金流 Tab（年度预算 vs 实际、刚性 vs 弹性占比）、资产配置 Tab（保单现金价值注入总盘）。

顶层两个数组：`incomes`（收入）、`expenses`（支出）。每项共用字段：

```jsonc
{
  "key": "salary_self",        // 唯一标识。现金流 Tab 里 transactions 的 recurring=<key> 字段按此挂钩实绩账单
  "name": "工资 · Self",        // 展示名
  "ccy": "RMB",                 // 原币种，按 rates 折 RMB
  "amount": 22000,              // 原币种金额。frequency=monthly→月额；annual→年额
  "frequency": "monthly",       // monthly | annual。月额在年化时 ×activeMonthsInYear，年额直接取
  "kind": "salary",             // 语义类型（见下表），驱动不同折算/通胀系数
  "startDate": null,            // 生效起（YYYY-MM 或 YYYY-MM-DD）；null 表示一直有效
  "endDate": null,              // 截止（同上）。activeMonthsInYear 用它判断当年是否仍在缴/收
  "note": "税后到手月薪 ~2.2w"
}
```

`kind` 取值与行为（`liabilities.js` 瀑布图、`cashflow.js` 年化）：

| kind | 含义 | 通胀系数（瀑布图逐年放大） |
|---|---|---|
| `salary` | 工资 | ×(1+通胀×0.7) |
| `rental_income` | 房租 | ×(1+通胀×0.5) |
| `insurance` | 保险保费（支出） | ×(1+通胀)；且合并入「保险池」 |
| `transport` / 其它 | 车险等其它刚性支出 | ×(1+通胀) |

**保险项的专属字段**（`kind:"insurance"` 的 expense，保单信息 + 现金价值时间序列）：

```jsonc
{
  "key": "ins_ci_kid_tiger",
  "name": "少儿重疾 · Kid2 50w",
  "ccy": "RMB",                 // 保费与 cashValueSchedule 金额都用此币种
  "amount": 800,
  "frequency": "annual",
  "kind": "insurance",
  "policyHolder": "Spouse",     // 投保人
  "insuredBy": "Kid2",          // 被保人
  "policyNo": "DEMO-INS-006",   // 保单号（⚠️ 真实 data/ 里是隐私，绝不提交、绝不在对话复述）
  "beneficiary": "Spouse",      // 受益人
  "coverage": 500000,           // 保额（原币种）
  "endDate": "2055-12-31",      // 保单满期
  "cashValueSchedule": {        // 现金价值（退保价值）年度时间序列，{年份:金额}，原币种
    "2026": 3200, "2028": 7800, "2030": 12800, "2035": 26500,
    "2040": 41000, "2045": 52000, "2050": 58000, "2055": 60000
  },
  "note": "现金价值随保单年度增长"
}
```

`cashValueSchedule` 维护要点（`core.js` `resolveCashValueForYear` + `injectInsuranceCashValue`）：

- key 是**年份字符串**（如 `"2026"`），value 是**保单原币种金额**（不是 RMB，按 `ccy` + 当年 `rates` 折算）。
- **缺失年份线性插值**：只填关键节点年份即可，中间年份自动算。早于首年取 0，晚于末年取末年值（现金价值表通常给到某保单年度后趋稳）。
- 取值年份由 snapshot 的 `date`（资产 Tab）/ 当前年份（负债 Tab KPI）决定——所以**报数时填的 snapshot 日期年份要和想取的现金价值年份对得上**。
- 所有保单当年现金价值合计会被注入 `history.json` 最新 snapshot 的 `holdings.insurance_cashvalue`，由 target.json「防御现金」模块的 `insurance_cashvalue` sub 承接，**参与总盘**。已存在 `insurance_cashvalue` 不覆盖，`sumRMB>0` 才写入。
- 兼容旧字段 `cashValueRMB`（字面 RMB，当当前值用，仅 schedule 缺失时兜底）——新数据建议直接用 `cashValueSchedule`。

**现金流 Tab 的实绩优先机制**（`cashflow.js`）：

- `transactions/yearly/YYYY.json` 里若某笔已对应 recurring 项，给该笔加 `"recurring": "<key>"`，现金流 Tab 用实绩跳过 recurring 侧的年化估算（**实绩优先**）。
- 保险特殊：所有保险实绩统一挂 `"recurring": "_insurance_pool"`（不是单张保单 key），recurring 侧的**所有** `kind:"insurance"` 项合并成一个「保险池」做预算 vs 实际对账。
- 非保险项按各自 `key` 逐项对账：`annualBudget = amount × (frequency===annual ? 1 : 12)` vs 当年实绩合计。

**改 recurring.json 的 SOP**（与改 data/ 通用 SOP 一致）：

1. 先备份：`python3 scripts/backup_data.py "改 recurring 说明"`（只改 demo_data 可跳过）。
2. `data/` 与 `demo_data/` 结构必须一致，改一份通常同步另一份。
3. 改完验 JSON：`python3 -c "import json; json.load(open('data/recurring.json'))"`。
4. 退休年份联动：`target.json` 的 `retirement.selfRetireYear` 改了，要同步改这里 `salary_*` 的 `endDate`（反之亦然）。
5. 保单号、保费金额属隐私，`data/` 版本绝不提交 git，也绝不在对话里复述具体数字。

### 6. target.json 中的不动产 sub（收租房产）

不动产在「保本升值（长期稳健）」象限下，**维护口径与金融资产不同**——它不套单一公司 5% 红线，且在「金融盘」口径里被剔除。关键字段：

```jsonc
{
  "key": "property_core",        // 唯一标识，holdings 里按此 key 报数；key 各家不同（property_core / lishuiqiao_property 都行）
  "name": "核心城市房产（收租型）",
  "ccy": "RMB",                  // 房产原币，按 rates 折 RMB
  "venue": "不动产",             // ⚠️ 必须是"不动产"。core.js 靠这个标记判定房产，不是靠 key
  "subTargetPct": 0.3064,        // 子项目标占比（四象限内部再分配）
  "subThresholdPct": 0.05,       // 子项偏离阈值（仅提醒）
  "phase": "active",             // active=持有 / planned=计划 / closed=已退出 / exit=待变现
  "expectedReturn": {            // 预期年化，三档情景
    "conservative": 0.012,
    "neutral": 0.02,
    "optimistic": 0.03,
    "yieldOnly": true,           // true=只算租金 yield，不算房价升值（房产默认）
    "source": "一线城市租金 yield 2-3%，扣空置/维护取 1.2-3%"
  },
  "note": ""
}
```

维护要点（`venue:"不动产"` 是核心标记，改一处口径三处生效）：

| 口径 | 行为 | 出处 |
|---|---|---|
| 单一公司红线 | **不动产不套 5% 红线**（收租房产不是单股） | `core.js` healthCheck 跳过 `venue==="不动产"` |
| 金融盘 vs 整体盘 | 不动产计入**整体盘**总盘，但**剔除出金融盘** | `core.js` enrichSnapshot `financialTotal` 跳过不动产 |
| 加权预期年化 | `excludeRealEstate` 选项下剔除；含房产时按 `yieldOnly` 只取租金 | `core.js` weightedExpectedReturn |
| 报数 | 房产估值随市场变，每次 snapshot 在 `holdings[property_core].raw` 填最新估值 | history.json append-only |

> 报房产估值时和报股票一样 append snapshot，但估值口径要稳定（同一种估值方法，别一会按购入价一会按挂牌价）。`venue` 写错成"房产"或"A 股"会导致它被误判进金融盘并套上单一公司红线。

### 7. target.json 中的通用 sub 字段（股票 / 基金 / 房产通用）

上面第 6 节是不动产的特殊口径。所有 sub（含股票/基金）共用下面这套字段，以一个待清仓的腾讯持仓为例：

```jsonc
{
  "key": "tencent_futu",        // 唯一标识。history.json 的 holdings 按此报数（holdings.tencent_futu.raw）。
                                 //   tencent_ 前缀的 sub 会被合并算"单一公司敞口"红线
  "name": "腾讯（富途·HK）",      // 展示名（表格/卡片显示的中文名）
  "ccy": "HKD",                  // 原币种。sub.rmb = raw × rates[ccy]；三币种物理隔离，海外池/人民币池不互补
  "venue": "富途牛牛",            // 持仓账户/通道，仅展示用。⚠️ 不动产必须精确写 "不动产"（见第 5 节）
  "subTargetPct": 0.0,           // 子项目标占比（占总盘）。0.0 = 清仓目标，不打算持有
  "subThresholdPct": 0.02,       // 子项偏离阈值（±2%），仅提醒不强制；象限 module.thresholdPct 才强制
  "phase": "exit",               // 生命周期：active=持有 / planned=计划建仓 / closed=已退出 / exit=待变现 / pending=待定
                                 //   exit 会被算进"待变现资产"健康检查告警
  "expectedReturn": {            // 预期年化收益，三档情景，按各 sub 的 RMB 加权算"加权预期年化"
    "conservative": 0.03,        // 保守
    "neutral": 0.06,             // 中性
    "optimistic": 0.1            // 乐观
    // "yieldOnly": true,        // （房产专用）true=只算租金 yield 不算房价升值
    // "source": "..."           // （可选）收益假设来源说明
  },
  "note": "**清仓目标**：成本价高、税少，卖出 → 转 VOO"  // 备注，支持 markdown，展示在子项明细
}
```

**两层目标别混淆**：象限 `module.targetPct`（如四象限 40%）是大类目标，`sub.subTargetPct` 是子项在总盘里的再分配——两者独立，子项之和不必等于象限目标（看板会分别算偏离）。

**`phase` 取值是固定枚举，别写错**：`active` / `planned` / `closed` / `exit` / `pending`。写错会导致待变现告警漏报或误报。

**这个 sub 的整体语义**：腾讯在富途账户的持仓，目标占比 0%（要清仓），当前处于待变现阶段，预期年化中性 6%，备注写了清仓理由和资金去向（转 VOO）。

## 怎么报新数值

直接对小龙猫说：

> 报数：今天微众活期 X 万、富途货基 Y 美元、腾讯（富途）Z 港币……

小龙猫会：
1. `python3 scripts/fetch_rates.py` 抓实时汇率
2. 在 `history.json` 末尾 append 一条新 snapshot
3. 不动 `target.json`（除非你说要改战略）

## 模块结构（target.json · 标普家庭资产四象限）

| 象限 | 目标 | 阈值 | 子项 |
|---|---:|---:|---|
| 一·日常现金（要花的钱） | 10% | ±3% | 微众活期 / 国债阶梯 / 短债 ETF / 美元货基 / 美国国债 |
| 二·保命的钱（保障保险） | 20% | ±3% | 保单现金价值 / IAU 黄金 / 实物金条 / 华安黄金 ETF |
| 三·生钱的钱（投资收益） | 30% | ±5% | CSPX/标普 / QQQM/纳指 / VOO / BRK.B / 腾讯×3 |
| 四·保本升值（长期稳健） | 40% | ±5% | 红利低波 515450 / 红利低波 563020 |

> **注意：** 面板展示的"当前目标占比"可以根据家庭不同阶段灵活调整，例如资产变现或追加投资后，只需在 `target.json` 中调整 `targetPct` 即可。标准普尔四象限（10/20/30/40）为参考基准，实际配置可按家庭阶段偏离。

### 不动产单列（realEstate segment）

不动产（`venue:"不动产"`）**已从四象限剥离**，放在 `target.json` 顶层 `realEstate` 数组（形态类似 `souvenirs`），与四象限并列：

- **计入总盘**：不动产市值照旧计入 `cur.total` / `cur.ccyTotals`，所有 KPI（总资产、单一公司敞口、RMB 占比、复利预测、Coast FIRE）的总盘口径**不变**。
- **不参与四象限偏离**：四象限的 `actualPct / delta / status` 及健康检查的"象限偏离"告警改用**金融盘口径**（分母为 `financialTotal`，已剔除不动产），让四象限回归纯金融资产的配置指导。
- 单独渲染为"不动产"卡片（四象限模块列表下方），展示市值与占整体盘比例（分母仍是全盘 `total`）。

```jsonc
"realEstate": [
  { "key":"property_core", "name":"核心城市房产（收租型）", "ccy":"RMB", "venue":"不动产",
    "subTargetPct":0.3064, "phase":"active", "expectedReturn":{...,"yieldOnly":true} }
]
```

> 不动产的 `key` 仍要和 `history.json` 的 `holdings` 报数 key 对齐。`venue:"不动产"` 标记保留——`core.js` 靠它判定房产口径（金融盘剔除、单一公司红线跳过），剥离后这套判定依然生效。

## 双层阈值

- **大类（象限）**：`module.thresholdPct`（图片里的 ±3%/±5%）
- **子项**：`sub.subThresholdPct`（独立计算，不影响大类）

红色 over / 黄色 under / 静音 ok。看板会同时标红/标黄。

## 计算逻辑

```
sub.rmb        = sub.raw × rates[sub.ccy]
module.total   = sum(subs.rmb)
total          = sum(modules.total)
module.actual  = module.total / total
sub.actual     = sub.rmb / total
```

## 看板能力

| 区块 | 输出 |
|---|---|
| 顶部 KPI | 总盘 / 模块+子项告警数 / 腾讯合并敞口 / RMB 占比 + 环比 |
| 模块画像 | 每个象限一张卡：进度条 + 目标线 + 阈值带 + 子项明细（含账户） |
| 偏离告警表 | 双层状态（象限 + 子项）一览 |
| 币种分布 | RMB/USD/HKD + 红线判定 |
| 趋势图 | 总盘 / RMB 占比 / 腾讯敞口 / 告警数（红线虚线） |
| 时间线 | 历次快照可点击切换；显示备注 + 环比 |

## 本地预览

```bash
cd memory/areas/life_planning/asset_dashboard
python3 -m http.server 8765
# 浏览器打开 http://localhost:8765
```

⚠️ 必须用 HTTP，不能 `file://`（fetch JSON 会被浏览器拦）。

## 红线参考（来自战术执行手册 V2.0）

| 红线 | 阈值 | 触发动作 |
|---|---|---|
| 单一公司持仓（合并所有账户） | > 5% | 当周内卖到 5% 以下 |
| 单一币种 | > 70% | 触发换汇/再平衡 |
| 象限偏离 | > ±2~5% | 季度末再平衡 |
| 腾讯单只 | 跌破 200 周均线 | 砍 1/3，不论价格 |
| 杠杆 | 任何 Margin | 立刻关闭 |
