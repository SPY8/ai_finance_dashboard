// =============================================================
// 人口与宏观监控 · CRO 年度 Dashboard Tab
// 4 个核心指标 + 3 阶段人口周期推演
// =============================================================
(function () {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  let hasRendered = false;

  window.renderPopulationTab = function () {
    if (hasRendered) return;
    hasRendered = true;

    fetch(window.AssetCore.getDataPath("population_macro.json") + "?t=" + Date.now(), { cache: "no-store" })
      .then(r => r.json()).then(data => {
        renderContent(data);
      }).catch(err => {
        $("#pop-kpis").innerHTML = `<div style="padding:40px;color:var(--danger)">加载失败: ${err.message}</div>`;
      });
  };

  function renderContent(data) {
    const ind = data.indicators;
    const alerts = data.alerts || [];
    const stages = data.stages || [];

    const nbData = ind.newborns.data.slice(-3);
    const latestNB = nbData[2], prevNB = nbData[1], nbDelta = latestNB.value - prevNB.value;
    const m2Data = ind.m2_gdp_gap.data.slice(-3);
    const latestM2 = m2Data[2];

    loadOffshoreRatio().then(off => {
      const nbLevel = latestNB.value <= ind.newborns.red ? "danger" : (latestNB.value <= ind.newborns.yellow ? "warn" : "ok");
      const m2Level = latestM2.value >= ind.m2_gdp_gap.red ? "danger" : (latestM2.value >= ind.m2_gdp_gap.yellow ? "warn" : "ok");
      const offLevel = off.latest >= 20 ? "ok" : "warn";
      const goldLevel = off.goldPct >= 13 ? "ok" : (off.goldPct >= 9 ? "warn" : "danger");

      const kpis = [
        { label: ind.newborns.label, value: latestNB.value + ind.newborns.unit, sub: `较上年 ${nbDelta >= 0 ? "+" : ""}${nbDelta}${ind.newborns.unit} · 黄灯≤${ind.newborns.yellow} · 红灯≤${ind.newborns.red}`, tone: nbLevel },
        { label: ind.m2_gdp_gap.label, value: latestM2.value + ind.m2_gdp_gap.unit, sub: `黄灯≥${ind.m2_gdp_gap.yellow} · 红灯≥${ind.m2_gdp_gap.red} · 近3年回落`, tone: m2Level },
        { label: "离岸美元池占总资产比例", value: off.latest + "%", sub: `救生艇载客率 · 目标≥20% · ${off.trend} · 最低 ${off.lowest}%`, tone: offLevel },
        { label: "黄金占金融盘比例", value: off.goldPct + "%", sub: `目标 13% · ${off.goldPct >= 13 ? "达标" : "距目标 " + (13 - off.goldPct) + "%"}`, tone: goldLevel },
      ];

      $("#pop-kpis").innerHTML = kpis.map(k => `<div class="kpi ${k.tone}"><div class="stripe"></div><div class="label">${k.label}</div><div class="value num">${k.value}</div><div class="sub">${k.sub}</div></div>`).join("");
    });

    // 告警条
    const alertHTML = alerts.map(a => `<div class="hc-row ${a.level}" style="grid-template-columns:auto 1fr"><span class="lvl">${a.level === "red" ? "红线" : a.level === "warn" ? "偏离" : "OK"}</span><span class="body">${a.message}</span></div>`).join("");
    $("#pop-alerts").innerHTML = alertHTML ? `<div class="hc-strip">${alertHTML}</div>` : "";

    // 图表
    setTimeout(() => {
      renderLineChart("pop-chart-nb", "新生儿数量（万人）", ind.newborns.data, ind.newborns.yellow, ind.newborns.red, "descending");
      renderLineChart("pop-chart-m2", "M2-GDP 差值（pp）", ind.m2_gdp_gap.data, ind.m2_gdp_gap.yellow, ind.m2_gdp_gap.red, "ascending");
    }, 100);

    // 阶段推演
    const stagesHTML = stages.map((s, i) => `<div style="background:var(--bg-1);border:1px solid var(--line);border-left:3px solid var(--${i === 0 ? "warn" : i === 1 ? "danger" : "accent"});border-radius:8px;padding:14px 16px"><div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px"><span style="font-size:16px;font-weight:700;font-family:'JetBrains Mono',monospace">${s.period}</span><span style="font-size:14px;font-weight:600;color:var(--text-1)">${s.title}</span></div><div style="font-size:11px;color:var(--text-2);margin-bottom:8px">触发条件：${s.trigger}</div><div style="font-size:11px;color:var(--text-1);background:var(--bg-2);padding:6px 10px;border-radius:4px">💥 ${s.impact}</div></div>`).join("");
    $("#pop-stages").innerHTML = stagesHTML;
  }

  function renderLineChart(domId, title, chartPoints, yellow, red, direction) {
    const dom = document.getElementById(domId);
    if (!dom || typeof echarts === "undefined") return;
    const theme = (window.AssetCore && typeof window.AssetCore.getEchartsTheme === "function")
      ? window.AssetCore.getEchartsTheme() : "dark";
    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    const axisLineColor = isLight ? "#d8ccbc" : "#1f2533";
    const axisLabelColor = isLight ? "#715f4f" : "#5e677a";
    const splitLineColor = isLight ? "#e1d5c5" : "#1f2533";
    const markLabelColor = isLight ? "#715f4f" : "#9ba4b6";
    const chart = echarts.init(dom, theme);
    if (window.AssetCore) window.AssetCore.registerChart(chart);
    const isDesc = direction === "descending";
    chart.setOption({
      backgroundColor: "transparent",
      grid: { top: 30, right: 20, bottom: 30, left: 60 },
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: chartPoints.map(d => d.year), axisLine: { lineStyle: { color: axisLineColor } }, axisLabel: { color: axisLabelColor, fontSize: 10, fontFamily: "JetBrains Mono" } },
      yAxis: { type: "value", axisLine: { show: false }, splitLine: { lineStyle: { color: splitLineColor, type: "dashed" } }, axisLabel: { color: axisLabelColor, fontSize: 10, fontFamily: "JetBrains Mono" } },
      series: [{
        name: title, data: chartPoints.map(d => d.value), type: "line", smooth: true, symbol: "circle", symbolSize: 6,
        lineStyle: { color: isDesc ? "#be766e" : "#c8925e", width: 2.5 }, itemStyle: { color: isDesc ? "#be766e" : "#c8925e" },
        markLine: { silent: true, symbol: "none", label: { position: "end", formatter: "{b}", fontSize: 9, color: markLabelColor }, lineStyle: { type: "dashed", width: 1 },
          data: [
            { yAxis: yellow, name: "黄灯 " + yellow, lineStyle: { color: "#c8925e" }, label: { color: "#c8925e" } },
            { yAxis: red, name: "红灯 " + red, lineStyle: { color: "#be766e" }, label: { color: "#be766e" } },
          ],
        },
      }],
    });
    window.addEventListener("resize", () => chart.resize());
  }

  function loadOffshoreRatio() {
    return fetch(window.AssetCore.getDataPath("history.json") + "?t=" + Date.now(), { cache: "no-store" })
      .then(r => r.json()).then(data => {
        const snaps = (data.snapshots || []).sort((a, b) => a.date.localeCompare(b.date));
        const points = [];
        snaps.forEach(s => {
          const rates = s.rates || {};
          let total = 0, offshore = 0, gold = 0, financial = 0;
          const realEstateKeys = new Set(["property_a","property_b"]);
          for (const [k, h] of Object.entries(s.holdings || {})) {
            const ccy = h.ccy || "RMB";
            const rate = ccy === "RMB" ? 1 : (rates[ccy] || 1);
            let v = 0;
            if (h.raw != null) v = h.raw * rate;
            else if (h.shares != null) {
              const px = (s.prices || {})[k] ? ((s.prices[k] || {}).price || h.cost) : h.cost;
              v = h.shares * px * rate;
            }
            total += v;
            if (!realEstateKeys.has(k)) financial += v;
            if (ccy === "USD" || ccy === "HKD") offshore += v;
            if (k === "gold_etf_huaan" || k === "iau_gold") gold += v;
          }
          points.push({ date: s.date, pct: total > 0 ? (offshore / total * 100).toFixed(1) : 0, goldPct: financial > 0 ? (gold / financial * 100).toFixed(1) : 0 });
        });
        const latest = points[points.length - 1];
        const lowest = Math.min(...points.map(p => parseFloat(p.pct)));
        const trend = points.length >= 2 && parseFloat(points[points.length - 1].pct) > parseFloat(points[points.length - 2].pct) ? "↑ 上升" : "↓ 下降";
        return { latest: parseFloat(latest.pct), lowest: lowest.toFixed(1), trend, goldPct: parseFloat(latest.goldPct) };
      }).catch(() => ({ latest: 0, lowest: 0, trend: "—", goldPct: 0 }));
  }
})();
