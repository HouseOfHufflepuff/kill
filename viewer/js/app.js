/**
 * KILL SYSTEM CORE - PRODUCTION v1.0.1
 * TARGET: BASE SEPOLIA TESTNET
 * * This file manages the 3D battlefield visualization, GraphQL synchronization,
 * and real-time P&L tracking for the KILL Game.
 */

// --- CONFIGURATION CONSTANTS ---
const NETWORK = "Base Sepolia";
const ALCHEMY_URL = "https://base-sepolia.g.alchemy.com/v2/nnFLqX2LjPIlLmGBWsr2I5voBfb-6-Gs";
const SUBGRAPH_URL = "https://api.goldsky.com/api/public/project_cmlgypvyy520901u8f5821f19/subgraphs/kill-testnet-subgraph/1.0.1/gn";
const KILL_TOKEN_ADDR = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const KILL_GAME_ADDR = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const REAPER_SPAWN_COST = 1000;

// --- ETHER INTERFACE ---
const provider = new ethers.JsonRpcProvider(ALCHEMY_URL);

// --- DOM ELEMENT REGISTRY ---
const battleField = document.getElementById('battle-stack');
const pnlEl = document.getElementById('leaderboard'); 
const logFeed = document.getElementById('log-feed');
const topStacksEl = document.getElementById('ripe-stacks');
const headerBlock = document.getElementById('header-block');
const networkLabel = document.getElementById('network-label');
const tooltip = document.getElementById('tooltip');
const agentModal = document.getElementById('agent-modal');
const unitsKilledEl = document.getElementById('stat-units-killed');
const reaperKilledEl = document.getElementById('stat-reaper-killed');
const killBurnedEl = document.getElementById('stat-kill-burned');
const statusEl = document.getElementById('system-status');
const totalUnitsActiveEl = document.getElementById('total-units-active');
const totalReapersActiveEl = document.getElementById('total-reapers-active');
const totalKillBountyEl = document.getElementById('total-kill-bounty');

// --- STATE MANAGEMENT ---
let knownIds = new Set();
let agentPnL = {}; // Structure: { addr: { spent: 0, earned: 0 } }
let lastBlock = 0;
let syncCounter = 2;
let stackRegistry = {}; 
let currentGlobalKillStacked = 0;
let isDragging = false, startX, startY, rotateX = 60, rotateZ = -45;

/**
 * UTILITY: Format numbers for UI display
 */
const formatValue = (val) => {
    return Math.floor(val).toLocaleString();
};

/**
 * INITIALIZATION: Setup UI Labels
 */
if (networkLabel) networkLabel.innerText = NETWORK.toUpperCase();
document.querySelectorAll('.net-var').forEach(el => el.innerText = NETWORK);

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
 * VISUALIZATION: Toggle layer visibility
 */
function toggleLayer(idx) {
    const layers = document.querySelectorAll('.layer');
    if (layers[idx]) {
        layers[idx].classList.toggle('hidden');
    }
}

/**
 * VISUALIZATION: Initialize 3D Node Grid
 */
function initBattlefield() {
    if (!battleField) return;
    battleField.innerHTML = ''; 
    
    // Create 6 depth layers for the 3D stack
    for (let l = 0; l < 6; l++) {
        const layer = document.createElement('div');
        layer.className = 'layer';
        layer.dataset.layerIndex = l;
        layer.style.transform = `translateZ(${l * 45}px)`;
        
        // Populate each layer with a 6x6 grid (36 nodes)
        for (let i = 0; i < 36; i++) {
            const stackId = (l * 36) + i;
            const node = document.createElement('div');
            node.className = 'node';
            node.id = `node-${stackId}`;
            node.dataset.id = stackId;
            
            node.onmouseover = (e) => showTooltip(e, stackId);
            node.onmouseout = () => {
                if (tooltip) tooltip.style.opacity = 0;
            };
            
            layer.appendChild(node);
        }
        battleField.appendChild(layer);
    }
}

/**
 * VISUALIZATION: Manage particle density based on node data
 */
function updateNodeParticles(id, units, reaperCount) {
    const node = document.getElementById(`node-${id}`);
    if (!node) return;
    
    // Calculate targets for unit and reaper visuals
    const targetUnitDots = Math.min(Math.floor(units / 1000), 40);
    const targetReaperDots = Math.min(reaperCount, 40); 
    
    syncParticleGroup(node, 'unit', targetUnitDots);
    syncParticleGroup(node, 'reaper', targetReaperDots);
}

