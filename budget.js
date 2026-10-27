// =============================================================
// Tab: 💸 现金与负债 · 年度预算分析与计划
// Budget plans are stored in this browser only; source data remains read-only.
// =============================================================
(function () {
  const C = window.AssetCore;
  const $ = (selector, root = document) => root.querySelector(selector);
  const h = C.escapeHTML;
  const hideAmounts = C.isPrivacyMode();
  const STORAGE_KEY = `afd_budget_plans_v1_${getDataScopeKey()}`;
  const categoryColors = new Map();
  let activeYear = "";
  let yearlyForecasts = {};
  let categories = [];
  let recurringData = { expenses: [], incomes: [] };
  let currencyConverter = (amount, ccy) => Number(amount || 0) * (ccy === "RMB" ? 1 : 1);
  let plan = null;
  let savedPlans = readSavedPlans();

  function readSavedPlans() {
    try {
      const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
      return value && typeof value === "object" ? value : {};
    } catch (_) {
      return {};
    }
  }

  function getDataScopeKey() {
    const source = String((window.AFD_CONFIG && window.AFD_CONFIG.dataDir) || "default");
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function toAmount(value) {
    const amount = Number(value);
    return Number.isFinite(amount) && amount > 0 ? amount : 0;
  }

  function roundBudget(value) {
    return Math.ceil(value / 100) * 100;
  }

  function safeColor(value) {
    return /^#[\da-f]{6}$/i.test(value || "") ? value : "#6b7280";
  }

  function formatInput(value) {
    return String(Math.round(toAmount(value) * 1e6) / 1e6);
  }

  function annualAmount(item, year, toRMB) {
    const months = C.activeMonthsInYear(item, year);
    if (months <= 0) return 0;
    const base = toRMB(item.amount || 0, item.ccy || "RMB");
    return item.frequency === "annual" ? base : base * months;
  }

  function ensureCategory(key, label, color) {
    const found = categories.find(category => category.key === key);
    if (found) return found;
    const category = { key, name: label || key, color: safeColor(color) };
    categories.push(category);
    categoryColors.set(key, category.color);
    return category;
  }

  function recurringCategory(item, categoriesByKey) {
    const fallbackByKind = {
      insurance: "insurance",
      transport: "transport",
      living: "living",
      housing: "living",
      debt_interest: "debt_interest",
    };
    const key = item.category || fallbackByKind[item.kind] || item.kind || "other";
    if (categoriesByKey.has(key)) return categoriesByKey.get(key);
    return ensureCategory(key, item.categoryName || item.kind || key, item.color);
  }

  function buildForecast(year, data, rec, incomeEvents, toRMB) {
    const partial = data.status === "partial_with_projection";
    const progress = Number(data.yearProgress) > 0 ? Number(data.yearProgress) : 1;
    const expenses = (data.expenses || []).filter(item => !(item && (item.exclude || item.excludeFromCashflow)));
    const incomes = (data.incomes || []).filter(item => !(item && (item.exclude || item.excludeFromCashflow)));
    const usedRecurring = new Set([...expenses, ...incomes].map(item => item.recurring).filter(Boolean));
    const spendByCategory = {};

    expenses.forEach(item => {
      const actual = toRMB(item.amount || 0, item.ccy || "RMB");
      const projected = partial
        ? toRMB(item.projected_annual ?? ((item.amount || 0) / progress), item.ccy || "RMB")
        : actual;
      const key = item.category || "other";
      spendByCategory[key] = (spendByCategory[key] || 0) + projected;
      ensureCategory(key, item.categoryName || key, item.color);
    });

    const yearNum = Number(year);
    (rec.expenses || []).forEach(item => {
      if (usedRecurring.has(item.key)) return;
      if (item.kind === "insurance" && usedRecurring.has("_insurance_pool")) return;
      const amount = annualAmount(item, yearNum, toRMB);
      if (!amount) return;
      const category = recurringCategory(item, new Map(categories.map(entry => [entry.key, entry])));
      spendByCategory[category.key] = (spendByCategory[category.key] || 0) + amount;
    });

    const recurringIncomes = new Map((rec.incomes || []).map(item => [item.key, item]));
    let income = 0;
    let nonDisposableIncome = 0;
    if (yearNum === new Date().getFullYear()) {
      // Match the overview's annualized disposable income: active recurring income per month × 12.
      let monthlyIncome = 0;
      let monthlyNonDisposableIncome = 0;
      (rec.incomes || []).filter(item => C.isActive(item)).forEach(item => {
        const monthly = toRMB(item.amount || 0, item.ccy || "RMB")
          * (item.frequency === "annual" ? 1 / 12 : 1);
        monthlyIncome += monthly;
        if (item.disposable === false) monthlyNonDisposableIncome += monthly;
      });
      income = monthlyIncome * 12;
      nonDisposableIncome = monthlyNonDisposableIncome * 12;
    } else {
      incomes.forEach(item => {
        const actual = toRMB(item.amount || 0, item.ccy || "RMB");
        const projected = partial
          ? toRMB(item.projected_annual ?? ((item.amount || 0) / progress), item.ccy || "RMB")
          : actual;
        income += projected;
        const linkedRecurring = recurringIncomes.get(item.recurring);
        if (item.disposable === false || (linkedRecurring && linkedRecurring.disposable === false)) {
          nonDisposableIncome += projected;
        }
      });
      (rec.incomes || []).forEach(item => {
        if (usedRecurring.has(item.key)) return;
        const amount = annualAmount(item, yearNum, toRMB);
        income += amount;
        if (item.disposable === false) nonDisposableIncome += amount;
      });
      (incomeEvents.events || []).filter(event => Number(event.year) === yearNum && Number(event.amount) > 0)
        .forEach(event => {
          const amount = toRMB(event.amount, event.ccy || "RMB");
          income += amount;
          if (event.disposable === false) nonDisposableIncome += amount;
        });
    }

    return {
      income,
      disposableIncome: Math.max(0, income - nonDisposableIncome),
      expense: Object.values(spendByCategory).reduce((sum, value) => sum + value, 0),
      spendByCategory,
      partial,
      asOf: data.asOf || "",
      progress,
    };
  }

  function defaultPlan(forecast, year, recurring, toRMB) {
    const budgets = {};
    categories.forEach(category => {
      budgets[category.key] = roundBudget(forecast.spendByCategory[category.key] || 0);
    });
    const fixedMonthly = (recurring.expenses || []).reduce((sum, item) => {
      return sum + annualAmount(item, Number(year), toRMB) / 12;
    }, 0);
    return {
      income: roundBudget(forecast.disposableIncome),
      savingsRate: 30,
      emergencyMonths: 6,
      budgets,
      periods: Object.fromEntries(categories.map(category => [category.key, "annual"])),
      fixedMonthly,
    };
  }

  function loadPlan(year, forecast, recurring, toRMB) {
    const baseline = defaultPlan(forecast, year, recurring, toRMB);
    const stored = savedPlans[year];
    if (!stored || typeof stored !== "object") return baseline;
    const budgets = { ...baseline.budgets };
    if (stored.budgets && typeof stored.budgets === "object") {
      Object.entries(stored.budgets).forEach(([key, value]) => { budgets[key] = toAmount(value); });
    }
    const periods = { ...baseline.periods };
    if (stored.periods && typeof stored.periods === "object") {
      Object.entries(stored.periods).forEach(([key, value]) => {
        if (value === "annual" || value === "monthly") periods[key] = value;
      });
    }
    return {
      income: baseline.income,
      savingsRate: Math.min(100, Math.max(0, Number(stored.savingsRate ?? baseline.savingsRate) || 0)),
      emergencyMonths: Math.min(24, Math.max(1, Number(stored.emergencyMonths ?? baseline.emergencyMonths) || 6)),
      budgets,
      periods,
      fixedMonthly: baseline.fixedMonthly,
    };
  }

  function getAnnualBudget(key) {
    const amount = toAmount(plan.budgets[key]);
    return plan.periods[key] === "monthly" ? amount * 12 : amount;
  }

  function getTotalBudget() {
    return categories.reduce((sum, category) => sum + getAnnualBudget(category.key), 0);
  }

  function getForecastSpend() {
    const forecast = yearlyForecasts[activeYear];
    return forecast ? forecast.expense : 0;
  }

  function renderControls() {
    $("#budget-controls").innerHTML = `
      <div class="budget-field">
        <label for="budget-savings-rate-input">目标储蓄率（%）</label>
        <input class="budget-input" id="budget-savings-rate-input" type="number" min="0" max="100" step="1" inputmode="decimal" value="${formatInput(plan.savingsRate)}">
        <small>按当前可支配收入预测与分类预算计算；不可支配收入不计入预算上限。</small>
      </div>
      <div class="budget-field">
        <label for="budget-emergency-months-input">应急金覆盖月数</label>
        <input class="budget-input" id="budget-emergency-months-input" type="number" min="1" max="24" step="1" inputmode="numeric" value="${formatInput(plan.emergencyMonths)}">
        <small>目标金额按循环刚性支出的月均额估算。</small>
      </div>
    `;
    $("#budget-savings-rate-input").addEventListener("input", event => {
      plan.savingsRate = Math.min(100, Math.max(0, Number(event.currentTarget.value) || 0));
      refreshSummary();
    });
    $("#budget-emergency-months-input").addEventListener("input", event => {
      plan.emergencyMonths = Math.min(24, Math.max(1, Number(event.currentTarget.value) || 1));
      refreshSummary();
    });
  }

  function renderCategoryRows() {
    const forecast = yearlyForecasts[activeYear];
    $("#budget-category-table tbody").innerHTML = categories.map(category => {
      const amount = toAmount(plan.budgets[category.key]);
      const color = categoryColors.get(category.key) || safeColor(category.color);
      const period = plan.periods[category.key] || "annual";
      return `
        <tr data-budget-row="${h(category.key)}">
          <td><span class="budget-cat"><span class="swatch" style="background:${color}" aria-hidden="true"></span>${h(category.name)}</span></td>
          <td class="r" data-forecast>${C.fmtK(forecast.spendByCategory[category.key] || 0)}</td>
          <td class="r"><div class="budget-edit">
            <select class="date-picker budget-period" data-budget-period="${h(category.key)}" aria-label="${h(category.name)}预算维护周期" ${hideAmounts ? "disabled" : ""}>
              <option value="annual" ${period === "annual" ? "selected" : ""}>年度</option>
              <option value="monthly" ${period === "monthly" ? "selected" : ""}>月度</option>
            </select>
            <input class="budget-input budget-amount" type="number" min="0" step="${period === "monthly" ? "0.01" : "100"}" inputmode="decimal" data-budget-category="${h(category.key)}" data-category-label="${h(category.name)}" aria-label="${h(category.name)}${period === "monthly" ? "月度" : "年度"}预算（RMB）" value="${hideAmounts ? "" : formatInput(amount)}" ${hideAmounts ? 'placeholder="金额已隐藏" disabled' : ""}>
          </div></td>
          <td class="budget-progress"><div class="budget-track" role="progressbar" aria-label="${h(category.name)}预算使用率" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div><small data-usage>—</small></td>
          <td class="r" data-remaining>—</td>
        </tr>
      `;
    }).join("");

    $("#budget-category-table tbody").querySelectorAll("[data-budget-category]").forEach(input => {
      input.addEventListener("input", event => {
        plan.budgets[event.currentTarget.dataset.budgetCategory] = toAmount(event.currentTarget.value);
        refreshSummary();
      });
    });
    $("#budget-category-table tbody").querySelectorAll("[data-budget-period]").forEach(select => {
      select.addEventListener("change", event => {
        const key = event.currentTarget.dataset.budgetPeriod;
        const oldPeriod = plan.periods[key] || "annual";
        const nextPeriod = event.currentTarget.value;
        const currentAmount = toAmount(plan.budgets[key]);
        const annualAmount = oldPeriod === "monthly" ? currentAmount * 12 : currentAmount;
        plan.periods[key] = nextPeriod;
        plan.budgets[key] = nextPeriod === "monthly" ? annualAmount / 12 : annualAmount;
        const row = event.currentTarget.closest("tr");
        const amountInput = $("[data-budget-category]", row);
        amountInput.value = formatInput(plan.budgets[key]);
        amountInput.step = nextPeriod === "monthly" ? "0.01" : "100";
        amountInput.setAttribute("aria-label", `${amountInput.dataset.categoryLabel}${nextPeriod === "monthly" ? "月度" : "年度"}预算（RMB）`);
        refreshSummary();
      });
    });
  }

  function renderKpis() {
    const forecast = yearlyForecasts[activeYear];
    const totalBudget = getTotalBudget();
    const forecastSpend = getForecastSpend();
    const plannedSurplus = plan.income - totalBudget;
    const plannedRate = plan.income > 0 ? plannedSurplus / plan.income * 100 : 0;
    const emergencyTarget = plan.fixedMonthly * plan.emergencyMonths;
    const monthlyBudget = totalBudget / 12;
    const monthlyForecast = forecastSpend / 12;
    const monthlyRoom = monthlyBudget - monthlyForecast;
    const cards = [
      { label: "可支配收入预测", value: C.fmtK(forecast.disposableIncome), sub: `总收入预测 ${C.fmtK(forecast.income)} RMB`, tone: "ok" },
      { label: "年度支出预算", value: C.fmtK(totalBudget), sub: `年化支出预测 ${C.fmtK(forecastSpend)} RMB`, tone: forecastSpend > totalBudget ? "warn" : "ok" },
      { label: "月度预算支出", value: `${C.fmtK(monthlyBudget)} /月`, sub: `预测 ${C.fmtK(monthlyForecast)} · ${monthlyRoom >= 0 ? "月余" : "月超"} ${C.fmtK(Math.abs(monthlyRoom))} RMB`, tone: monthlyRoom < 0 ? "warn" : "ok" },
      { label: "计划结余", value: `${plannedSurplus >= 0 ? "+" : ""}${C.fmtK(plannedSurplus)}`, sub: `储蓄率 ${plannedRate.toFixed(1)}% · 目标 ${plan.savingsRate.toFixed(0)}%`, tone: plannedSurplus < 0 ? "danger" : (plannedRate < plan.savingsRate ? "warn" : "ok") },
      { label: "应急金目标", value: C.fmtK(emergencyTarget), sub: `${plan.emergencyMonths} 个月刚性支出 · 月均 ${C.fmtK(plan.fixedMonthly)}`, tone: "gold" },
    ];
    $("#budget-kpis").innerHTML = cards.map(card => `
      <div class="kpi ${card.tone}"><div class="label">${card.label}</div><div class="value num">${card.value}</div><div class="sub">${card.sub}</div></div>
    `).join("");
  }

  function renderInsights() {
    const forecast = yearlyForecasts[activeYear];
    const totalBudget = getTotalBudget();
    const forecastSpend = getForecastSpend();
    const plannedSurplus = plan.income - totalBudget;
    const plannedRate = plan.income > 0 ? plannedSurplus / plan.income * 100 : 0;
    const emergencyTarget = plan.fixedMonthly * plan.emergencyMonths;
    const buildMonths = plannedSurplus > 0 ? emergencyTarget / (plannedSurplus / 12) : Infinity;
    const overBudget = categories.map(category => ({
      name: category.name,
      amount: (forecast.spendByCategory[category.key] || 0) - toAmount(plan.budgets[category.key]),
    })).filter(item => item.amount > 0).sort((a, b) => b.amount - a.amount).slice(0, 3);
    const isOver = forecastSpend > totalBudget;
    const insights = [];

    if (plannedSurplus < 0) {
      insights.push(`<div class="budget-insight danger">当前计划支出比收入计划高 <b>${C.fmtK(Math.abs(plannedSurplus))} RMB/年</b>。请增加收入计划或调整分类预算。</div>`);
    } else if (plannedRate < plan.savingsRate) {
      insights.push(`<div class="budget-insight warn">计划储蓄率为 <b>${plannedRate.toFixed(1)}%</b>，低于目标 <b>${plan.savingsRate.toFixed(0)}%</b>；按当前可支配收入预测，年度支出预算需控制在 <b>${C.fmtK(plan.income * (1 - plan.savingsRate / 100))} RMB</b> 以内。</div>`);
    } else {
      insights.push(`<div class="budget-insight">计划结余可达到储蓄率目标，预计年度结余 <b>${C.fmtK(plannedSurplus)} RMB</b>。</div>`);
    }

    if (isOver) {
      insights.push(`<div class="budget-insight warn">按${forecast.partial ? `截至 ${h(forecast.asOf)} 的年化预测` : "年度流水与循环收支预测"}，支出将超出分类预算 <b>${C.fmtK(forecastSpend - totalBudget)} RMB</b>${overBudget.length ? `；优先检查：${overBudget.map(item => `${h(item.name)} +${C.fmtK(item.amount)}`).join("、")}。` : "。"}</div>`);
    } else {
      insights.push(`<div class="budget-insight">按${forecast.partial ? `截至 ${h(forecast.asOf)} 的年化预测` : "年度流水与循环收支预测"}，分类预算尚有 <b>${C.fmtK(totalBudget - forecastSpend)} RMB</b> 余量。</div>`);
    }

    insights.push(`<div class="budget-insight">应急金按循环刚性支出估算为 <b>${C.fmtK(emergencyTarget)} RMB</b>；按当前计划结余速度，约需 <b>${Number.isFinite(buildMonths) ? `${buildMonths.toFixed(1)} 个月` : "暂不可累积"}</b> 储备完成。该数值是目标测算，不代表当前已持有的现金。</div>`);
    $("#budget-insights").innerHTML = insights.join("");
  }

  function refreshCategoryRows() {
    const forecast = yearlyForecasts[activeYear];
    categories.forEach(category => {
      const row = $(`[data-budget-row="${CSS.escape(category.key)}"]`, $("#budget-category-table tbody"));
      if (!row) return;
      const forecastSpend = forecast.spendByCategory[category.key] || 0;
      const budget = getAnnualBudget(category.key);
      const ratio = budget > 0 ? forecastSpend / budget : (forecastSpend > 0 ? 1 : 0);
      const percent = budget > 0 ? ratio * 100 : (forecastSpend > 0 ? 100 : 0);
      const remaining = budget - forecastSpend;
      const track = $(".budget-track", row);
      const fill = $(".budget-track span", row);
      track.setAttribute("aria-valuenow", String(Math.min(100, Math.round(percent))));
      fill.style.width = `${Math.min(100, percent)}%`;
      fill.classList.toggle("over", forecastSpend > budget);
      $("[data-usage]", row).textContent = budget > 0 ? `${percent.toFixed(0)}% 已用` : (forecastSpend > 0 ? "无预算" : "0% 已用");
      const remainingCell = $("[data-remaining]", row);
      remainingCell.textContent = `${remaining >= 0 ? "" : "−"}${C.fmtK(Math.abs(remaining))}`;
      remainingCell.style.color = remaining < 0 ? "var(--danger)" : "var(--text-2)";
    });
  }

  function refreshSummary() {
    renderKpis();
    renderInsights();
    refreshCategoryRows();
  }

  function renderYear(year) {
    activeYear = year;
    plan = loadPlan(year, yearlyForecasts[year], recurringData, currencyConverter);
    renderControls();
    renderCategoryRows();
    refreshSummary();
    $("#budget-status").textContent = hideAmounts
      ? "金额隐藏模式已开启；预算金额已隐藏并暂停编辑。关闭隐藏后可继续查看和编辑。"
      : (savedPlans[year] ? "已载入此年度保存在当前浏览器的预算计划。" : "显示的是按实际预测生成的起始预算；调整后点击“保存本地计划”。");
    $("#budget-status").dataset.state = "";
  }

  Promise.all([
    C.fetchJson("transactions/index.json"),
    C.fetchJson("categories.json"),
    C.fetchJson("recurring.json"),
    C.fetchJson("history.json"),
    C.fetchJson("income_events.json", { fallback: { events: [] } }),
  ]).then(async ([txIndex, categoryData, recurring, history, incomeEvents]) => {
    const snapshots = (history.snapshots || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    const rates = snapshots.length ? snapshots[snapshots.length - 1].rates : { USD: 7, HKD: 0.91 };
    const toRMB = (amount, ccy) => Number(amount || 0) * (ccy === "RMB" ? 1 : (rates[ccy] || 1));
    recurringData = recurring;
    currencyConverter = toRMB;
    categories = (categoryData.categories || []).map(category => ({ ...category, color: safeColor(category.color) }));
    categories.forEach(category => categoryColors.set(category.key, category.color));
    const years = (txIndex.years || []).slice().sort();
    const planYears = years.length ? years : [String(new Date().getFullYear())];
    const dataRows = await Promise.all(planYears.map(year => {
      if (!years.includes(year)) return Promise.resolve({ year, data: { year: Number(year), expenses: [], incomes: [] } });
      return C.fetchJson(`transactions/yearly/${year}.json`).then(data => ({ year, data }));
    }));
    dataRows.forEach(({ year, data }) => {
      yearlyForecasts[year] = buildForecast(year, data, recurring, incomeEvents, toRMB);
    });
    const picker = $("#budget-year");
    picker.innerHTML = planYears.slice().reverse().map(year => `<option value="${h(year)}">${h(year)}</option>`).join("");
    picker.addEventListener("change", () => renderYear(picker.value));
    $("#budget-save").disabled = hideAmounts;
    $("#budget-reset").disabled = hideAmounts;
    $("#budget-save").addEventListener("click", () => {
      const savingsRate = Number($("#budget-savings-rate-input").value);
      const emergencyMonths = Number($("#budget-emergency-months-input").value);
      if (!Number.isFinite(savingsRate) || savingsRate < 0 || savingsRate > 100) {
        setStatus("目标储蓄率请输入 0 到 100 之间的数字。", "error");
        $("#budget-savings-rate-input").focus();
        return;
      }
      if (!Number.isFinite(emergencyMonths) || emergencyMonths < 1 || emergencyMonths > 24) {
        setStatus("应急金覆盖月数请输入 1 到 24 之间的数字。", "error");
        $("#budget-emergency-months-input").focus();
        return;
      }
      plan.savingsRate = savingsRate;
      plan.emergencyMonths = emergencyMonths;
      $("#budget-category-table tbody").querySelectorAll("[data-budget-category]").forEach(input => {
        plan.budgets[input.dataset.budgetCategory] = toAmount(input.value);
      });
      const nextSavedPlans = {
        ...savedPlans,
        [activeYear]: {
          savingsRate: plan.savingsRate,
          emergencyMonths: plan.emergencyMonths,
          budgets: plan.budgets,
          periods: plan.periods,
        },
      };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSavedPlans));
        savedPlans = nextSavedPlans;
        setStatus("计划已保存在当前浏览器。", "saved");
      } catch (_) {
        setStatus("浏览器未能保存本地计划；请检查隐私/存储设置后重试。", "error");
      }
    });
    $("#budget-reset").addEventListener("click", () => {
      plan = defaultPlan(yearlyForecasts[activeYear], activeYear, recurringData, currencyConverter);
      renderControls();
      renderCategoryRows();
      refreshSummary();
      setStatus("已恢复为按本年度实际预测生成的起始预算；保存后才会写入本地。", "");
    });

    picker.value = planYears[planYears.length - 1];
    renderYear(picker.value);
  }).catch(error => {
    $("#budget-kpis").innerHTML = `<div class="lia-card" role="alert">预算数据加载失败：${h(error.message || "未知错误")}</div>`;
    console.error(error);
  });

  function setStatus(message, state) {
    const status = $("#budget-status");
    status.textContent = message;
    status.dataset.state = state || "";
  }
})();
