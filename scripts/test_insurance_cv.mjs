import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const projectRoot = path.resolve(import.meta.dirname, "..");
const coreSource = fs.readFileSync(path.join(projectRoot, "core.js"), "utf8");
const liabilitiesSource = fs.readFileSync(path.join(projectRoot, "liabilities.js"), "utf8");

function loadChart(year = 2026) {
  const container = { innerHTML: "" };
  const charts = [];
  const sandbox = {
    console,
    Date: class extends Date {
      constructor() { super(year, 5, 15); }
    },
    document: {
      querySelector: () => container,
    },
    window: { addEventListener() {} },
    echarts: {
      init() {
        const chart = {
          options: null,
          actions: [],
          disposed: false,
          resizeCount: 0,
          setOption(options) { this.options = options; },
          dispatchAction(action) { this.actions.push(action); },
          dispose() { this.disposed = true; },
          isDisposed() { return this.disposed; },
          resize() { this.resizeCount++; },
        };
        charts.push(chart);
        return chart;
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(coreSource, sandbox, { filename: "core.js" });
  sandbox.window.AssetCore.fetchJson = () => new Promise(() => {});
  vm.runInContext(
    liabilitiesSource.replace(/\}\)\(\);\s*$/, "globalThis.renderChart = renderInsuranceCVChart;\n})();"),
    sandbox,
    { filename: "liabilities.js" },
  );
  return { render: sandbox.renderChart, charts, core: sandbox.window.AssetCore, container };
}

const recurring = {
  expenses: [
    { kind: "insurance", name: "Policy A", ccy: "RMB", cashValueSchedule: { 2024: 100, 2028: 500 } },
    { kind: "insurance", name: "Policy B", ccy: "USD", cashValueSchedule: { 2026: 10, 2030: 50 } },
  ],
};

test("insurance curve selects the current calendar year and shows policy totals", () => {
  const { render, charts } = loadChart();
  render(recurring, { USD: 7 });
  const chart = charts[0];
  const action = chart.actions[0];
  assert.equal(action.type, "showTip");
  assert.equal(chart.options.xAxis.data[action.dataIndex], "2026");
  assert.equal(action.seriesIndex, chart.options.series.length - 1);
  assert.equal(chart.options.tooltip.trigger, "axis");
  assert.equal(chart.options.tooltip.alwaysShowContent, true);
  assert.equal(chart.options.series[0].data[action.dataIndex], 300);
  assert.equal(chart.options.series[1].data[action.dataIndex], 70);
  assert.equal(chart.options.series[action.seriesIndex].data[action.dataIndex], 370);
});

test("insurance curve includes this year when all policies start in the future", () => {
  const { render, charts } = loadChart();
  render({ expenses: [recurring.expenses[1]] }, { USD: 7 });
  assert.equal(charts[0].options.xAxis.data[charts[0].actions[0].dataIndex], "2026");

  const future = loadChart(2025);
  future.render({ expenses: [recurring.expenses[1]] }, { USD: 7 });
  const chart = future.charts[0];
  assert.equal(chart.options.xAxis.data[0], "2025");
  assert.equal(chart.actions[0].dataIndex, 0);
  assert.equal(chart.options.series[0].data[0], 0);
});

test("insurance curve follows the calendar year instead of hard-coding it", () => {
  const { render, charts } = loadChart(2035);
  render(recurring, { USD: 7 });
  const chart = charts[0];
  assert.equal(chart.options.xAxis.data[chart.actions[0].dataIndex], "2035");
  assert.equal(chart.options.xAxis.data.at(-1), "2045");
});

test("insurance curve resizes on tab activation and disposes the previous chart", () => {
  const { render, charts, core } = loadChart();
  render(recurring, { USD: 7 });
  core.resizeAllCharts();
  assert.equal(charts[0].resizeCount, 1);
  render(recurring, { USD: 7 });
  assert.equal(charts[0].disposed, true);
  core.resizeAllCharts();
  assert.equal(charts[0].resizeCount, 1);
  assert.equal(charts[1].resizeCount, 1);
  assert.equal(core._charts.length, 1);
});

test("insurance curve keeps the empty state when no policies are configured", () => {
  const { render, charts, container } = loadChart();
  render({ expenses: [] }, {});
  assert.equal(charts.length, 0);
  assert.match(container.innerHTML, /cashValueSchedule/);
});
