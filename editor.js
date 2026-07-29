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

  const ENUMS = {
    ccy: ["RMB", "USD", "HKD"],
    freq: ["monthly", "annual", "quarterly", "weekly", "once"],
    kindIn: ["salary", "rental_income", "interest", "dividend", "other"],
    kindEx: ["insurance", "mortgage", "rent", "transport", "utility", "education", "other"],
    phase: ["active", "planned", "blocked", "hold", "closed", "exit"],
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
    else if (currentFile === "target.json") renderTarget();
    else if (currentFile === "history.json") renderHistory();
    else root.appendChild(el("div", { class: "card" }, "未知文件"));
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
  // snapshot 字段多且嵌套深（rates/prices/holdings/cashFlow），用文本编辑 + 失焦校验更稳。
  function renderHistory() {
    const snaps = working.snapshots || [];
    root.appendChild(card("说明", "history.json 是 append-only 快照数组。新增 snapshot 推荐用 python3 scripts/new_snapshot.py 生成后粘贴；此处可微调/删除/重排。每条字段：date, rates, ratesSource, comment, cashFlow, prices, holdings。", () => el("div", {})));
    snaps.forEach((s, i) => root.appendChild(snapBlock(i)));
    root.appendChild(addBtn("＋ 新增空 snapshot（手动填）", () => {
      working.snapshots.push({ date: new Date().toISOString().slice(0, 10), rates: { USD: 7.2, HKD: 0.92 }, ratesSource: "", comment: "", cashFlow: null, prices: {}, holdings: {} });
      render(); validate();
    }));
  }
  function snapBlock(i) {
    const s = working.snapshots[i];
    const text = JSON.stringify(s, null, 2);
    return el("div", { class: "card" }, [
      el("h2", {}, [
        el("span", {}, "快照 #" + (i + 1) + " · " + (s.date || "?")),
        el("span", { class: "hint" }, (s.comment || "").slice(0, 40)),
        el("button", { class: "btn ghost", type: "button", title: "上移", onclick: () => {
          if (i > 0) { const a = working.snapshots[i - 1]; working.snapshots[i - 1] = working.snapshots[i]; working.snapshots[i] = a; render(); validate(); }
        } }, "↑"),
        delBtn(() => { working.snapshots.splice(i, 1); render(); validate(); }),
      ]),
      field("JSON（失焦校验）", () => {
        const ta = el("textarea", { rows: "14" });
        ta.value = text;
        ta.addEventListener("blur", () => {
          try {
            working.snapshots[i] = JSON.parse(ta.value);
            ta.style.borderColor = "";
            validate();
          } catch (e) {
            ta.style.borderColor = "var(--danger)";
            setMsg("snapshot #" + (i + 1) + " JSON 解析失败：" + e.message, "err");
          }
        });
        return ta;
      }),
    ]);
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
    if (currentFile === "history.json") {
      const dates = (working.snapshots || []).map(s => s.date);
      const dup = dates.filter((d, idx) => d && dates.indexOf(d) !== idx);
      if (dup.length) problems.push("重复 snapshot date: " + [...new Set(dup)].join(", "));
      (working.snapshots || []).forEach((s, i) => {
        if (!s.date) problems.push("snapshot #" + (i + 1) + " 缺 date");
        if (!s.rates) problems.push("snapshot #" + (i + 1) + " 缺 rates");
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
