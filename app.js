// =============================================================
// 资产配置看板 · 视图渲染（V2.3）
// 数据源：data/target.json + data/history.json
// 共享：core.js（fmt/fmtK/pct/parseDate/enrichSnapshot/healthCheck/reconcile/...）
// =============================================================
(function () {
  const C = window.AssetCore;
  const fmt = C.fmt, fmtK = C.fmtK, pct = C.pct;
  const h = C.escapeHTML, a = C.escapeAttr;
  const pp = (x, d=1) => (x == null || isNaN(x)) ? "—" : (x*100).toFixed(d) + "pp";
  const moneyText = (n, d=2) => C.isPrivacyMode() ? C.maskedValue() : (n || 0).toFixed(d);
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

  // ---- 0. 加载数据 ----
  Promise.all([
    C.fetchJson("target.json"),
    C.fetchJson("history.json"),
    fetch(C.getDataPath("recurring.json"),{cache:"no-store"}).then(r => r.json()).catch(() => null),
  ]).then(([target, history, recurring]) => {
    const snaps = (history.snapshots || []).slice().sort((a,b) => a.date.localeCompare(b.date));
    if (snaps.length === 0) {
      document.body.innerHTML = `<div style="padding:40px;color:#fff;font-family:system-ui">history.json 中没有任何 snapshot。请先添加一条。</div>`;
      return;
    }

    // 复用给 computeAnnualPassiveIncome / computeAnnualExpenseEstimate（它们原本要自己 fetch recurring）
    _recurringCache = recurring;

    // 给所有 snapshot 预先算出 RMB 等值 + 模块/总计
    // 先把保单当年现金价值注入 holdings，再 enrich
    const enriched = snaps.map(s => {
      if (recurring) C.injectInsuranceCashValue(s, recurring);
      return enrichSnapshot(s, target);
    });

    // ---- 日期选择器 ----
    const picker = $("#date-picker");
    picker.innerHTML = enriched.slice().reverse().map(s => `<option value="${s.date}">${s.date}　·　${fmtK(s.total)} RMB</option>`).join("");
    picker.addEventListener("change", () => render(picker.value));

    function render(dateKey) {
      const idx = enriched.findIndex(s => s.date === dateKey);
      const cur = enriched[idx];
      const prev = idx > 0 ? enriched[idx-1] : null;
      renderHeader(cur, target);
      renderHealthCheck(cur, target);
      renderReconcile(prev, cur);
      renderKPIs(cur, prev, target);
      renderCoastCard(cur, target);
      renderModules(cur);
      renderAlerts(cur);
      renderCurrency(cur, target);
      renderTrends(enriched, dateKey, target);
      renderTimeline(enriched, dateKey, picker);
      renderPools(cur, target);
      renderGrowthProjection(cur, target);
      renderMilestones(target);
    }
    render(enriched[enriched.length-1].date);
    picker.value = enriched[enriched.length-1].date;
  }).catch(err => {
    document.body.innerHTML = `<div style="padding:40px;color:#fff;font-family:system-ui">
      <h2>加载数据失败</h2>
      <p>${err.message}</p>
      <p style="color:#aaa">请通过本地 HTTP 服务打开（fetch 不能用 file://）：</p>
      <pre style="background:#222;padding:12px;border-radius:6px">cd memory/areas/life_planning/asset_dashboard
python3 -m http.server 8765</pre>
    </div>`;
    console.error(err);
  });

  // ---- 计算单个快照（委托 core.js）----
  function enrichSnapshot(snap, target) {
    return C.enrichSnapshot(snap, target);
  }

  function renderHeader(cur, target) {
    $("#rate-usd").textContent = (cur.rates?.USD || 1).toFixed(4);
    $("#rate-hkd").textContent = (cur.rates?.HKD || 1).toFixed(4);
    const src = cur.ratesSource ? `<div style="color:var(--text-2);font-size:11px">汇率源：${h(cur.ratesSource)}</div>` : "";
    $("#snapshot-comment").innerHTML = (cur.comment ? `“${h(cur.comment)}”` : "") + src;
  }

  function renderKPIs(cur, prev, target) {
    const total = cur.total;
    const financialTotal = cur.financialTotal || 0;
    const rmbPct = total > 0 ? cur.ccyTotals.RMB / total : 0;
    const redLine = target.redLines?.singleStockMaxPct ?? 0.05;
    // 单一公司敞口：按 target.redLines.singleStockGroups 聚合；未配置则取 rmb 最大的单个 sub
    const stockGroups = target.redLines?.singleStockGroups || [];
    const groupREs = stockGroups.map(g => new RegExp("^" + g));
    let singleRMB = 0, singleName = "单一持仓";
    if (stockGroups.length) {
      cur.modules.flatMap(m=>m.subs).forEach(s => {
        for (let i = 0; i < groupREs.length; i++) {
          if (groupREs[i].test(s.key)) { singleRMB += s.rmb; singleName = stockGroups[i] + "* 合计"; break; }
        }
      });
    } else {
      let max = 0;
      cur.modules.flatMap(m=>m.subs).forEach(s => {
        if (s.key === "_orphan" || s.status === "planned") return;
        // ponytail: 单一公司口径只管股票/基金类，不动产（收租房产）不应套用 5% 单股红线
        if (s.venue === "不动产") return;
        if (s.rmb > max) { max = s.rmb; singleRMB = s.rmb; singleName = s.name; }
      });
    }
    const singlePct = total > 0 ? singleRMB / total : 0;

    const deltaTotal = prev ? (total - prev.total) : 0;
    const deltaPct   = prev && prev.total ? (total - prev.total) / prev.total : 0;
    const deltaText = !prev ? "首次建档"
      : `${deltaTotal>=0?"+":""}${fmtK(deltaTotal)} (${(deltaPct*100).toFixed(2)}%)`;
    const deltaCls = !prev ? "flat" : (deltaTotal > 0 ? "up" : (deltaTotal < 0 ? "down" : "flat"));

    const overModules  = cur.modules.filter(m => m.status === "over").length;
    const underModules = cur.modules.filter(m => m.status === "under").length;
    const overSubs     = cur.modules.flatMap(m => m.subs).filter(s => s.status === "over").length;
    const underSubs    = cur.modules.flatMap(m => m.subs).filter(s => s.status === "under").length;

    // === 主 KPI（4 张）===
    const main = [
      {
        label: "总资产 (RMB)",
        value: fmtK(total),
        sub: `金融盘 ${fmtK(financialTotal)} · 不动产 ${fmtK(total - financialTotal)}`,
        help: "总盘=所有模块子项折RMB市值之和；金融盘=剔除房产+待变现；不动产=总盘-金融盘",
        delta: deltaText, deltaCls,
        tone: "ok",
      },
      {
        label: "单一公司敞口",
        value: pct(singlePct, 1),
        sub: `红线 ≤ ${pct(redLine,0)} · ${singleName} · ${fmtK(singleRMB)} RMB`,
        help: "占总盘最大的单一公司/分组占比；用于检查单一公司红线（默认5%）",
        tone: singlePct > redLine ? "danger" : "ok",
      },
      {
        label: "RMB 占比",
        value: pct(rmbPct, 1),
        sub: rmbPct > 0.70 ? "已超 70% 红线" : (rmbPct > 0.60 ? "高于 V2.0 目标 60%" : "在目标内"),
        help: "RMB子项折RMB市值占总盘比例；红线70%/目标60%",
        tone: rmbPct > 0.70 ? "danger" : (rmbPct > 0.60 ? "warn" : "ok"),
      },
      {
        label: "象限 / 子项告警",
        value: `${overModules+underModules} / ${overSubs+underSubs}`,
        sub: (overModules+underModules) === 0 ? "全部模块在阈值内" : `模块超${overModules} 偏低${underModules} · 子项超${overSubs} 偏低${underSubs}`,
        help: "告警数：超/偏低模块数 / 超/偏低子项数（基于阈值判定）",
        tone: overModules > 0 ? "danger" : (underModules > 0 || overSubs > 0 ? "warn" : "ok"),
      },
    ];
    $("#kpis").innerHTML = main.map(k => `
      <div class="kpi ${k.tone}">
        <div class="stripe"></div>
        <div class="label" title="${k.help || ""}">${k.label}</div>
        <div class="value num" title="${k.help || ""}">${k.value}</div>
        <div class="sub" title="${k.help || ""}">${k.sub}</div>
        ${k.delta ? `<div class="delta ${k.deltaCls}" title="环比变化=本次快照总盘-上次快照总盘">${k.delta}</div>` : ""}
      </div>
    `).join("");

    // === 次 KPI（4 张：盈亏 + 整体年化 + 金融盘年化 + 退休缺口）===
    const scenario = (target.assumptions?.return_scenario?.value) || "conservative";
    const totalReturn     = C.weightedExpectedReturn(cur, scenario, { excludeOrphan:true, excludeRealEstate:false });
    const financialReturn = C.weightedExpectedReturn(cur, scenario, { excludeOrphan:true, excludeRealEstate:true });

    let mvSec = 0, costSec = 0;
    cur.modules.forEach(m => m.subs.forEach(s => {
      if (s.shares != null) { mvSec += s.rmb; costSec += s.costRMB ?? s.rmb; }
    }));
    const pl = mvSec - costSec;
    const plPct = costSec ? pl / costSec : 0;

    // 退休缺口（粗算）：年支出 - 被动现金流
    const ret = target.retirement || {};
    const annualExpense = computeAnnualExpenseEstimate(target);
    const annualPassive = computeAnnualPassiveIncome(cur, target);
    const gap = annualExpense - annualPassive;

    const secondary = [
      {
        label: "证券持仓盈亏",
        value: (pl >= 0 ? "+" : "") + fmtK(pl),
        sub: `市值 ${fmtK(mvSec)} / 成本 ${fmtK(costSec)} · ${pct(plPct, 1)}`,
        help: "仅统计有shares字段的证券持仓；浮盈亏=市值-成本",
        tone: pl >= 0 ? "ok" : "warn",
      },
      {
        label: "整体盘预期年化",
        value: pct(totalReturn, 2),
        sub: `含房产；20 年终值 ${fmtK(total * Math.pow(1+totalReturn, 20))}`,
        help: "按各子项expectedReturn加权；整体盘口径含房产",
        tone: "ok",
      },
      {
        label: "金融盘预期年化",
        value: pct(financialReturn, 2),
        sub: `剔除房产 · ${fmtK(financialTotal)} → ${fmtK(financialTotal * Math.pow(1+financialReturn, 20))}`,
        help: "按各子项expectedReturn加权；金融盘口径剔除房产",
        tone: "ok",
      },
      {
        label: "退休年现金流缺口",
        value: gap > 0 ? fmtK(gap) : "已覆盖",
        sub: gap > 0
          ? `年开销 ${fmtK(annualExpense)} − 被动收入 ${fmtK(annualPassive)} ${ret.selfRetireYear ? "· 假设 " + ret.selfRetireYear + " 退休" : ""}`
          : `被动收入已覆盖开销 ${fmtK(-gap)} ${ret.selfRetireYear ? "· 假设 " + ret.selfRetireYear + " 退休" : ""}`,
        help: "退休年开销估算-被动收入估算；为正表示缺口（需要投资收益或降低开销弥补）",
        tone: gap > 0 ? "warn" : "ok",
      },
    ];
    $("#kpis-secondary").innerHTML = secondary.map(k => `
      <div class="kpi ${k.tone}">
        <div class="stripe"></div>
        <div class="label" title="${k.help || ""}">${k.label}</div>
        <div class="value num" title="${k.help || ""}">${k.value}</div>
        <div class="sub" title="${k.help || ""}">${k.sub}</div>
      </div>
    `).join("");
  }

  // ---- 年支出 / 被动收入估算（用于退休缺口）----
  // 注意：依赖 recurring.json，但 app.js 本身不加载它；放一个占位读取
  let _recurringCache = null;
  function loadRecurringOnce() {
    if (_recurringCache) return Promise.resolve(_recurringCache);
    return C.fetchJson("recurring.json").then(d => _recurringCache = d).catch(() => null);
  }
  function computeAnnualExpenseEstimate(target) {
    if (!_recurringCache) return 0;
    const rates = _recurringCache._rates || { USD:6.8, HKD:0.87 }; // 退休测算用一个稳定汇率
    const toRMB = (a,c) => a * (c==="RMB" ? 1 : (rates[c] || 1));
    const recurringAnnual = (_recurringCache.expenses || []).reduce((acc,e) => {
      // 用 isActive 简单过滤
      if (!C.isActive(e)) return acc;
      const a = toRMB(e.amount, e.ccy) * (e.frequency === "annual" ? 1 : 12);
      return acc + a;
    }, 0);
    // 弹性支出按 ~26 万估（cashflow Tab 的 2026 预测）
    const elasticAnnual = 260000;
    return recurringAnnual + elasticAnnual;
  }
  function computeAnnualPassiveIncome(cur, target) {
    if (!_recurringCache) return 0;
    const rates = _recurringCache._rates || { USD:6.8, HKD:0.87 };
    const toRMB = (a,c) => a * (c==="RMB" ? 1 : (rates[c] || 1));
    // 1) recurring 收入 — 退休口径只算被动（房租 / 妈妈月存 / 退休后零散），剔除工资
    const PASSIVE_KINDS = new Set(["rental_income","family_deposit","side_gig"]);
    const recurringIn = (_recurringCache.incomes || []).reduce((acc,i) => {
      if (!PASSIVE_KINDS.has(i.kind)) return acc;
      // 用退休年作为参考时点（若 endDate 在退休前则不算）
      const refYear = (target.retirement && target.retirement.selfRetireYear) || (new Date().getFullYear() + 1);
      const refDate = new Date(refYear + 1, 0, 1);
      if (!C.isActive(i, refDate)) return acc;
      return acc + toRMB(i.amount, i.ccy) * (i.frequency === "annual" ? 1 : 12);
    }, 0);
    // 2) 投资被动现金流（用金融盘 × 加权预期年化的"票息部分" — 简化为 50% × 预期年化）
    const scenario = target.assumptions?.return_scenario?.value || "conservative";
    const fr = C.weightedExpectedReturn(cur, scenario, { excludeOrphan:true, excludeRealEstate:true });
    const yieldPart = (cur.financialTotal || 0) * fr * 0.5; // 假设一半是票息一半是增值
    return recurringIn + yieldPart;
  }

  // 把年支出拆成「刚性 / 弹性」两个口径，用于 SWR 反推
  function computeAnnualExpenseBreakdown() {
    if (!_recurringCache) return { rigid: 0, elastic: 260000, total: 260000 };
    const rates = _recurringCache._rates || { USD:6.8, HKD:0.87 };
    const toRMB = (a,c) => a * (c==="RMB" ? 1 : (rates[c] || 1));
    const rigid = (_recurringCache.expenses || []).reduce((acc,e) => {
      if (!C.isActive(e)) return acc;
      const a = toRMB(e.amount, e.ccy) * (e.frequency === "annual" ? 1 : 12);
      return acc + a;
    }, 0);
    const elastic = 260000; // 与 computeAnnualExpenseEstimate 保持同一假设（cashflow Tab 的弹性估算）
    return { rigid, elastic, total: rigid + elastic };
  }

  // ---- Coast FIRE 卡：今天的本金不再注资，靠复利到法退年能否养到底 ----
  // 公式：CoastNumber = (annualMultiple × 年开销) / (1 + r)^years
  // 如果当前总盘 ≥ CoastNumber → 已 Coast：可以停止注资
  // 注：realReturns 是"扣除通胀的实际收益率"，所以 25× 年开销也是今天购买力，无需再调通胀
  const FIRE_EXPANDED_LS_KEY = "afd_fire_expanded";
  function renderCoastCard(cur, target) {
    const root = $("#swr-card"); // 容器名沿用 #swr-card，避免改 HTML
    if (!root) return;
    if (!_recurringCache) { root.innerHTML = ""; return; }

    const exp = computeAnnualExpenseBreakdown();
    const total = cur.total || 0;

    const cfg = target.coastFire || {};
    const currentAge = cfg.selfCurrentAge || 40;
    const retireAge  = cfg.legalRetireAge || 60;
    const years      = Math.max(0, retireAge - currentAge);
    const mult       = cfg.annualMultiple || 25;
    const realReturns = cfg.realReturns || { conservative:0.05, neutral:0.06, optimistic:0.07 };

    const targetCorpus = mult * exp.total; // 退休时所需本金（今天购买力）

    const LEVELS = [
      { key: "conservative", label: "保守", r: realReturns.conservative, hint: "实际 5% · 类全球股债 60/40 长期" },
      { key: "neutral",      label: "中性", r: realReturns.neutral,      hint: "实际 6% · 偏股全球分散" },
      { key: "optimistic",   label: "乐观", r: realReturns.optimistic,   hint: "实际 7% · 偏股+小盘价值溢价" },
    ];

    const fmtPct = p => `${(p*100).toFixed(0)}%`;
    const rowsHTML = LEVELS.map(lv => {
      const factor = Math.pow(1 + lv.r, years); // 复利倍数
      const coastNumber = targetCorpus / factor;
      const ratio = coastNumber > 0 ? total / coastNumber : 0;
      const done = ratio >= 1;
      const far  = ratio < 0.5;
      const fillW = Math.max(2, Math.min(100, ratio * 100));
      const gap = coastNumber - total;
      const gapStr = gap > 0 ? `差 ${fmtK(gap)}` : `已超 ${fmtK(-gap)}`;

      // 反算：当前总盘按这个收益率，多少年能复利到 targetCorpus
      // years_needed = log(targetCorpus / total) / log(1+r)
      let yearsToCoast = "—";
      if (total > 0 && targetCorpus > total) {
        const n = Math.log(targetCorpus / total) / Math.log(1 + lv.r);
        if (isFinite(n) && n > 0) yearsToCoast = `${n.toFixed(1)} 年`;
      } else if (total >= targetCorpus) {
        yearsToCoast = "已达成";
      }

      return `
        <div class="swr-row">
          <div class="tag">${lv.label}<span class="pct">${(lv.r*100).toFixed(0)}%</span></div>
          <div class="bar"><div class="fill ${done?'done':''}" style="width:${fillW}%"></div></div>
          <div class="target">需 ≥ ${fmtK(coastNumber)}<br><span style="color:var(--text-3);font-size:10px">复利后 ${fmtK(total * factor)}</span></div>
          <div class="progress ${done?'done':(far?'far':'')}">${fmtPct(ratio)}<br><span style="color:var(--text-3);font-weight:400;font-size:10px">${gapStr}</span></div>
        </div>
      `;
    }).join("");

    // 兜底：Bengen 3.5% 安全提取（只显示 1 行，作为参考）
    const bengenTarget = exp.total / 0.035;
    const bengenRatio  = bengenTarget > 0 ? total / bengenTarget : 0;
    const bengenDone   = bengenRatio >= 1;
    const bengenGap    = bengenTarget - total;
    const bengenGapStr = bengenGap > 0 ? `差 ${fmtK(bengenGap)}` : `已超 ${fmtK(-bengenGap)}`;

    // 整体已 Coast 状态（中性档为准）
    const neutralFactor = Math.pow(1 + realReturns.neutral, years);
    const neutralCoast  = targetCorpus / neutralFactor;
    const overallDone   = total >= neutralCoast;
    const fireExpanded  = !overallDone || (window.localStorage && localStorage.getItem(FIRE_EXPANDED_LS_KEY) === "1");
    const summaryText   = overallDone
      ? `中性档已达成，当前总盘约为门槛的 ${fmtPct(total / neutralCoast)}`
      : `中性档仍差 ${fmtK(Math.max(0, neutralCoast - total))}，建议保留在完整视图里观察`;

    root.innerHTML = `
      <div class="swr-card ${overallDone ? 'achieved' : ''} ${fireExpanded ? '' : 'compact'}">
        <div class="swr-head">
          <div class="title">
            <span class="icon">${overallDone ? '✅' : '🔥'}</span>
            Coast FIRE ${overallDone ? '· 已达成' : '· 进度'}
            <span style="color:var(--text-2);font-weight:400;font-size:var(--fs-xs);margin-left:8px">现在 ${currentAge} 岁 → ${retireAge} 岁停止打工，靠复利养到底</span>
          </div>
          <div class="swr-actions">
            <div class="now">总盘 <b>${fmtK(total)}</b> · 年开销 <b>${fmtK(exp.total)}</b> · ${retireAge}岁需 <b>${fmtK(targetCorpus)}</b></div>
            ${overallDone ? `<button class="btn ghost" id="fire-toggle" type="button">${fireExpanded ? "收起评估" : "展开评估"}</button>` : ``}
          </div>
        </div>
        ${overallDone && !fireExpanded ? `<div class="swr-foot" style="border-top:none">${summaryText}</div>` : ``}
        <div class="swr-rows">${rowsHTML}</div>
        <div class="swr-bengen ${bengenDone?'done':''}">
          <span class="bengen-label">Full FIRE 兜底</span>
          <span class="bengen-detail">Bengen 3.5% 安全提取 → 本金需 ≥ <b>${fmtK(bengenTarget)}</b></span>
          <span class="bengen-progress ${bengenDone?'done':''}">${fmtPct(bengenRatio)} · ${bengenGapStr}</span>
        </div>
        <div class="swr-foot">
          口径：年开销 <code>${fmtK(exp.total)}</code> · ${mult}× 倍数 · 实际收益率（已含通胀对冲）· 房产计入总盘 · 公式 <code>Need = ${mult}×Exp / (1+r)^${years}</code>
        </div>
      </div>
    `;

    const toggle = $("#fire-toggle", root);
    if (toggle) {
      toggle.addEventListener("click", () => {
        try {
          if (window.localStorage) {
            const next = fireExpanded ? "0" : "1";
            localStorage.setItem(FIRE_EXPANDED_LS_KEY, next);
          }
        } catch (err) {
          // Ignore storage failures; the current render still works.
        }
        renderCoastCard(cur, target);
      });
    }
  }

  // 启动加载
  loadRecurringOnce().then(() => {
    // 触发一次重渲染（如果首屏已经渲过）
    const picker = $("#date-picker");
    if (picker && picker.value) picker.dispatchEvent(new Event("change"));
  });

  function statusChip(status, delta) {
    if (status === "over")  return `<span class="chip danger" title="偏离Δ=实际占比-目标占比（单位pp）">超 +${pp(delta,1)}</span>`;
    if (status === "under") return `<span class="chip warn" title="偏离Δ=实际占比-目标占比（单位pp）">偏低 ${pp(delta,1)}</span>`;
    return `<span class="chip ok" title="偏离Δ在阈值范围内">在阈值内</span>`;
  }
  const ccyTag = c => `<span class="ccy ${c}">${c}</span>`;
  function phaseBadgeHTML(phase) {
    if (!phase || phase === "active") return "";
    const map = {
      blocked: { txt:"⏳ 阻塞", color:"#a4adbf", bg:"rgba(164,173,191,.12)" },
      exit:    { txt:"📉 清仓中", color:"#ff5c7a", bg:"rgba(255,92,122,.14)" },
      planned: { txt:"🛠 计划中", color:"#7aa2ff", bg:"rgba(122,162,255,.14)" },
    };
    const c = map[phase];
    if (!c) return "";
    return `<span style="font-size:10px;padding:1px 6px;border-radius:4px;color:${c.color};background:${c.bg};letter-spacing:.3px">${c.txt}</span>`;
  }

  function renderModules(cur) {
    $("#mods").innerHTML = cur.modules.map(m => {
      const lower = (m.targetPct - m.thresholdPct);
      const upper = (m.targetPct + m.thresholdPct);
      const axisMax = Math.max(upper, m.actualPct, m.targetPct) * 1.25 || 0.01;
      const fillW   = Math.min(100, (m.actualPct / axisMax) * 100);
      const targetX = (m.targetPct / axisMax) * 100;
      const bandL   = Math.max(0, (lower / axisMax) * 100);
      const bandR   = Math.min(100, (upper / axisMax) * 100);
      const fillCls = m.status === "over" ? "over" : (m.status === "under" ? "under" : "");
      const pctCls  = m.status === "over" ? "over" : (m.status === "under" ? "under" : "");
      const modPctTitle = `模块实际占比=模块小计/总盘；目标=${pct(m.targetPct,0)}；偏离Δ=${pp(m.delta,1)}；阈值±${pct(m.thresholdPct,0)}`;

      return `
        <div class="mod">
          <div class="mod-head">
            <div>
              <div class="mod-name">
                <span class="roman serif">${h(m.roman)}</span>${h(m.name)}
                ${statusChip(m.status, m.delta)}
              </div>
              <div style="color:var(--text-2);font-size:11px;margin-top:4px" title="模块小计=该模块所有子项市值（折RMB）之和">小计 <span class="num">${fmt(m.total)}</span> RMB</div>
            </div>
            <div class="mod-meta">
              <div class="pct ${pctCls} num" title="${modPctTitle}">${pct(m.actualPct,1)}</div>
              <div class="target" title="${modPctTitle}">目标 ${pct(m.targetPct,0)} · 阈值 ±${pct(m.thresholdPct,0)}</div>
            </div>
          </div>
          <div class="bar">
            <div class="band" style="left:${bandL}%;width:${bandR-bandL}%"></div>
            <div class="fill ${fillCls}" style="width:${fillW}%"></div>
            <div class="target-mark" style="left:${targetX}%"></div>
          </div>
          <div class="subs">
            ${m.subs.filter(s => {
              // 隐藏数量为 0 的持仓（已清仓），但保留 planned/blocked/exit 阶段的占位
              if (s.phase === "planned" || s.phase === "blocked") return true;
              if (s.shares === 0 || s.rmb === 0) return false;
              return true;
            }).map(s => {
              const subTarget = (s.subTargetPct != null) ? pct(s.subTargetPct,1) : "—";
              const subDeltaTxt = s.subThresholdPct != null && s.subThresholdPct > 0
                ? `Δ ${s.delta>=0?"+":""}${pp(s.delta,1)}`
                : "";
              const subStateCls = (s.status === "over" || s.status === "under") ? s.status : "ok";
              const venue = s.venue ? `<span style="color:var(--text-2);font-size:11px">· ${h(s.venue)}</span>` : "";
              const phaseBadge = phaseBadgeHTML(s.phase);
              const rawTitle = s.shares != null
                ? `原币口径：${fmt(s.shares)} 股 × ${moneyText(s.price)} ${s.ccy}（成本 ${moneyText(s.costPerShare)}）`
                : `原币口径：${fmt(s.raw)} ${s.ccy}`;
              const rmbTitle = s.shares != null && s.costRMB ? (() => {
                const pl = s.rmb - s.costRMB;
                const plPct = pl / s.costRMB;
                return `市值（折RMB）=${fmt(s.rmb)}；成本（折RMB）=${fmt(s.costRMB)}；浮盈亏=${pl>=0?"+":""}${fmtK(pl)}（${(plPct*100).toFixed(1)}%）`;
              })() : `市值（折RMB）=${fmt(s.rmb)}`;
              const stateTitle = `实际占比=${pct(s.actualPct,1)}（=市值/总盘）；目标=${subTarget}；偏离Δ=${pp(s.delta,1)}；阈值±${pct(s.subThresholdPct||0,1)}；Δ单位为pp`;
              return `
                <div class="sub-row">
                  <div class="sub-name">${ccyTag(s.ccy)}<span class="nm">${h(s.name)}</span>${phaseBadge}${venue}</div>
                  <div class="sub-raw num" title="${a(rawTitle)}">
                    ${s.shares != null
                      ? `${fmt(s.shares)} × ${moneyText(s.price)}`
                      : `${fmt(s.raw)} ${s.ccy}`}
                  </div>
                  <div class="sub-rmb num" title="${a(rmbTitle)}">
                    ${fmt(s.rmb)}
                    ${s.shares != null && s.costRMB ? (() => {
                      const pl = s.rmb - s.costRMB;
                      const plPct = pl / s.costRMB;
                      // 色温：plPct 映射到颜色（-30% 深红 → 0 灰 → +30% 深绿）
                      const t = Math.max(-1, Math.min(1, plPct / 0.3));
                      const color = t > 0
                        ? `hsl(150, ${(40 + t*40).toFixed(0)}%, ${(55 - t*10).toFixed(0)}%)`
                        : `hsl(${(0 - t*-10).toFixed(0)}, ${(40 + (-t)*40).toFixed(0)}%, ${(60 - (-t)*15).toFixed(0)}%)`;
                      return `<div class="pl" style="color:${color}" title="浮盈亏=市值-成本（证券类才有成本）">${pl>=0?'+':''}${fmtK(pl)} (${(plPct*100).toFixed(1)}%)</div>`;
                    })() : ''}
                  </div>
                  <div class="sub-state ${subStateCls}" title="${a(stateTitle)}">
                    <span style="font-size:10px;color:var(--text-2)">占比</span> ${pct(s.actualPct,1)}<br/>
                    <span style="font-size:10px;color:var(--text-2)">${subDeltaTxt || "Δ —"}</span>
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      `;
    }).join("");
  }

  // 不动产 segment 已合并进池分离视图（renderPools 的"不动产池"卡片），此处保留空占位避免他处引用报错。
  // ponytail: renderRealEstate 不再渲染——不动产卡片由 renderPools 统一产出，避免重复展示。

  function renderAlerts(cur) {
    const tbody = $("#alerts tbody");
    const rows = [];
    cur.modules.forEach(m => {
      const stateLabel = m.status === "over"
        ? `<span class="chip danger">象限超标</span>`
        : m.status === "under"
          ? `<span class="chip warn">象限偏低</span>`
          : `<span class="chip ok">正常</span>`;

      // 1) 模块汇总行（独占一行，带高亮背景）
      rows.push(`
        <tr class="al-mod-row">
          <td colspan="2" style="font-weight:600;color:var(--text-0)">
            <span class="roman serif" style="color:var(--text-2);margin-right:6px">${h(m.roman)}</span>${h(m.name)}
            <span style="color:var(--text-2);font-weight:400;font-size:11px;margin-left:8px">小计</span>
          </td>
          <td class="r" style="font-weight:600">${fmt(m.total)}</td>
          <td class="r" style="font-weight:600">${pct(m.actualPct,1)}</td>
          <td class="r">${pct(m.targetPct,0)}</td>
          <td class="r">±${pct(m.thresholdPct,0)}</td>
          <td class="r"><span class="delta ${m.status}" title="偏离Δ=实际占比-目标占比（单位pp）">${m.delta>0?"+":""}${pp(m.delta,1)}</span></td>
          <td>${stateLabel}</td>
        </tr>
      `);

      // 2) 子项行（缩进、灰一点）
      m.subs.forEach(s => {
        const subStatusInline = (s.status === "over" || s.status === "under")
          ? ` <span class="chip ${s.status==='over'?'danger':'warn'}" style="margin-left:4px;font-size:10px;padding:1px 6px">子项${s.status==='over'?'超':'偏低'}</span>`
          : "";
        const phaseBadge = phaseBadgeHTML(s.phase);
        rows.push(`
          <tr class="al-sub-row">
            <td></td>
            <td style="padding-left:24px;color:var(--text-1)">
              <span style="color:var(--text-2);margin-right:6px">└</span>
              <span class="ccy ${s.ccy}" style="margin-right:6px">${h(s.ccy)}</span>${h(s.name)}${phaseBadge}${subStatusInline}
            </td>
            <td class="r" style="color:var(--text-1)">${fmt(s.rmb)}</td>
            <td class="r" style="color:var(--text-1)">${pct(s.actualPct,1)}</td>
            <td class="r" style="color:var(--text-2);font-size:11px">${s.subTargetPct != null ? pct(s.subTargetPct,1) : ""}</td>
            <td class="r" style="color:var(--text-2);font-size:11px">${s.subThresholdPct ? "±" + pct(s.subThresholdPct,1) : ""}</td>
            <td class="r" style="color:var(--text-2);font-size:11px" title="偏离Δ=实际占比-目标占比（单位pp）">${s.subThresholdPct ? `${s.delta>=0?"+":""}${pp(s.delta,1)}` : ""}</td>
            <td></td>
          </tr>
        `);
      });
    });
    tbody.innerHTML = rows.join("");
  }

  function renderCurrency(cur, target) {
    const total = cur.total;
    const colors = { RMB:"var(--rmb)", USD:"var(--usd)", HKD:"var(--hkd)" };
    const ccyOrder = ["RMB","USD","HKD"];
    $("#ccy-mix").innerHTML = ccyOrder.map(c => {
      const w = total > 0 ? (cur.ccyTotals[c]/total)*100 : 0;
      return `<div title="${c} ${pct(cur.ccyTotals[c]/total,1)}" style="width:${w}%;background:${colors[c]}"></div>`;
    }).join("");
    $("#ccy-legend").innerHTML = ccyOrder.map(c => `
      <div><i style="background:${colors[c]}"></i>${c}
        <span class="num" style="color:var(--text-0);margin-left:6px">${pct(total>0?cur.ccyTotals[c]/total:0,1)}</span>
        <span class="num" style="margin-left:6px;color:var(--text-2)">${fmtK(cur.ccyTotals[c])}</span>
      </div>
    `).join("");
    const rmbPct = total > 0 ? cur.ccyTotals.RMB / total : 0;
    $("#ccy-status").innerHTML = rmbPct > 0.70
      ? `<span class="chip danger">RMB ${pct(rmbPct,1)} 已超红线</span>`
      : rmbPct > 0.60
        ? `<span class="chip warn">RMB ${pct(rmbPct,1)} 高于目标</span>`
        : `<span class="chip ok">RMB ${pct(rmbPct,1)} 在目标内</span>`;
  }

  // ---- 趋势卡（ECharts 版本）----
  let trendCharts = [];
  function renderTrends(enriched, activeDate, target) {
    // 清理旧图表
    trendCharts.forEach(c => c.dispose());
    trendCharts = [];

    const dates = enriched.map(s => s.date);
    // 单一公司敞口序列：按 target.redLines.singleStockGroups 聚合；未配置则取每期最大单一 sub
    const stockGroups = (target.redLines && target.redLines.singleStockGroups) || [];
    const groupREs = stockGroups.map(g => new RegExp("^" + g));
    const singleStockSeries = enriched.map(s => {
      if (!s.total) return 0;
      if (stockGroups.length) {
        let sum = 0;
        s.modules.flatMap(m=>m.subs).forEach(x => {
          for (let i = 0; i < groupREs.length; i++) {
            if (groupREs[i].test(x.key)) { sum += x.rmb; break; }
          }
        });
        return sum / s.total;
      }
      let max = 0;
      s.modules.flatMap(m=>m.subs).forEach(x => {
        if (x.key === "_orphan" || x.status === "planned") return;
        // ponytail: 单一公司口径只管股票/基金类，不动产不应套用单股红线
        if (x.venue === "不动产") return;
        if (x.rmb > max) max = x.rmb;
      });
      return max / s.total;
    });
    const series = {
      total:    enriched.map(s => s.total),
      rmbPct:   enriched.map(s => s.total ? s.ccyTotals.RMB / s.total : 0),
      single:   singleStockSeries,
      modOver:  enriched.map(s => s.modules.filter(m=>m.status!=="ok").length),
    };
    const cards = [
      { name:"金融资产总值 (RMB)", value:fmtK(series.total[series.total.length-1]), data:series.total, fmt:fmtK, color:"#7aa2ff", isPct:false },
      { name:"RMB 占比", value:pct(series.rmbPct[series.rmbPct.length-1],1), data:series.rmbPct, fmt:v=>pct(v,1), color:"#5b8bff", isPct:true, refLine:0.70 },
      { name:"单一公司敞口", value:pct(series.single[series.single.length-1],1), data:series.single, fmt:v=>pct(v,1), color:"#ff5c7a", isPct:true, refLine:0.05 },
      { name:"模块告警数", value:String(series.modOver[series.modOver.length-1]), data:series.modOver, fmt:v=>String(v|0), color:"#ffb454", isPct:false },
    ];

    const container = $("#trends");
    container.innerHTML = cards.map((c, i) => `
      <div class="trend" id="trend-chart-${i}">
        <div class="trend-head">
          <div class="t-name">${c.name}</div>
          <div class="t-val" style="color:${c.color}">${c.value}</div>
        </div>
        <div style="width:100%;height:120px;"></div>
      </div>
    `).join("");

    cards.forEach((c, i) => {
      const chartDom = container.querySelector(`#trend-chart-${i} > div:last-child`);
      const chart = echarts.init(chartDom, C.getEchartsTheme());
      trendCharts.push(chart);
      window.AssetCore.registerChart(chart);

      const activeIndex = enriched.findIndex(s => s.date === activeDate);

      const option = {
        backgroundColor: 'transparent',
        grid: { top: 5, right: 5, bottom: 5, left: 5 },
        tooltip: {
          trigger: 'axis',
          backgroundColor: 'rgba(19, 23, 31, 0.95)',
          borderColor: '#1f2533',
          textStyle: { color: '#e8ecf3', fontSize: 11 },
          formatter: (params) => {
            const idx = params[0].dataIndex;
            const date = dates[idx];
            const val = c.isPct ? pct(c.data[idx], 2) : fmtK(c.data[idx]);
            return `<div style="font-family:'JetBrains Mono',monospace">${date}<br/>${c.name}: <b>${val}</b></div>`;
          }
        },
        xAxis: {
          type: 'category',
          data: dates,
          show: false
        },
        yAxis: {
          type: 'value',
          show: false,
          scale: true
        },
        series: [{
          data: c.data,
          type: 'line',
          smooth: true,
          symbol: (val, params) => params.dataIndex === activeIndex ? 'circle' : 'none',
          symbolSize: 8,
          lineStyle: { color: c.color, width: 2 },
          itemStyle: { color: c.color },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: c.color + '33' },
              { offset: 1, color: c.color + '05' }
            ])
          },
          markLine: c.refLine ? {
            silent: true,
            symbol: 'none',
            lineStyle: { color: '#5e677a', type: 'dashed', width: 1 },
            data: [{ yAxis: c.refLine }]
          } : undefined
        }]
      };
      chart.setOption(option);
    });
  }

  // ---- 时间线 ----
  function renderTimeline(enriched, activeDate, picker) {
    const tl = $("#timeline");
    tl.innerHTML = enriched.slice().reverse().map((s,idx) => {
      // idx 是倒序后的；找原 index
      const origIdx = enriched.length - 1 - idx;
      const prev = origIdx > 0 ? enriched[origIdx-1] : null;
      const d = prev ? s.total - prev.total : 0;
      const dPct = prev && prev.total ? d/prev.total : 0;
      const cls = !prev ? "flat" : (d>0 ? "up" : (d<0 ? "down" : "flat"));
      const txt = !prev ? "—" : `${d>=0?"+":""}${(dPct*100).toFixed(2)}%`;
      return `
        <div class="tl-row ${s.date===activeDate?'active':''}" data-date="${a(s.date)}">
          <div class="d">${h(s.date)}</div>
          <div class="c">${h(s.comment || "")}</div>
          <div class="v">${fmtK(s.total)}</div>
          <div class="chg ${cls}">${txt}</div>
        </div>
      `;
    }).join("");
    tl.querySelectorAll(".tl-row").forEach(r => {
      r.addEventListener("click", () => {
        picker.value = r.dataset.date;
        picker.dispatchEvent(new Event("change"));
      });
    });
  }

  // ---- 长期增长预测（ECharts 版本）----
  let growthChart = null;
  function renderGrowthProjection(cur, target) {
    const root = $("#growth-projection");
    if (!root) return;

    const scenarios = target.returnAssumptions?.scenarios || {};
    const scenarioKeys = Object.keys(scenarios);
    if (scenarioKeys.length === 0) {
      root.innerHTML = `<div style="padding:14px;color:var(--text-2)">target.json 未定义 returnAssumptions</div>`;
      return;
    }

    const inflRate = (target.inflation && target.inflation.annual) || 0.025;
    const mode = (window.localStorage && localStorage.getItem("growthMode")) || "nominal";

    // 各情景下的组合年化（用 core）
    const portfolioReturns = {};
    scenarioKeys.forEach(sk => {
      portfolioReturns[sk] = C.weightedExpectedReturn(cur, sk, { excludeOrphan: true });
    });

    const years = 20;
    const xData = Array.from({length: years+1}, (_,i) => `+${i}年`);
    const series = scenarioKeys.map(sk => {
      const r = portfolioReturns[sk];
      const data = [];
      for (let y = 0; y <= years; y++) {
        const nominal = cur.total * Math.pow(1 + r, y);
        const real = nominal / Math.pow(1 + inflRate, y);
        data.push(mode === "real" ? real : nominal);
      }
      const realReturn = (1+r)/(1+inflRate) - 1;
      return { key: sk, label: scenarios[sk].label, color: scenarios[sk].color, nominalReturn: r, realReturn, data };
    });

    const startYear = new Date(cur.date).getFullYear();
    const cardsHTML = series.map(s => `
      <div style="background:var(--bg-2);border-left:3px solid ${s.color};border-radius:8px;padding:12px 14px">
        <div style="font-size:11px;color:var(--text-2);text-transform:uppercase;letter-spacing:.4px">${s.label}</div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:600;color:${s.color};margin:4px 0">${pct(s.nominalReturn,2)} <span style="font-size:11px;color:var(--text-2)">名义 / 实际 ${pct(s.realReturn,2)}</span></div>
        <div style="font-size:11px;color:var(--text-1);font-family:'JetBrains Mono',monospace">
          5年 ${fmtK(s.data[5])}<br/>
          10年 ${fmtK(s.data[10])}<br/>
          20年 ${fmtK(s.data[20])} <span style="color:${s.color}">${(s.data[20]/cur.total).toFixed(1)}×</span>
        </div>
      </div>
    `).join("");

    root.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px;gap:14px;flex-wrap:wrap">
        <div style="font-size:12px;color:var(--text-2)">起点：${startYear} 年总盘 <b style="color:var(--text-0);font-family:'JetBrains Mono',monospace">${fmtK(cur.total)}</b> RMB · 通胀 ${(inflRate*100).toFixed(1)}%/年 · 假设无新注入 / 无消费 / 复利</div>
        <div class="infl-toggle">
          <button class="${mode==='nominal'?'active':''}" data-mode="nominal">名义值（含通胀）</button>
          <button class="${mode==='real'?'active':''}" data-mode="real">实际购买力</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(${series.length},1fr);gap:10px;margin-bottom:14px">
        ${cardsHTML}
      </div>
      <div id="growth-chart" style="width:100%;height:280px;"></div>
      <div style="font-size:11px;color:var(--text-2);margin-top:8px;text-align:right">⚠️ 是预测不是承诺；实际波动远大于这条平滑曲线</div>
    `;

    // 初始化 ECharts
    const chartDom = root.querySelector('#growth-chart');
    if (growthChart) growthChart.dispose();
    growthChart = echarts.init(chartDom, C.getEchartsTheme());
    window.AssetCore.registerChart(growthChart);

    const option = {
      backgroundColor: 'transparent',
      grid: { top: 20, right: 30, bottom: 30, left: 70 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(19, 23, 31, 0.95)',
        borderColor: '#1f2533',
        textStyle: { color: '#e8ecf3', fontSize: 11 },
        formatter: (params) => {
          let html = `<div style="font-family:'JetBrains Mono',monospace">${params[0].axisValue}</div>`;
          params.forEach(p => {
            const val = fmtK(p.value);
            const multiple = (p.value / cur.total).toFixed(1);
            html += `<div style="display:flex;align-items:center;gap:6px;margin-top:4px">
              <span style="display:inline-block;width:8px;height:8px;background:${p.color};border-radius:50%"></span>
              <span>${p.seriesName}: <b>${val}</b> (${multiple}×)</span>
            </div>`;
          });
          return html;
        }
      },
      xAxis: {
        type: 'category',
        data: xData,
        axisLine: { lineStyle: { color: '#1f2533' } },
        axisLabel: { color: '#5e677a', fontSize: 10, fontFamily: 'JetBrains Mono' },
        axisTick: { show: false }
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        splitLine: { lineStyle: { color: '#1f2533', type: 'dashed' } },
        axisLabel: {
          color: '#5e677a',
          fontSize: 10,
          fontFamily: 'JetBrains Mono',
          formatter: (v) => fmtK(v)
        }
      },
      dataZoom: [{
        type: 'inside',
        start: 0,
        end: 100
      }],
      series: series.map(s => ({
        name: s.label,
        data: s.data,
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 4,
        lineStyle: { color: s.color, width: 2.5 },
        itemStyle: { color: s.color },
        endLabel: {
          show: true,
          formatter: '{c}',
          color: s.color,
          fontFamily: 'JetBrains Mono',
          fontSize: 10,
          formatter: (p) => `${(p.value/cur.total).toFixed(1)}×`
        }
      }))
    };
    growthChart.setOption(option);

    root.querySelectorAll(".infl-toggle button").forEach(btn => {
      btn.addEventListener("click", () => {
        if (window.localStorage) localStorage.setItem("growthMode", btn.dataset.mode);
        renderGrowthProjection(cur, target);
      });
    });
  }

  // ---- 池分离视图 ----
  function renderPools(cur, target) {
    const pools = $("#pools");
    if (!pools) return;

    // 按币种把所有 sub 拆到三个池：不动产池 / RMB 资金池 / 海外资金池
    // 不动产顶层 realEstate 已从四象限剥离，单独成池；RMB 与海外仍按币种拆分金融资产。
    const isOverseasCcy = c => c === "USD" || c === "HKD";
    const all = cur.modules.flatMap(m => m.subs.map(s => ({...s, _modKey: m.key})));
    const rmbSubs = all.filter(s => s.ccy === "RMB");
    const ovsSubs = all.filter(s => isOverseasCcy(s.ccy));
    // realEstate 子项 core.js 未算 actualPct，这里按整体盘补算
    const reSubs = (cur.realEstate || []).map(s => ({
      ...s,
      actualPct: cur.total > 0 ? (s.rmb||0) / cur.total : 0,
    }));
    // souvenirs 同理补算 actualPct；纯展示池，不设目标、不告警
    const svSubs = (cur.souvenirs || []).map(s => ({
      ...s,
      actualPct: cur.total > 0 ? (s.rmb||0) / cur.total : 0,
    }));

    // 池目标占比 = 该池所有子项 subTargetPct 之和（含 phase=blocked，假设通道开通后回归）
    const rmbTarget = rmbSubs.reduce((a,s)=>a+(s.subTargetPct||0),0);
    const ovsTarget = ovsSubs.reduce((a,s)=>a+(s.subTargetPct||0),0);
    const reTarget  = reSubs.reduce((a,s)=>a+(s.subTargetPct||0),0);
    const rmbActual = cur.total > 0 ? rmbSubs.reduce((a,s)=>a+s.rmb,0) / cur.total : 0;
    const ovsActual = cur.total > 0 ? ovsSubs.reduce((a,s)=>a+s.rmb,0) / cur.total : 0;
    const reActual  = cur.total > 0 ? reSubs.reduce((a,s)=>a+(s.rmb||0),0) / cur.total : 0;

    const card = (label, color, target, actual, subs) => {
      const delta = actual - target;
      const cls = Math.abs(delta) > 0.05 ? (delta > 0 ? "over" : "under") : "ok";
      const chip = cls === "over" ? `<span class="chip danger" title="偏离Δ=实际占比-目标占比（单位pp）">偏多 +${pp(delta,1)}</span>`
                 : cls === "under" ? `<span class="chip warn" title="偏离Δ=实际占比-目标占比（单位pp）">偏少 ${pp(delta,1)}</span>`
                 : `<span class="chip ok">在阈值内</span>`;
      const axisMax = Math.max(target, actual) * 1.3 || 0.01;
      const fillW = Math.min(100, (actual/axisMax)*100);
      const targetX = (target/axisMax)*100;
      const fillCls = cls;
      const sumRMB = subs.reduce((a,s)=>a+s.rmb,0);

      // 子项明细：按金额降序展示
      const sorted = subs.slice().sort((a,b) => b.rmb - a.rmb);
      const subsHTML = sorted.map(s => `
        <div class="sub-row">
          <div class="sub-name">${ccyTag(s.ccy)}<span class="nm">${s.name}</span>${phaseBadgeHTML(s.phase)}</div>
          <div class="sub-raw num">${fmt(s.raw)} ${s.ccy}</div>
          <div class="sub-rmb num">${fmt(s.rmb)}</div>
          <div class="sub-state ok">${pct(s.actualPct,1)}</div>
        </div>
      `).join("");

      return `
        <div class="mod" style="border-left:3px solid ${color}">
          <div class="mod-head">
            <div>
              <div class="mod-name">${label} ${chip}</div>
              <div style="color:var(--text-2);font-size:11px;margin-top:4px">小计 <span class="num">${fmt(sumRMB)}</span> RMB · ${subs.length} 个子项</div>
            </div>
            <div class="mod-meta">
              <div class="pct ${fillCls} num">${pct(actual,1)}</div>
              <div class="target">目标 ${pct(target,1)}</div>
            </div>
          </div>
          <div class="bar">
            <div class="fill ${fillCls}" style="width:${fillW}%"></div>
            <div class="target-mark" style="left:${targetX}%"></div>
          </div>
          <div class="subs">${subsHTML}</div>
        </div>
      `;
    };
    // 内联中国国旗 SVG，规避 Windows 上 🇨🇳 emoji 渲染为 "CN" 文字方块的问题
    const cnFlag = `<svg width="20" height="14" viewBox="0 0 30 20" style="vertical-align:-2px;border-radius:2px;box-shadow:0 0 0 1px var(--border,rgba(0,0,0,.1))" aria-label="中国国旗"><rect width="30" height="20" fill="#de2910"/><g fill="#ffde00"><polygon points="6,2 7.18,5.3 4,3.2 8,3.2 4.82,5.3"/><circle cx="10" cy="2" r=".7"/><circle cx="12" cy="4" r=".7"/><circle cx="12" cy="7" r=".7"/><circle cx="10" cy="9" r=".7"/></g></svg>`;
    // 不动产池阈值放宽到 0.08：房产调仓周期长、估值波动大，套用金融盘 5% 红线会长期误报
    const reCard = (subs) => {
      const sumRMB = subs.reduce((a,s)=>a+(s.rmb||0),0);
      const sorted = subs.slice().sort((a,b) => (b.rmb||0) - (a.rmb||0));
      const subsHTML = sorted.map(s => `
        <div class="sub-row">
          <div class="sub-name">${ccyTag(s.ccy)}<span class="nm">${h(s.name)}</span>${phaseBadgeHTML(s.phase)}</div>
          <div class="sub-raw num">${fmt(s.raw)} ${s.ccy}</div>
          <div class="sub-rmb num">${fmt(s.rmb||0)}</div>
          <div class="sub-state ok">${pct(s.actualPct,1)}</div>
        </div>
      `).join("");
      const delta = reActual - reTarget;
      const cls = Math.abs(delta) > 0.08 ? (delta > 0 ? "over" : "under") : "ok";
      const chip = cls === "over" ? `<span class="chip danger" title="偏离Δ=实际占比-目标占比（单位pp）">偏多 +${pp(delta,1)}</span>`
                 : cls === "under" ? `<span class="chip warn" title="偏离Δ=实际占比-目标占比（单位pp）">偏少 ${pp(delta,1)}</span>`
                 : `<span class="chip ok">在阈值内</span>`;
      const axisMax = Math.max(reTarget, reActual) * 1.3 || 0.01;
      const fillW = Math.min(100, (reActual/axisMax)*100);
      const targetX = (reTarget/axisMax)*100;
      return `
        <div class="mod" style="border-left:3px solid var(--gold)">
          <div class="mod-head">
            <div>
              <div class="mod-name">🏠 不动产池（收租房产） ${chip}</div>
              <div style="color:var(--text-2);font-size:11px;margin-top:4px" title="不动产池=顶层 realEstate 项折RMB之和；计入总盘，不参与四象限偏离">小计 <span class="num">${fmt(sumRMB)}</span> RMB · ${subs.length} 个子项</div>
            </div>
            <div class="mod-meta">
              <div class="pct ${cls} num">${pct(reActual,1)}</div>
              <div class="target">目标 ${pct(reTarget,1)}</div>
            </div>
          </div>
          <div class="bar">
            <div class="fill ${cls}" style="width:${fillW}%"></div>
            <div class="target-mark" style="left:${targetX}%"></div>
          </div>
          <div class="subs">${subsHTML}</div>
        </div>
      `;
    };
    // 纪念品池：纯展示，不设目标占比、不告警（纪念股/汽车/收藏品等耗损型资产不做再平衡）
    // ponytail: 复用 reCard 的子项行结构，去掉 bar/target-mark/chip，只留市值小计与占比。
    const svCard = (subs) => {
      const svActual = cur.total > 0 ? subs.reduce((a,s)=>a+(s.rmb||0),0) / cur.total : 0;
      const sumRMB = subs.reduce((a,s)=>a+(s.rmb||0),0);
      const sorted = subs.slice().sort((a,b) => (b.rmb||0) - (a.rmb||0));
      const subsHTML = sorted.map(s => `
        <div class="sub-row">
          <div class="sub-name">${ccyTag(s.ccy)}<span class="nm">${h(s.name)}</span>${phaseBadgeHTML(s.phase)}</div>
          <div class="sub-raw num">${fmt(s.raw||0)} ${s.ccy}</div>
          <div class="sub-rmb num">${fmt(s.rmb||0)}</div>
          <div class="sub-state ok">${pct(s.actualPct,1)}</div>
        </div>
      `).join("");
      return `
        <div class="mod" style="border-left:3px solid var(--text-2)">
          <div class="mod-head">
            <div>
              <div class="mod-name">🎁 纪念品池（耗损/收藏） <span class="chip ok">仅展示</span></div>
              <div style="color:var(--text-2);font-size:11px;margin-top:4px" title="纪念品池=顶层 souvenirs 项折RMB之和；计入总盘，不参与四象限偏离与再平衡">小计 <span class="num">${fmt(sumRMB)}</span> RMB · ${subs.length} 个子项</div>
            </div>
            <div class="mod-meta">
              <div class="pct ok num">${pct(svActual,1)}</div>
              <div class="target">无目标</div>
            </div>
          </div>
          <div class="subs">${subsHTML}</div>
        </div>
      `;
    };
    pools.innerHTML =
      card(`${cnFlag} RMB 池（人民币）`,   "var(--rmb)", rmbTarget, rmbActual, rmbSubs) +
      card("🌏 海外池（USD + HKD）", "var(--usd)", ovsTarget, ovsActual, ovsSubs) +
      reCard(reSubs) +
      svCard(svSubs);
  }

  // ---- 健康检查（紧凑单行版）----
  function renderHealthCheck(cur, target) {
    const issues = C.healthCheck(cur, target);
    const root = $("#health-check");
    if (!root) return;
    if (issues.length === 0) {
      root.innerHTML = `
        <div class="hc-strip">
          <div class="hc-row ok">
            <span class="lvl">OK</span>
            <span class="body"><b>全部健康</b>所有红线 / 象限阈值 / 待办均在控</span>
            <span class="action">继续季度复盘</span>
          </div>
        </div>`;
      return;
    }
    const lvlLabel = { danger: "红线", warn: "偏离", info: "待办", ok: "OK" };
    root.innerHTML = `<div class="hc-strip">${issues.map(i => `
      <div class="hc-row ${i.level}">
        <span class="lvl">${h(lvlLabel[i.level] || i.level)}</span>
        <span class="body"><b>${h(i.title)}</b>${h(i.detail)}</span>
        <span class="action">→ ${h(i.action)}</span>
      </div>
    `).join("")}</div>`;
  }

  // ---- 资产 vs 现金流对账 ----
  function renderReconcile(prev, cur) {
    const root = $("#reconcile-bar");
    if (!root) return;
    const r = C.reconcile(prev, cur);
    if (!r) {
      root.innerHTML = `<div class="recon">📍 首次建档（${cur.date}）。再报数 1 次后，这里会显示真实回报率。</div>`;
      return;
    }
    const sign = r.marketReturn >= 0 ? "ret-pos" : "ret-neg";
    const mark = r.marketReturn >= 0 ? "+" : "";
    root.innerHTML = `
      <div class="recon">
        <span>📊 距上次报数 <b>${r.days} 天</b></span>
        <span>·</span>
        <span>总盘变化 <b class="${sign}">${mark}${fmtK(r.dTotal)}</b></span>
        <span>·</span>
        <span>注入 <b>${fmtK(r.netInjection)}</b></span>
        <span>·</span>
        <span>真实回报 <b class="${sign}">${mark}${fmtK(r.marketReturn)}</b> (${(r.returnPct*100).toFixed(2)}%)</span>
        <span>·</span>
        <span>年化 <b class="${sign}">${(r.annualized*100).toFixed(1)}%</b></span>
      </div>`;
  }

  // ---- 里程碑 P0/P1/P2/P3 ----
  function renderMilestones(target) {
    const root = $("#milestones");
    if (!root) return;
    const ms = (target.milestones && target.milestones.items) || [];
    if (ms.length === 0) { root.innerHTML = `<div style="color:var(--text-2)">target.json 未配置 milestones</div>`; return; }
    const counts = { P0:[0,0], P1:[0,0], P2:[0,0], P3:[0,0] };
    ms.forEach(m => { if (counts[m.priority]) { counts[m.priority][1]++; if (m.done) counts[m.priority][0]++; } });
    const summary = ["P0","P1","P2","P3"].map(p => {
      const [d,t] = counts[p];
      const rate = t ? d/t : 0;
      return `<div style="padding:8px 14px;background:var(--bg-2);border-radius:8px;font-size:12px"><span class="ms-prio ${p}" style="margin-right:8px">${p}</span>${d}/${t} <span style="color:var(--text-2);margin-left:6px">${(rate*100).toFixed(0)}%</span></div>`;
    }).join("");

    const cards = ms.map(m => `
      <div class="ms-card ${m.done ? 'done' : ''}">
        <div class="ms-check">${m.done ? '✓' : ''}</div>
        <span class="ms-prio ${m.priority}">${m.priority}</span>
        <div style="flex:1">
          <div class="ms-name">${m.name}</div>
          ${m.note ? `<div class="ms-note">${m.note}</div>` : ''}
        </div>
      </div>
    `).join("");

    root.innerHTML = `
      <div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap">${summary}</div>
      ${target.milestones.note ? `<div style="color:var(--text-2);font-size:12px;margin-bottom:8px">${target.milestones.note}</div>` : ''}
      <div class="ms-grid">${cards}</div>
    `;
  }

  // ---- 对冲排行 Tab ----
  let _hedgeRendered = false;
  window.renderHedgeTab = function () {
    if (_hedgeRendered) return; // 只渲染一次
    _hedgeRendered = true;

    const GROUPS = {
      hk_conc:  { label:"🐉 港股·集中仓",  color:"#a48cbc" },
      us_equity:{ label:"🇺🇸 美股·全球增长", color:"#7aa07a" },
      gold:     { label:"🥇 黄金·避险对冲", color:"#b69462" },
      div_rmb:  { label:"🇨🇳 红利·防御收入", color:"#7d8fb8" },
      closed:   { label:"🔴 已清仓",        color:"#6f6052" },
    };
    // ponytail: 港股集中仓按 key 前缀动态归类，避免写死个股
    const HK_GROUP_PREFIXES = ["hk_", "tencent_", "hs_", "hangseng_"];
    const isHK = key => HK_GROUP_PREFIXES.some(p => key.startsWith(p));
    // KEY_GROUP 提供显式归类；未列出的港股 key 运行时归入 hk_conc
    const KEY_GROUP = {
      hstech:"closed", hsi_dividend_efund:"closed",
      voo:"us_equity", qqqm:"us_equity", brk_b:"us_equity",
      iau_gold:"gold", gold_etf_huaan:"gold",
      etf_563020:"div_rmb", etf_515450:"div_rmb", etf_512890:"div_rmb",
      high_div_bluechip:"closed",
    };
    const TAG_CLASS = {
      hk_conc:"hedge-hk", us_equity:"hedge-usd", gold:"hedge-gold",
      div_rmb:"hedge-div", closed:"hedge-closed"
    };

    C.fetchJson("history.json").then(data=>{
      const snaps = (data.snapshots||[]).slice().sort((a,b)=>a.date.localeCompare(b.date));
      const latest = snaps[snaps.length-1];
      const lRates = latest.rates||{};
      const toRMB = (v,ccy) => ccy==="RMB"?v:v*(lRates[ccy]||1);

      const allKeys = new Set();
      snaps.forEach(s=>Object.keys(s.holdings||{}).forEach(k=>allKeys.add(k)));

      const items = [];
      allKeys.forEach(key=>{
        const h = latest.holdings[key];
        if(!h || "raw" in h) return;
        const group = KEY_GROUP[key] || (isHK(key) ? "hk_conc" : "closed");
        const ccy = h.ccy || "RMB";
        const name = h.name || key;
        const shares = h.shares||0, cost = h.cost||0;

        if(shares > 0){
          const px = (latest.prices[key]||{}).price || cost;
          const mv = toRMB(shares*px,ccy), cRmb = toRMB(shares*cost,ccy);
          items.push({key,name,group,shares,pl:mv-cRmb,plPct:cRmb?(mv-cRmb)/cRmb:0,status:"holding"});
        } else {
          let lc=0,ls=0;
          for(let i=snaps.length-1;i>=0;i--){
            const sh=(snaps[i].holdings||{})[key];
            if(sh&&sh.shares>0){ls=sh.shares;lc=sh.cost||0;break;}
          }
          const cRmb=toRMB(ls*lc,ccy);
          items.push({key,name,group,shares:0,pl:-cRmb,plPct:-1,status:"closed"});
        }
      });
      items.sort((a,b)=>b.pl-a.pl);

      // ---- 对冲概览 ----
      const groupPL={};
      Object.keys(GROUPS).forEach(g=>groupPL[g]={pl:0,items:[]});
      items.forEach(it=>{if(groupPL[it.group])groupPL[it.group].pl+=it.pl;groupPL[it.group].items.push(it);});

      const sideHTML=(gk,cls)=>{
        const g=GROUPS[gk],d=groupPL[gk];
        const vc=d.pl>=0?"ok-color":"danger-color";
        const list=d.items.map(it=>`<span style="display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:4px;background:${it.pl>=0?'var(--ok)':'var(--danger)'}"></span>${it.name} <span class="num">${C.fmtK(it.pl)}</span>`).join("<br>");
        return `<div class="hedge-side ${cls}" style="background:var(--bg-1);border:1px solid var(--line);border-radius:8px;padding:16px;${cls==='left'?'border-right:none':'border-left:none'}">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-3);font-weight:600;margin-bottom:8px">${g.label}</div>
          <div style="font-size:26px;font-weight:700;color:var(${d.pl>=0?'--ok':'--danger'})" class="num">${C.fmtK(d.pl)} RMB</div>
          <div style="margin-top:10px;font-size:12px;color:var(--text-2);line-height:1.8">${list}</div>
        </div>`;
      };

      const bearPL=groupPL.hk_conc.pl;
      const hedgePL=groupPL.us_equity.pl+groupPL.gold.pl;
      const overview = document.getElementById("hedge-overview");
      if(overview) overview.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 60px 1fr;gap:0;margin-bottom:16px;align-items:stretch">
          ${sideHTML("hk_conc","left")}
          <div style="display:flex;align-items:center;justify-content:center;background:var(--bg-2);border-top:1px solid var(--line);border-bottom:1px solid var(--line);font-size:11px;color:var(--text-3);font-weight:600;letter-spacing:1px">VS</div>
          ${(()=>{const usd=groupPL.us_equity,gold=groupPL.gold;
            const list=[...usd.items,...gold.items].map(it=>`<span style="display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:4px;background:${it.pl>=0?'var(--ok)':'var(--danger)'}"></span>${it.name} <span class="num">${C.fmtK(it.pl)}</span>`).join("<br>");
            return `<div class="hedge-side right" style="background:var(--bg-1);border:1px solid var(--line);border-radius:0 8px 8px 0;border-left:none;padding:16px">
              <div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-3);font-weight:600;margin-bottom:8px">🛡️ 美股 + 黄金（对冲端）</div>
              <div style="font-size:26px;font-weight:700;color:var(${hedgePL>=0?'--ok':'--danger'})" class="num">${C.fmtK(hedgePL)} RMB</div>
              <div style="margin-top:10px;font-size:12px;color:var(--text-2);line-height:1.8">${list}</div>
            </div>`;
          })()}
        </div>`;

      // ---- 净对冲条 ----
      const net=bearPL+hedgePL;
      const maxA=Math.max(Math.abs(bearPL),Math.abs(hedgePL),1);
      const posW=net>0?Math.min(50,(net/maxA)*50):0;
      const negW=net<0?Math.min(50,(-net/maxA)*50):0;
      const netEl = document.getElementById("hedge-net-card");
      if(netEl) netEl.innerHTML=`
        <div style="background:var(--bg-1);border:1px solid var(--line);border-radius:8px;padding:16px 20px;margin-bottom:16px;display:flex;align-items:center;gap:16px;flex-wrap:wrap">
          <div>
            <div style="font-size:11px;color:var(--text-3);text-transform:uppercase;letter-spacing:.5px;font-weight:600">净对冲效果（港股集中 + 美股黄金）</div>
            <div style="font-size:20px;font-weight:700;color:var(${net>=0?'--ok':'--danger'})" class="num">${net>=0?"+":""}${C.fmtK(net)} RMB</div>
          </div>
          <div style="flex:1;min-width:200px;height:28px;background:var(--bg-3);border-radius:6px;position:relative;overflow:hidden">
            <div style="position:absolute;left:50%;top:0;bottom:0;width:1px;background:var(--text-3)"></div>
            ${net>0?`<div style="position:absolute;left:50%;top:0;bottom:0;width:${posW}%;background:rgba(122,160,122,.5);border-radius:0 4px 4px 0"></div>`:`<div style="position:absolute;right:50%;top:0;bottom:0;width:${negW}%;background:rgba(190,118,110,.5);border-radius:4px 0 0 4px"></div>`}
          </div>
          <div style="font-size:11px;color:var(--text-2);max-width:300px">${net<0?"⚠️ 对冲尚未完全覆盖港股集中仓亏损":"✅ 对冲端已反超港股集中仓亏损"}</div>
        </div>`;

      // ---- 排行表 ----
      const maxPL=Math.max(...items.map(it=>Math.abs(it.pl)),1);
      const rows=items.map(it=>{
        const tag=TAG_CLASS[it.group]||"hedge-closed";
        const gLabel=(GROUPS[it.group]?.label||"").split(" ").pop();
        const cls=it.pl>0?"ok-color":(it.pl<0?"danger-color":"");
        const sign=it.pl>=0?"+":"";
        const barPct=(Math.abs(it.pl)/maxPL)*50;
        const barDir=it.pl>=0?"left":"right";
        const barColor=it.pl>=0?"rgba(122,160,122,.5)":"rgba(190,118,110,.5)";
        return `<tr>
          <td style="padding:8px 10px;background:var(--bg-1)"><span style="font-size:9px;padding:2px 5px;border-radius:3px;font-weight:600;background:var(--bg-3);border:1px solid var(--line);color:var(--text-2);margin-right:6px">${gLabel}</span>${it.name}</td>
          <td style="padding:8px 10px;background:var(--bg-1);text-align:right" class="num">${it.status==="closed"?"—":it.shares.toLocaleString()}</td>
          <td style="padding:8px 10px;background:var(--bg-1);text-align:right" class="num ${cls}">${sign}${C.fmt(Math.round(it.pl))}</td>
          <td style="padding:8px 10px;background:var(--bg-1);text-align:right" class="num ${cls}">${it.status==="closed"?"已清仓":(it.plPct*100).toFixed(1)+"%"}</td>
          <td style="padding:8px 10px;background:var(--bg-1);width:180px"><div style="height:16px;border-radius:3px;background:var(--bg-3);position:relative;overflow:hidden"><div style="position:absolute;top:0;bottom:0;${barDir}:0;width:${barPct}%;background:${barColor};border-radius:3px"></div></div></td>
        </tr>`;
      }).join("");
      const rankEl = document.getElementById("hedge-ranking");
      if(rankEl) rankEl.innerHTML=`<table style="width:100%;border-collapse:separate;border-spacing:0 3px"><thead><tr>
        <th style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-3);font-weight:600;text-align:left;padding:4px 10px">品种</th>
        <th style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-3);font-weight:600;text-align:right;padding:4px 10px">持仓</th>
        <th style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-3);font-weight:600;text-align:right;padding:4px 10px">盈亏</th>
        <th style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-3);font-weight:600;text-align:right;padding:4px 10px">收益率</th>
        <th></th>
      </tr></thead><tbody>${rows}</tbody></table>`;

      // ---- 对冲配对（集中仓合计 vs 美股/黄金对冲端）----
      const findIt=k=>items.find(it=>it.key===k);
      const hkAll=items.filter(it=>it.group==="hk_conc"&&it.status==="holding");
      const hkAgg={name:"港股集中仓合计",pl:hkAll.reduce((a,it)=>a+it.pl,0)};
      const pairs=[
        {l:null,r:"voo",n:"港股集中 vs VOO 标普"},
        {l:null,r:"qqqm",n:"港股集中 vs QQQM 纳指"},
        {l:null,r:"iau_gold",n:"港股集中 vs IAU 黄金"},
        {l:null,r:"gold_etf_huaan",n:"港股集中 vs 518880 黄金"},
      ];
      const pairHTML=pairs.map(p=>{
        const li=p.l?findIt(p.l):hkAgg;
        const ri=findIt(p.r);
        if(!li||!ri)return"";
        const net2=li.pl+ri.pl;
        return `<div style="background:var(--bg-1);border:1px solid var(--line);border-radius:8px;padding:14px 16px;margin-bottom:8px;display:grid;grid-template-columns:1fr auto 1fr;gap:12px;align-items:center">
          <div><div style="font-size:13px;font-weight:600">${li.name}</div><div style="font-size:18px;font-weight:700;color:var(${li.pl>=0?'--ok':'--danger'})" class="num">${C.fmtK(li.pl)}</div></div>
          <div style="font-size:18px;color:var(--text-3)">⟷</div>
          <div style="text-align:right"><div style="font-size:13px;font-weight:600">${ri.name}</div><div style="font-size:18px;font-weight:700;color:var(${ri.pl>=0?'--ok':'--danger'})" class="num">${C.fmtK(ri.pl)}</div></div>
          <div style="font-size:12px;color:var(--text-2);text-align:center;grid-column:1/-1;border-top:1px dashed var(--line);padding-top:6px">对冲净值 <b class="num" style="color:var(${net2>=0?'--ok':'--danger'})">${net2>=0?"+":""}${C.fmtK(net2)}</b> · ${p.n}</div>
        </div>`;
      }).filter(Boolean).join("");
      const pairEl = document.getElementById("hedge-pairs");
      if(pairEl) pairEl.innerHTML=pairHTML;

      // ---- 操作时间线 ----
      const tl=[
        {d:"2026-05-16",e:[{t:"buy",x:"建档：全品种首次录入"}]},
        {d:"2026-05-28",e:[{t:"sell",x:"卖出 长江电力 100股@27.22"},{t:"buy",x:"买入 518880 10,900股@9.144"}]},
        {d:"2026-06-02",e:[{t:"sell",x:"港股集中 -1,200股"},{t:"sell",x:"清仓 恒生科技 03032"},{t:"sell",x:"清仓 高股息 03483"}]},
        {d:"2026-06-11",e:[{t:"buy",x:"加仓 518880 5,800股@8.530"}]},
        {d:"2026-06-22",e:[{t:"sell",x:"清仓 512890 50,000股@1.112"},{t:"buy",x:"买入 563020 99,500股@1.1076"},{t:"buy",x:"买入 515450 81,000股@1.3617"}]},
      ];
      const tlHTML=tl.map(t=>{
        const chips=t.e.map(e=>`<span style="font-size:11px;padding:3px 8px;border-radius:4px;background:var(--bg-1);border:1px solid ${e.t==='buy'?'rgba(122,160,122,.3)':'rgba(190,118,110,.3)'};color:var(${e.t==='buy'?'--ok':'--danger'})">${e.t==='buy'?'🟢':'🔴'} ${e.x}</span>`).join(" ");
        return `<div style="display:grid;grid-template-columns:90px 1fr;gap:12px;margin-bottom:6px"><div style="font-size:11px;color:var(--text-3);font-family:'JetBrains Mono',monospace;padding-top:4px;text-align:right">${t.d}</div><div style="display:flex;flex-wrap:wrap;gap:4px">${chips}</div></div>`;
      }).join("");
      const tlEl = document.getElementById("hedge-timeline");
      if(tlEl) tlEl.innerHTML=tlHTML;

    }).catch(err=>{
      console.error("对冲排行加载失败:",err);
    });
  };
})();
