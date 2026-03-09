/**
 * KILL SYSTEM CORE - sync.js (Solana / Supabase)
 */

/**
 * COOKIE UTILS — shared across sync.js and index.html inline scripts
 */
function setCookie(name, val, days) {
    document.cookie = name + '=' + encodeURIComponent(val)
        + '; max-age=' + (days * 86400) + '; path=/; SameSite=Lax';
}
function getCookie(name) {
    const m = document.cookie.match(
        new RegExp('(?:^|;\\s*)' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)')
    );
    return m ? decodeURIComponent(m[1]) : null;
}

/**
 * UTILITY: Format numbers for UI display (K, M, B)
 */
const formatValue = (val) => {
    if (val === null || val === undefined) return '0';
    const num = parseFloat(val);
    if (isNaN(num)) return '0';

    const absVal = Math.abs(num);
    if (absVal >= 1000000000) return (num / 1000000000).toFixed(1) + 'B';
    if (absVal >= 1000000)    return (num / 1000000).toFixed(1) + 'M';
    if (absVal >= 1000)       return (num / 1000).toFixed(1) + 'K';

    return Math.floor(num).toLocaleString();
};

// Cached registered agents (updated every 30s by pollAgentRegistry)
let registeredAgentsCache = [];

/**
 * HEARTBEAT: Fetch current Solana devnet block height via public RPC.
 * Uses getBlockHeight (confirmed commitment) — increments slower than slot
 * (~1 per ~400ms but only when blocks are produced, not every skipped slot).
 * Mirrors the EVM viewer's BLOCK SYNC log pattern exactly.
 */
async function updateHeartbeat() {
    try {
        const resp = await fetch(SOLANA_RPC_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0", id: 1, method: "getSlot",
                params: [{ commitment: "confirmed" }]
            })
        });
        const json = await resp.json();
        const currentBlock = json.result;

        if (currentBlock !== lastBlock && lastBlock !== 0) {
            const displayKill = formatValue(currentGlobalKillStacked);
            addLog(currentBlock, `BLOCK SYNC: ${displayKill} KILL`, "log-network");
        }

        if (headerBlock) headerBlock.innerText = currentBlock;
        lastBlock = currentBlock;
    } catch (e) {
        if (headerBlock) headerBlock.innerText = "SYNCING...";
        console.error("Heartbeat sync failed:", e);
    }
}

/**
 * UI: Tooltip for Top Stacks list
 */
function showStackTooltip(e, id, units, reapers, bounty, totalKill) {
    if (!tooltip) return;

    const basePower = units + (reapers * 666);
    const agents = (stackRegistry[String(id)] || {}).agents || [];
    const agentSection = agents.length > 0
        ? (() => {
            const rows = agents.map(a =>
                `<span style="color:#aaa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${a.agent.substring(0, 10)}…</span>` +
                `<span style="text-align:right;color:#ddd;">${formatValue(a.units)}</span>` +
                `<span style="text-align:right;color:var(--cyan);">${formatValue(a.reaper)}</span>`
            ).join('');
            return `<div style="border-bottom:1px solid #333;margin:4px 0;"></div>` +
                `<div style="display:grid;grid-template-columns:1fr 68px 52px;gap:2px 0;font-size:0.6rem;">` +
                `<span style="color:#888;">WALLET</span><span style="color:#888;text-align:right;">UNITS</span><span style="color:#888;text-align:right;">REAPER</span>` +
                rows + `</div>`;
          })()
        : (units > 0 || reapers > 0)
            ? `<div style="border-bottom:1px solid #333;margin:4px 0;"></div>` +
              `<div style="font-size:0.6rem;color:#555;font-style:italic;">agent breakdown pending</div>`
            : '';

    tooltip.style.opacity = 1;
    tooltip.style.left = (e.pageX + 15) + 'px';
    tooltip.style.top = (e.pageY + 15) + 'px';

    tooltip.innerHTML = `
        <div style="padding: 5px; min-width: 220px; font-family: 'Courier New', monospace;">
            <strong style="color:var(--pink); font-size: 0.7rem;">STACK_IDENTITY: ${id}</strong>
            <div style="border-bottom: 1px solid #333; margin: 4px 0;"></div>
            <div style="display:flex; justify-content:space-between; font-size:0.65rem;">
                <span>UNITS:</span> <span>${formatValue(units)}</span>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:0.65rem; color:var(--cyan)">
                <span>REAPER:</span> <span>${formatValue(reapers)}</span>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:0.65rem; opacity:0.8;">
                <span>BASE_POWER:</span> <span>${formatValue(basePower)}</span>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:0.65rem; color:var(--cyan)">
                <span>BOUNTY:</span> <span>${bounty.toFixed(2)}x</span>
            </div>
            <div style="border-bottom: 1px solid #333; margin: 4px 0;"></div>
            <div style="display:flex; justify-content:space-between; font-weight:bold; color:var(--pink); font-size:0.75rem;">
                <span>VALUE:</span> <span>${formatValue(totalKill)} KILL</span>
            </div>
            ${agentSection}
        </div>
    `;
}

