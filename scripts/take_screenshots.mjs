#!/usr/bin/env node
/**
 * 用 puppeteer-core + 本机 Google Chrome 给三个 Tab 各截一张 PNG。
 * - 等待 fetch 完成、KPI 渲染好之后再截图
 * - 自动按 body 实际高度截全页
 *
 * 用法：
 *   node take_screenshots.mjs              # 默认 8765 端口、3x retina
 *   node take_screenshots.mjs 8765 2       # 指定端口和倍率
 *   SCALE=4 node take_screenshots.mjs      # 也可以用环境变量
 *
 * 依赖：先在 /tmp/puppeteer-test 装好 puppeteer-core
 */
import puppeteer from "/tmp/puppeteer-test/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";
import { mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, "..");
const PORT = process.argv[2] || "8765";
const SCALE = Number(process.argv[3] || process.env.SCALE || 3);
const VIEW_W = Number(process.env.VIEW_W || 1600);
const VIEW_H = Number(process.env.VIEW_H || 900);
const URL_BASE = `http://127.0.0.1:${PORT}/index.html`;
const OUT_DIR = resolve(PROJECT_DIR, "screenshots");

const TABS = [
  { tab: "assets", file: "01_assets.png", label: "📊 总览" },
  { tab: "money",  file: "02_money.png", label: "💸 现金与负债" },
  { tab: "risk",   file: "03_risk.png", label: "🛡️ 风险与宏观" },
];

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

mkdirSync(OUT_DIR, { recursive: true });

console.log(`🚀 启动 Chrome（${VIEW_W}×${VIEW_H} @ ${SCALE}x）...`);
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  defaultViewport: { width: VIEW_W, height: VIEW_H, deviceScaleFactor: SCALE },
  args: ["--hide-scrollbars", "--disable-gpu", "--no-sandbox"],
});

try {
  for (const { tab, file, label } of TABS) {
    const url = `${URL_BASE}#${tab}`;
    const out = resolve(OUT_DIR, file);
    console.log(`📸 ${label} → ${out}`);

    const page = await browser.newPage();
    await page.setViewport({ width: VIEW_W, height: VIEW_H, deviceScaleFactor: SCALE });
    await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });

    // 等到对应 Tab 的 KPI 容器有内容（KPI 由 JS 异步写入）
    const kpiSelector = {
      assets: "#kpis .kpi",
      money:  "#liab-kpis .kpi",
      risk:   "#risk-kpis .kpi",
    }[tab];

    try {
      await page.waitForSelector(kpiSelector, { timeout: 10000 });
      await page.waitForFunction(
        (sel) => {
          const els = document.querySelectorAll(sel);
          return els.length >= 3;
        },
        { timeout: 10000 },
        kpiSelector,
      );
    } catch (e) {
      console.warn(`   ⚠️ 未等到 KPI（${kpiSelector}）渲染：${e.message}`);
    }

    // 给 SVG / 字体一点喘息时间
    await new Promise(r => setTimeout(r, 800));

    await page.screenshot({ path: out, fullPage: true, type: "png" });

    const size = statSync(out).size;
    const dims = await page.evaluate(() => ({
      w: document.documentElement.scrollWidth,
      h: document.documentElement.scrollHeight,
    }));
    console.log(`   ✅ ${(size / 1024).toFixed(0)} KB · ${dims.w * SCALE}×${dims.h * SCALE}px`.replace("SCALE", SCALE));
    await page.close();
  }
} finally {
  await browser.close();
}

console.log("\n🎉 完成。三张图在：", OUT_DIR);

