/**
 * KILL SYSTEM CORE - engine.js
 */

// --- GLOBAL CONFIGURATION ---
const NETWORK = "Base Sepolia";
const ALCHEMY_URL = "https://base-sepolia.g.alchemy.com/v2/nnFLqX2LjPIlLmGBWsr2I5voBfb-6-Gs";
const SUBGRAPH_URL = "https://api.goldsky.com/api/public/project_cmlgypvyy520901u8f5821f19/subgraphs/kill-testnet-subgraph/1.0.2/gn";
const BLOCK_EXPLORER = "https://sepolia.basescan.org";

// --- DOM ELEMENT REGISTRY ---
const battleField = document.getElementById('battle-stack');
const pnlEl = document.getElementById('leaderboard'); 
const logFeed = document.getElementById('log-feed');
const topStacksEl = document.getElementById('ripe-stacks');
const headerBlock = document.getElementById('header-block');
const networkLabel = document.getElementById('network-label');
const tooltip = document.getElementById('tooltip');
const agentModal = document.getElementById('agent-modal');
const aboutModal = document.getElementById('about-modal'); 
const unitsKilledEl = document.getElementById('stat-units-killed');
const reaperKilledEl = document.getElementById('stat-reaper-killed');
const killBurnedEl = document.getElementById('stat-kill-burned');
const statusEl = document.getElementById('system-status');
const totalUnitsActiveEl = document.getElementById('total-units-active');
const totalReapersActiveEl = document.getElementById('total-reapers-active');
const totalKillBountyEl = document.getElementById('total-kill-bounty');
const gameProfitEl = document.getElementById('stat-game-profit');
const gameCostEl = document.getElementById('stat-game-cost');
const gamePnlEl = document.getElementById('stat-game-pnl');
const opBestEl = document.getElementById('op-best');
const opPnlEl = document.getElementById('op-pnl');
const opAgentEl = document.getElementById('op-agent');

function toggleModal(show) {
    if (agentModal) agentModal.style.display = show ? 'flex' : 'none';
}

function toggleAboutModal(show) {
    if (aboutModal) aboutModal.style.display = show ? 'flex' : 'none';
}

function openRosterModal() {
    const m = document.getElementById('roster-modal');
    if (m) m.style.display = 'flex';
}

function closeRosterModal() {
    const m = document.getElementById('roster-modal');
    if (m) m.style.display = 'none';
}

function chooseAgent() {
    closeRosterModal();
    toggleModal(true);
}

function toggleHelp() {
    document.body.classList.toggle('help-mode');
    const pill  = document.getElementById('help-pill');
    const label = document.getElementById('help-label');
    const isOn  = document.body.classList.contains('help-mode');
    if (pill)  pill.classList.toggle('on', isOn);
    if (label) label.innerText = isOn ? 'ON' : 'OFF';
}

window.onclick = function(event) {
    if (event.target == agentModal) toggleModal(false);
    if (event.target == aboutModal) toggleAboutModal(false);
    const rosterModal = document.getElementById('roster-modal');
    if (event.target == rosterModal) closeRosterModal();
};

function copyCommand(id, btn) {
    const cmd = document.getElementById(id);
    if (!cmd) return;
    navigator.clipboard.writeText(cmd.innerText);
    if (btn) {
        btn.innerText = 'COPIED';
        setTimeout(() => btn.innerText = 'COPY', 2000);
    }
}

function switchOS(os) {
    const isMac = os === 'mac';
    document.getElementById('cmd-mac').style.display          = isMac ? 'flex' : 'none';
    document.getElementById('cmd-win').style.display          = isMac ? 'none' : 'flex';
    document.getElementById('step-execute-mac').style.display = isMac ? '' : 'none';
    document.getElementById('step-execute-win').style.display = isMac ? 'none' : '';
    document.getElementById('os-mac').classList.toggle('active', isMac);
    document.getElementById('os-win').classList.toggle('active', !isMac);
}

function updateSystemStatus(totalStacked) {
    if (!statusEl) return;
    let statusText = "OPERATIONAL";
    if (totalStacked >= 20000000) statusText = "LETHAL";
    else if (totalStacked >= 15000000) statusText = "CRITICAL";
    else if (totalStacked >= 10000000) statusText = "VOLATILE";
    else if (totalStacked >= 5000000)  statusText = "ACTIVE";
    else if (totalStacked > 0)        statusText = "STABLE";
    const dot = (totalStacked >= 20000000) ? '<span class="lethal-dot"></span>' : '';
    statusEl.innerHTML = `${dot}SYSTEM STATUS: ${statusText}`;
}

function toggleLayer(idx) {
    const layers = document.querySelectorAll('.layer');
    if (layers[idx]) layers[idx].classList.toggle('hidden');
}