/**
 * VISUALIZATION: Synchronize particle counts for a specific type
 */
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

/**
 * VISUALIZATION: Create an individual DOM particle
 */
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

/**
 * VISUALIZATION: Trigger a pulse animation on a node
 */
function triggerPulse(id, type) {
    const node = document.getElementById(`node-${id}`);
    if (!node) return;
    
    const pulseClass = (type === 'kill') ? 'pulse-kill' : 'pulse-cyan';
    node.classList.remove('pulse-kill', 'pulse-cyan');
    
    // Reflow to restart animation
    void node.offsetWidth; 
    node.classList.add(pulseClass);
}

/**
 * UI: Show contextual information for a stack node
 */
function showTooltip(e, id) {
    if (!tooltip) return;
    
    const data = stackRegistry[id] || { units: "0", reaper: "0", birthBlock: "0" };
    const u = parseInt(data.units);
    const r = parseInt(data.reaper);
    const age = (lastBlock > 0 && data.birthBlock !== "0") ? (lastBlock - parseInt(data.birthBlock)) : 0;
    
    // Bounty logic calculation
    const bountyMultiplier = (1 + (age / 1000));
    const killOnStack = (u * bountyMultiplier);

    tooltip.style.opacity = 1;
    tooltip.style.left = (e.pageX + 15) + 'px';
    tooltip.style.top = (e.pageY + 15) + 'px';
    tooltip.innerHTML = `
        <strong style="color:var(--cyan)">STACK_${id}</strong><br>
        UNITS: ${u.toLocaleString()}<br>
        REAPER COUNT: ${r}<br>
        <hr style="border:0; border-top:1px solid #333; margin:5px 0;">
        <span style="color:var(--pink)">KILL VALUE: ${killOnStack.toLocaleString(undefined, {maximumFractionDigits: 2})}</span><br>
        <div style="font-size:0.6rem; color:#888; margin-top:4px;">Mult: ${bountyMultiplier.toFixed(2)}x // Age: ${age}</div>
    `;
}

/**
 * UI: Render the Top Stacks leaderboard
 */