/**
 * UI: Render the Top Stacks leaderboard rows
 */
// Bounty constants — mirrors Solana contract (50x over 3 days)
const SLOTS_PER_MULT = 13_224;  // ~3 days / 49 steps ≈ 13,224 slots/step
const MAX_MULT       = 50;
const SPAWN_COST_KILL = 20;     // KILL per unit (display units, 6-decimal)
const GLOBAL_CAP_BPS  = 0.25;  // 25% of treasury

function updateTopStacks(stacks, activeReaperMap, treasuryKill) {
    if (!topStacksEl) return;
    let globalUnits = 0, globalReapers = 0, globalBountyKill = 0;

    const processed = stacks.map(s => {
        const u      = parseInt(s.total_standard_units || 0);
        const r      = activeReaperMap[s.id] || parseInt(s.total_boosted_units) || 0;
        const bSlot  = parseInt(s.birth_slot || 0);

        const age    = (lastBlock > 0 && bSlot > 0) ? Math.max(0, lastBlock - bSlot) : 0;
        const mult   = Math.min(MAX_MULT, Math.max(1, 1 + Math.floor(age / SLOTS_PER_MULT)));
        const power  = u + (r * 666);
        const rawKill = power * SPAWN_COST_KILL * mult;
        const cap    = (treasuryKill > 0) ? treasuryKill * GLOBAL_CAP_BPS : Infinity;
        const totalKillValue = Math.min(rawKill, cap);
        const displayBounty = mult;

        globalUnits    += u;
        globalReapers  += r;
        globalBountyKill += totalKillValue;

        // Keep birthBlock key to stay compatible with engine.js tooltip
        const stackAgents = s.agents || [];
        stackRegistry[s.id] = {
            units: u,
            reaper: r,
            birthBlock: bSlot,
            bounty: displayBounty,
            totalKill: totalKillValue,
            agents: stackAgents
        };

        updateNodeParticles(s.id, u, r);

        return { id: s.id, units: u, reapers: r, bounty: displayBounty, kill: totalKillValue };
    });

    currentGlobalKillStacked = globalBountyKill;

    if (totalUnitsActiveEl)   totalUnitsActiveEl.innerText   = formatValue(globalUnits);
    if (totalReapersActiveEl) totalReapersActiveEl.innerText = formatValue(globalReapers);
    if (totalKillBountyEl)    totalKillBountyEl.innerText    = formatValue(Math.floor(globalBountyKill));

    const sorted = processed.filter(s => s.units > 0 || s.reapers > 0).sort((a, b) => b.kill - a.kill);
    if (opBestEl) opBestEl.innerText = sorted.length > 0 ? `${formatValue(Math.floor(sorted[0].kill))} KILL` : '---';
    if (sorted.length === 0) {
        topStacksEl.innerHTML = '<div style="font-size:0.7rem; color:#444; padding:10px;">ARENA EMPTY...</div>';
        return;
    }

    topStacksEl.innerHTML = sorted.map(item => {
        const isSelected = selectedStacks.has(String(item.id));
        return `
        <div class="stack-row${isSelected ? ' stack-row-selected' : ''}"
             id="stack-filter-row-${item.id}"
             onclick="toggleStackFilter('${item.id}')"
             onmouseover="showStackTooltip(event, '${item.id}', ${item.units}, ${item.reapers}, ${item.bounty}, ${item.kill})"
             onmouseout="if(tooltip) tooltip.style.opacity=0"
             style="display: flex; justify-content: space-between; border-bottom: 1px solid #111; padding: 2px 0; cursor: pointer;">
            <span style="width:10%; color:${isSelected ? 'var(--pink)' : '#555'};">${item.id}</span>
            <span style="width:20%">${formatValue(item.units)}</span>
            <span style="width:14%; color:var(--cyan)">${formatValue(item.reapers)}</span>
            <span style="width:25%; color:var(--cyan); opacity:0.8;">${item.bounty.toFixed(2)}x</span>
            <span style="width:31%; text-align:right; color:var(--pink); font-weight:bold;">${formatValue(Math.floor(item.kill))}</span>
        </div>
    `;
    }).join('');
}

