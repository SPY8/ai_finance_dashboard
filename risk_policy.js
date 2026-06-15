// =============================================================
// 资产配置看板 · 风控与政策雷达 Tab
// 关联风险图谱与金融工具/政策武器库
// =============================================================
(function () {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  let risksData = null;
  let arsenalData = null;
  let hasRendered = false;
  let activeArsenalId = null;

  function loadData() {
    if (risksData && arsenalData) return Promise.resolve({ risks: risksData, arsenal: arsenalData });
    return Promise.all([
      fetch(window.AssetCore.getDataPath("risks.json"), { cache: "no-store" }).then(r => r.json()).catch(() => ({ dimensions: [], risks: [] })),
      fetch(window.AssetCore.getDataPath("policies.json"), { cache: "no-store" }).then(r => r.json()).catch(() => [])
    ]).then(([risks, arsenal]) => {
      risksData = risks;
      arsenalData = arsenal;
      return { risks, arsenal };
    });
  }

  window.renderRiskPolicyTab = function() {
    if (hasRendered && $("#risk-content").dataset.loaded === "true") return;

    loadData().then(({ risks, arsenal }) => {
      renderKPIs(risks, arsenal);
      renderLayout(risks, arsenal);
      bindEvents();
      
      $("#risk-content").dataset.loaded = "true";
      hasRendered = true;
    }).catch(err => {
      console.error("Risk Policy Tab 加载失败:", err);
      $("#risk-content").innerHTML = `<div style="padding:40px;color:var(--danger)">加载失败: ${err.message}</div>`;
    });
  };

  function renderKPIs(risks, arsenal) {
    const riskCount = (risks.risks || []).length;
    const toolsCount = arsenal.filter(a => a.type === 'tool').length;
    const policyCount = arsenal.filter(a => a.type === 'policy').length;

    const kpis = [
      {
        label: "在册风险盲区",
        value: riskCount,
        sub: "家庭财富防御底线",
        tone: "warn"
      },
      {
        label: "可用金融工具",
        value: toolsCount,
        sub: "出海与防御武器库",
        tone: "ok"
      },
      {
        label: "宏观政策追踪",
        value: policyCount,
        sub: "动态影响因子",
        tone: "info"
      }
    ];

    $("#risk-kpis").innerHTML = kpis.map(k => `
      <div class="kpi ${k.tone}">
        <div class="stripe"></div>
        <div class="label">${k.label}</div>
        <div class="value num">${k.value}</div>
        <div class="sub">${k.sub}</div>
      </div>
    `).join("");
  }

  function renderLayout(risks, arsenal) {
    // 按类别分组
    const categories = [...new Set(arsenal.map(a => a.category))];
    
    const html = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start">
        <section style="margin-top:0">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">
            <h2>⚔️ 工具与政策武器库<span class="hint">点击卡片查看与风险的映射关系</span></h2>
          </div>
          
          <!-- 筛选器 -->
          <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap" id="arsenal-filters">
            <button class="btn primary filter-btn active" data-cat="all">全部展示</button>
            ${categories.map(cat => `<button class="btn filter-btn" data-cat="${cat}">${cat}</button>`).join('')}
          </div>

          <div id="arsenal-list" style="display:flex;flex-direction:column;gap:16px">
            ${categories.map(cat => `
              <div class="arsenal-group" data-cat="${cat}">
                <div class="group-header" style="font-size:12px;color:var(--text-3);font-weight:600;margin-bottom:8px;letter-spacing:0.5px;text-transform:uppercase;cursor:pointer;display:flex;align-items:center;gap:6px;user-select:none">
                  <span class="toggle-icon" style="transition:transform 0.2s">▼</span> ${cat}
                </div>
                <div class="group-content" style="display:flex;flex-direction:column;gap:12px;transition:max-height 0.3s ease-in-out, opacity 0.3s ease-in-out;overflow:hidden;opacity:1">
                  ${arsenal.filter(a => a.category === cat).map(a => renderArsenalCard(a)).join('')}
                </div>
              </div>
            `).join('')}
          </div>
        </section>
        
        <section style="margin-top:0;position:sticky;top:20px;height:calc(100vh - 40px);display:flex;flex-direction:column">
          <h2 style="flex-shrink:0">🕸️ 全景风控图谱<span class="hint">四大维度防线（<span style="color:var(--ok)">绿=被对冲</span> / <span style="color:var(--danger)">红=被引入</span>）</span></h2>
          <div id="risk-map" style="display:flex;flex-direction:column;gap:16px;overflow-y:auto;padding-right:4px;flex:1">
            ${(risks.dimensions || []).map(d => renderRiskDimension(d, risks.risks)).join('')}
          </div>
        </section>
      </div>
    `;

    $("#risk-content").innerHTML = html;
  }

  function renderArsenalCard(item) {
    const isTool = item.type === 'tool';
    const accentColor = isTool ? 'var(--ok)' : 'var(--accent)';
    
    return `
      <div class="lia-card arsenal-card" data-id="${item.id}" data-mitigates="${(item.mitigates||[]).join(',')}" data-introduces="${(item.introduces||[]).join(',')}" style="cursor:pointer;transition:all 0.2s;border-left:3px solid ${accentColor};padding:14px 16px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
          <div>
            <div style="font-size:14px;font-weight:600;color:var(--text-0);margin-bottom:4px">${item.title}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              ${(item.tags||[]).map(t => `<span style="font-size:10px;padding:1px 6px;border-radius:4px;background:var(--bg-2);color:var(--text-2);border:1px solid var(--line)">${t}</span>`).join('')}
            </div>
          </div>
          <div style="font-size:11px;font-family:'JetBrains Mono',monospace;color:var(--text-3)">${item.date}</div>
        </div>
        
        <div style="font-size:12px;color:var(--text-0);margin-bottom:10px;background:var(--bg-2);padding:6px 10px;border-radius:4px;border-left:2px solid var(--text-3)">
          <b style="color:var(--text-1)">本质：</b>${item.essence}
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:10px;font-size:11px;line-height:1.5">
          <div>
            <div style="color:var(--ok);font-weight:600;margin-bottom:2px">🟢 优势 / 机会</div>
            <ul style="margin:0;padding-left:14px;color:var(--text-1)">
              ${(item.pros||[]).map(p => `<li>${p}</li>`).join('')}
            </ul>
          </div>
          <div>
            <div style="color:var(--danger);font-weight:600;margin-bottom:2px">🔴 劣势 / 代价</div>
            <ul style="margin:0;padding-left:14px;color:var(--text-2)">
              ${(item.cons||[]).map(c => `<li>${c}</li>`).join('')}
            </ul>
          </div>
        </div>

        ${(item.rules && item.rules.length > 0) ? `
          <div style="font-size:11px;color:var(--accent);margin-top:8px;padding-top:8px;border-top:1px dashed var(--line)">
            <div style="font-weight:600;margin-bottom:4px">⚡ 实操纪律：</div>
            <ul style="margin:0;padding-left:14px;line-height:1.6">
              ${item.rules.map(r => `<li>${r}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
      </div>
    `;
  }

  function renderRiskDimension(dim, allRisks) {
    const dimRisks = allRisks.filter(r => r.dimension === dim.id);
    if (!dimRisks.length) return '';

    return `
      <div class="risk-dim" style="background:var(--bg-1);border:1px solid var(--line);border-radius:var(--radius);overflow:visible;flex-shrink:0">
        <div style="background:var(--bg-2);padding:8px 14px;font-size:12px;font-weight:600;color:${dim.color};border-bottom:1px solid var(--line);display:flex;align-items:center;gap:8px">
          <div style="width:8px;height:8px;border-radius:50%;background:${dim.color}"></div>
          ${dim.name}
        </div>
        <div style="padding:10px 14px;display:flex;flex-direction:column;gap:8px">
          ${dimRisks.map(r => `
            <div class="risk-node" id="risk-${r.id}" style="padding:8px 12px;background:var(--bg-0);border:1px solid var(--line);border-radius:6px;transition:all 0.3s ease">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                <div style="font-size:13px;font-weight:500;color:var(--text-0)">${r.title}</div>
                <div style="font-size:10px;color:var(--text-3);background:var(--bg-2);padding:1px 6px;border-radius:3px">${r.keyword}</div>
              </div>
              <div style="font-size:11px;color:var(--text-2);line-height:1.5">${r.description}</div>
              <div class="risk-badge" style="display:none;font-size:10px;font-weight:600;margin-top:6px;padding:2px 6px;border-radius:4px;width:fit-content"></div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function bindEvents() {
    const arsenalCards = $$('.arsenal-card');
    const riskNodes = $$('.risk-node');
    const riskDims = $$('.risk-dim');

    // 初始化所有的 max-height 以便能够平滑折叠
    $$('.group-content').forEach(content => {
      content.style.maxHeight = content.scrollHeight + 'px';
    });

    // 筛选器逻辑
    const filterBtns = $$('.filter-btn');
    const arsenalGroups = $$('.arsenal-group');
    
    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetCat = btn.dataset.cat;
        
        // 更新按钮状态
        filterBtns.forEach(b => {
          b.classList.remove('primary', 'active');
          if(b === btn) b.classList.add('primary', 'active');
        });

        // 过滤列表
        arsenalGroups.forEach(group => {
          const content = group.querySelector('.group-content');
          const icon = group.querySelector('.toggle-icon');
          if (targetCat === 'all' || group.dataset.cat === targetCat) {
            group.style.display = 'block';
            // 筛选时自动展开，重置其内容高度
            setTimeout(() => {
              content.style.maxHeight = content.scrollHeight + 'px';
              content.style.opacity = '1';
              icon.style.transform = 'rotate(0deg)';
            }, 0);
          } else {
            group.style.display = 'none';
          }
        });
      });
    });

    // 分类折叠逻辑
    $$('.group-header').forEach(header => {
      header.addEventListener('click', () => {
        const content = header.nextElementSibling;
        const icon = header.querySelector('.toggle-icon');
        
        if (content.style.maxHeight === '0px') {
          content.style.maxHeight = content.scrollHeight + 'px';
          content.style.opacity = '1';
          icon.style.transform = 'rotate(0deg)';
        } else {
          // 每次折叠前更新一下真实的 scrollHeight 防止内部内容发生变化导致卡顿
          content.style.maxHeight = content.scrollHeight + 'px';
          // 强行触发重绘
          content.offsetHeight; 
          content.style.maxHeight = '0px';
          content.style.opacity = '0';
          icon.style.transform = 'rotate(-90deg)';
        }
      });
    });

    arsenalCards.forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.id;
        const mitigates = card.dataset.mitigates.split(',').filter(Boolean);
        const introduces = card.dataset.introduces.split(',').filter(Boolean);
        
        // Toggle off if already active
        if (activeArsenalId === id) {
          activeArsenalId = null;
          arsenalCards.forEach(c => {
            c.style.background = 'var(--bg-1)';
            c.style.borderColor = 'var(--line)';
            c.style.opacity = '1';
          });
          riskNodes.forEach(r => {
            r.style.display = 'block'; // 恢复显示
            r.style.opacity = '1';
            r.style.background = 'var(--bg-0)';
            r.style.borderColor = 'var(--line)';
            r.style.boxShadow = 'none';
            r.style.transform = 'scale(1)';
            const badge = r.querySelector('.risk-badge');
            if(badge) badge.style.display = 'none';
          });
          riskDims.forEach(d => {
             d.style.display = 'block'; // 恢复维度显示
          });
          return;
        }

        activeArsenalId = id;

        // Highlight selected arsenal card
        arsenalCards.forEach(c => {
          if (c.dataset.id === id) {
            c.style.background = 'var(--bg-2)';
            c.style.borderColor = 'var(--text-0)';
            c.style.opacity = '1';
          } else {
            c.style.background = 'var(--bg-1)';
            c.style.borderColor = 'var(--line)';
            c.style.opacity = '0.5';
          }
        });

        // Highlight related risks (Mitigates vs Introduces) and hide others
        riskNodes.forEach(r => {
          const riskId = r.id.replace('risk-', '');
          const badge = r.querySelector('.risk-badge');
          
          if (mitigates.includes(riskId)) {
            r.style.display = 'block';
            r.style.opacity = '1';
            r.style.background = 'rgba(61,220,151,0.08)';
            r.style.borderColor = 'var(--ok)';
            r.style.boxShadow = '0 0 0 1px var(--ok)';
            r.style.transform = 'scale(1.02)';
            if(badge) {
              badge.textContent = "🟢 被此工具对冲 / 解决";
              badge.style.color = "var(--ok)";
              badge.style.background = "rgba(61,220,151,0.15)";
              badge.style.display = "block";
            }
          } else if (introduces.includes(riskId)) {
            r.style.display = 'block';
            r.style.opacity = '1';
            r.style.background = 'rgba(255,92,122,0.08)';
            r.style.borderColor = 'var(--danger)';
            r.style.boxShadow = '0 0 0 1px var(--danger)';
            r.style.transform = 'scale(1.02)';
            if(badge) {
              badge.textContent = "🔴 被此工具引入 / 需防范";
              badge.style.color = "var(--danger)";
              badge.style.background = "rgba(255,92,122,0.15)";
              badge.style.display = "block";
            }
          } else {
            r.style.display = 'none'; // 隐藏非相关节点，实现聚焦
          }
        });

        // Hide dimensions that have no visible nodes
        riskDims.forEach(d => {
            const visibleNodes = Array.from(d.querySelectorAll('.risk-node')).filter(n => n.style.display !== 'none');
            if (visibleNodes.length === 0) {
                d.style.display = 'none';
            } else {
                d.style.display = 'block';
            }
        });
      });
    });
    // 窗口调整大小时，重新计算展开组的 max-height，防止响应式文字折行导致被截断
    window.addEventListener('resize', () => {
      $$('.group-content').forEach(content => {
        if (content.style.maxHeight !== '0px') {
          content.style.maxHeight = 'none'; // 先解除限制，让浏览器自然排版
          const newHeight = content.scrollHeight;
          content.style.maxHeight = newHeight + 'px'; // 重新锁死真实高度，保证下次折叠动画有效
        }
      });
    });

  }

})();