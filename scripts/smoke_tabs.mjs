#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "/tmp/puppeteer-test/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, "..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".png")) return "image/png";
  return "text/plain; charset=utf-8";
}

function startServer(rootDir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const reqPath = decodeURIComponent((req.url || "/").split("?")[0]);
      const clean = reqPath === "/" ? "/index.html" : reqPath;
      const fullPath = path.join(rootDir, clean);
      if (!fullPath.startsWith(rootDir)) {
        res.writeHead(403).end("Forbidden");
        return;
      }
      fs.readFile(fullPath, (err, buf) => {
        if (err) {
          res.writeHead(404).end("Not Found");
          return;
        }
        res.writeHead(200, { "Content-Type": contentType(fullPath), "Cache-Control": "no-store" });
        res.end(buf);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

async function assertNoRuntimeErrors(page, stage) {
  const state = await page.evaluate(() => {
    const text = document.body ? document.body.innerText : "";
    return {
      loadFailed: /加载失败|渲染异常|Target Tab 加载失败|Risk Policy Tab 加载失败/.test(text),
      theme: document.documentElement.getAttribute("data-theme"),
    };
  });
  if (state.loadFailed) throw new Error(`${stage}: 页面出现加载失败提示`);
  return state;
}

const { server, port } = await startServer(PROJECT_DIR);
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  defaultViewport: { width: 1440, height: 960, deviceScaleFactor: 2 },
  args: ["--hide-scrollbars", "--disable-gpu", "--no-sandbox"],
});

const page = await browser.newPage();
const consoleErrors = [];
function shouldIgnoreResource(url) {
  return /\/config\.js(\?|$)|\/favicon\.ico(\?|$)/i.test(url);
}
page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
page.on("response", (res) => {
  if (res.status() >= 400 && !shouldIgnoreResource(res.url())) {
    consoleErrors.push(`http ${res.status()}: ${res.url()}`);
  }
});
page.on("console", (msg) => {
  if (msg.type() === "error" && !/Failed to load resource/i.test(msg.text())) {
    consoleErrors.push(`console: ${msg.text()}`);
  }
});

try {
  const base = `http://127.0.0.1:${port}/index.html`;
  await page.goto(base, { waitUntil: "networkidle0", timeout: 30000 });
  await page.waitForSelector("#kpis .kpi", { timeout: 15000 });
  let state = await assertNoRuntimeErrors(page, "assets");
  console.log(`assets ok, theme=${state.theme}`);

  const beforeTheme = state.theme;
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 30000 }),
    page.click("#theme-toggle"),
  ]);
  state = await assertNoRuntimeErrors(page, "theme-toggle");
  if (state.theme === beforeTheme) throw new Error("theme-toggle: 主题未切换");
  console.log(`theme toggle ok, ${beforeTheme} -> ${state.theme}`);

  await page.click('.tab-btn[data-tab="strategy"]');
  await page.waitForSelector("#target-kpis .kpi", { timeout: 15000 });
  await page.waitForSelector("#target-content section", { timeout: 15000 });
  await assertNoRuntimeErrors(page, "strategy");
  console.log("strategy ok");

  await page.click('.tab-btn[data-tab="defense"]');
  await page.waitForSelector("#risk-kpis .kpi", { timeout: 15000 });
  await page.waitForSelector(".arsenal-card, #risk-map .risk-node", { timeout: 15000 });
  await assertNoRuntimeErrors(page, "defense");
  console.log("defense ok");

  await page.click('.tab-btn[data-tab="tax"]');
  await page.waitForSelector("#tax-kpis .kpi", { timeout: 15000 });
  await page.waitForSelector("#tax-content .lia-card, #tax-content", { timeout: 15000 });
  await assertNoRuntimeErrors(page, "tax");
  console.log("tax ok");

  if (consoleErrors.length) throw new Error(consoleErrors.join("\n"));
  console.log("smoke passed");
} finally {
  await page.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