function initBattlefield() {
    if (!battleField) return;
    battleField.innerHTML = ''; 
    for (let l = 0; l < 6; l++) {
        const layer = document.createElement('div');
        layer.className = 'layer';
        layer.dataset.layerIndex = l;
        layer.style.transform = `translateZ(${l * 45}px)`;
        for (let i = 0; i < 36; i++) {
            const stackId = (l * 36) + i;
            const node = document.createElement('div');
            node.className = 'node';
            node.id = `node-${stackId}`;
            node.dataset.id = stackId;
            node.onmouseover = (e) => showTooltip(e, stackId);
            node.onmouseout = () => { if (tooltip) tooltip.style.opacity = 0; };
            layer.appendChild(node);
        }
        battleField.appendChild(layer);
    }
}

/**
 * VISUALIZATION: Manage particle density
 */
function updateNodeParticles(id, units, reaperCount) {
    const node = document.getElementById(`node-${id}`);
    if (!node) return;
    
    const targetUnitDots = Math.min(Math.floor(units / 1332), 20);
    const targetReaperDots = Math.min(Math.floor(reaperCount / 2), 20);
    
    if (selectedStacks.size > 0) {
        const isSelected = selectedStacks.has(String(id));
        node.style.opacity = isSelected ? '1' : '0.05';
        node.style.borderColor = isSelected ? 'var(--pink)' : '#111';
        node.style.boxShadow = isSelected ? '0 0 12px rgba(255,45,117,0.5)' : 'none';
    } else if (activeFilterAgent && (units > 0 || reaperCount > 0)) {
        node.style.opacity = '1';
        node.style.boxShadow = "0 0 10px var(--cyan)";
        node.style.borderColor = "var(--cyan)";
    } else if (activeFilterAgent) {
        node.style.opacity = '1';
        node.style.boxShadow = "none";
        node.style.borderColor = "#111";
    } else {
        node.style.opacity = '1';
        node.style.boxShadow = "none";
        node.style.borderColor = (units > 0 || reaperCount > 0) ? "#333" : "#111";
    }

    syncParticleGroup(node, 'unit', targetUnitDots);
    syncParticleGroup(node, 'reaper', targetReaperDots);
}

function syncParticleGroup(node, type, targetCount) {
    const existing = node.querySelectorAll(`.particle.${type}`);
    if (existing.length < targetCount) {
        const frag = document.createDocumentFragment();
        for (let i = 0; i < (targetCount - existing.length); i++) {
            frag.appendChild(createParticle(type));
        }
        node.appendChild(frag);
    } else if (existing.length > targetCount) {
        for (let i = 0; i < (existing.length - targetCount); i++) {
            if (existing[i]) existing[i].remove();
        }
    }
}

function createParticle(type) {
    const p = document.createElement('div');
    p.className = `particle ${type}`;
    const x = Math.random() * 80 + 10;
    const y = Math.random() * 80 + 10;
    const zOffsets = [0, 8, 16];
    const z = zOffsets[Math.floor(Math.random() * zOffsets.length)];
    p.style.left = `${x}%`;
    p.style.top = `${y}%`;
    p.style.transform = `translateZ(${z}px)`;
    return p;
}

function triggerPulse(id, type) {
    const node = document.getElementById(`node-${id}`);
    if (!node) return;
    let pulseClass;
    if (type === 'kill')  pulseClass = 'pulse-kill';
    else if (type === 'move') pulseClass = 'pulse-white';
    else pulseClass = 'pulse-cyan'; // spawn
    node.classList.remove('pulse-kill', 'pulse-cyan', 'pulse-white');
    void node.offsetWidth;
    node.classList.add(pulseClass);
}

function showTooltip(e, id) {
    if (!tooltip) return;
    const data = stackRegistry[id] || { units: "0", reaper: "0", birthBlock: "0" };
    const u = parseInt(data.units);
    const r = parseInt(data.reaper);
    const bBlock = parseInt(data.birthBlock);
    const age = (lastBlock > 0 && bBlock > 0) ? (lastBlock - bBlock) : 0;
    const bountyMultiplier = (1 + (age / 1000));
    const basePower = u + (r * 666);
    const totalKillValue = basePower * bountyMultiplier;

    tooltip.style.opacity = 1;
    tooltip.style.left = (e.pageX + 15) + 'px';
    tooltip.style.top = (e.pageY + 15) + 'px';
    
    const filterHeader = activeFilterAgent ? `<div style="color:var(--cyan); font-weight:bold; margin-bottom:4px;">AGENT: ${activeFilterAgent.substring(0,8)}</div>` : '';

    tooltip.innerHTML = `
        <div style="padding: 2px; font-family: monospace; font-size: 0.75rem; line-height: 1.2;">
            ${filterHeader}
            <strong style="color:var(--cyan); letter-spacing:1px;">STACK_${id}</strong><br>
            <span style="opacity:0.6">BIRTH_BLOCK:</span> ${bBlock > 0 ? bBlock : '---'}<br>
            <hr style="border:0; border-top:1px solid #333; margin:6px 0;">
            UNITS: ${u.toLocaleString()}<br>
            REAPER: ${r}<br>
            <span style="opacity:0.6">BASE_POWER:</span> ${basePower.toLocaleString()}<br>
            <span style="color:var(--cyan)">BOUNTY: ${bountyMultiplier.toFixed(3)}x</span><br>
            <div style="border-top:1px solid #333; margin-top:4px; padding-top:4px;">
                <span style="color:var(--pink); font-weight:bold; font-size:0.85rem;">VALUE: ${Math.floor(totalKillValue).toLocaleString()} KILL</span>
            </div>
        </div>
    `;
}

