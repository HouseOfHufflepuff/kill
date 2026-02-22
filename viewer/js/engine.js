/**
 * KILL SYSTEM CORE - engine.js
 */

// --- GLOBAL CONFIGURATION (Moved here for cross-file access) ---
const NETWORK = "Base Sepolia";
const ALCHEMY_URL = "https://base-sepolia.g.alchemy.com/v2/nnFLqX2LjPIlLmGBWsr2I5voBfb-6-Gs";
const SUBGRAPH_URL = "https://api.goldsky.com/api/public/project_cmlgypvyy520901u8f5821f19/subgraphs/kill-testnet-subgraph/1.0.1/gn";
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
    
    void node.offsetWidth; 
    node.classList.add(pulseClass);
}

/**
 * UI: Show contextual information for a stack node
 * UPDATED: Aligned with contract logic (Base Power + Age Bounty)
 */
function showTooltip(e, id) {
    if (!tooltip) return;
    
    const data = stackRegistry[id] || { units: "0", reaper: "0", birthBlock: "0" };
    const u = parseInt(data.units);
    const r = parseInt(data.reaper);
    const bBlock = parseInt(data.birthBlock);
    
    // Formula: 1 + (Age / 1000)
    const age = (lastBlock > 0 && bBlock > 0) ? (lastBlock - bBlock) : 0;
    const bountyMultiplier = (1 + (age / 1000));
    
    // Base Power: Standard Units + (Reapers * 666)
    const basePower = u + (r * 666);
    const totalKillValue = basePower * bountyMultiplier;

    tooltip.style.opacity = 1;
    tooltip.style.left = (e.pageX + 15) + 'px';
    tooltip.style.top = (e.pageY + 15) + 'px';
    
    tooltip.innerHTML = `
        <div style="padding: 2px; font-family: monospace; font-size: 0.75rem; line-height: 1.2;">
            <strong style="color:var(--cyan); letter-spacing:1px;">STACK_${id}</strong><br>
            <span style="opacity:0.6">BIRTH_BLOCK:</span> ${bBlock > 0 ? bBlock : '---'}<br>
            <span style="opacity:0.6">CURRENT_AGE:</span> ${age.toLocaleString()} blocks
            <hr style="border:0; border-top:1px solid #333; margin:6px 0;">
            UNITS: ${u.toLocaleString()}<br>
            REAPER: ${r}<br>
            <span style="opacity:0.6">BASE_POWER:</span> ${basePower.toLocaleString()}<br>
            <span style="color:var(--cyan)">BOUNTY: ${bountyMultiplier.toFixed(3)}x</span><br>
            <div style="font-size: 0.6rem; opacity: 0.5; margin-bottom: 4px;">(1 + Age/1000)</div>
            <div style="border-top:1px solid #333; margin-top:4px; padding-top:4px;">
                <span style="color:var(--pink); font-weight:bold; font-size:0.85rem;">VALUE: ${Math.floor(totalKillValue).toLocaleString()} KILL</span>
            </div>
        </div>
    `;
}

/**
 * UI: Add entry to the system log feed
 */
function addLog(blockNum, msg, className, subMsg = null) {
    if (!logFeed) return;
    const entry = document.createElement('div');
    entry.className = `log-entry ${className}`;
    
    let innerHTML = `<span class="log-block">${blockNum}</span> > ${msg}`;
    if (subMsg) {
        innerHTML += `<div class="log-subtext" style="font-size:0.65rem; opacity:0.7; border-left: 1px solid currentColor; margin: 4px 0 2px 42px; padding-left: 8px; font-family:monospace; white-space:pre-wrap;">${subMsg}</div>`;
    }
    
    entry.innerHTML = innerHTML;
    logFeed.appendChild(entry);
    
    if (logFeed.childNodes.length > 50) {
        logFeed.removeChild(logFeed.firstChild);
    }
    logFeed.scrollTop = logFeed.scrollHeight;
}

/**
 * UI: Modal Management
 */
function toggleModal(show) { 
    if (agentModal) agentModal.style.display = show ? 'flex' : 'none'; 
}

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

function clearLog() { 
    if (logFeed) logFeed.innerHTML = ''; 
    knownIds.clear(); 
    addLog(lastBlock, "SYSTEM LOG PURGED", "log-network");
}