/**
 * UI: Filter Action Trigger
 */
function selectAgent(addr) {
    if (activeFilterAgents.has(addr)) {
        activeFilterAgents.delete(addr);
        addLog(lastBlock, `SYSTEM FILTER: REMOVED ${addr.substring(0, 8)}`, "log-network");
    } else {
        activeFilterAgents.add(addr);
        addLog(lastBlock, `SYSTEM FILTER: ADDED ${addr.substring(0, 8)}`, "log-network");
    }
    syncData();
}

/**
 * CORE: Main Data Synchronization Loop
 */
async function syncData() {
    await updateHeartbeat();

    try {
        // Fetch global_stat via REST
        let globalStat = null;
        try {
            const statResp = await fetch(
                `${SUPABASE_URL}/rest/v1/global_stat?id=eq.current&select=*`,
                { headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${SUPABASE_ANON_KEY}` } }
            );
            const statRows = await statResp.json();
            globalStat = Array.isArray(statRows) ? (statRows[0] || null) : null;
        } catch (_) {}

        const query = `{
            stackCollection(orderBy: [{ total_standard_units: DescNullsLast }], first: 216) {
                edges { node {
                    id total_standard_units total_boosted_units birth_slot current_bounty
                    agent_stackCollection {
                        edges { node { agent units reaper } }
                    }
                } }
            }
            killedCollection(orderBy: [{ slot: DescNullsLast }], first: 50) {
                edges { node {
                    id attacker target stack_id
                    attacker_units_sent attacker_reaper_sent
                    attacker_units_lost attacker_reaper_lost
                    target_units_lost target_reaper_lost
                    initial_defender_units initial_defender_reaper
                    attacker_bounty defender_bounty total_burned slot
                } }
            }
            spawnedCollection(orderBy: [{ slot: DescNullsLast }], first: 50) {
                edges { node { id agent stack_id units reapers slot } }
            }
            movedCollection(orderBy: [{ slot: DescNullsLast }], first: 50) {
                edges { node { id agent from_stack to_stack units reaper slot } }
            }
            agentCollection(orderBy: [{ net_pnl: DescNullsLast }], first: 1000) {
                edges { node { id total_spent total_earned net_pnl } }
            }
        }`;

        const resp = await fetch(`${SUPABASE_URL}/graphql/v1`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "apikey": SUPABASE_ANON_KEY
            },
            body: JSON.stringify({ query })
        });

        const result = await resp.json();
        if (!result || !result.data) return;

        const raw = result.data;
        const killeds = raw.killedCollection?.edges?.map(e => e.node)  || [];
        const spawneds = raw.spawnedCollection?.edges?.map(e => e.node) || [];
        const moveds  = raw.movedCollection?.edges?.map(e => e.node)   || [];
        const agents  = raw.agentCollection?.edges?.map(e => e.node)   || [];

        const stacks = (raw.stackCollection?.edges || []).map(e => {
            const node = e.node;
            node.agents = (node.agent_stackCollection?.edges || [])
                .map(ae => ae.node)
                .map(a => ({ agent: a.agent, units: parseInt(a.units || 0), reaper: parseInt(a.reaper || 0) }))
                .filter(a => a.units > 0 || a.reaper > 0)
                .sort((a, b) => (b.units + b.reaper * 666) - (a.units + a.reaper * 666));
            return node;
        });

        // If filtering by agents, replace aggregate counts with the filtered wallet's totals
        if (activeFilterAgents.size > 0) {
            stacks.forEach(s => {
                const filtered = (s.agents || []).filter(a => activeFilterAgents.has(a.agent));
                s.total_standard_units = String(filtered.reduce((sum, a) => sum + a.units, 0));
                s.total_boosted_units  = String(filtered.reduce((sum, a) => sum + a.reaper, 0));
            });
        }

        const activeReaperMap = {};
        stacks.forEach(s => activeReaperMap[s.id] = parseInt(s.total_boosted_units || "0"));

        if (statusEl) {
            let statusText = "OPERATIONAL";
            const totalStacked = currentGlobalKillStacked;
            if (totalStacked >= 20000000)      statusText = "LETHAL";
            else if (totalStacked >= 15000000) statusText = "CRITICAL";
            else if (totalStacked >= 10000000) statusText = "VOLATILE";
            else if (totalStacked >= 5000000)  statusText = "ACTIVE";
            else if (totalStacked > 0)         statusText = "STABLE";

            statusEl.innerHTML = totalStacked >= 20000000
                ? `<span class="lethal-dot"></span>SYSTEM STATUS: ${statusText}`
                : `SYSTEM STATUS: ${statusText}`;
        }

        const treasuryKill = globalStat ? parseFloat(globalStat.current_treasury || 0) / 1_000_000 : 0;
        updateTopStacks(stacks, activeReaperMap, treasuryKill);

        // Agent P&L totals (6 decimals)
        let totalEarned = 0;
        let totalSpent  = 0;
        agents.forEach(a => {
            totalEarned += parseFloat(a.total_earned || 0) / 1_000_000;
            totalSpent  += parseFloat(a.total_spent  || 0) / 1_000_000;
        });
        const totalNet = totalEarned - totalSpent;

        if (gameProfitEl) gameProfitEl.innerText = formatValue(totalEarned);
        if (gameCostEl)   gameCostEl.innerText   = formatValue(totalSpent);
        if (gamePnlEl) {
            gamePnlEl.innerText    = (totalNet > 0 ? "+" : "") + formatValue(totalNet);
            gamePnlEl.style.color  = totalNet >= 0 ? "var(--cyan)" : "var(--pink)";
        }
        if (opPnlEl) {
            opPnlEl.innerText   = (totalNet > 0 ? "+" : "") + formatValue(totalNet);
            opPnlEl.style.color = totalNet >= 0 ? "var(--cyan)" : "var(--pink)";
        }
        if (opAgentEl && agents.length > 0) {
            const topEarned = parseFloat(agents[0].total_earned || 0) / 1_000_000;
            const topSpent  = parseFloat(agents[0].total_spent  || 0) / 1_000_000;
            const topNet    = topEarned - topSpent;
            opAgentEl.innerText   = `${topNet > 0 ? '+' : ''}${formatValue(topNet)} KILL`;
            opAgentEl.style.color = topNet >= 0 ? 'var(--cyan)' : 'var(--pink)';
        }

        if (globalStat) {
            if (unitsKilledEl)  unitsKilledEl.innerText  = formatValue(parseInt(globalStat.total_units_killed));
            if (reaperKilledEl) reaperKilledEl.innerText = formatValue(parseInt(globalStat.total_reaper_killed));
            const burned = parseFloat(globalStat.kill_burned || 0) / 1_000_000;
            if (killBurnedEl) killBurnedEl.innerText = `${formatValue(burned)} KILL`;
            const circulatingEl = document.getElementById('stat-kill-circulating');
            if (circulatingEl) {
                const circ = 666_000_000_000 - burned;
                circulatingEl.innerText = (circ / 1_000_000_000).toFixed(3) + 'B';
            }
        }

        // Process events oldest → newest so triggerPulse fires in order
        const events = [
            ...spawneds.map(s => ({ ...s, type: 'spawn' })),
            ...killeds.map(k => ({ ...k, type: 'kill' })),
            ...moveds.map(m => ({ ...m, type: 'move' }))
        ].sort((a, b) => Number(a.slot) - Number(b.slot));

        events.forEach(evt => {
            if (knownIds.has(evt.id)) return;
            const slot = evt.slot;

            if (evt.type === 'spawn') {
                const logMsg = `<span style="color:var(--cyan)">[SPAWN]</span> <span class="log-addr-short">${evt.agent.substring(0, 8)}</span><span class="log-addr-full"><a href="${BLOCK_EXPLORER}/address/${evt.agent}?cluster=devnet" target="_blank">${evt.agent}</a></span> <span style="opacity:0.5">-></span> STACK_${evt.stack_id}`;
                const subMsg = `UNITS: ${formatValue(parseInt(evt.units))} | REAPER: ${formatValue(parseInt(evt.reapers))}`;
                addLog(slot, logMsg, 'log-spawn', subMsg);
                triggerPulse(evt.stack_id, 'spawn');

            } else if (evt.type === 'kill') {
                const atkBounty  = parseFloat(evt.attacker_bounty || 0) / 1_000_000;
                const defBounty  = parseFloat(evt.defender_bounty || 0) / 1_000_000;
                const totalBurned = parseFloat(evt.total_burned   || 0) / 1_000_000;
                const offPow  = parseInt(evt.attacker_units_sent  || 0) + parseInt(evt.attacker_reaper_sent  || 0) * 666;
                const defPow  = parseInt(evt.initial_defender_units || 0) + parseInt(evt.initial_defender_reaper || 0) * 666;
                const offLost = parseInt(evt.attacker_units_lost   || 0) + parseInt(evt.attacker_reaper_lost  || 0) * 666;
                const defLost = parseInt(evt.target_units_lost     || 0) + parseInt(evt.target_reaper_lost    || 0) * 666;
                const logMsg = `<span style="color:var(--pink)">[KILL]</span> <span class="log-addr-short">${evt.attacker.substring(0, 6)}</span><span class="log-addr-full"><a href="${BLOCK_EXPLORER}/address/${evt.attacker}?cluster=devnet" target="_blank">${evt.attacker}</a></span> <span style="opacity:0.5">X</span> STACK_${evt.stack_id}`;
                const subMsg = `<div class="kill-table">` +
                    `<div class="kill-row kill-header"><span></span><span>OFFENSE</span><span>DEFENSE</span></div>` +
                    `<div class="kill-row"><span>BATTLE</span><span>${formatValue(offPow)}</span><span>${formatValue(defPow)}</span></div>` +
                    `<div class="kill-row"><span>OUTCOME</span><span>${formatValue(offLost)}</span><span>${formatValue(defLost)}</span></div>` +
                    `<div class="kill-row"><span>KILL WON</span><span>${formatValue(atkBounty)}</span><span>${formatValue(defBounty)}</span></div>` +
                    `<div class="kill-row"><span>BURNED</span><span>${formatValue(totalBurned)}</span><span></span></div>` +
                    `</div>`;
                addLog(slot, logMsg, 'log-kill', subMsg, evt.target);
                triggerPulse(evt.stack_id, 'kill');

            } else if (evt.type === 'move') {
                const logMsg = `<span style="color:#888">[MOVE]</span> <span class="log-addr-short">${evt.agent.substring(0, 6)}</span><span class="log-addr-full"><a href="${BLOCK_EXPLORER}/address/${evt.agent}?cluster=devnet" target="_blank">${evt.agent}</a></span> <span style="opacity:0.5">>></span> STACK_${evt.to_stack}`;
                const subMsg = `TRANSFERRED: ${formatValue(parseInt(evt.units))} UNITS | ${formatValue(parseInt(evt.reaper))} REAPER`;
                addLog(slot, logMsg, 'log-move', subMsg);
                triggerPulse(evt.to_stack, 'move');
            }

            knownIds.add(evt.id);
        });

        // Build per-agent total active power across all stacks (units + reapers*666)
        // Use activeAgents (non-zero only) so power/stack counts reflect real holdings
        const agentPowerMap = {};
        const agentStackCountMap = {};
        stacks.forEach(s => {
            (s.agents || []).forEach(a => {
                if (!agentPowerMap[a.agent]) agentPowerMap[a.agent] = 0;
                agentPowerMap[a.agent] += a.units + a.reaper * 666;
                if (!agentStackCountMap[a.agent]) agentStackCountMap[a.agent] = 0;
                agentStackCountMap[a.agent]++;
            });
        });

        renderPnL(agents, agentPowerMap, agentStackCountMap);

    } catch (e) { console.error("Sync fail", e); }
}

/**
 * UI: Render Agent P&L Leaderboard
 */
function renderPnL(agents, agentPowerMap, agentStackCountMap) {
    if (!pnlEl) return;
    agentPowerMap      = agentPowerMap      || {};
    agentStackCountMap = agentStackCountMap || {};

    pnlEl.innerHTML = agents.map(a => {
        const spent  = parseFloat(a.total_spent  || 0) / 1_000_000;
        const earned = parseFloat(a.total_earned || 0) / 1_000_000;
        const net    = earned - spent;
        const pwr    = agentPowerMap[a.id] || 0;
        const stacks = agentStackCountMap[a.id] || 0;
        const isFiltered = activeFilterAgents.has(a.id);

        return `
            <div class="stack-row" data-agent="${a.id}"
                 onmouseover="showLeaderboardTooltip(event,'${a.id}',${earned},${spent},${net},${pwr},${stacks})"
                 onmouseout="if(tooltip) tooltip.style.opacity=0"
                 style="display: flex; justify-content: space-between; padding: 2px 0; cursor: pointer; background: ${isFiltered ? 'rgba(20,241,149,0.1)' : 'transparent'};">
                <span style="width:25%; font-family:monospace; color:${isFiltered ? 'var(--cyan)' : '#888'};">${a.id.substring(0, 8)}</span>
                <span style="width:22%; text-align:right; color:${pwr > 0 ? '#eee' : '#444'};">${formatValue(pwr)}</span>
                <span style="width:22%; text-align:right; color:${earned > 0 ? 'var(--cyan)' : '#eee'}; font-weight:bold;">${formatValue(earned)}</span>
                <span style="width:31%; text-align:right; color:${net > 0 ? 'var(--cyan)' : 'var(--pink)'}; font-weight:bold;">${net > 0 ? '+' : ''}${formatValue(net)}</span>
            </div>
        `;
    }).join('');

    pnlEl.querySelectorAll('.stack-row[data-agent]').forEach(row => {
        row.addEventListener('click', () => selectAgent(row.dataset.agent));
    });
}

/**
 * AGENT REGISTRY: Poll agent-register endpoint, update badge + mission checklist
 */
async function pollAgentRegistry() {
    // Get this viewer's public IP (cached after first successful fetch)
    if (!pollAgentRegistry._ip) {
        try {
            const ipRes = await fetch('https://api.ipify.org?format=json');
            if (ipRes.ok) pollAgentRegistry._ip = (await ipRes.json()).ip;
        } catch (_) {}
    }
    const viewerIp = pollAgentRegistry._ip || null;

    // Fetch all registered agents from the edge function
    let registeredAgents = [];
    try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/agent-register`, {
            headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
        });
        if (res.ok) registeredAgents = await res.json();
    } catch (_) {}
    registeredAgentsCache = Array.isArray(registeredAgents) ? registeredAgents : [];

    // Check: any agent with matching IP that checked in within last 10 minutes?
    const cutoff = Date.now() - 10 * 60 * 1000;
    const matchedAgent = viewerIp && Array.isArray(registeredAgents)
        ? registeredAgents.find(a => a.ip === viewerIp && a.updt && new Date(a.updt).getTime() > cutoff)
        : null;
    const agentOnline = !!matchedAgent;

    // ── Cookie: persist agent address whenever online ─────────────────────────
    if (agentOnline) {
        setCookie('kill_agent', matchedAgent.address, 365);
    }

    // ── Header badge ─────────────────────────────────────────────────────────
    const badge = document.getElementById('spec-badge');
    if (badge) {
        if (agentOnline) {
            badge.textContent = '◉ AGENT ONLINE';
            badge.style.color = 'var(--cyan)';
            badge.style.borderColor = 'rgba(20,241,149,0.35)';
            badge.style.background = 'rgba(20,241,149,0.07)';
        } else {
            badge.textContent = '◉ SPECTATOR MODE';
            badge.style.color = '';
            badge.style.borderColor = '';
            badge.style.background = '';
        }
    }

    // ── Configure button ──────────────────────────────────────────────────────
    const cfgBtn = document.getElementById('cfg-agent-btn');
    if (cfgBtn) {
        if (agentOnline) {
            cfgBtn.style.color = 'var(--cyan)';
            cfgBtn.style.borderColor = 'rgba(20,241,149,0.35)';
        } else {
            cfgBtn.style.color = '';
            cfgBtn.style.borderColor = '';
        }
    }

    // ── Mission checklist ─────────────────────────────────────────────────────
    function setCheck(id, on) {
        const el = document.getElementById(id);
        if (el) el.style.color = on ? 'var(--cyan)' : '#222';
    }

    setCheck('mcheck-installed', agentOnline);
    setCheck('mcheck-sol',     agentOnline && parseFloat(matchedAgent.sol  || 0) > 0);
    setCheck('mcheck-kill',    agentOnline && parseFloat(matchedAgent.kill || 0) > 0);
    setCheck('mcheck-dryrun',  agentOnline);
    setCheck('mcheck-live',    agentOnline);

    // ── Auto-select on first online detection (once per page load) ────────────
    // _autoSelected latches permanently on first trigger so subsequent polls
    // and any manual filter changes by the user are never overridden.
    if (agentOnline && !pollAgentRegistry._autoSelected) {
        pollAgentRegistry._autoSelected = true;
        const addr = matchedAgent.address;
        if (!activeFilterAgents.has(addr)) {
            selectAgent(addr); // adds to filter + calls syncData() to re-render
        }
        // Scroll the leaderboard row into view after re-render settles
        setTimeout(() => {
            const row = document.querySelector(`#leaderboard .stack-row[data-agent="${addr}"]`);
            if (row) row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 600);
    }
}

/**
 * UI: Enhanced Tooltip for Leaderboard Rows
 */
function showLeaderboardTooltip(e, addr, earned, spent, net, power, stacks) {
    if (!tooltip) return;
    const reg      = registeredAgentsCache.find(a => a.address === addr) || null;
    const pnlColor = net > 0 ? 'var(--cyan)' : 'var(--pink)';

    const row = (label, val, color) =>
        `<tr><td style="color:#555;padding-right:12px;white-space:nowrap;">${label}</td><td style="color:${color||'#ccc'};word-break:break-all;">${val}</td></tr>`;

    // Format capabilities (may be array or object)
    let capsStr = '—';
    if (reg && reg.capabilities != null) {
        try {
            const c = typeof reg.capabilities === 'string' ? JSON.parse(reg.capabilities) : reg.capabilities;
            capsStr = Array.isArray(c) ? c.join(', ') : JSON.stringify(c);
        } catch { capsStr = String(reg.capabilities); }
    }

    const fmtDate = (iso) => {
        if (!iso) return '—';
        const d = new Date(iso);
        const mins = Math.floor((Date.now() - d) / 60000);
        if (mins < 1)   return 'just now';
        if (mins < 60)  return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24)   return `${hrs}h ago`;
        return `${Math.floor(hrs/24)}d ago`;
    };

    const registeredSection = reg ? `
        <tr><td colspan="2" style="padding-top:8px;padding-bottom:2px;color:var(--cyan);font-size:0.6rem;letter-spacing:2px;">REGISTRY</td></tr>
        ${row('NAME',    reg.name  || '—')}
        ${row('BUILD',   reg.build || '—')}
        ${row('CAPS',    capsStr)}
        ${row('SOL',     reg.sol  != null ? parseFloat(reg.sol).toFixed(4)  + ' SOL'  : '—', parseFloat(reg.sol||0)  > 0 ? 'var(--cyan)' : '#666')}
        ${row('KILL',    reg.kill != null ? formatValue(parseFloat(reg.kill)) + ' KILL' : '—', parseFloat(reg.kill||0) > 0 ? 'var(--cyan)' : '#666')}
        ${row('LAST SEEN', fmtDate(reg.updt), '#888')}
    ` : `
        <tr><td colspan="2" style="padding-top:8px;padding-bottom:2px;color:#444;font-size:0.6rem;letter-spacing:2px;">REGISTRY</td></tr>
        <tr><td colspan="2" style="color:#444;font-style:italic;font-size:0.65rem;">NOT REGISTERED</td></tr>
    `;

    tooltip.style.opacity = 1;
    tooltip.style.left = (e.pageX + 15) + 'px';
    tooltip.style.top  = (e.pageY + 15) + 'px';
    tooltip.innerHTML = `
        <div style="padding:4px 2px; min-width:240px; font-family:'Courier New',monospace; font-size:0.7rem;">
            <div style="color:var(--pink);font-size:0.6rem;letter-spacing:2px;margin-bottom:4px;">AGENT_IDENTITY</div>
            <div style="color:var(--cyan);word-break:break-all;margin-bottom:6px;font-size:0.65rem;">${addr}</div>
            <table style="width:100%;border-collapse:collapse;">
                <tr><td colspan="2" style="padding-bottom:2px;color:#555;font-size:0.6rem;letter-spacing:2px;">GAME STATS</td></tr>
                ${row('POWER',  formatValue(power), power > 0 ? '#eee' : '#444')}
                ${row('STACKS', stacks > 0 ? stacks : '—', stacks > 0 ? '#eee' : '#444')}
                ${row('EARNED', formatValue(earned), earned > 0 ? 'var(--cyan)' : '#eee')}
                ${row('SPENT',  formatValue(spent))}
                ${row('NET P/L', (net > 0 ? '+' : '') + formatValue(net), pnlColor)}
                ${registeredSection}
            </table>
            <div style="font-size:0.55rem;opacity:0.35;margin-top:6px;text-align:center;">CLICK TO FILTER STACKS</div>
        </div>
    `;
}
