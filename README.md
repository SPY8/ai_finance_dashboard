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

## 怎么报新数值

直接对小龙猫说：

> 报数：今天微众活期 X 万、富途货基 Y 美元、腾讯（富途）Z 港币……

小龙猫会：
1. `python3 scripts/fetch_rates.py` 抓实时汇率
2. 在 `history.json` 末尾 append 一条新 snapshot
3. 不动 `target.json`（除非你说要改战略）

## 模块结构（target.json · V2.1）

| 大类 | 目标 | 阈值 | 子项 |
|---|---:|---:|---|
| 一·防御现金 | 16% | ±3% | 微众活期 / 美元货币基金 / 美国国债 |
| 二·稳健现金流 | 66% | ±5% | 前海自住房 / 鼎太待售房产 / 红利低波 512890 |
| 三·全球增长 | 10% | ±5% | CSPX/标普 / QQQM/纳指 / BRK.B / 易方达高股息HK / 恒生科技HK |
| 四·避险卫星 | 8% | ±2% | IAU 黄金 / 腾讯×3 账户 |

> **注意：** 面板展示的“当前目标占比”可以根据家庭不同阶段灵活调整，例如资产变现或追加投资后，只需在 `target.json` 中调整 `targetPct` 即可。

## 双层阈值

- **大类**：`module.thresholdPct`（图片里的 ±3%/±5%/±2%）
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
| 模块画像 | 每个大类一张卡：进度条 + 目标线 + 阈值带 + 子项明细（含账户） |
| 偏离告警表 | 双层状态（大类 + 子项）一览 |
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
| 大类偏离 | > ±2~5% | 季度末再平衡 |
| 腾讯单只 | 跌破 200 周均线 | 砍 1/3，不论价格 |
| 杠杆 | 任何 Margin | 立刻关闭 |
