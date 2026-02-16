/**
 * KILL SYSTEM CORE - sync.js
 */

// --- ETHER INTERFACE ---
const provider = new ethers.JsonRpcProvider(ALCHEMY_URL);

/**
 * UTILITY: Format numbers for UI display
 */
const formatValue = (val) => {
    const absVal = Math.abs(val);
    if (absVal >= 1000000000) return (val / 1000000000).toFixed(1) + 'B';
    if (absVal >= 1000000) return (val / 1000000).toFixed(1) + 'M';
    if (absVal >= 1000) return (val / 1000).toFixed(1) + 'K';
    return Math.floor(val).toLocaleString();
};

/**
 * HEARTBEAT: Synchronize with the latest blockchain block height
 */
async function updateHeartbeat() {
    try {
        const hexBlock = await provider.send("eth_blockNumber", []);
        const currentBlock = parseInt(hexBlock, 16);
        
        if (currentBlock !== lastBlock && lastBlock !== 0) {
            const displayKill = Math.floor(currentGlobalKillStacked).toLocaleString();
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
 * UI: Render the Top Stacks leaderboard rows
 */
function updateTopStacks(stacks, activeReaperMap) {
    if (!topStacksEl) return;
    let globalUnits = 0, globalReapers = 0, globalBountyKill = 0;

    const processed = stacks.map(s => {
        const u = parseInt(s.totalStandardUnits);
        const r = activeReaperMap[s.id] || parseInt(s.totalBoostedUnits) || 0;
        const bBlock = parseInt(s.birthBlock);
        const age = (lastBlock > 0 && bBlock > 0) ? (lastBlock - bBlock) : 0;
        const multiplier = (1 + (age / 1000));
        const totalKillValue = u * multiplier;

        globalUnits += u; 
        globalReapers += r; 
        globalBountyKill += totalKillValue;
        stackRegistry[s.id] = { units: s.totalStandardUnits, reaper: r.toString(), birthBlock: s.birthBlock }; 
        updateNodeParticles(s.id, s.totalStandardUnits, r);
        return { id: s.id, units: u, reapers: r, bounty: multiplier, kill: totalKillValue };
    });

    currentGlobalKillStacked = globalBountyKill;
    if(totalUnitsActiveEl) totalUnitsActiveEl.innerText = globalUnits.toLocaleString();
    if(totalReapersActiveEl) totalReapersActiveEl.innerText = globalReapers.toLocaleString();
    if(totalKillBountyEl) totalKillBountyEl.innerText = `${Math.floor(globalBountyKill).toLocaleString()}`;

    const sorted = processed.filter(s => s.units > 0 || s.reapers > 0).sort((a, b) => b.kill - a.kill);
    if (sorted.length === 0) {
        topStacksEl.innerHTML = '<div style="font-size:0.7rem; color:#444; padding:10px;">ARENA EMPTY...</div>';
        return;
    }

    topStacksEl.innerHTML = sorted.map(item => `
        <div class="stack-row" onmouseover="showTooltip(event, '${item.id}')" onmouseout="if(tooltip) tooltip.style.opacity=0" style="display: flex; justify-content: space-between; border-bottom: 1px solid #111; padding: 2px 0;">
            <span style="width:10%; color:#555;">${item.id}</span>
            <span style="width:20%">${item.units >= 1000 ? (item.units / 1000).toFixed(1) + 'K' : item.units}</span>
            <span style="width:10%; color:var(--cyan)">${item.reapers}</span>
            <span style="width:25%; color:var(--cyan); opacity:0.8;">${item.bounty.toFixed(2)}x</span>
            <span style="width:35%; text-align:right; color:var(--pink); font-weight:bold;">${Math.floor(item.kill).toLocaleString()}</span>
        </div>
    `).join('');
}

/**
 * CORE: Main Data Synchronization Loop
 */
async function syncData() {
    await updateHeartbeat();
    
    try {
        const query = `{
            globalStat(id: "current") { 
            totalUnitsKilled 
            totalReaperKilled 
            killBurned 
            }
            stacks(orderBy: totalStandardUnits, orderDirection: desc, first: 100) { 
            id 
            totalStandardUnits 
            totalBoostedUnits 
            birthBlock 
            }
            killeds(first: 50, orderBy: block_number, orderDirection: desc) { 
            id 
            attacker 
            targetUnitsLost 
            block_number 
            stackId 
            }
            spawneds(first: 50, orderBy: block_number, orderDirection: desc) { 
            id 
            agent 
            stackId 
            units
            reapers
            block_number 
            }
            moveds(first: 50, orderBy: block_number, orderDirection: desc) { 
            id 
            agent 
            fromStack 
            toStack 
            units 
            block_number 
            }
            agents(first: 10) {
            id
            totalSpent
            totalEarned
            }
        }`;

        const resp = await fetch(SUBGRAPH_URL, { 
            method: "POST", 
            headers: { "Content-Type": "application/json" }, 
            body: JSON.stringify({ query }) 
        });

        const result = await resp.json();
        if (!result || !result.data) return;

        const { globalStat, killeds = [], spawneds = [], moveds = [], stacks = [], agents = [] } = result.data;
        
        const activeReaperMap = {};
        stacks.forEach(s => activeReaperMap[s.id] = parseInt(s.totalBoostedUnits || "0"));

        if (statusEl) {
            statusEl.innerHTML = killeds.length > 0 ? 
                '<span class="lethal-dot"></span>SYSTEM STATUS: LETHAL' : 
                'SYSTEM STATUS: OPERATIONAL';
        }

        updateTopStacks(stacks, activeReaperMap);
        
        if (globalStat) {
            if (unitsKilledEl) unitsKilledEl.innerText = parseInt(globalStat.totalUnitsKilled).toLocaleString();
            if (reaperKilledEl) reaperKilledEl.innerText = parseInt(globalStat.totalReaperKilled).toLocaleString();
            
            const burned = ethers.formatEther(globalStat.killBurned || "0");
            if (killBurnedEl) killBurnedEl.innerText = `${parseFloat(burned).toLocaleString(undefined, {minimumFractionDigits: 3})} KILL`;
        }

        const events = [...spawneds.map(s => ({...s, type: 'spawn'})), ...killeds.map(k => ({...k, type: 'kill'})), ...moveds.map(m => ({...m, type: 'move'}))].sort((a, b) => Number(a.block_number) - Number(b.block_number));

        events.forEach(evt => {
            const addr = (evt.type === 'kill') ? evt.attacker : evt.agent;
            if (addr && !agentPnL[addr]) agentPnL[addr] = { spent: 0, earned: 0 };

            if (!knownIds.has(evt.id)) {
                if (evt.type === 'spawn') {
                    agentPnL[addr].spent += Number(evt.units || 0) * 10;
                    addLog(evt.block_number, `[SPAWN] ${evt.agent.substring(0,6)} (+${evt.reapers} REAPER)`, 'log-spawn');
                    triggerPulse(evt.stackId, 'spawn');
                } else if (evt.type === 'kill') {
                    const amount = parseInt(evt.targetUnitsLost);
                    agentPnL[addr].earned += amount;
                    addLog(evt.block_number, `[KILL] ${evt.attacker.substring(0,6)} reaped ${amount}`, 'log-kill');
                    triggerPulse(evt.stackId, 'kill');
                } else if (evt.type === 'move') {
                    addLog(evt.block_number, `[MOVE] ${evt.agent.substring(0,6)} shifted ${evt.units} to STACK_${evt.toStack}`, 'log-move');
                    triggerPulse(evt.toStack, 'spawn'); 
                }
                knownIds.add(evt.id);
            }
        });

        renderPnL(agents);

    } catch (e) { console.error("Sync fail", e); }
}

/**
 * UI: Render Agent P&L Leaderboard
 */
function renderPnL(agents) {
    if (!pnlEl) return;
    
    const sortedAgents = [...agents].sort((a, b) => {
        const netA = BigInt(a.totalEarned) - BigInt(a.totalSpent);
        const netB = BigInt(b.totalEarned) - BigInt(b.totalSpent);
        return netB > netA ? 1 : -1;
    }).slice(0, 10);

    pnlEl.innerHTML = sortedAgents.map(a => {
        const spent = parseFloat(ethers.formatEther(a.totalSpent || "0"));
        const earned = parseFloat(ethers.formatEther(a.totalEarned || "0"));
        const net = earned - spent;
        return `
            <div class="stack-row" onmouseover="showLeaderboardTooltip(event, '${a.id}', ${earned}, ${spent}, ${net})" onmouseout="if(tooltip) tooltip.style.opacity=0" style="display: flex; justify-content: space-between; padding: 2px 0;">
                <span style="width:25%; font-family:monospace;">
                    <a href="${BLOCK_EXPLORER}/address/${a.id}" target="_blank" style="color:#888; text-decoration:none;">${a.id.substring(0, 8)}</a>
                </span>
                <span style="width:25%; text-align:right; color:${earned > 0 ? 'var(--cyan)' : '#eee'}; font-weight:bold;">${formatValue(earned)}</span>
                <span style="width:20%; text-align:right; opacity:0.6;">${formatValue(spent)}</span>
                <span style="width:30%; text-align:right; color:${net > 0 ? 'var(--cyan)' : 'var(--pink)'}; font-weight:bold;">${net > 0 ? '+' : ''}${formatValue(net)}</span>
            </div>
        `;
    }).join('');
}

/**
 * UI: Enhanced Tooltip for Leaderboard Rows
 */
function showLeaderboardTooltip(e, addr, earned, spent, net) {
    if (!tooltip) return;
    const pnlColor = net > 0 ? 'var(--cyan)' : 'var(--pink)';
    tooltip.style.opacity = 1;
    tooltip.style.left = (e.pageX + 15) + 'px';
    tooltip.style.top = (e.pageY + 15) + 'px';
    tooltip.innerHTML = `
        <div style="padding: 2px; min-width: 200px;">
            <strong style="color:var(--pink); font-size: 0.65rem;">AGENT_IDENTITY</strong><br>
            <span style="font-size:0.7rem; color:var(--cyan); word-break:break-all;">${addr}</span>
            <hr style="border:0; border-top:1px solid #333; margin:8px 0;">
            <div style="display:flex; justify-content:space-between;"><span>EARNED:</span> <span>${formatValue(earned)}</span></div>
            <div style="display:flex; justify-content:space-between;"><span>SPENT:</span> <span>${formatValue(spent)}</span></div>
            <div style="display:flex; justify-content:space-between; margin-top:4px; font-weight:bold; color:${pnlColor};">
                <span>NET P/L:</span> <span>${net > 0 ? '+' : ''}${formatValue(net)}</span>
            </div>
        </div>
    `;
}