// =============================================================
// 数据编辑器前端逻辑（方案 B）
// 依赖 scripts/edit_server.py 提供的 /__edit__/{list,load,save} API。
// 结构化表单：recurring / target / history 三份 JSON，校验后写回 data/。
// =============================================================
(function () {
  "use strict";

  const API = "/__edit__";
  const root = document.getElementById("editor-root");
  const vMsg = document.getElementById("validate-msg");
  const saveBtn = document.getElementById("save-btn");
  const saveNote = document.getElementById("save-note");
  const toastEl = document.getElementById("toast");

  // 状态：当前文件名 + 原始数据 + 工作副本（被表单双向绑定修改）
  let currentFile = null;
  let original = null;   // 加载时的深拷贝，用于脏检测
  let working = null;    // 表单正在编辑的对象
  let targetNames = {};  // history 编辑时：target.json 的 key→name 映射，用于 holdings 行旁注

  const ENUMS = {
    ccy: ["RMB", "USD", "HKD"],
    freq: ["monthly", "annual", "quarterly", "weekly", "once"],
    kindIn: ["salary", "rental_income", "interest", "dividend", "other"],
    kindEx: ["insurance", "mortgage", "rent", "transport", "utility", "education", "other"],
    phase: ["active", "planned", "blocked", "hold", "closed", "exit"],
    liaType: ["hard", "soft"],
    liaAccrual: ["none", "monthly_inflow"],
  };

  // ---------- 工具 ----------
  function toast(msg, kind) {
    toastEl.textContent = msg;
    toastEl.className = "toast show " + (kind || "");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toastEl.className = "toast"; }, 2600);
  }
  function el(tag, attrs, kids) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === "class") e.className = attrs[k];
      else if (k === "style") e.setAttribute("style", attrs[k]);
      else if (k.startsWith("on") && typeof attrs[k] === "function") e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    if (kids) (Array.isArray(kids) ? kids : [kids]).forEach(k => {
      if (k == null) return;
      e.appendChild(typeof k === "string" ? document.createTextNode(k) : k);
    });
    return e;
  }
  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }
  function setVal(obj, path, val) {
    const ks = path.slice();
    let cur = obj;
    while (ks.length > 1) { cur = cur[ks.shift()]; }
    cur[ks[0]] = val;
  }
  function rowGet(obj, path) {
    let cur = obj;
    for (const k of path) cur = cur == null ? undefined : cur[k];
    return cur;
  }
  function numOr(v, d) {
    if (v === "" || v == null) return d;
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  }
  function fmtPct(x) { return (Math.round(x * 10000) / 100) + "%"; }
  function esc(s) { return String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

  // ---------- API ----------
  async function apiLoad(file) {
    const r = await fetch(`${API}/load?file=${encodeURIComponent(file)}`, { cache: "no-store" });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || ("HTTP " + r.status));
    return j.data;
  }
  // 收集 target.json 所有 sub/realEstate/souvenirs 的 key→name，用于 history holdings 行旁注。
  // 失败返回空映射，不阻塞 history 编辑。
  async function loadTargetNames() {
    try {
      const t = await apiLoad("target.json");
      const m = {};
      (t.modules || []).forEach(mod => (mod.subs || []).forEach(s => { if (s.key) m[s.key] = s.name || s.key; }));
      (t.realEstate || []).forEach(re => { if (re && re.key) m[re.key] = re.name || re.key; });
      (t.souvenirs || []).forEach(sv => { if (sv && sv.key) m[sv.key] = sv.name || sv.key; });
      return m;
    } catch (e) { return {}; }
  }
  async function apiSave(file, data, note) {
    const r = await fetch(`${API}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file, data, note }),
    });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || ("HTTP " + r.status));
    return j;
  }

  // ---------- 文件切换 ----------
  document.getElementById("file-tabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".file-tab");
    if (!btn) return;
    selectFile(btn.dataset.file);
  });
  document.getElementById("reload-btn").addEventListener("click", () => {
    if (currentFile) selectFile(currentFile);
  });
  saveBtn.addEventListener("click", onSave);

  async function selectFile(file) {
    currentFile = file;
    document.querySelectorAll(".file-tab").forEach(b => b.classList.toggle("active", b.dataset.file === file));
    root.innerHTML = '<div class="loading">加载 data/' + file + ' …</div>';
    saveBtn.disabled = true;
    setMsg("加载中…", "");
    try {
      original = await apiLoad(file);
      working = deepClone(original);
      if (file === "history.json") {
        targetNames = await loadTargetNames();
        selSnap = -1;  // 进入时重置，让首次渲染自动选中最近一条
      }
      render();
      validate();
    } catch (err) {
      root.innerHTML = '<div class="card"><div class="msg err">加载失败：' + esc(err.message) + '</div><div class="note-line">确认已用 <code>python3 scripts/edit_server.py</code> 启动服务，且 data/' + file + ' 存在。</div></div>';
      setMsg("加载失败", "err");
    }
  }

  // ---------- 渲染分发 ----------
  function render() {
    root.innerHTML = "";
    if (currentFile === "recurring.json") renderRecurring();
    else if (currentFile === "liabilities.json") renderLiabilities();
    else if (currentFile === "target.json") renderTarget();
    else if (currentFile === "history.json") renderHistory();
    else root.appendChild(el("div", { class: "card" }, "未知文件"));
  }

  // =============== liabilities.json ===============
  // 负债条目：type(hard 扣净资产 / soft 不扣)、本金、利率、月/年利息、可选 monthly_inflow 动态累积。
  function renderLiabilities() {
    root.appendChild(card("负债清单 · liabilities", "硬性(hard)扣减净资产；软性(soft)不扣。monthly_inflow 类型按 startDate×monthlyInflow 动态累积本金，看板会覆盖 principal。", () => liaTable()));
  }
  function liaTable() {
    const arr = working.liabilities || [];
    return el("table", { class: "rows" }, [
      el("thead", {}, el("tr", {}, [
        th("名称"), th("性质"), th("币种"), th("本金"), th("年化利率"), th("月利息"), th("年利息"), th("扣净资产"), th("累积方式"), th("起"), th("止"), th("备注"), th("")
      ])),
      el("tbody", {}, arr.map((row, i) => liaRow(i))),
      el("tfoot", {}, el("tr", {}, [
        el("td", { colspan: "13" }, addBtn("＋ 新增负债", () => {
          working.liabilities.push({ name: "", type: "hard", ccy: "RMB", principal: 0, interestRate: 0, monthlyInterest: 0, annualInterest: 0, deductFromNet: true, accrual: "none", startDate: null, endDate: null, note: "" });
          render(); validate();
        })),
      ])),
    ]);
  }
  function liaRow(i) {
    const path = (f) => ["liabilities", i, f];
    const row = working.liabilities[i];
    const isInflow = row.accrual === "monthly_inflow";
    // type 切换时同步 deductFromNet 默认值（hard=true / soft=false），除非用户已显式设过
    const onType = (v) => {
      setVal(working, path("type"), v);
      setVal(working, path("deductFromNet"), v === "hard");
      render(); validate();
    };
    return el("tr", {}, [
      td(inp("text", row.name || "", v => setVal(working, path("name"), v))),
      td(sel(ENUMS.liaType, row.type || "hard", onType)),
      td(sel(ENUMS.ccy, row.ccy || "RMB", v => setVal(working, path("ccy"), v))),
      td({ class: "num" }, inp("number", row.principal ?? 0, v => setVal(working, path("principal"), numOr(v, 0)))),
      td({ class: "num" }, inp("number", row.interestRate ?? 0, v => setVal(working, path("interestRate"), numOr(v, 0)))),
      td({ class: "num" }, inp("number", row.monthlyInterest ?? 0, v => setVal(working, path("monthlyInterest"), numOr(v, 0)))),
      td({ class: "num" }, inp("number", row.annualInterest ?? 0, v => setVal(working, path("annualInterest"), numOr(v, 0)))),
      td(liaDeductToggle(i)),
      td(sel(ENUMS.liaAccrual, row.accrual || "none", v => { setVal(working, path("accrual"), v === "none" ? null : v); render(); validate(); })),
      td(dateIn(row.startDate || "", v => setVal(working, path("startDate"), v || null))),
      td(dateIn(row.endDate || "", v => setVal(working, path("endDate"), v || null))),
      td(inp("text", row.note || "", v => setVal(working, path("note"), v))),
      td(delBtn(() => { working.liabilities.splice(i, 1); render(); validate(); })),
      ...isInflow ? [el("td", { colspan: "13", style: "padding:0 8px 8px" }, liaInflowExtra(i))] : [],
    ]);
  }
  function liaDeductToggle(i) {
    const row = working.liabilities[i];
    const cb = el("input", { type: "checkbox" });
    cb.checked = row.deductFromNet !== false;
    cb.addEventListener("change", () => { setVal(working, ["liabilities", i, "deductFromNet"], cb.checked); validate(); });
    return cb;
  }
  function liaInflowExtra(i) {
    const path = (f) => ["liabilities", i, f];
    const row = working.liabilities[i];
    const start = row.startDate ? new Date(String(row.startDate).replace(/-(\d+)$/, "-$1-01")) : null;
    let months = 0;
    if (start) months = Math.max(0, Math.floor((Date.now() - start) / (1000 * 60 * 60 * 24 * 30.44)));
    const accrued = months * (row.monthlyInflow || 0);
    return el("div", { class: "mod-block", style: "margin-top:4px" }, [
      el("div", { class: "mod-head" }, [
        el("span", { class: "nm" }, "月存累积 · " + (row.name || "(name)")),
        el("span", { class: "pill warn" }, "monthly_inflow"),
        el("span", { class: "hint", style: "margin-left:8px;color:var(--text-3);font-weight:400" }, start ? `已累积约 ${months} 月 ≈ ${accrued}（看板会覆盖 principal）` : "需填 startDate"),
      ]),
      el("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:8px" }, [
        field("monthlyInflow", () => inp("number", row.monthlyInflow ?? 0, v => { setVal(working, path("monthlyInflow"), numOr(v, 0)); validate(); })),
        field("startDate（年-月，如 2021-06）", () => inp("text", row.startDate || "", v => { setVal(working, path("startDate"), v || null); validate(); })),
      ]),
    ]);
  }

  // =============== recurring.json ===============
  function renderRecurring() {
    root.appendChild(card("循环收入 · incomes", "每月/每年的固定进账（工资/房租/利息）", () => incomeTable("incomes")));
    root.appendChild(card("循环支出 · expenses", "保险/房贷/租金/交通等；insurance kind 会展开保单字段", () => expenseTable()));
  }

  function incomeTable(prop) {
    const arr = working[prop];
    return el("table", { class: "rows" }, [
      el("thead", {}, el("tr", {}, [
        th("key"), th("名称"), th("币种"), th("金额"), th("频次"), th("kind"), th("起"), th("止"), th("备注"), th("")
      ])),
      el("tbody", {}, arr.map((row, i) => incomeRow(prop, i))),
      el("tfoot", {}, el("tr", {}, [
        el("td", { colspan: "10" }, addBtn("＋ 新增收入", () => {
          working[prop].push({ key: "new_in_" + Date.now(), name: "", ccy: "RMB", amount: 0, frequency: "monthly", kind: "salary", startDate: null, endDate: null, note: "" });
          render(); validate();
        })),
      ])),
    ]);
  }
  function incomeRow(prop, i) {
    const path = (f) => [prop, i, f];
    return el("tr", {}, [
      td(inp("text", rowGet(working, path("key")), v => setVal(working, path("key"), v))),
      td(inp("text", rowGet(working, path("name")), v => setVal(working, path("name"), v))),
      td(sel(ENUMS.ccy, rowGet(working, path("ccy")), v => setVal(working, path("ccy"), v))),
      td({ class: "num" }, inp("number", rowGet(working, path("amount")), v => setVal(working, path("amount"), numOr(v, 0)))),
      td(sel(ENUMS.freq, rowGet(working, path("frequency")), v => setVal(working, path("frequency"), v))),
      td(sel(ENUMS.kindIn, rowGet(working, path("kind")), v => setVal(working, path("kind"), v))),
      td(dateIn(rowGet(working, path("startDate")), v => setVal(working, path("startDate"), v || null))),
      td(dateIn(rowGet(working, path("endDate")), v => setVal(working, path("endDate"), v || null))),
      td(inp("text", rowGet(working, path("note")) || "", v => setVal(working, path("note"), v))),
      td(delBtn(() => { working[prop].splice(i, 1); render(); validate(); })),
    ]);
  }

  function expenseTable() {
    const arr = working.expenses;
    return el("div", {}, [
      el("table", { class: "rows" }, [
        el("thead", {}, el("tr", {}, [
          th("key"), th("名称"), th("币种"), th("金额"), th("频次"), th("kind"), th("起"), th("止"), th("备注"), th("")
        ])),
        el("tbody", {}, arr.map((row, i) => expenseRow(i))),
        el("tfoot", {}, el("tr", {}, [
          el("td", { colspan: "10" }, addBtn("＋ 新增支出", () => {
            working.expenses.push({ key: "new_exp_" + Date.now(), name: "", ccy: "RMB", amount: 0, frequency: "monthly", kind: "other", startDate: null, endDate: null, note: "" });
            render(); validate();
          })),
        ])),
      ]),
      // insurance 展开区
      ...arr.map((row, i) => row.kind === "insurance" ? insuranceExtra(i) : null).filter(Boolean),
    ]);
  }
  function expenseRow(i) {
    const path = (f) => ["expenses", i, f];
    return el("tr", {}, [
      td(inp("text", rowGet(working, path("key")), v => setVal(working, path("key"), v))),
      td(inp("text", rowGet(working, path("name")), v => setVal(working, path("name"), v))),
      td(sel(ENUMS.ccy, rowGet(working, path("ccy")), v => setVal(working, path("ccy"), v))),
      td({ class: "num" }, inp("number", rowGet(working, path("amount")), v => setVal(working, path("amount"), numOr(v, 0)))),
      td(sel(ENUMS.freq, rowGet(working, path("frequency")), v => setVal(working, path("frequency"), v))),
      td(sel(ENUMS.kindEx, rowGet(working, path("kind")), v => { setVal(working, path("kind"), v); render(); validate(); })),
      td(dateIn(rowGet(working, path("startDate")), v => setVal(working, path("startDate"), v || null))),
      td(dateIn(rowGet(working, path("endDate")), v => setVal(working, path("endDate"), v || null))),
      td(inp("text", rowGet(working, path("note")) || "", v => setVal(working, path("note"), v))),
      td(delBtn(() => { working.expenses.splice(i, 1); render(); validate(); })),
    ]);
  }
  function insuranceExtra(i) {
    const path = (f) => ["expenses", i, f];
    const row = working.expenses[i];
    const cv = row.cashValueSchedule || {};
    const cvText = Object.keys(cv).sort().map(y => `${y}: ${cv[y]}`).join("\n");
    const grid = el("div", { style: "display:grid;grid-template-columns:repeat(5,1fr);gap:8px" }, [
      field("policyHolder", () => inp("text", rowGet(working, path("policyHolder")) || "", v => setVal(working, path("policyHolder"), v))),
      field("insuredBy", () => inp("text", rowGet(working, path("insuredBy")) || "", v => setVal(working, path("insuredBy"), v))),
      field("policyNo", () => inp("text", rowGet(working, path("policyNo")) || "", v => setVal(working, path("policyNo"), v))),
      field("beneficiary", () => inp("text", rowGet(working, path("beneficiary")) || "", v => setVal(working, path("beneficiary"), v))),
      field("coverage", () => inp("number", rowGet(working, path("coverage")) ?? "", v => setVal(working, path("coverage"), v === "" ? null : numOr(v, null)))),
    ]);
    // ponytail: cashValueSchedule 用文本框，每行 YYYY:金额；容错跳过坏行
    const taWrap = field("cashValueSchedule（每行 YYYY:金额，金额用保单 ccy）", () => {
      const ta = el("textarea", { rows: "4" });
      ta.value = cvText;
      ta.addEventListener("input", () => parseCv(ta.value, path("cashValueSchedule")));
      return ta;
    });
    return el("div", { class: "mod-block", style: "margin-top:6px" }, [
      el("div", { class: "mod-head" }, [
        el("span", { class: "nm" }, "保单字段 · " + (rowGet(working, path("key")) || "(key)")),
        el("span", { class: "hint", style: "margin-left:8px;color:var(--text-3);font-weight:400;text-transform:none;letter-spacing:0" }, (rowGet(working, path("note")) || "").slice(0, 60)),
        el("span", { class: "pill warn" }, "insurance"),
      ]),
      grid,
      taWrap,
    ]);
  }
  function parseCv(text, path) {
    const obj = {};
    String(text).split("\n").forEach(line => {
      const m = line.match(/^\s*(\d{4})\s*[:：]\s*(-?[\d.]+)\s*$/);
      if (m) obj[m[1]] = Number(m[2]);
    });
    setVal(working, path, Object.keys(obj).length ? obj : null);
  }

  // =============== target.json ===============
  function renderTarget() {
    root.appendChild(card("战略元信息", "version/updated/redLines/inflation", () => targetMeta()));
    const mods = working.modules || [];
    mods.forEach((m, mi) => root.appendChild(modBlock(mi)));
    root.appendChild(addBtn("＋ 新增大类 module", () => {
      working.modules.push({ key: "new_mod_" + Date.now(), name: "", roman: "", targetPct: 0, thresholdPct: 0.03, purpose: "", rationale: "", subs: [] });
      render(); validate();
    }));
    root.appendChild(card("权重和校验", "modules.targetPct 之和应 = 100%；各 module 内 subs.subTargetPct 之和应 = module.targetPct", () => weightSummary()));
  }
  function targetMeta() {
    const rd = (k) => (working.redLines && working.redLines[k]) ?? "";
    const wr = (k, v) => { if (working.redLines) working.redLines[k] = v; };
    return el("div", { style: "display:grid;grid-template-columns:repeat(3,1fr);gap:10px" }, [
      field("version", () => inp("text", working.version || "", v => working.version = v)),
      field("updated (YYYY-MM-DD)", () => dateIn(working.updated || "", v => working.updated = v || "")),
      field("inflation.annual", () => inp("number", (working.inflation && working.inflation.annual) ?? "", v => { if (working.inflation) working.inflation.annual = numOr(v, 0); })),
      field("redLines.singleStockMaxPct", () => inp("number", rd("singleStockMaxPct"), v => wr("singleStockMaxPct", numOr(v, 0)))),
      field("redLines.rmbMaxPct", () => inp("number", rd("rmbMaxPct"), v => wr("rmbMaxPct", numOr(v, 0)))),
      field("redLines.rmbTargetPct", () => inp("number", rd("rmbTargetPct"), v => wr("rmbTargetPct", numOr(v, 0)))),
    ]);
  }
  function modBlock(mi) {
    const m = working.modules[mi];
    const mp = (f) => ["modules", mi, f];
    return el("div", { class: "card" }, [
      el("h2", {}, [
        el("span", {}, "大类 · " + (m.name || m.key)),
        el("span", { class: "pill ok" }, "目标 " + fmtPct(m.targetPct || 0)),
        el("span", { class: "hint" }, "roman=" + (m.roman || "")),
        delBtn(() => { working.modules.splice(mi, 1); render(); validate(); }),
      ]),
      el("div", { style: "display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:10px" }, [
        field("key", () => inp("text", m.key, v => setVal(working, mp("key"), v))),
        field("名称", () => inp("text", m.name || "", v => setVal(working, mp("name"), v))),
        field("roman", () => inp("text", m.roman || "", v => setVal(working, mp("roman"), v))),
        field("目标占比", () => inp("number", m.targetPct ?? 0, v => { setVal(working, mp("targetPct"), numOr(v, 0)); validate(); })),
        field("阈值 ±", () => inp("number", m.thresholdPct ?? 0, v => setVal(working, mp("thresholdPct"), numOr(v, 0)))),
        field("purpose", () => inp("text", m.purpose || "", v => setVal(working, mp("purpose"), v))),
      ]),
      el("div", { class: "indent" }, [
        el("table", { class: "rows" }, [
          el("thead", {}, el("tr", {}, [th("key"), th("名称"), th("币种"), th("venue"), th("目标占比"), th("阈值"), th("phase"), th("备注"), th("")])),
          el("tbody", {}, (m.subs || []).map((s, si) => subRow(mi, si))),
        ]),
        addBtn("＋ 新增子项 sub", () => {
          m.subs.push({ key: "new_sub_" + Date.now(), name: "", ccy: "RMB", venue: "", subTargetPct: 0, subThresholdPct: 0, phase: "active", note: "" });
          render(); validate();
        }),
      ]),
    ]);
  }
  function subRow(mi, si) {
    const sp = (f) => ["modules", mi, "subs", si, f];
    const s = working.modules[mi].subs[si];
    return el("tr", {}, [
      td(inp("text", s.key, v => setVal(working, sp("key"), v))),
      td(inp("text", s.name || "", v => setVal(working, sp("name"), v))),
      td(sel(ENUMS.ccy, s.ccy, v => setVal(working, sp("ccy"), v))),
      td(inp("text", s.venue || "", v => setVal(working, sp("venue"), v))),
      td({ class: "num" }, inp("number", s.subTargetPct ?? 0, v => { setVal(working, sp("subTargetPct"), numOr(v, 0)); validate(); })),
      td({ class: "num" }, inp("number", s.subThresholdPct ?? 0, v => setVal(working, sp("subThresholdPct"), numOr(v, 0)))),
      td(sel(ENUMS.phase, s.phase, v => setVal(working, sp("phase"), v))),
      td(inp("text", s.note || "", v => setVal(working, sp("note"), v))),
      td(delBtn(() => { working.modules[mi].subs.splice(si, 1); render(); validate(); })),
    ]);
  }
  function weightSummary() {
    const mods = working.modules || [];
    const totalMod = mods.reduce((a, m) => a + (m.targetPct || 0), 0);
    const rows = [el("div", { class: "kv" }, [el("span", {}, "modules.targetPct 之和"), el("b", { class: Math.abs(totalMod - 1) < 0.0001 ? "ok" : "warn" }, fmtPct(totalMod) + (Math.abs(totalMod - 1) < 0.0001 ? " ✓" : " ✗ 应=100%"))])];
    mods.forEach(m => {
      const subSum = (m.subs || []).reduce((a, s) => a + (s.subTargetPct || 0), 0);
      rows.push(el("div", { class: "kv" }, [
        el("span", {}, "  └ " + (m.name || m.key) + " subs 之和"),
        el("b", { class: Math.abs(subSum - (m.targetPct || 0)) < 0.005 ? "ok" : "warn" }, fmtPct(subSum) + " / 目标 " + fmtPct(m.targetPct || 0)),
      ]));
    });
    return el("div", {}, rows);
  }

  // =============== history.json ===============
  // snapshot 字段多且嵌套（rates/prices/holdings/cashFlow），结构化表格 + 折叠原始 JSON 兜底。
  // 每次报数结构相似，用下拉框选一条来改，避免全部罗列。
  // 新增 snapshot 推荐用 scripts/new_snapshot.py；此处负责微调/删除/重排/手填。
  let selSnap = -1;  // 当前选中的 snapshot 索引；-1 表示尚未初始化，渲染时指向最近一条
  function renderHistory() {
    const snaps = working.snapshots || [];
    // 默认选中最近一条（按 date 降序排在最前者）
    if (selSnap < 0 || selSnap >= snaps.length) {
      if (!snaps.length) selSnap = 0;
      else selSnap = snaps.reduce((mx, s, i, arr) => String(s.date || "") >= String(arr[mx].date || "") ? i : mx, 0);
    }
    root.appendChild(card("说明", "history.json 是 append-only 快照数组。新增 snapshot 推荐用 python3 scripts/new_snapshot.py 生成后粘贴到选中那条的『原始 JSON』区；此处表格可微调数值/删除/重排。holdings 两种形态：现金类{raw}、证券类{shares,cost}（当前价取自 prices[key]）。", () => el("div", {})));
    // 下拉选择某次报数（按时间倒序展示，最近一条在最上；value 仍为真实数组索引，不改变 append-only 顺序）
    root.appendChild(el("div", { class: "card" }, [
      el("h2", {}, [el("span", {}, "选择报数"), el("span", { class: "hint" }, snaps.length + " 条快照")]),
      el("div", { style: "display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap" }, [
        field("snapshot", () => {
          const order = snaps.map((_, i) => i).sort((a, b) => String(snaps[b].date || "").localeCompare(String(snaps[a].date || "")));
          const e = el("select", {}, order.map(i => el("option", { value: String(i) }, "#" + (i + 1) + " · " + (snaps[i].date || "?") + (snaps[i].comment ? "  " + String(snaps[i].comment).slice(0, 30) : ""))));
          e.value = String(selSnap);
          e.addEventListener("change", () => { selSnap = Number(e.value); render(); validate(); });
          return e;
        }),
        el("button", { class: "btn ghost", type: "button", title: "上一条", onclick: () => { if (selSnap > 0) { selSnap--; render(); validate(); } } }, "← 上一条"),
        el("button", { class: "btn ghost", type: "button", title: "下一条", onclick: () => { if (selSnap < snaps.length - 1) { selSnap++; render(); validate(); } } }, "下一条 →"),
        addBtn("＋ 新增空 snapshot（手动填）", () => {
          working.snapshots.push({ date: new Date().toISOString().slice(0, 10), rates: { USD: 7.2, HKD: 0.92 }, ratesSource: "", comment: "", cashFlow: null, prices: {}, holdings: {} });
          selSnap = working.snapshots.length - 1;
          render(); validate();
        }),
      ]),
    ]));
    if (snaps.length) root.appendChild(snapBlock(selSnap));
  }
  function snapBlock(i) {
    const s = working.snapshots[i];
    const sp = (f) => ["snapshots", i, f];
    return el("div", { class: "card" }, [
      el("h2", {}, [
        el("span", {}, "快照 #" + (i + 1) + " · " + (s.date || "?")),
        el("span", { class: "hint" }, (s.comment || "").slice(0, 40)),
        el("span", { class: "pill ok" }, i + 1 + " / " + working.snapshots.length),
        el("button", { class: "btn ghost", type: "button", title: "上移", onclick: () => {
          if (i > 0) { const a = working.snapshots[i - 1]; working.snapshots[i - 1] = working.snapshots[i]; working.snapshots[i] = a; selSnap = i - 1; render(); validate(); }
        } }, "↑"),
        delBtn(() => { working.snapshots.splice(i, 1); render(); validate(); }),
      ]),
      // 元信息行
      el("div", { style: "display:grid;grid-template-columns:1fr 1fr 1fr 1.4fr;gap:8px;margin-bottom:10px" }, [
        field("date", () => dateIn(s.date || "", v => { setVal(working, sp("date"), v || ""); validate(); })),
        field("rates.USD→RMB", () => inp("number", (s.rates && s.rates.USD) ?? "", v => { setVal(working, sp("rates.USD"), numOr(v, 0)); validate(); })),
        field("rates.HKD→RMB", () => inp("number", (s.rates && s.rates.HKD) ?? "", v => { setVal(working, sp("rates.HKD"), numOr(v, 0)); validate(); })),
        field("ratesSource", () => inp("text", s.ratesSource || "", v => setVal(working, sp("ratesSource"), v))),
      ]),
      field("comment", () => inp("text", s.comment || "", v => setVal(working, sp("comment"), v))),
      cashFlowBlock(i),
      // prices 表
      el("div", { class: "mod-block", style: "margin-top:10px" }, [
        el("div", { class: "mod-head" }, [el("span", { class: "nm" }, "prices · 当前报价"), el("span", { class: "pill ok" }, Object.keys(s.prices || {}).length + " 项")]),
        priceTable(i),
      ]),
      // holdings 表
      el("div", { class: "mod-block", style: "margin-top:10px" }, [
        el("div", { class: "mod-head" }, [el("span", { class: "nm" }, "holdings · 持仓"), el("span", { class: "pill ok" }, Object.keys(s.holdings || {}).length + " 项")]),
        holdingTable(i),
      ]),
      // 折叠原始 JSON 兜底
      el("details", { style: "margin-top:10px" }, [
        el("summary", { style: "cursor:pointer;color:var(--text-2);font-size:11px" }, "原始 JSON（兜底 · 失焦校验回写）"),
        (() => {
          const ta = el("textarea", { rows: "14" });
          ta.value = JSON.stringify(s, null, 2);
          ta.addEventListener("blur", () => {
            try {
              working.snapshots[i] = JSON.parse(ta.value);
              render(); validate();
            } catch (e) {
              ta.style.borderColor = "var(--danger)";
              setMsg("snapshot #" + (i + 1) + " JSON 解析失败：" + e.message, "err");
            }
          });
          return ta;
        })(),
      ]),
    ]);
  }
  function cashFlowBlock(i) {
    const s = working.snapshots[i];
    const sp = (f) => ["snapshots", i, f];
    const cf = s.cashFlow;
    const has = cf != null;
    const cb = el("input", { type: "checkbox" });
    cb.checked = has;
    cb.addEventListener("change", () => {
      if (cb.checked) setVal(working, sp("cashFlow"), { deposits: (cf && cf.deposits) || 0, withdrawals: (cf && cf.withdrawals) || 0, note: (cf && cf.note) || "" });
      else setVal(working, sp("cashFlow"), null);
      render(); validate();
    });
    if (!has) return el("div", { style: "margin-top:6px" }, [el("label", { style: "display:flex;align-items:center;gap:6px;cursor:pointer" }, [cb, " 本期有注资/抽资（cashFlow）"])]);
    return el("div", { class: "mod-block", style: "margin-top:6px" }, [
      el("div", { class: "mod-head" }, [el("label", { style: "display:flex;align-items:center;gap:6px;cursor:pointer;margin:0;font-weight:600" }, [cb, " cashFlow · 净注入/抽资"])]),
      el("div", { style: "display:grid;grid-template-columns:1fr 1fr 2fr;gap:8px" }, [
        field("deposits", () => inp("number", cf.deposits ?? 0, v => { setVal(working, sp("cashFlow.deposits"), numOr(v, 0)); validate(); })),
        field("withdrawals", () => inp("number", cf.withdrawals ?? 0, v => { setVal(working, sp("cashFlow.withdrawals"), numOr(v, 0)); validate(); })),
        field("note", () => inp("text", cf.note || "", v => setVal(working, sp("cashFlow.note"), v))),
      ]),
    ]);
  }
  function priceTable(i) {
    const s = working.snapshots[i];
    const prices = s.prices || {};
    const keys = Object.keys(prices);
    return el("table", { class: "rows" }, [
      el("thead", {}, el("tr", {}, [th("key"), th("名称"), th("币种"), th("price"), th("")])),
      el("tbody", {}, keys.map(k => priceRow(i, k))),
      el("tfoot", {}, el("tr", {}, [
        el("td", { colspan: "5" }, addBtn("＋ 新增 price", () => {
          let n = 1; while (prices["new_price_" + n]) n++;
          setVal(working, ["snapshots", i, "prices", "new_price_" + n], { ccy: "RMB", price: 0 });
          render(); validate();
        })),
      ])),
    ]);
  }
  function priceRow(i, k) {
    const s = working.snapshots[i];
    const p = s.prices[k];
    const base = ["snapshots", i, "prices", k];
    const nm = targetNames[k];
    return el("tr", {}, [
      td(keyInp(i, k, "price")),
      td({ class: "num", style: "color:var(--text-1);font-size:12px" }, nm ? esc(nm) : (k in targetNames ? "" : "—")),
      td(sel(ENUMS.ccy, p.ccy || "RMB", v => { setVal(working, [...base, "ccy"], v); validate(); })),
      td({ class: "num" }, inp("number", p.price ?? 0, v => { setVal(working, [...base, "price"], numOr(v, 0)); validate(); })),
      td(delBtn(() => { delete working.snapshots[i].prices[k]; render(); validate(); })),
    ]);
  }
  function renamePriceKey(i, oldK, newK) {
    if (newK === oldK) return;
    const prices = working.snapshots[i].prices;
    if (prices[newK] != null) { setMsg("prices 已有 key: " + newK, "err"); return false; }
    prices[newK] = prices[oldK]; delete prices[oldK];
    return true;
  }
  // key 输入框：input 时只暂存到 dataset，不立即 rename/re-render（避免每键触发 render 导致失焦）；change（失焦）时统一 rename。
  function keyInp(i, k, kind) {
    const e = el("input", { type: "text" });
    e.value = k;
    e.addEventListener("input", () => { e.dataset.dirty = "1"; validate(); });
    e.addEventListener("change", () => {
      if (e.dataset.dirty !== "1") return;
      const newK = e.value.trim() || k;
      const ok = kind === "price" ? renamePriceKey(i, k, newK) : renameHoldingKey(i, k, newK);
      e.dataset.dirty = "";
      if (ok) { render(); }
      else { e.value = k; }
      validate();
    });
    return e;
  }
  function holdingTable(i) {
    const s = working.snapshots[i];
    const holdings = s.holdings || {};
    const keys = Object.keys(holdings);
    return el("table", { class: "rows" }, [
      el("thead", {}, el("tr", {}, [th("key"), th("名称"), th("类型"), th("归属"), th("流动性"), th("金额/份额"), th("成本价"), th("市值"), th("")])),
      el("tbody", {}, keys.map(k => holdingRow(i, k))),
      el("tfoot", {}, el("tr", {}, [
        el("td", { colspan: "9" }, addBtn("＋ 新增 holding（现金类）", () => {
          let n = 1; while (holdings["new_holding_" + n]) n++;
          setVal(working, ["snapshots", i, "holdings", "new_holding_" + n], { raw: 0 });
          render(); validate();
        })),
      ])),
    ]);
  }
  function holdingRow(i, k) {
    const s = working.snapshots[i];
    const h = s.holdings[k];
    const base = ["snapshots", i, "holdings", k];
    const isShares = h.shares != null;
    const nm = targetNames[k];
    const px = (s.prices && s.prices[k] && s.prices[k].price) || null;
    const mv = isShares && px != null ? h.shares * px : null;
    return el("tr", {}, [
      td(keyInp(i, k, "holding")),
      td({ class: "num", style: "color:var(--text-1);font-size:12px" }, [
        nm ? esc(nm) : "—",
        (k in targetNames) ? null : el("span", { class: "pill warn", style: "margin-left:4px" }, "游离"),
      ]),
      td(sel(["现金类", "证券类"], isShares ? "证券类" : "现金类", v => {
        if (v === "现金类") setVal(working, base, { raw: h.raw ?? 0, belongTo: h.belongTo, liquidity: h.liquidity });
        else setVal(working, base, { shares: h.shares ?? 0, cost: h.cost ?? 0, belongTo: h.belongTo, liquidity: h.liquidity });
        render(); validate();
      })),
      td(sel(["family", "wife_parents", "luffy_parents"], h.belongTo || "family", v => { setVal(working, [...base, "belongTo"], v); validate(); })),
      td(sel(["高", "中", "低"], h.liquidity || "中", v => { setVal(working, [...base, "liquidity"], v); validate(); })),
      td({ class: "num" }, inp("number", isShares ? (h.shares ?? 0) : (h.raw ?? 0), v => {
        if (isShares) setVal(working, [...base, "shares"], numOr(v, 0));
        else setVal(working, [...base, "raw"], numOr(v, 0));
        validate();
      })),
      td({ class: "num" }, isShares ? inp("number", h.cost ?? 0, v => { setVal(working, [...base, "cost"], numOr(v, 0)); validate(); }) : el("span", { style: "color:var(--text-3)" }, "—")),
      td({ class: "num" }, mv != null ? el("span", { class: "num" }, Math.round(mv).toLocaleString("en-US")) : el("span", { style: "color:var(--warn)" }, px == null ? "无报价" : "—")),
      td(delBtn(() => { delete working.snapshots[i].holdings[k]; render(); validate(); })),
    ]);
  }
  function renameHoldingKey(i, oldK, newK) {
    if (newK === oldK) return false;
    const holdings = working.snapshots[i].holdings;
    if (holdings[newK] != null) { setMsg("holdings 已有 key: " + newK, "err"); return false; }
    holdings[newK] = holdings[oldK]; delete holdings[oldK];
    return true;
  }

  // ---------- 校验 ----------
  function validate() {
    try { JSON.stringify(working); }
    catch (e) { setMsg("数据无法序列化：" + e.message, "err"); saveBtn.disabled = true; return; }

    let problems = [];
    if (currentFile === "target.json") {
      const mods = working.modules || [];
      const totalMod = mods.reduce((a, m) => a + (m.targetPct || 0), 0);
      if (Math.abs(totalMod - 1) > 0.0001) problems.push("modules.targetPct 之和 = " + fmtPct(totalMod) + "（应 100%）");
      mods.forEach(m => {
        const subSum = (m.subs || []).reduce((a, s) => a + (s.subTargetPct || 0), 0);
        if (Math.abs(subSum - (m.targetPct || 0)) > 0.005) problems.push((m.name || m.key) + " subs 之和 " + fmtPct(subSum) + " ≠ 目标 " + fmtPct(m.targetPct || 0));
      });
      const keys = mods.flatMap(m => [m.key, ...(m.subs || []).map(s => s.key)]);
      const dup = keys.filter((k, idx) => k && keys.indexOf(k) !== idx);
      if (dup.length) problems.push("重复 key: " + [...new Set(dup)].join(", "));
    }
    if (currentFile === "recurring.json") {
      [working.incomes, working.expenses].forEach(arr => {
        const keys = (arr || []).map(x => x.key);
        const dup = keys.filter((k, idx) => k && keys.indexOf(k) !== idx);
        if (dup.length) problems.push("重复 key: " + [...new Set(dup)].join(", "));
        (arr || []).forEach(r => { if (!r.key) problems.push("存在空 key 的条目"); });
      });
      (working.expenses || []).forEach((e, i) => {
        if (e.kind === "insurance" && !e.endDate) problems.push("expenses[" + i + "] insurance 缺 endDate");
      });
    }
    if (currentFile === "liabilities.json") {
      (working.liabilities || []).forEach((l, i) => {
        if (!l.name) problems.push("liabilities[" + i + "] 缺 name");
        if (!l.ccy) problems.push("liabilities[" + i + "] 缺 ccy");
        if (l.accrual === "monthly_inflow") {
          if (!l.startDate) problems.push("liabilities[" + i + "] monthly_inflow 缺 startDate");
          if (!(l.monthlyInflow > 0)) problems.push("liabilities[" + i + "] monthly_inflow 缺 monthlyInflow");
        } else {
          if (!(l.principal >= 0)) problems.push("liabilities[" + i + "] principal 异常");
        }
      });
    }
    if (currentFile === "history.json") {
      const dates = (working.snapshots || []).map(s => s.date);
      const dup = dates.filter((d, idx) => d && dates.indexOf(d) !== idx);
      if (dup.length) problems.push("重复 snapshot date: " + [...new Set(dup)].join(", "));
      (working.snapshots || []).forEach((s, i) => {
        if (!s.date) problems.push("snapshot #" + (i + 1) + " 缺 date");
        if (!s.rates) problems.push("snapshot #" + (i + 1) + " 缺 rates");
        // holdings/prices key 空值/重复
        ["holdings", "prices"].forEach(prop => {
          const keys = Object.keys(s[prop] || {});
          const empties = keys.filter(k => !k || !k.trim());
          if (empties.length) problems.push("snapshot #" + (i + 1) + " " + prop + " 有空 key");
          const dupk = keys.filter((k, idx) => k && keys.indexOf(k) !== idx);
          if (dupk.length) problems.push("snapshot #" + (i + 1) + " " + prop + " 重复 key: " + [...new Set(dupk)].join(", "));
        });
        // 证券类 holding 缺报价
        const px = s.prices || {};
        Object.entries(s.holdings || {}).forEach(([k, h]) => {
          if (h.shares != null && (px[k] == null || px[k].price == null))
            problems.push("snapshot #" + (i + 1) + " " + k + " 证券类但 prices 缺报价");
        });
        // cashFlow 勾选但全 0（非阻断式 warn，这里仍只作 problem 提示）
        if (s.cashFlow && (s.cashFlow.deposits || 0) === 0 && (s.cashFlow.withdrawals || 0) === 0)
          problems.push("snapshot #" + (i + 1) + " cashFlow 已启用但 deposits/withdrawals 均为 0");
      });
    }
    const dirty = JSON.stringify(original) !== JSON.stringify(working);
    if (!dirty) { setMsg("无改动", ""); saveBtn.disabled = true; return; }
    saveBtn.disabled = false;
    if (problems.length) setMsg("有改动 · ⚠ " + problems.length + " 个校验问题：" + problems.slice(0, 2).join("；") + (problems.length > 2 ? "…" : ""), "warn");
    else setMsg("有改动 · 校验通过 ✓（" + currentFile + "）", "ok");
  }
  function setMsg(text, kind) { vMsg.textContent = text; vMsg.className = "msg " + (kind || ""); }

  // ---------- 保存 ----------
  async function onSave() {
    if (!currentFile || !working) return;
    saveBtn.disabled = true;
    saveBtn.textContent = "保存中…";
    try {
      let toSave = working;
      if (currentFile === "target.json") toSave = bumpTargetChangelog(working, saveNote.value);
      await apiSave(currentFile, toSave, saveNote.value || "editor edit");
      original = deepClone(working);
      toast("已保存 → data/" + currentFile + "（已自动备份）", "ok");
      saveNote.value = "";
      validate();
    } catch (err) {
      toast("保存失败：" + err.message, "err");
      validate();
    } finally {
      saveBtn.textContent = "保存";
    }
  }
  function bumpTargetChangelog(t, note) {
    const c = deepClone(t);
    c.changelog = c.changelog || [];
    const today = new Date().toISOString().slice(0, 10);
    c.updated = today;
    c.changelog.unshift({ date: today, version: c.version || "editor", note: note ? ("编辑器：" + note) : "编辑器修改" });
    return c;
  }

  // ---------- 表单小构件 ----------
  function card(title, hint, bodyFn) {
    return el("div", { class: "card" }, [
      el("h2", {}, [el("span", {}, title), el("span", { class: "hint" }, hint)]),
      bodyFn(),
    ]);
  }
  function th(t) { return el("th", {}, t); }
  // td/field 支持单参数调用 td(kid)：此时第一个参数是 DOM 节点而非 attrs，
  // 若误当 attrs 会把 DOM 属性 setAttribute 到 td 上并吞掉孩子（bug 根因）。
  function td(a, b) { return b === undefined ? el("td", {}, a) : el("td", a, b); }
  function field(label, fn) { return el("div", {}, [el("label", {}, label), fn()]); }
  function inp(type, val, onInput) {
    const e = el("input", { type });
    e.value = val == null ? "" : val;
    e.addEventListener("input", () => onInput(e.value));
    e.addEventListener("change", () => validate());
    return e;
  }
  function sel(opts, val, onChange) {
    const e = el("select", {}, opts.map(o => el("option", { value: o }, o)));
    e.value = val;
    e.addEventListener("change", () => { onChange(e.value); validate(); });
    return e;
  }
  function dateIn(val, onChange) {
    const e = el("input", { type: "date" });
    e.value = val || "";
    e.addEventListener("change", () => { onChange(e.value); validate(); });
    return e;
  }
  function delBtn(onClick) { return el("button", { class: "row-del", type: "button", title: "删除", onclick: onClick }, "✕"); }
  function addBtn(label, onClick) { return el("button", { class: "btn ghost", type: "button", onclick: onClick }, label); }

  // ---------- 启动 ----------
  selectFile("recurring.json");
})();