function updateTopStacks(stacks, activeReaperMap) {
    let globalUnits = 0, globalReapers = 0, globalBountyKill = 0;

    const processed = stacks.map(s => {
        const u = parseInt(s.totalStandardUnits);
        const r = activeReaperMap[s.id] || parseInt(s.totalBoostedUnits) || 0;
        const age = (lastBlock > 0) ? (lastBlock - parseInt(s.birthBlock)) : 0;
        const multiplier = (1 + (age / 1000));
        const totalKillValue = u * multiplier;

        globalUnits += u; 
        globalReapers += r; 
        globalBountyKill += totalKillValue;

        // Sync local registry for tooltip access
        stackRegistry[s.id] = { units: s.totalStandardUnits, reaper: r.toString(), birthBlock: s.birthBlock }; 
        updateNodeParticles(s.id, s.totalStandardUnits, r);

        return { id: s.id, units: u, reapers: r, kill: totalKillValue };
    });

    currentGlobalKillStacked = globalBountyKill;

    // Update Global Statistics
    if(totalUnitsActiveEl) totalUnitsActiveEl.innerText = globalUnits.toLocaleString();
    if(totalReapersActiveEl) totalReapersActiveEl.innerText = globalReapers.toLocaleString();
    if(totalKillBountyEl) totalKillBountyEl.innerText = `${Math.floor(globalBountyKill).toLocaleString()}`;

    const sorted = processed
        .filter(s => s.units > 0 || s.reapers > 0)
        .sort((a, b) => b.kill - a.kill);

    if (!topStacksEl) return;

    if (sorted.length === 0) {
        topStacksEl.innerHTML = '<div style="font-size:0.7rem; color:#444; padding:10px;">ARENA EMPTY...</div>';
        return;
    }

    const header = `
        <div class="stack-row header-row" style="opacity:0.6; font-size:0.55rem; border-bottom:1px solid #222; margin-bottom:4px;">
            <span style="width:15%">ID</span>
            <span style="width:35%">UNITS</span>
            <span style="width:15%">R</span>
            <span style="width:35%; text-align:right;">KILL</span>
        </div>
    `;

    topStacksEl.innerHTML = header + sorted.map(item => `
        <div class="stack-row" style="font-size:0.75rem;">
            <span style="width:15%">${item.id}</span>
            <span style="width:35%">${Math.floor(item.units / 1000)}K</span>
            <span style="width:15%; color:var(--cyan)">${item.reapers}</span>
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
        // --- NEW UPDATED GRAPHQL CALL ---
        // Includes detailed stack metadata and entity filtering
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
        if (!result || !result.data) {
            console.error("Subgraph data return is null or malformed");
            return;
        }

        const { globalStat, killeds = [], spawneds = [], stacks = [], agents = [] } = result.data;
        console.log(agents);
        
        // --- LOGIC: Track Active Reapers ---
        const killedStackIds = new Set(killeds.map(k => k.stackId.toString()));
        const activeReaperMap = {};
        
        spawneds.forEach(s => {
            if (!killedStackIds.has(s.stackId.toString())) {
                activeReaperMap[s.stackId] = (activeReaperMap[s.stackId] || 0) + 1;
            }
        });

        // --- UI: Update Lethal Status ---
        if (statusEl) {
            statusEl.innerHTML = killeds.length > 0 ? 
                '<span class="lethal-dot"></span>SYSTEM STATUS: LETHAL' : 
                'SYSTEM STATUS: OPERATIONAL';
        }
        
        // --- UI: Update Global Stats ---
        if (globalStat) {
            if (unitsKilledEl) unitsKilledEl.innerText = parseInt(globalStat.totalUnitsKilled).toLocaleString();
            if (reaperKilledEl) reaperKilledEl.innerText = parseInt(globalStat.totalReaperKilled).toLocaleString();
            
            const burned = ethers.formatEther(globalStat.killBurned || "0");
            if (killBurnedEl) {
                killBurnedEl.innerText = `${parseFloat(burned).toLocaleString(undefined, {minimumFractionDigits: 3})} KILL`;
            }
        }

        updateTopStacks(stacks, activeReaperMap);

        // --- P&L LOGIC: Event Processing ---
        const events = [
            ...spawneds.map(s => ({...s, type: 'spawn'})), 
            ...killeds.map(k => ({...k, type: 'kill'}))
        ];

        events.forEach(evt => {
            const addr = evt.type === 'spawn' ? evt.agent : evt.attacker;
            
            if (!agentPnL[addr]) {
                agentPnL[addr] = { spent: 0, earned: 0 };
            }

            if (!knownIds.has(evt.id)) {
                if (evt.type === 'spawn') {
                    agentPnL[addr].spent += Number(REAPER_SPAWN_COST);
                    addLog(evt.block_number, `[SPAWN] ${evt.agent.substring(0,6)}`, 'log-spawn');
                    triggerPulse(evt.stackId, 'spawn');
                } else if (evt.type === 'kill') {
                    const amount = parseInt(evt.targetUnitsLost);
                    agentPnL[addr].earned += amount;
                    addLog(evt.block_number, `[KILL] ${evt.attacker.substring(0,6)} reaped ${amount}`, 'log-kill');
                    triggerPulse(evt.stackId, 'kill');
                }
                knownIds.add(evt.id);
            }
        });

        updateTopStacks(stacks, activeReaperMap);
        renderPnL(agents);

    } catch (e) { 
        console.error("Subgraph sync fail", e); 
        addLog(lastBlock, "DATA SYNC ERROR - CHECK CONSOLE", "log-kill");
    }
}

/**
 * UI: Add entry to the system log feed
 */
function addLog(blockNum, msg, className) {
    if (!logFeed) return;
    const entry = document.createElement('div');
    entry.className = `log-entry ${className}`;
    entry.innerHTML = `<span class="log-block">${blockNum}</span> > ${msg}`;
    logFeed.appendChild(entry);
    
    // Maintain rolling log limit
    if (logFeed.childNodes.length > 50) {
        logFeed.removeChild(logFeed.firstChild);
    }
    logFeed.scrollTop = logFeed.scrollHeight;
}

/**
 * UI: Render Agent P&L Leaderboard
 */
function renderPnL(agents) {
    if (!pnlEl || !agents) return;

    // Calculate P&L from raw fields and sort descending by Net
    const sorted = agents.map(a => {
        const spent = parseFloat(a.totalSpent || 0);
        // Divide by 1e18 to handle the Wei earned value (e.g. 192008... becomes 192008.91)
        const earned = parseFloat(a.totalEarned || 0) / 1e18; 
        return {
            id: a.id,
            spent: spent,
            earned: earned,
            net: earned - spent
        };
    }).sort((a, b) => b.net - a.net);

    pnlEl.innerHTML = `
        <div class="rank-item" style="opacity:0.6; font-size:0.55rem; border-bottom:1px solid #444; margin-bottom:5px;">
            <span>AGENT</span>
            <span style="text-align:right;">PROFIT</span>
            <span style="text-align:right;">COST</span>
            <span style="text-align:right;">P/L</span>
        </div>
    ` + sorted.map(item => {
        const pnlColor = item.net >= 0 ? 'var(--cyan)' : 'var(--pink)';
        return `
            <div class="rank-item" onmouseover="showAddrTooltip(event, '${item.id}')" onmouseout="tooltip.style.opacity=0">
                <span class="rank-addr">${item.id.substring(0,8)}</span>
                <span class="rank-val rank-profit">${formatValue(item.earned)}</span>
                <span class="rank-val rank-cost">${formatValue(item.spent)}</span>
                <span class="rank-val rank-pnl" style="color:${pnlColor}">${item.net > 0 ? '+' : ''}${formatValue(item.net)}</span>
            </div>
        `;
    }).join('');
}
/**
 * UI: Tooltip for full address hover
 */
function showAddrTooltip(e, addr) {
    if (!tooltip) return;
    tooltip.style.opacity = 1; 
    tooltip.style.left = (e.pageX + 15) + 'px'; 
    tooltip.style.top = (e.pageY + 15) + 'px';
    tooltip.innerHTML = `
        <span style="color:var(--pink)">FULL ADDR:</span><br>
        <span style="font-size:0.6rem;">${addr}</span>
    `;
}

/**
 * UI: Modal Management
 */
function toggleModal(show) { 
    if (agentModal) agentModal.style.display = show ? 'flex' : 'none'; 
}

window.addEventListener('click', (e) => { 
    if (e.target === agentModal) toggleModal(false); 
});

/**
 * UI: Copy to clipboard utility
 */
function copyCommand() {
    const cmd = document.getElementById('curl-cmd');
    if (!cmd) return;
    
    navigator.clipboard.writeText(cmd.innerText);
    const btn = document.querySelector('.btn-copy');
    if (btn) {
        btn.innerText = 'COPIED';
        setTimeout(() => btn.innerText = 'COPY', 2000);
    }
}

/**
 * UI: Log clear utility
 */
function clearLog() { 
    if (logFeed) logFeed.innerHTML = ''; 
    knownIds.clear(); 
    addLog(lastBlock, "SYSTEM LOG PURGED", "log-network");
}

/**
 * CAMERA: 3D Battlefield Controls
 */
window.onmousedown = (e) => {
    // Avoid dragging when clicking UI elements
    const isUI = e.target.className === 'node' || 
                 e.target.closest('.panel') || 
                 e.target.closest('.modal-content') || 
                 e.target.closest('.layer-controls');
                 
    if (isUI) return;
    
    isDragging = true; 
    startX = e.clientX; 
    startY = e.clientY;
};

window.onmouseup = () => { isDragging = false; };

window.onmousemove = (e) => {
    if (!isDragging || !battleField) return;
    
    // Calculate rotation movement
    rotateZ += (e.clientX - startX) * 0.5; 
    rotateX -= (e.clientY - startY) * 0.5;
    
    battleField.style.transform = `rotateX(${rotateX}deg) rotateZ(${rotateZ}deg)`;
    
    startX = e.clientX; 
    startY = e.clientY;
};

// --- STARTUP SEQUENCING ---

// Refresh every second; sync every 3 seconds (syncCounter reset)
setInterval(() => { 
    syncCounter--; 
    if(syncCounter < 0) { 
        syncCounter = 2; 
        syncData(); 
    } 
}, 1000);

// Run initial boot sequence
initBattlefield(); 
syncData();

/**
 * DEBUG CONSOLE LOG: Verification
 */
console.log(`KILL AGENT MODULE INITIALIZED: ${NETWORK}`);