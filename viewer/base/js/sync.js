/**
 * KILL SYSTEM CORE - sync.js
 */

// --- ETHER INTERFACE ---
const provider = new ethers.JsonRpcProvider(ALCHEMY_URL);

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

/**
 * HEARTBEAT: Synchronize with the latest blockchain block height
 */
async function updateHeartbeat() {
    try {
        const hexBlock = await provider.send("eth_blockNumber", []);
        const currentBlock = parseInt(hexBlock, 16);
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
 * Shows headcount-based bounty value and effective (decayed) combat power.
 */
function showStackTooltip(e, id, units, reapers, multiplier, decayPct, bountyKill) {
    if (!tooltip) return;
    const basePower      = units + (reapers * 666);
    const effectivePower = Math.floor(basePower * decayPct / 100);

    tooltip.style.opacity = 1;
    tooltip.style.left = (e.pageX + 15) + 'px';
    tooltip.style.top  = (e.pageY + 15) + 'px';

    tooltip.innerHTML = `
        <div style="padding: 5px; min-width: 190px; font-family: 'Courier New', monospace;">
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
            <div style="display:flex; justify-content:space-between; font-size:0.65rem; color:${decayPct < 60 ? 'var(--pink)' : 'var(--cyan)'};">
                <span>EFF_POWER (${decayPct.toFixed(0)}% decay):</span> <span>${formatValue(effectivePower)}</span>
            </div>
            <div style="border-bottom: 1px solid #333; margin: 4px 0;"></div>
            <div style="display:flex; justify-content:space-between; font-size:0.65rem; color:var(--cyan)">
                <span>BOUNTY_MULT:</span> <span>${multiplier.toFixed(2)}x</span>
            </div>
            <div style="display:flex; justify-content:space-between; font-weight:bold; color:var(--pink); font-size:0.75rem;">
                <span>VALUE:</span> <span>${formatValue(bountyKill)} KILL</span>
            </div>
        </div>
    `;
}

/**
 * UI: Render the Top Stacks leaderboard rows
 */
function updateTopStacks(stacks, activeReaperMap) {
    if (!topStacksEl) return;
    let globalUnits = 0, globalReapers = 0, globalBountyKill = 0;

    const processed = stacks.map(s => {
        const u      = parseInt(s.totalStandardUnits || 0);
        const r      = activeReaperMap[s.id] || parseInt(s.totalBoostedUnits) || 0;
        const bBlock = parseInt(s.birthBlock || 0);

        const age        = (lastBlock > 0 && bBlock > 0) ? (lastBlock - bBlock) : 0;
        const multiplier = calcMultiplier(age);
        const decayPct   = calcDecayPct(multiplier);

        // Bounty value: headcount (units + reapers) × multiplier.
        // Power (units + reapers*666) is for combat only — not for bounty value.
        const headcount      = u + r;
        const totalKillValue = headcount * multiplier;

        globalUnits      += u;
        globalReapers    += r;
        globalBountyKill += totalKillValue;

        stackRegistry[s.id] = {
            units:      u,
            reaper:     r,
            birthBlock: bBlock,
            multiplier,
            decayPct,
            totalKill:  totalKillValue,
        };

        updateNodeParticles(s.id, u, r);

        return { id: s.id, units: u, reapers: r, multiplier, decayPct, kill: totalKillValue };
    });

    currentGlobalKillStacked = globalBountyKill;

    if (totalUnitsActiveEl)  totalUnitsActiveEl.innerText  = formatValue(globalUnits);
    if (totalReapersActiveEl) totalReapersActiveEl.innerText = formatValue(globalReapers);
    if (totalKillBountyEl)   totalKillBountyEl.innerText   = formatValue(Math.floor(globalBountyKill));

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
             onmouseover="showStackTooltip(event, '${item.id}', ${item.units}, ${item.reapers}, ${item.multiplier}, ${item.decayPct}, ${item.kill})"
             onmouseout="if(tooltip) tooltip.style.opacity=0"
             style="display: flex; justify-content: space-between; border-bottom: 1px solid #111; padding: 2px 0; cursor: pointer;">
            <span style="width:10%; color:${isSelected ? 'var(--pink)' : '#555'};">${item.id}</span>
            <span style="width:20%">${formatValue(item.units)}</span>
            <span style="width:14%; color:var(--cyan)">${formatValue(item.reapers)}</span>
            <span style="width:25%; color:${item.decayPct < 60 ? 'var(--pink)' : 'var(--cyan)'}; opacity:0.8;">${item.multiplier.toFixed(2)}x / ${item.decayPct.toFixed(0)}%</span>
            <span style="width:31%; text-align:right; color:var(--pink); font-weight:bold;">${formatValue(Math.floor(item.kill))}</span>
        </div>
    `;
    }).join('');
}

/**
 * UI: Filter Action Trigger
 */
function selectAgent(addr) {
    if (activeFilterAgent === addr) {
        activeFilterAgent = null;
        addLog(lastBlock, "SYSTEM FILTER: RESET TO GLOBAL", "log-network");
    } else {
        activeFilterAgent = addr;
        addLog(lastBlock, `SYSTEM FILTER: AGENT ${addr.substring(0, 8)}`, "log-network");
    }
    syncData();
}

/**
 * CORE: Main Data Synchronization Loop
 */
async function syncData() {
    await updateHeartbeat();

    const agentStackQuery = activeFilterAgent ? `
        agentStacks(where: { agent: "${activeFilterAgent.toLowerCase()}" }) {
            stackId
            units
            reaper
        }
    ` : '';

    try {
        const query = `{
            globalStat(id: "current") {
                totalUnitsKilled
                totalReaperKilled
                killAdded
                killExtracted
                killBurned
                currentTreasury
                maxBounty
                spawnCost
                blocksPerMultiplier
                maxMultiplier
                globalCapBps
            }
            stacks(orderBy: totalStandardUnits, orderDirection: desc, first: 216) {
                id
                totalStandardUnits
                totalBoostedUnits
                birthBlock
                currentBounty
            }
            ${agentStackQuery}
            killeds(first: 50, orderBy: block_number, orderDirection: desc) {
                id
                attacker
                target
                stackId
                attackerUnitsSent
                attackerReaperSent
                attackerUnitsLost
                attackerReaperLost
                targetUnitsLost
                targetReaperLost
                attackerBounty
                defenderBounty
                initialDefenderUnits
                initialDefenderReaper
                block_number
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
                reaper
                block_number
            }
            claimeds(first: 50, orderBy: block_number, orderDirection: desc) {
                id
                claimer
                stackId
                units
                block_number
            }
            agents(first: 1000, orderBy: netPnL, orderDirection: desc, where: { id_not: "0x0000000000000000000000000000000000000000" }) {
                id
                totalSpent
                totalEarned
                netPnL
                airdropClaimed
            }
        }`;

        const resp = await fetch(SUBGRAPH_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query })
        });

        const result = await resp.json();
        if (!result || !result.data) return;

        const {
            globalStat,
            killeds   = [],
            spawneds  = [],
            moveds    = [],
            claimeds  = [],
            stacks    = [],
            agents    = [],
            agentStacks = []
        } = result.data;

        // Update live config from subgraph so bounty/decay calc uses current on-chain params
        if (globalStat) {
            if (globalStat.blocksPerMultiplier) liveConfig.blocksPerMultiplier = parseInt(globalStat.blocksPerMultiplier);
            if (globalStat.maxMultiplier)       liveConfig.maxMultiplier       = parseInt(globalStat.maxMultiplier);
            if (globalStat.globalCapBps)        liveConfig.globalCapBps        = parseInt(globalStat.globalCapBps);
            if (globalStat.spawnCost)           liveConfig.spawnCost           = parseFloat(ethers.formatEther(globalStat.spawnCost));
        }

        // Replace global stack counts with agent-specific totals when filtering
        if (activeFilterAgent) {
            const agentLookup = {};
            agentStacks.forEach(as => {
                agentLookup[as.stackId] = { units: as.units, reaper: as.reaper };
            });
            stacks.forEach(s => {
                const own = agentLookup[s.id] || { units: "0", reaper: "0" };
                s.totalStandardUnits = own.units;
                s.totalBoostedUnits  = own.reaper;
            });
        }

        const activeReaperMap = {};
        stacks.forEach(s => activeReaperMap[s.id] = parseInt(s.totalBoostedUnits || "0"));

        updateTopStacks(stacks, activeReaperMap);
        updateSystemStatus(currentGlobalKillStacked);

        // --- P&L leaderboard ---
        let totalEarned = 0, totalSpent = 0;
        agents.forEach(a => {
            totalEarned += parseFloat(ethers.formatEther(a.totalEarned || "0"));
            totalSpent  += parseFloat(ethers.formatEther(a.totalSpent  || "0"));
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
            const topNet = parseFloat(ethers.formatEther(agents[0].totalEarned || "0"))
                         - parseFloat(ethers.formatEther(agents[0].totalSpent  || "0"));
            opAgentEl.innerText   = `${topNet > 0 ? '+' : ''}${formatValue(topNet)} KILL`;
            opAgentEl.style.color = topNet >= 0 ? 'var(--cyan)' : 'var(--pink)';
        }

        // --- Global stats ---
        if (globalStat) {
            if (unitsKilledEl)  unitsKilledEl.innerText  = formatValue(parseInt(globalStat.totalUnitsKilled));
            if (reaperKilledEl) reaperKilledEl.innerText = formatValue(parseInt(globalStat.totalReaperKilled));

            const burned      = parseFloat(ethers.formatEther(globalStat.killBurned      || "0"));
            const treasury    = parseFloat(ethers.formatEther(globalStat.currentTreasury || "0"));
            const maxBounty   = parseFloat(ethers.formatEther(globalStat.maxBounty       || "0"));
            const circulating = 66666666666 - burned;

            if (killBurnedEl) killBurnedEl.innerText = `${formatValue(burned)} KILL`;

            const circulatingEl = document.getElementById('stat-kill-circulating');
            if (circulatingEl) circulatingEl.innerText = formatValue(circulating);

            // Treasury and max bounty cap — optional elements
            const treasuryEl  = document.getElementById('stat-treasury');
            const maxBountyEl = document.getElementById('stat-max-bounty');
            if (treasuryEl)  treasuryEl.innerText  = `${formatValue(treasury)} KILL`;
            if (maxBountyEl) maxBountyEl.innerText = `${formatValue(maxBounty)} KILL`;
        }

        // --- Activity log ---
        const events = [
            ...spawneds.map(s  => ({ ...s,  type: 'spawn'  })),
            ...killeds.map(k   => ({ ...k,  type: 'kill'   })),
            ...moveds.map(m    => ({ ...m,  type: 'move'   })),
            ...claimeds.map(c  => ({ ...c,  type: 'claim'  })),
        ].sort((a, b) => Number(a.block_number) - Number(b.block_number));

        events.forEach(evt => {
            if (knownIds.has(evt.id)) return;
            const block = evt.block_number;

            if (evt.type === 'spawn') {
                const logMsg = `<span style="color:var(--cyan)">[SPAWN]</span> <span class="log-addr-short">${evt.agent.substring(0, 8)}</span><span class="log-addr-full"><a href="${BLOCK_EXPLORER}/address/${evt.agent}" target="_blank">${evt.agent}</a></span> <span style="opacity:0.5">-></span> STACK_${evt.stackId}`;
                const subMsg = `UNITS: ${formatValue(parseInt(evt.units))} | REAPER: ${formatValue(parseInt(evt.reapers))}`;
                addLog(block, logMsg, 'log-spawn', subMsg);
                triggerPulse(evt.stackId, 'spawn');

            } else if (evt.type === 'kill') {
                // Gross bounties from subgraph; show net (after burn + treasury fee)
                const grossAtk = parseFloat(ethers.formatEther(evt.attackerBounty || "0"));
                const grossDef = parseFloat(ethers.formatEther(evt.defenderBounty || "0"));
                const netAtk   = netBountyDisplay(grossAtk);
                const netDef   = netBountyDisplay(grossDef);

                // Power uses 666x reaper multiplier — combat only, not bounty
                const offPow  = parseInt(evt.attackerUnitsSent  || 0) + parseInt(evt.attackerReaperSent  || 0) * 666;
                const defPow  = parseInt(evt.initialDefenderUnits || 0) + parseInt(evt.initialDefenderReaper || 0) * 666;
                const offLost = parseInt(evt.attackerUnitsLost  || 0) + parseInt(evt.attackerReaperLost  || 0) * 666;
                const defLost = parseInt(evt.targetUnitsLost    || 0) + parseInt(evt.targetReaperLost    || 0) * 666;

                const logMsg = `<span style="color:var(--pink)">[KILL]</span> <span class="log-addr-short">${evt.attacker.substring(0, 6)}</span><span class="log-addr-full"><a href="${BLOCK_EXPLORER}/address/${evt.attacker}" target="_blank">${evt.attacker}</a></span> <span style="opacity:0.5">X</span> STACK_${evt.stackId}`;
                const subMsg = `<div class="kill-table">` +
                    `<div class="kill-row kill-header"><span></span><span>OFFENSE</span><span>DEFENSE</span></div>` +
                    `<div class="kill-row"><span>BATTLE_PWR</span><span>${formatValue(offPow)}</span><span>${formatValue(defPow)}</span></div>` +
                    `<div class="kill-row"><span>LOST_PWR</span><span>${formatValue(offLost)}</span><span>${formatValue(defLost)}</span></div>` +
                    `<div class="kill-row"><span>NET_BOUNTY</span><span>${formatValue(netAtk)}</span><span>${formatValue(netDef)}</span></div>` +
                    `</div>`;
                addLog(block, logMsg, 'log-kill', subMsg, evt.target);
                triggerPulse(evt.stackId, 'kill');

            } else if (evt.type === 'move') {
                const logMsg = `<span style="color:#888">[MOVE]</span> <span class="log-addr-short">${evt.agent.substring(0, 6)}</span><span class="log-addr-full"><a href="${BLOCK_EXPLORER}/address/${evt.agent}" target="_blank">${evt.agent}</a></span> <span style="opacity:0.5">>></span> STACK_${evt.toStack}`;
                const subMsg = `TRANSFERRED: ${formatValue(parseInt(evt.units))} UNITS | ${formatValue(parseInt(evt.reaper))} REAPER`;
                addLog(block, logMsg, 'log-move', subMsg);
                triggerPulse(evt.toStack, 'move');

            } else if (evt.type === 'claim') {
                const logMsg = `<span style="color:#f7931a">[CLAIM]</span> <span class="log-addr-short">${evt.claimer.substring(0, 6)}</span><span class="log-addr-full"><a href="${BLOCK_EXPLORER}/address/${evt.claimer}" target="_blank">${evt.claimer}</a></span> <span style="opacity:0.5">-></span> STACK_${evt.stackId}`;
                const subMsg = `PT1 AIRDROP: ${formatValue(parseInt(evt.units))} UNITS (FREE SPAWN)`;
                addLog(block, logMsg, 'log-spawn', subMsg);
                triggerPulse(evt.stackId, 'spawn');
            }

            knownIds.add(evt.id);
        });

        renderPnL(agents);

    } catch (e) { console.error("Sync fail", e); }
}

/**
 * UI: Render Agent P&L Leaderboard
 */
function renderPnL(agents) {
    if (!pnlEl) return;

    pnlEl.innerHTML = agents.map(a => {
        const spent  = parseFloat(ethers.formatEther(a.totalSpent  || "0"));
        const earned = parseFloat(ethers.formatEther(a.totalEarned || "0"));
        const net    = earned - spent;
        const isFiltered = activeFilterAgent === a.id;
        const claimedBadge = a.airdropClaimed
            ? `<span style="color:#f7931a; font-size:0.55rem; margin-left:3px;" title="PT1 Airdrop Claimed">★</span>`
            : '';

        return `
            <div class="stack-row"
                 onclick="selectAgent('${a.id}')"
                 onmouseover="showLeaderboardTooltip(event, '${a.id}', ${earned}, ${spent}, ${net}, ${a.airdropClaimed})"
                 onmouseout="if(tooltip) tooltip.style.opacity=0"
                 style="display: flex; justify-content: space-between; padding: 2px 0; cursor: pointer; background: ${isFiltered ? 'rgba(0,255,255,0.1)' : 'transparent'};">
                <span style="width:25%; font-family:monospace; color:${isFiltered ? 'var(--cyan)' : '#888'};">
                    ${a.id.substring(0, 8)}${claimedBadge}
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
function showLeaderboardTooltip(e, addr, earned, spent, net, airdropClaimed) {
    if (!tooltip) return;
    const pnlColor = net > 0 ? 'var(--cyan)' : 'var(--pink)';
    tooltip.style.opacity = 1;
    tooltip.style.left = (e.pageX + 15) + 'px';
    tooltip.style.top  = (e.pageY + 15) + 'px';
    tooltip.innerHTML = `
        <div style="padding: 2px; min-width: 200px; font-family: 'Courier New', monospace;">
            <strong style="color:var(--pink); font-size: 0.65rem;">AGENT_IDENTITY</strong><br>
            <span style="font-size:0.7rem; color:var(--cyan); word-break:break-all;">${addr}</span>
            <hr style="border:0; border-top:1px solid #333; margin:8px 0;">
            <div style="display:flex; justify-content:space-between; font-size:0.7rem;"><span>EARNED:</span> <span>${formatValue(earned)}</span></div>
            <div style="display:flex; justify-content:space-between; font-size:0.7rem;"><span>SPENT:</span> <span>${formatValue(spent)}</span></div>
            <div style="display:flex; justify-content:space-between; margin-top:4px; font-weight:bold; color:${pnlColor}; font-size:0.75rem;">
                <span>NET P/L:</span> <span>${net > 0 ? '+' : ''}${formatValue(net)}</span>
            </div>
            ${airdropClaimed ? `<div style="font-size:0.6rem; color:#f7931a; margin-top:4px;">★ PT1 AIRDROP CLAIMED</div>` : ''}
            <div style="font-size: 0.6rem; opacity: 0.5; margin-top: 4px; text-align:center;">CLICK TO FILTER STACKS</div>
        </div>
    `;
}