function toggleLogExpand() {
    const panel = document.getElementById('right-panel');
    const btn = document.getElementById('btn-log-expand');
    const filterEl = document.getElementById('log-filter');
    const isExpanded = panel.classList.toggle('log-panel-expanded');
    if (btn) btn.innerHTML = isExpanded ? '⤡' : '⛶';
    if (filterEl) {
        filterEl.style.display = isExpanded ? 'block' : 'none';
        if (!isExpanded) { filterEl.value = ''; filterLog(''); }
        else { filterEl.focus(); }
    }
}

function filterLog(val) {
    const q = val.toLowerCase().trim();
    document.querySelectorAll('#log-feed .log-entry').forEach(entry => {
        entry.style.display = (!q || (entry.dataset.search || '').includes(q)) ? '' : 'none';
    });
}

function toggleLogPause() {
    isLogPaused = !isLogPaused;
    const btn = document.getElementById('btn-log-pause');
    if (btn) btn.innerText = isLogPaused ? 'RESUME' : 'PAUSE';
}

function addLog(blockNum, msg, className, subMsg = null, searchKey = '') {
    if (!logFeed || isLogPaused) return;
    const entry = document.createElement('div');
    entry.className = `log-entry ${className}`;
    let innerHTML = `<span class="log-block">${blockNum}</span> > ${msg}`;
    if (subMsg) {
        innerHTML += `<div class="log-subtext" style="font-size:0.65rem; opacity:0.7; border-left: 1px solid currentColor; margin: 4px 0 2px 42px; padding-left: 8px; font-family:monospace; white-space:pre-wrap;">${subMsg}</div>`;
    }
    entry.innerHTML = innerHTML;
    entry.dataset.search = (entry.textContent + ' ' + searchKey).toLowerCase();
    logFeed.appendChild(entry);
    if (logFeed.childNodes.length > 50) logFeed.removeChild(logFeed.firstChild);
    logFeed.scrollTop = logFeed.scrollHeight;
}

function clearLog() { 
    if (logFeed) logFeed.innerHTML = ''; 
    knownIds.clear(); 
    addLog(lastBlock, "SYSTEM LOG PURGED", "log-network");
}

function clearAgentFilter() {
    if (activeFilterAgent) {
        activeFilterAgent = null;
        addLog(lastBlock, "AGENT FILTER CLEARED", "log-network");
        syncData();
    }
}

function toggleStackFilter(id) {
    const sid = String(id);
    if (selectedStacks.has(sid)) {
        selectedStacks.delete(sid);
    } else {
        selectedStacks.add(sid);
    }
    const row = document.getElementById(`stack-filter-row-${id}`);
    if (row) row.classList.toggle('stack-row-selected', selectedStacks.has(sid));
    applyStackFilter();
}

function applyStackFilter() {
    for (let i = 0; i < 216; i++) {
        const node = document.getElementById(`node-${i}`);
        if (!node) continue;
        if (selectedStacks.size === 0) {
            node.style.opacity = '1';
            const data = stackRegistry[i] || {};
            const hasContent = (parseInt(data.units) > 0 || parseInt(data.reaper) > 0);
            node.style.borderColor = hasContent ? '#333' : '#111';
            node.style.boxShadow = 'none';
        } else if (selectedStacks.has(String(i))) {
            node.style.opacity = '1';
            node.style.borderColor = 'var(--pink)';
            node.style.boxShadow = '0 0 12px rgba(255,45,117,0.5)';
        } else {
            node.style.opacity = '0.05';
            node.style.borderColor = '#111';
            node.style.boxShadow = 'none';
        }
    }
}

function clearStackFilter() {
    selectedStacks.clear();
    document.querySelectorAll('.stack-row-selected').forEach(row => row.classList.remove('stack-row-selected'));
    applyStackFilter();
}