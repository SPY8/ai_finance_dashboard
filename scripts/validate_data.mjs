#!/usr/bin/env node
/**
 * 一键数据体检 —— 改完任何数据后跑一下，绿了才算完。
 *
 * 复用 core.js（和看板渲染同一份逻辑，不会出现「脚本说没事、看板却炸」）：
 *   - JSON 合法性：history.json / target.json 能否解析
 *   - 快照时序：snapshots 是否按 date 升序、有无重复日期
 *   - 持仓 key 缩水：最新快照的 holdings key 数是否比上一条显著变少（疑似漏继承）
 *   - target 权重和：大类 targetPct 之和 == 100%、子项之和 == 大类（core.runAssertions）
 *   - 红线/告警：core.healthCheck（单一公司敞口 / RMB 占比 / 大类偏离）
 *
 * 退出码：
 *   0  通过（可能有 warn/info 提示，不致命）
 *   1  有致命错误（JSON 非法 / runAssertions 报错 / 时序错乱）
 *
 * 用法：
 *   node scripts/validate_data.mjs                 # 默认体检 data/（真实数据）
 *   node scripts/validate_data.mjs --data-dir demo_data
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const projectRoot = path.resolve(import.meta.dirname, "..");

// —— 解析 --data-dir，默认 data/，不存在则回退 demo_data ——
function parseDataDir() {
  const idx = process.argv.indexOf("--data-dir");
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  if (fs.existsSync(path.join(projectRoot, "data", "history.json"))) return "data";
  return "demo_data";
}
const dataDir = parseDataDir();
const dataPath = path.join(projectRoot, dataDir);

const errors = [];   // 致命，exit 1
const warns = [];    // 提示，exit 0

function loadJson(rel) {
  const p = path.join(dataPath, rel);
  if (!fs.existsSync(p)) {
    errors.push(`找不到 ${dataDir}/${rel}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (err) {
    errors.push(`${dataDir}/${rel} JSON 非法：${err.message}`);
    return null;
  }
}

// —— 在 vm 沙箱里加载 core.js，拿到 window.AssetCore ——
function loadCore() {
  const coreSource = fs.readFileSync(path.join(projectRoot, "core.js"), "utf8");
  const sandbox = {
    console,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    document: { documentElement: { getAttribute: () => null } },
    window: {
      AFD_CONFIG: { dataDir, sharedDir: "demo_data" },
      localStorage: { getItem: () => null, setItem: () => {} },
    },
  };
  sandbox.window.document = sandbox.document;
  vm.createContext(sandbox);
  vm.runInContext(coreSource, sandbox, { filename: "core.js" });
  return sandbox.window.AssetCore;
}

function parseDate(s) {
  const [y, m, d] = String(s || "").split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1).getTime();
}

// ========== 1. 加载 + JSON 合法性 ==========
const history = loadJson("history.json");
const target = loadJson("target.json");

// ========== 2. 快照时序 ==========
let snaps = [];
if (history) {
  snaps = history.snapshots || [];
  if (snaps.length === 0) {
    errors.push("history.json 没有任何快照");
  } else {
    const seen = new Set();
    for (let i = 1; i < snaps.length; i++) {
      const prev = parseDate(snaps[i - 1].date);
      const cur = parseDate(snaps[i].date);
      if (cur < prev) {
        errors.push(`快照时序错乱：第 ${i} 条 ${snaps[i].date} 早于前一条 ${snaps[i - 1].date}`);
      }
    }
    snaps.forEach((s) => {
      if (seen.has(s.date)) warns.push(`存在重复日期的快照：${s.date}`);
      seen.add(s.date);
    });

    // ========== 3. 持仓 key 缩水检测 ==========
    if (snaps.length >= 2) {
      const last = snaps[snaps.length - 1];
      const prev = snaps[snaps.length - 2];
      const lastKeys = new Set(Object.keys(last.holdings || {}));
      const prevKeys = Object.keys(prev.holdings || {});
      const dropped = prevKeys.filter((k) => !lastKeys.has(k));
      if (dropped.length > 0) {
        warns.push(
          `最新快照(${last.date}) 比上一条少了 ${dropped.length} 个持仓 key：${dropped.join(", ")}` +
            `（确认是清仓还是漏继承？清仓应保留 key 并设 shares/raw=0）`
        );
      }
    }
  }
}

// ========== 4 & 5. core.js 断言 + 健康检查 ==========
if (history && target && snaps.length > 0 && errors.length === 0) {
  try {
    const core = loadCore();
    const last = snaps[snaps.length - 1];
    const cur = core.enrichSnapshot(last, target);

    core.runAssertions(cur, target).forEach((e) => errors.push(`断言失败：${e}`));
    core.healthCheck(cur, target).forEach((issue) => {
      const msg = `[${issue.level}] ${issue.title} — ${issue.detail}`;
      if (issue.level === "danger") warns.push("红线：" + msg);
      else warns.push(msg);
    });
  } catch (err) {
    errors.push(`core.js 校验执行失败：${err.message}`);
  }
}

// ========== 输出 ==========
console.log(`\n🩺 数据体检 · 目录 = ${dataDir}/  · 快照 ${snaps.length} 条\n`);
if (warns.length) {
  console.log("⚠️  提示 / 告警（不致命）：");
  warns.forEach((w) => console.log("   - " + w));
  console.log("");
}
if (errors.length) {
  console.log("❌ 致命错误：");
  errors.forEach((e) => console.log("   - " + e));
  console.log("\n体检未通过，请修复后重跑。");
  process.exit(1);
}
console.log("✅ 体检通过" + (warns.length ? "（含上述非致命提示）" : "，无任何问题") + "。");
process.exit(0);
