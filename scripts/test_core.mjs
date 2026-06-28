import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const projectRoot = path.resolve(import.meta.dirname, "..");
const coreSource = fs.readFileSync(path.join(projectRoot, "core.js"), "utf8");

function loadCore(options = {}) {
  const theme = options.theme || "light";
  const afdConfig = options.afdConfig || {};
  const fetchImpl = options.fetchImpl || (async () => ({ ok: true, json: async () => ({}) }));
  const store = new Map();
  const sandbox = {
    console,
    fetch: fetchImpl,
    document: {
      documentElement: {
        getAttribute(name) {
          if (name === "data-theme") return theme;
          return null;
        },
      },
    },
    window: {
      AFD_CONFIG: afdConfig,
      localStorage: {
        getItem(key) {
          return store.has(key) ? store.get(key) : null;
        },
        setItem(key, value) {
          store.set(key, String(value));
        },
      },
    },
  };
  sandbox.window.document = sandbox.document;
  vm.createContext(sandbox);
  vm.runInContext(coreSource, sandbox, { filename: "core.js" });
  return sandbox.window.AssetCore;
}

test("getDataPath 对敏感数据与共享数据分层路由", () => {
  const core = loadCore({ afdConfig: { dataDir: "data", sharedDir: "demo_data" } });
  assert.equal(core.getDataPath("target.json"), "./data/target.json");
  assert.equal(core.getDataPath("transactions/yearly/2026.json"), "./data/transactions/yearly/2026.json");
  assert.equal(core.getDataPath("policies.json"), "./demo_data/policies.json");
  assert.equal(core.getDataPath("risks.json"), "./demo_data/risks.json");
});

test("getMilestoneStats 兼容旧数组与新对象结构", () => {
  const core = loadCore();
  let stats = core.getMilestoneStats([{ done: true }, { done: false }]);
  assert.equal(stats.done, 1);
  assert.equal(stats.total, 2);
  stats = core.getMilestoneStats({ items: [{ done: false }, { done: false }, { done: true }] });
  assert.equal(stats.done, 1);
  assert.equal(stats.total, 3);
  stats = core.getMilestoneStats(null);
  assert.equal(stats.done, 0);
  assert.equal(stats.total, 0);
});

test("getEchartsTheme 根据页面主题返回正确初始化值", () => {
  assert.equal(loadCore({ theme: "dark" }).getEchartsTheme(), "dark");
  assert.equal(loadCore({ theme: "light" }).getEchartsTheme(), null);
});

test("fetchJson 在 HTTP 错误时返回 fallback 或抛出明确错误", async () => {
  const core = loadCore({
    fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }),
  });
  const fallback = await core.fetchJson("missing.json", { fallback: { ok: true } });
  assert.equal(fallback.ok, true);
  await assert.rejects(() => core.fetchJson("missing.json"), /missing\.json 加载失败（HTTP 404）/);
});

test("demo target.json 的 milestones 可被正确统计", () => {
  const core = loadCore();
  const demoTarget = JSON.parse(fs.readFileSync(path.join(projectRoot, "demo_data", "target.json"), "utf8"));
  const stats = core.getMilestoneStats(demoTarget.milestones);
  // 断言与 demo_data/target.json 当前内容对齐（数据更新后同步）
  const rawItems = Array.isArray(demoTarget.milestones)
    ? demoTarget.milestones
    : (demoTarget.milestones && demoTarget.milestones.items) || [];
  assert.equal(stats.total, rawItems.length);
  assert.equal(stats.done, rawItems.filter(x => x.done).length);
});
