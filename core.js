// =============================================================
// 资产配置看板 · 核心计算库（共享）
// 三本账（target/history/recurring/transactions）共用的工具
// =============================================================
window.AssetCore = (function () {
  'use strict';

  const PRIVACY_LS_KEY = "afd_hide_amounts";
  const PRIVACY_MASK = "••••";

  function isPrivacyMode() {
    try {
      return window.localStorage && window.localStorage.getItem(PRIVACY_LS_KEY) === "1";
    } catch (err) {
      return false;
    }
  }

  function setPrivacyMode(on) {
    try {
      if (window.localStorage) window.localStorage.setItem(PRIVACY_LS_KEY, on ? "1" : "0");
    } catch (err) {
      // Ignore localStorage failures and fall back to visible numbers.
    }
    return !!on;
  }

  function maskedValue() {
    return PRIVACY_MASK;
  }

  function escapeHTML(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttr(value) {
    return escapeHTML(value).replace(/`/g, "&#96;");
  }

  function getThemeName() {
    try {
      return document && document.documentElement && document.documentElement.getAttribute("data-theme") === "dark"
        ? "dark"
        : "light";
    } catch (err) {
      return "light";
    }
  }

  function getEchartsTheme() {
    return getThemeName() === "dark" ? "dark" : null;
  }

  function getMilestoneStats(milestones) {
    const items = Array.isArray(milestones)
      ? milestones
      : ((milestones && Array.isArray(milestones.items)) ? milestones.items : []);
    const done = items.filter(function (m) { return !!(m && m.done); }).length;
    return { done: done, total: items.length };
  }

  // ---- 核心工具函数 ----

  // 动态获取数据路径 (根据 config.js 配置，如果没有则回退到 demo_data)
  function getDataPath(filename) {
    const cfg = window.AFD_CONFIG || {};
    const dataDir = cfg.dataDir ? String(cfg.dataDir) : "demo_data";
    const sharedDir = cfg.sharedDir ? String(cfg.sharedDir) : "demo_data";
    const name = String(filename || "");
    const base = name.split("/")[0];
    const isNumeric =
      base === "transactions" ||
      name === "target.json" ||
      name === "history.json" ||
      name === "liabilities.json" ||
      name === "recurring.json" ||
      name === "income_events.json" ||
      name === "categories.json";
    const dir = isNumeric ? dataDir : sharedDir;
    return `./${dir}/${name}`;
  }

  function fetchJson(filename, options) {
    const opts = options || {};
    const url = opts.url || getDataPath(filename);
    return fetch(url, { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error((filename || url) + " 加载失败（HTTP " + res.status + "）");
        return res.json();
      })
      .catch(function (err) {
        if (Object.prototype.hasOwnProperty.call(opts, "fallback")) return opts.fallback;
        throw err;
      });
  }

  // ========== 格式化 ==========
  function fmt(n)  {
    if (n == null || isNaN(n)) return "—";
    if (isPrivacyMode()) return maskedValue();
    return Math.round(n).toLocaleString("en-US");
  }
  function fmtK(n) {
    if (n == null || isNaN(n)) return "—";
    if (isPrivacyMode()) return maskedValue();
    if (Math.abs(n) >= 1e8) return (n/1e8).toFixed(2) + "亿";
    if (Math.abs(n) >= 1e4) return (n/1e4).toFixed(1) + "万";
    return Math.round(n).toLocaleString("en-US");
  }
  function pct(x, d) { d = d == null ? 1 : d; return isNaN(x) ? "—" : (x*100).toFixed(d) + "%"; }

  // ========== 日期 / 时间区间 ==========
  function parseDate(s) {
    if (!s) return null;
    const m = String(s).match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/);
    if (!m) return null;
    return new Date(parseInt(m[1]), (parseInt(m[2]||1)||1)-1, parseInt(m[3]||1)||1);
  }
  function activeMonthsInYear(item, year) {
    const yStart = new Date(year, 0, 1);
    const yEnd   = new Date(year, 11, 31);
    const start = parseDate(item.startDate) || new Date(1970,0,1);
    const end   = parseDate(item.endDate)   || new Date(9999,11,31);
    if (start > yEnd || end < yStart) return 0;
    const effStart = start > yStart ? start : yStart;
    const effEnd   = end < yEnd ? end : yEnd;
    const months = (effEnd.getFullYear() - effStart.getFullYear()) * 12 + (effEnd.getMonth() - effStart.getMonth()) + 1;
    return Math.max(0, Math.min(12, months));
  }
  function isActive(item, ref) {
    ref = ref || new Date();
    const start = parseDate(item.startDate);
    const end   = parseDate(item.endDate);
    if (start && start > ref) return false;
    if (end && end < ref) return false;
    return true;
  }

  // ========== 汇率 ==========
  function makeToRMB(rates) {
    return function (amt, ccy) {
      return amt * (ccy === "RMB" ? 1 : ((rates && rates[ccy]) || 1));
    };
  }

  // ========== 通胀 ==========
  // futureValue = present * (1 + r)^n
  function inflate(present, years, annualRate) { return present * Math.pow(1 + annualRate, years); }
  // todayValue = future / (1 + r)^n  （把未来购买力折回今天）
  function deflate(future, years, annualRate) { return future / Math.pow(1 + annualRate, years); }

  // ========== Snapshot enrichment（资产快照 → 模块/子项/币种聚合）==========
  function enrichSnapshot(snap, target) {
    const rates  = snap.rates  || { USD:1, HKD:1 };
    const prices = snap.prices || {};
    const toRMB  = makeToRMB(rates);

    let total = 0;
    let totalCost = 0;
    const ccyTotals = { RMB:0, USD:0, HKD:0 };
    const KEY_ALIASES = { etf_563020: ["etf_512890"] };
    const targetKeys = new Set(target.modules.flatMap(m => m.subs.map(s => s.key)));
    // ponytail: 不动产已从四象限剥离到顶层 realEstate segment，其 key 必须纳入 targetKeys，
    // 否则会被当 orphan 二次计入总盘。与 modules.subs 同口径防重。
    (target.realEstate || []).forEach(function (re) { if (re && re.key) targetKeys.add(re.key); });
    Object.values(KEY_ALIASES).forEach(function (arr) {
      (arr || []).forEach(function (k) { targetKeys.add(k); });
    });

    function resolveKey(k, obj) {
      if (obj && obj[k] != null) return k;
      const aliases = KEY_ALIASES[k];
      if (!aliases) return k;
      for (let i = 0; i < aliases.length; i++) {
        const ak = aliases[i];
        if (obj && obj[ak] != null) return ak;
      }
      return k;
    }

    function valueOf(h, sub) {
      if (!h) return null;
      const ccy = h.ccy || (sub && sub.ccy) || "RMB";
      const rate = ccy === "RMB" ? 1 : (rates[ccy] || 1);
      if (h.raw != null) {
        const rmb = h.raw * rate;
        return { raw: h.raw, rmb, cost: h.raw, costRMB: rmb, marketValue: rmb, ccy };
      }
      if (h.shares != null) {
        const px = (prices[sub && sub.key] && prices[sub.key].price) != null
                   ? prices[sub.key].price : h.price;
        if (px == null) return null;
        const mv = h.shares * px;
        const costTotal = h.shares * (h.cost != null ? h.cost : px);
        return {
          raw: mv, rmb: mv * rate,
          cost: costTotal, costRMB: costTotal * rate, marketValue: mv * rate,
          shares: h.shares, price: px, costPerShare: h.cost, ccy,
        };
      }
      return null;
    }

    const modules = target.modules.map(m => {
      const subs = m.subs.map(sub => {
        const holdings = snap.holdings || {};
        const pricesObj = prices || {};
        const hk = resolveKey(sub.key, holdings);
        const pk = resolveKey(sub.key, pricesObj);
        const h = holdings[hk];
        const v = valueOf(h, Object.assign({}, sub, { key: pk }));
        if (!v) return Object.assign({}, sub, { raw:0, rmb:0, cost:0, costRMB:0, marketValue:0, missing:true });
        return Object.assign({}, sub, v);
      });
      const modTotal = subs.reduce(function(a,s){ return a + s.rmb; }, 0);
      total += modTotal;
      totalCost += subs.reduce(function(a,s){ return a + (s.costRMB != null ? s.costRMB : s.rmb); }, 0);
      subs.forEach(function(s){ ccyTotals[s.ccy] = (ccyTotals[s.ccy] || 0) + s.rmb; });
      return Object.assign({}, m, { subs:subs, total:modTotal });
    });

    // 游离持仓（target 未列出）
    const orphanSubs = [];
    Object.entries(snap.holdings || {}).forEach(function (entry) {
      const key = entry[0], h = entry[1];
      if (targetKeys.has(key)) return;
      const v = valueOf(h, { key:key });
      if (!v) return;
      orphanSubs.push(Object.assign({
        key: key, name: h.name || key, venue: h.venue || "—",
        subTargetPct: 0, subThresholdPct: 0,
        note: h.note || "Target 未列出 · 待消化或重分类",
      }, v));
      ccyTotals[v.ccy] = (ccyTotals[v.ccy] || 0) + v.rmb;
      total += v.rmb;
      totalCost += v.costRMB != null ? v.costRMB : v.rmb;
    });
    if (orphanSubs.length > 0) {
      const orphanTotal = orphanSubs.reduce(function(a,s){return a+s.rmb;}, 0);
      modules.push({
        key: "_orphan",
        name: "待变现 / 游离持仓",
        roman: "★",
        targetPct: 0,
        thresholdPct: 0,
        subs: orphanSubs,
        total: orphanTotal,
        purpose: "Target 中未列出的资产；通常是过渡持仓（如待售房产）或还没归类的新仓",
      });
    }

    // 不动产 segment（顶层 realEstate，类似 souvenirs）：计入总盘/币种分布，但不进四象限 modules。
    // ponytail: 总盘口径零变化——房产市值照旧计入 total/ccyTotals，只是不再是任何象限的 sub。
    const realEstateItems = (target.realEstate || []).map(function (re) {
      const holdings = snap.holdings || {};
      const pricesObj = prices || {};
      const hk = resolveKey(re.key, holdings);
      const pk = resolveKey(re.key, pricesObj);
      const h = holdings[hk];
      const v = valueOf(h, Object.assign({}, re, { key: pk }));
      if (!v) return Object.assign({}, re, { raw:0, rmb:0, cost:0, costRMB:0, marketValue:0, missing:true });
      return Object.assign({}, re, v);
    });
    realEstateItems.forEach(function (s) {
      if (!s.rmb) return;
      total += s.rmb;
      totalCost += s.costRMB != null ? s.costRMB : s.rmb;
      ccyTotals[s.ccy] = (ccyTotals[s.ccy] || 0) + s.rmb;
    });
    const realEstateTotal = realEstateItems.reduce(function(a,s){return a + (s.rmb||0);}, 0);

    // 金融盘 = 四象限模块非不动产子项之和（不动产已不在 modules，等于 modules 全 sub 之和 - orphan）
    // ponytail: 保留 venue 判定兜底（万一 target 仍把不动产写在 modules 里），主路径是 realEstate 已剥离
    const isRealEstate = function (s) { return s.venue === "不动产"; };
    let financialTotal = 0;
    modules.forEach(function (m) {
      if (m.key === "_orphan") return;
      m.subs.forEach(function (s) {
        if (isRealEstate(s)) return;
        financialTotal += s.rmb;
      });
    });

    // 模块/子项状态判定：四象限用金融盘作分母（不动产剥离后按金融资产 100% 配平判偏离）；
    // _orphan 仍用全盘 total（"占整体盘"概念）。financialTotal 为 0 时回退 total 防除零。
    const quadrantDenom = financialTotal > 0 ? financialTotal : total;
    modules.forEach(function (m) {
      const denom = m.key === "_orphan" ? total : quadrantDenom;
      m.actualPct = denom > 0 ? m.total / denom : 0;
      m.delta     = m.actualPct - m.targetPct;
      if (m.key === "_orphan") {
        // 游离持仓目标=0%，有任何持仓都算超标
        m.status = m.total > 0 ? "over" : "ok";
      } else {
        m.status = Math.abs(m.delta) > m.thresholdPct ? (m.delta > 0 ? "over" : "under") : "ok";
      }
      m.subs.forEach(function (s) {
        s.actualPct = denom > 0 ? s.rmb / denom : 0;
        s.delta     = s.actualPct - (s.subTargetPct || 0);
        if (s.phase === "blocked")      s.status = "blocked";
        else if (s.phase === "exit")    s.status = s.rmb > 0 ? "exit" : "ok";
        else if (s.phase === "planned") s.status = s.rmb === 0 ? "planned" : (s.delta > (s.subThresholdPct||0) ? "over" : "ok");
        else s.status = (s.subThresholdPct && Math.abs(s.delta) > s.subThresholdPct)
                        ? (s.delta > 0 ? "over" : "under") : "ok";
      });
    });

    return Object.assign({}, snap, {
      total: total, totalCost: totalCost, ccyTotals: ccyTotals,
      modules: modules, financialTotal: financialTotal,
      realEstate: realEstateItems, realEstateTotal: realEstateTotal,
    });
  }

  // ========== 加权预期年化 ==========
  function weightedExpectedReturn(cur, scenario, opts) {
    opts = opts || {};
    const realEstateKeys = new Set(["property_a","property_b"]); // 兼容旧调用；venue 判定见 enrichSnapshot
    const isRealEstate = function (s) { return s.venue === "不动产" || realEstateKeys.has(s.key); };
    let weighted = 0, totalW = 0;
    cur.modules.forEach(function (m) {
      if (m.key === "_orphan" && opts.excludeOrphan !== false) return;
      m.subs.forEach(function (s) {
        if (opts.excludeRealEstate && isRealEstate(s)) return;
        const er = s.expectedReturn && s.expectedReturn[scenario];
        if (er != null && s.rmb > 0) {
          weighted += er * s.rmb;
          totalW += s.rmb;
        }
      });
    });
    // 整体盘口径（excludeRealEstate!==true）需把已剥离到 cur.realEstate 的房产纳入加权，
    // 否则"整体盘预期年化"会丢掉房产，与 app.js 的"含房产"语义冲突。金融盘口径维持剔除。
    if (!opts.excludeRealEstate) {
      (cur.realEstate || []).forEach(function (s) {
        const er = s.expectedReturn && s.expectedReturn[scenario];
        if (er != null && s.rmb > 0) {
          weighted += er * s.rmb;
          totalW += s.rmb;
        }
      });
    }
    return totalW > 0 ? weighted / totalW : 0;
  }

  // ========== 健康检查（红线/告警一眼看）==========
  function healthCheck(cur, target) {
    const issues = [];
    const total  = cur.total;
    const ccyTotals = cur.ccyTotals;
    const rmbPct = total > 0 ? ccyTotals.RMB / total : 0;
    const redLine = (target.redLines && target.redLines.singleStockMaxPct) || 0.05;

    // 1. 单一公司红线（按 target.redLines.singleStockGroups 聚合；未配置则取占总盘最大的单个 sub）
    const stockGroups = (target.redLines && target.redLines.singleStockGroups) || [];
    const groupREs = stockGroups.map(g => new RegExp("^" + g));
    let aggRMB = 0, aggName = "单一持仓";
    if (stockGroups.length) {
      cur.modules.forEach(function (m) {
        m.subs.forEach(function (s) {
          for (let i = 0; i < groupREs.length; i++) {
            if (groupREs[i].test(s.key)) { aggRMB += s.rmb; aggName = stockGroups[i] + "* 合计"; break; }
          }
        });
      });
    } else {
      let max = 0;
      cur.modules.forEach(function (m) {
        m.subs.forEach(function (s) {
          if (s.key === "_orphan" || s.status === "planned") return;
          // ponytail: 单一公司口径只管股票/基金类，不动产（收租房产）不应套用 5% 单股红线
          if (s.venue === "不动产") return;
          if (s.rmb > max) { max = s.rmb; aggRMB = s.rmb; aggName = s.name; }
        });
      });
    }
    const aggPct = total > 0 ? aggRMB / total : 0;
    if (aggPct > redLine) {
      issues.push({
        level: "danger",
        category: "red_line",
        title: "单一公司敞口超红线",
        detail: `${aggName} ${(aggPct*100).toFixed(1)}% > ${(redLine*100).toFixed(0)}%（机构标准）。当前 ${fmtK(aggRMB)} RMB，需减到 ${fmtK(total*redLine)} 以下。`,
        action: "触发减仓阶梯 / 移至对冲端（海外资产）",
      });
    }

    // 2. RMB 占比
    if (rmbPct > ((target.redLines && target.redLines.rmbMaxPct) || 0.70)) {
      issues.push({
        level: "danger",
        category: "red_line",
        title: "RMB 占比超红线",
        detail: `${(rmbPct*100).toFixed(1)}% > ${((target.redLines.rmbMaxPct||0.70)*100).toFixed(0)}%。`,
        action: "卖房款到账后优先购汇 / 港股通转 USD 资产",
      });
    } else if (rmbPct > ((target.redLines && target.redLines.rmbTargetPct) || 0.60)) {
      issues.push({
        level: "warn",
        category: "deviation",
        title: "RMB 占比高于目标",
        detail: `${(rmbPct*100).toFixed(1)}% > 目标 ${((target.redLines.rmbTargetPct||0.60)*100).toFixed(0)}%。`,
        action: "中长期再平衡",
      });
    }

    // 3. 大类（标普象限）偏离
    cur.modules.forEach(function (m) {
      if (m.key === "_orphan") return;
      if (m.status === "over") {
        issues.push({
          level: "warn",
          category: "deviation",
          title: m.name + " 象限超标",
          detail: `实际 ${(m.actualPct*100).toFixed(1)}% vs 目标 ${(m.targetPct*100).toFixed(0)}%（+${(m.delta*100).toFixed(1)}%）`,
          action: "季度末再平衡",
        });
      } else if (m.status === "under") {
        issues.push({
          level: "warn",
          category: "deviation",
          title: m.name + " 象限偏低",
          detail: `实际 ${(m.actualPct*100).toFixed(1)}% vs 目标 ${(m.targetPct*100).toFixed(0)}%（${(m.delta*100).toFixed(1)}%）`,
          action: "用新资金 / 卖出超标象限补仓",
        });
      }
    });

    // 4. 待变现资产存在
    const orphan = cur.modules.find(function (m) { return m.key === "_orphan"; });
    if (orphan && orphan.actualPct > 0.05) {
      issues.push({
        level: "info",
        category: "pending",
        title: "存在待变现资产",
        detail: `${fmtK(orphan.total)} RMB（占 ${(orphan.actualPct*100).toFixed(1)}%）。`,
        action: "完成 P0 核心房产定价 + 售出后重分配",
      });
    }

    return issues;
  }

  // ========== 保单现金价值（按年度时间序列）==========
  // schedule = { "2026": 18000, "2028": 21100, ... }，金额为保单原币种。
  // 缺失年份线性插值；早于首年取 0；晚于末年取末年值（现金价值表通常给到某个保单年度后趋稳）。
  function resolveCashValueForYear(schedule, year) {
    if (!schedule) return 0;
    const keys = Object.keys(schedule).map(Number).filter(y => !isNaN(y));
    if (keys.length === 0) return 0;
    keys.sort(function (a, b) { return a - b; });
    if (year < keys[0]) return 0;
    if (year >= keys[keys.length - 1]) return Number(schedule[keys[keys.length - 1]]) || 0;
    for (let i = 0; i < keys.length - 1; i++) {
      const y0 = keys[i], y1 = keys[i + 1];
      if (year >= y0 && year <= y1) {
        const v0 = Number(schedule[y0]) || 0;
        const v1 = Number(schedule[y1]) || 0;
        if (y1 === y0) return v0;
        const t = (year - y0) / (y1 - y0);
        return v0 + (v1 - v0) * t;
      }
    }
    return 0;
  }

  // 把所有保单当年现金价值合计注入 snap.holdings.insurance_cashvalue（就地修改）。
  // 优先用 cashValueSchedule（按 snap.date 取年份 + 插值）；兼容旧字段 cashValueRMB（当作当前值，原币种→需 schedule 没有时才用）。
  // 已存在 insurance_cashvalue 不覆盖。sumRMB > 0 才写入。
  function injectInsuranceCashValue(snap, recurring) {
    if (!snap || !recurring) return;
    if (!snap.holdings) snap.holdings = {};
    if (snap.holdings.insurance_cashvalue != null) return;
    const rates = snap.rates || { USD: 1, HKD: 1 };
    const year = (parseDate(snap.date) || new Date()).getFullYear();
    const expenses = (recurring.expenses || []).filter(function (e) {
      return e && e.kind === "insurance";
    });
    let sumRMB = 0;
    expenses.forEach(function (e) {
      let val = 0;
      if (e.cashValueSchedule) {
        val = resolveCashValueForYear(e.cashValueSchedule, year);
      } else if (e.cashValueRMB != null && e.cashValueRMB > 0) {
        // legacy：cashValueRMB 字面意思是 RMB，直接当 RMB 用
        val = Number(e.cashValueRMB) || 0;
        sumRMB += val;
        return;
      }
      if (!val) return;
      const ccy = e.ccy || "RMB";
      const rate = ccy === "RMB" ? 1 : (rates[ccy] || 1);
      sumRMB += val * rate;
    });
    if (sumRMB > 0) {
      snap.holdings.insurance_cashvalue = { raw: sumRMB, ccy: "RMB", _derived: true };
    }
  }

  // ========== 资产 vs 现金流对账 ==========
  // 返回上次到这次的总盘变化 = 注入 + 真实回报
  function reconcile(prevSnap, curSnap) {
    if (!prevSnap || !curSnap) return null;
    const dTotal = curSnap.total - prevSnap.total;
    const cf = curSnap.cashFlow || {};
    const deposits     = cf.deposits || 0;
    const withdrawals  = cf.withdrawals || 0;
    const netInjection = deposits - withdrawals;
    const marketReturn = dTotal - netInjection;
    const days = Math.max(1, (parseDate(curSnap.date) - parseDate(prevSnap.date)) / 86400000);
    const returnPct = prevSnap.total > 0 ? marketReturn / prevSnap.total : 0;
    const annualized = days > 0 ? Math.pow(1 + returnPct, 365 / days) - 1 : 0;
    return {
      days: Math.round(days),
      dTotal: dTotal,
      netInjection: netInjection,
      marketReturn: marketReturn,
      returnPct: returnPct,
      annualized: annualized,
    };
  }

  // ========== 启动断言（开发期发现错误）==========
  function runAssertions(cur, target) {
    const errors = [];
    const total = cur.total;
    if (!(total > 50e4 && total < 1e9)) {
      errors.push("总盘异常：" + fmtK(total) + "（预期 50 万 - 10 亿，超出说明数据填错）");
    }
    const targetSum = target.modules.reduce(function(a,m){ return a + m.targetPct; }, 0);
    if (Math.abs(targetSum - 1) > 0.01) {
      errors.push("target.json 模块权重和 = " + (targetSum*100).toFixed(1) + "%（应为 100%）");
    }
    // ponytail: 不动产已剥离到顶层 realEstate，四象限只统计金融资产。capital_preserve 的金融子项
    // subTargetPct 之和不再等于含房产的大类 targetPct（房产那部分被移走了），属预期，放行该大类校验。
    cur.modules.forEach(function (m) {
      if (m.key === "_orphan") return;
      const hasRealEstate = m.subs.some(function(s){ return s.venue === "不动产"; });
      // 该大类已剥离不动产（target 配了 realEstate 且此 module 内已无不动产 sub）：
      // 金融子项和 ≠ 含房产大类目标属预期，跳过严格校验，仅留宽松提示。
      if (!hasRealEstate && (target.realEstate || []).length > 0) return;
      const subSum = m.subs.reduce(function(a,s){ return a + (s.subTargetPct||0); }, 0);
      if (Math.abs(subSum - m.targetPct) > 0.005) {
        errors.push(m.name + " 子项权重和 " + (subSum*100).toFixed(1) + "% ≠ 大类目标 " + (m.targetPct*100).toFixed(1) + "%");
      }
    });
    return errors;
  }

  // ========== 暴露 API ==========
  return {
    PRIVACY_LS_KEY: PRIVACY_LS_KEY,
    fmt: fmt, fmtK: fmtK, pct: pct,
    isPrivacyMode: isPrivacyMode, setPrivacyMode: setPrivacyMode, maskedValue: maskedValue,
    escapeHTML: escapeHTML, escapeAttr: escapeAttr,
    getThemeName: getThemeName, getEchartsTheme: getEchartsTheme,
    getMilestoneStats: getMilestoneStats,
    parseDate: parseDate, isActive: isActive, activeMonthsInYear: activeMonthsInYear,
    makeToRMB: makeToRMB,
    inflate: inflate, deflate: deflate,
    enrichSnapshot: enrichSnapshot,
    weightedExpectedReturn: weightedExpectedReturn,
    healthCheck: healthCheck,
    reconcile: reconcile,
    runAssertions: runAssertions,
    getDataPath: getDataPath,
    fetchJson: fetchJson,

    // 图表注册表 — tab 切换时自动 resize 避免宽度塌陷
    _charts: [],
    registerChart: function(chart) { this._charts.push(chart); },
    resizeAllCharts: function() {
      this._charts = this._charts.filter(function(c) {
        if (c && !c.isDisposed()) { c.resize(); return true; }
        return false;
      });
    },
    resolveCashValueForYear: resolveCashValueForYear,
    injectInsuranceCashValue: injectInsuranceCashValue,
  };
})();
