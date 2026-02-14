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
 * FIX: Removed vertical pink line (border-left)
 */
function showTooltip(e, id) {
    if (!tooltip) return;
    
    const data = stackRegistry[id] || { units: "0", reaper: "0", birthBlock: "0" };
    const u = parseInt(data.units);
    const r = parseInt(data.reaper);
    const bBlock = parseInt(data.birthBlock);
    
    const age = (lastBlock > 0 && bBlock > 0) ? (lastBlock - bBlock) : 0;
    const bountyMultiplier = (1 + (age / 1000));
    const totalKillValue = (u * bountyMultiplier);

    tooltip.style.opacity = 1;
    tooltip.style.left = (e.pageX + 15) + 'px';
    tooltip.style.top = (e.pageY + 15) + 'px';
    
    tooltip.innerHTML = `
        <div style="padding: 2px;">
            <strong style="color:var(--cyan); letter-spacing:1px;">STACK_${id}</strong><br>
            <span style="opacity:0.6">BIRTH_BLOCK:</span> ${bBlock > 0 ? bBlock : '---'}<br>
            <span style="opacity:0.6">CURRENT_AGE:</span> ${age.toLocaleString()} blocks
            <hr style="border:0; border-top:1px solid #333; margin:8px 0;">
            UNITS: ${u.toLocaleString()}<br>
            REAPERS: ${r}<br>
            <span style="color:var(--cyan)">BOUNTY: ${bountyMultiplier.toFixed(3)}x</span><br>
            <span style="color:var(--pink); font-weight:bold; font-size:0.9rem;">VALUE: ${Math.floor(totalKillValue).toLocaleString()} KILL</span>
            <div style="font-size:0.55rem; color:#666; margin-top:6px; font-style:italic;">
                Calc: Units * (1 + (Age / 1000))
            </div>
        </div>
    `;
}

/**
 * UI: Render the Top Stacks leaderboard rows
 * FIX: Renders 5 columns to match the new static header
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

        stackRegistry[s.id] = { 
            units: s.totalStandardUnits, 
            reaper: r.toString(), 
            birthBlock: s.birthBlock 
        }; 
        
        updateNodeParticles(s.id, s.totalStandardUnits, r);

        return { id: s.id, units: u, reapers: r, bounty: multiplier, kill: totalKillValue };
    });

    currentGlobalKillStacked = globalBountyKill;

    if(totalUnitsActiveEl) totalUnitsActiveEl.innerText = globalUnits.toLocaleString();
    if(totalReapersActiveEl) totalReapersActiveEl.innerText = globalReapers.toLocaleString();
    if(totalKillBountyEl) totalKillBountyEl.innerText = `${Math.floor(globalBountyKill).toLocaleString()}`;

    const sorted = processed
        .filter(s => s.units > 0 || s.reapers > 0)
        .sort((a, b) => b.kill - a.kill);

    if (sorted.length === 0) {
        topStacksEl.innerHTML = '<div style="font-size:0.7rem; color:#444; padding:10px;">ARENA EMPTY...</div>';
        return;
    }

    // Generate rows ONLY (No duplicate header)
    topStacksEl.innerHTML = sorted.map(item => `
        <div class="stack-row" onmouseover="showTooltip(event, '${item.id}')" onmouseout="if(tooltip) tooltip.style.opacity=0" style="display: flex; justify-content: space-between; border-bottom: 1px solid #111; padding: 4px 0;">
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
        // Query updated to match your schema exactly:
        // 1. Moved: Changed 'amount' to 'units'
        // 2. Killed: Added 'targetUnitsLost' (matches schema)
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
        
        if (result.errors) {
            console.error("GraphQL Schema Mismatch:", result.errors);
            return;
        }

        if (!result || !result.data) {
            console.error("Subgraph data return is null or malformed");
            return;
        }

        const { globalStat, killeds = [], spawneds = [], moveds = [], stacks = [], agents = [] } = result.data;
        
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
            ...killeds.map(k => ({...k, type: 'kill'})),
            ...moveds.map(m => ({...m, type: 'move'}))
        ].sort((a, b) => Number(a.block_number) - Number(b.block_number));

        events.forEach(evt => {
            const addr = (evt.type === 'kill') ? evt.attacker : evt.agent;
            
            if (addr && !agentPnL[addr]) {
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
                } else if (evt.type === 'move') {
                    // Logic mapped to schema: using 'units' and 'toStack'
                    addLog(evt.block_number, `[MOVE] ${evt.agent.substring(0,6)} shifted ${evt.units} to STACK_${evt.toStack}`, 'log-move');
                    triggerPulse(evt.toStack, 'spawn'); 
                }
                knownIds.add(evt.id);
            }
        });

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
 * FIX: Using DocumentFragment and explicit loop to ensure all elements append.
 */
function renderPnL(agents) {
    if (!pnlEl) return;
    
    // Clear the container completely
    pnlEl.innerHTML = '';

    if (!agents || agents.length === 0) {
        pnlEl.innerHTML = '<div style="color:#444; padding:10px;">AWAITING DATA...</div>';
        return;
    }

    // 1. Sort the raw data first
    const sortedAgents = [...agents].sort((a, b) => {
        const netA = (parseFloat(a.totalEarned || 0) / 1e18) - parseFloat(a.totalSpent || 0);
        const netB = (parseFloat(b.totalEarned || 0) / 1e18) - parseFloat(b.totalSpent || 0);
        return netB - netA;
    }).slice(0, 5); // Limit to top 5

    // 2. Create Header
    const header = document.createElement('div');
    header.className = 'rank-item';
    header.style.cssText = "opacity:0.5; font-size:0.5rem; border-bottom:1px solid #333; margin-bottom:8px; display:flex; width:100%;";
    header.innerHTML = `
        <span style="flex:1.5">AGENT</span>
        <span style="flex:1; text-align:right;">EARNED</span>
        <span style="flex:1; text-align:right;">SPENT</span>
        <span style="flex:1; text-align:right;">NET P/L</span>
    `;
    pnlEl.appendChild(header);

    // 3. Create Rows using a Fragment for performance and reliability
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < sortedAgents.length; i++) {
        const a = sortedAgents[i];
        const spent = parseFloat(a.totalSpent || 0);
        const earned = parseFloat(a.totalEarned || 0) / 1e18;
        const net = earned - spent;
        const pnlColor = net >= 0 ? 'var(--cyan)' : 'var(--pink)';

        const row = document.createElement('div');
        row.className = 'rank-item';
        // Ensure the row is visible and has layout
        row.style.cssText = "display:flex; width:100%; min-height:20px; align-items:center; margin-bottom:4px;";
        
        row.onmouseover = (e) => showAddrTooltip(e, a.id);
        row.onmouseout = () => { if(tooltip) tooltip.style.opacity = 0; };

        row.innerHTML = `
            <span class="rank-addr" style="flex:1.5; font-family:monospace;">${a.id.substring(0, 8)}</span>
            <span style="flex:1; text-align:right;">${formatValue(earned)}</span>
            <span style="flex:1; text-align:right; opacity:0.6;">${formatValue(spent)}</span>
            <span style="flex:1; text-align:right; color:${pnlColor}; font-weight:bold;">
                ${net > 0 ? '+' : ''}${formatValue(net)}
            </span>
        `;
        fragment.appendChild(row);
    }

    pnlEl.appendChild(fragment);
    
    // Debug check: log how many rows were actually added
    console.log(`Leaderboard rendered with ${sortedAgents.length} agents.`);
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