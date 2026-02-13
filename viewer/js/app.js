const NETWORK = "Base Sepolia";
const ALCHEMY_URL = "https://base-sepolia.g.alchemy.com/v2/nnFLqX2LjPIlLmGBWsr2I5voBfb-6-Gs";
const SUBGRAPH_URL = "https://api.goldsky.com/api/public/project_cmlgypvyy520901u8f5821f19/subgraphs/kill-testnet-subgraph/1.0.1/gn";
const KILL_TOKEN_ADDR = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const KILL_GAME_ADDR = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";

const provider = new ethers.JsonRpcProvider(ALCHEMY_URL);

const battleField = document.getElementById('battle-stack');
const leaderboardEl = document.getElementById('leaderboard');
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

let knownIds = new Set();
let hunterStats = {};
let lastBlock = 0;
let syncCounter = 2;
let stackRegistry = {}; 

if (networkLabel) networkLabel.innerText = NETWORK.toUpperCase();
document.querySelectorAll('.net-var').forEach(el => el.innerText = NETWORK);

async function updateHeartbeat() {
    try {
        const hexBlock = await provider.send("eth_blockNumber", []);
        const currentBlock = parseInt(hexBlock, 16);
        if (currentBlock !== lastBlock && lastBlock !== 0) {
            addLog(currentBlock, "BLOCK SYNC: RESOLVED", "log-network");
        }
        headerBlock.innerText = currentBlock;
        lastBlock = currentBlock;
    } catch (e) {
        headerBlock.innerText = "SYNCING...";
    }
}

function toggleLayer(idx) {
    const layers = document.querySelectorAll('.layer');
    if (layers[idx]) layers[idx].classList.toggle('hidden');
}

function initBattlefield() {
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
            node.onmouseout = () => tooltip.style.opacity = 0;
            layer.appendChild(node);
        }
        battleField.appendChild(layer);
    }
}

function updateNodeParticles(id, units, reaper) {
    const node = document.getElementById(`node-${id}`);
    if (!node) return;

    const targetUnitDots = Math.min(Math.floor(units / 1000), 40);
    const targetReaperDots = Math.min(parseInt(reaper), 20);

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
            existing[i].remove();
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
    const pulseClass = (type === 'kill') ? 'pulse-kill' : 'pulse-cyan';
    node.classList.remove('pulse-kill', 'pulse-cyan');
    void node.offsetWidth; 
    node.classList.add(pulseClass);
}

function showTooltip(e, id) {
    const data = stackRegistry[id] || { units: "0", reaper: "0", birthBlock: "0" };
    const u = parseInt(data.units);
    const r = parseInt(data.reaper);
    const age = (lastBlock > 0 && data.birthBlock !== "0") ? (lastBlock - parseInt(data.birthBlock)) : 0;
    const bountyMultiplier = (1 + (age / 1000));
    const killOnStack = (u * bountyMultiplier);

    tooltip.style.opacity = 1;
    tooltip.style.left = (e.pageX + 15) + 'px';
    tooltip.style.top = (e.pageY + 15) + 'px';
    tooltip.innerHTML = `
        <strong style="color:var(--cyan)">STACK_${id}</strong><br>
        UNITS: ${u.toLocaleString()}<br>
        REAPER: ${r.toLocaleString()}<br>
        <hr style="border:0; border-top:1px solid #333; margin:5px 0;">
        <span style="color:var(--pink)">KILL VALUE: ${killOnStack.toLocaleString(undefined, {maximumFractionDigits: 2})}</span><br>
        <div style="font-size:0.6rem; color:#888; margin-top:4px;">Mult: ${bountyMultiplier.toFixed(2)}x // Age: ${age}</div>
    `;
}

function updateTopStacks(stacks) {
    let globalUnits = 0, globalReapers = 0, globalBountyKill = 0;

    stacks.forEach(s => { 
        const u = parseInt(s.totalStandardUnits);
        const r = parseInt(s.totalBoostedUnits);
        const age = (lastBlock > 0) ? (lastBlock - parseInt(s.birthBlock)) : 0;
        const multiplier = (1 + (age / 1000));

        stackRegistry[s.id] = { units: s.totalStandardUnits, reaper: s.totalBoostedUnits, birthBlock: s.birthBlock }; 
        globalUnits += u; globalReapers += r; globalBountyKill += (u * multiplier);
        updateNodeParticles(s.id, s.totalStandardUnits, s.totalBoostedUnits);
    });

    if(totalUnitsActiveEl) totalUnitsActiveEl.innerText = globalUnits.toLocaleString();
    if(totalReapersActiveEl) totalReapersActiveEl.innerText = globalReapers.toLocaleString();
    if(totalKillBountyEl) totalKillBountyEl.innerText = `${Math.floor(globalBountyKill).toLocaleString()} KILL`;

    const activeStacks = stacks.filter(s => parseInt(s.totalStandardUnits) > 0 || parseInt(s.totalBoostedUnits) > 0);
    if (activeStacks.length === 0) {
        topStacksEl.innerHTML = '<div style="font-size:0.7rem; color:#444; padding:10px;">ARENA EMPTY...</div>';
        return;
    }

    topStacksEl.innerHTML = activeStacks.map(item => {
        const u = parseInt(item.totalStandardUnits), r = parseInt(item.totalBoostedUnits);
        const age = (lastBlock > 0) ? (lastBlock - parseInt(item.birthBlock)) : 0;
        const bountyMultiplier = (1 + (age / 1000)).toFixed(2);
        return `
            <div class="stack-row">
                <span class="stack-id">${item.id}</span>
                <span class="stack-val">${u.toLocaleString()}</span>
                <span class="stack-val" style="color:var(--cyan)">${r.toLocaleString()}</span>
                <span class="stack-kill bounty-hover" onmouseover="showBountyTooltip(event, ${bountyMultiplier}, ${age})" onmouseout="tooltip.style.opacity=0">${bountyMultiplier}x</span>
            </div>
        `;
    }).join('');
}

function showBountyTooltip(e, mult, age) {
    tooltip.style.opacity = 1;
    tooltip.style.left = (e.pageX + 15) + 'px';
    tooltip.style.top = (e.pageY + 15) + 'px';
    tooltip.innerHTML = `<div style="text-align:center;"><strong style="color:var(--pink)">BOUNTY STATUS</strong><br>${mult}x Yield<br><div style="font-size:0.6rem; color:#666;">Age: ${age} blocks</div></div>`;
}

async function syncData() {
    await updateHeartbeat();
    try {
        const query = `{
          globalStat(id: "current") { totalUnitsKilled, totalReaperKilled, killBurned }
          stacks(orderBy: totalStandardUnits, orderDirection: desc, first: 100) { id, totalStandardUnits, totalBoostedUnits, birthBlock }
          killeds(first: 20, orderBy: block_number, orderDirection: desc) { id, attacker, targetUnitsLost, block_number, stackId }
          spawneds(first: 20, orderBy: block_number, orderDirection: desc) { id, agent, stackId, block_number }
        }`;
        const resp = await fetch(SUBGRAPH_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
        const result = await resp.json();
        if (!result || !result.data) return;
        const { globalStat, killeds = [], spawneds = [], stacks = [] } = result.data;
        statusEl.innerText = killeds.length > 0 ? "SYSTEM STATUS: LETHAL" : "SYSTEM STATUS: OPERATIONAL";
        if (globalStat) {
            unitsKilledEl.innerText = parseInt(globalStat.totalUnitsKilled).toLocaleString();
            reaperKilledEl.innerText = parseInt(globalStat.totalReaperKilled).toLocaleString();
            const burned = ethers.formatEther(globalStat.killBurned || "0");
            killBurnedEl.innerText = `${parseFloat(burned).toLocaleString(undefined, {minimumFractionDigits: 3})} KILL`;
        }
        updateTopStacks(stacks);
        [...spawneds.map(s => ({...s, type: 'spawn'})), ...killeds.map(k => ({...k, type: 'kill'}))]
            .sort((a, b) => Number(a.block_number) - Number(b.block_number))
            .forEach(evt => {
                if (!knownIds.has(evt.id)) {
                    if (evt.type === 'spawn') {
                        addLog(evt.block_number, `[SPAWN] Agent ${evt.agent.substring(0,6)} @ STACK_${evt.stackId}`, 'log-spawn');
                        triggerPulse(evt.stackId, 'spawn');
                    } else {
                        const amount = parseInt(evt.targetUnitsLost);
                        addLog(evt.block_number, `[KILL] Agent ${evt.attacker.substring(0,8)} reaped ${amount} @ STACK_${evt.stackId}`, 'log-kill');
                        triggerPulse(evt.stackId, 'kill');
                        hunterStats[evt.attacker] = (hunterStats[evt.attacker] || 0) + amount;
                    }
                    knownIds.add(evt.id);
                }
            });
        renderLeaderboard();
    } catch (e) { console.error("Sync fail", e); }
}

function addLog(blockNum, msg, className) {
    const entry = document.createElement('div');
    entry.className = `log-entry ${className}`;
    entry.innerHTML = `<span class="log-block">${blockNum}</span> > ${msg}`;
    logFeed.appendChild(entry);
    if (logFeed.childNodes.length > 50) logFeed.removeChild(logFeed.firstChild);
    logFeed.scrollTop = logFeed.scrollHeight;
}

function renderLeaderboard() {
    const sorted = Object.entries(hunterStats).sort(([,a], [,b]) => b - a).slice(0, 10);
    leaderboardEl.innerHTML = sorted.map(([addr, score]) => `
        <div class="rank-item" onmouseover="showAddrTooltip(event, '${addr}')" onmouseout="tooltip.style.opacity=0">
            <span class="rank-addr">${addr.substring(0,8)}...</span>
            <span class="rank-score">${score.toLocaleString()} KILL</span>
        </div>
    `).join('');
}

function showAddrTooltip(e, addr) {
    tooltip.style.opacity = 1; tooltip.style.left = (e.pageX + 15) + 'px'; tooltip.style.top = (e.pageY + 15) + 'px';
    tooltip.innerHTML = `<span style="color:var(--pink)">FULL ADDR:</span><br><span style="font-size:0.6rem;">${addr}</span>`;
}

function toggleModal(show) { agentModal.style.display = show ? 'flex' : 'none'; }
window.addEventListener('click', (e) => { if (e.target === agentModal) toggleModal(false); });

function copyCommand() {
    navigator.clipboard.writeText(document.getElementById('curl-cmd').innerText);
    const btn = document.querySelector('.btn-copy');
    btn.innerText = 'COPIED';
    setTimeout(() => btn.innerText = 'COPY', 2000);
}

function clearLog() { logFeed.innerHTML = ''; knownIds.clear(); }

let isDragging = false, startX, startY, rotateX = 60, rotateZ = -45;
window.onmousedown = (e) => {
    if (e.target.className === 'node' || e.target.closest('.panel') || e.target.closest('.modal-content') || e.target.closest('.layer-controls')) return;
    isDragging = true; startX = e.clientX; startY = e.clientY;
};
window.onmouseup = () => isDragging = false;
window.onmousemove = (e) => {
    if (!isDragging) return;
    rotateZ += (e.clientX - startX) * 0.5; rotateX -= (e.clientY - startY) * 0.5;
    battleField.style.transform = `rotateX(${rotateX}deg) rotateZ(${rotateZ}deg)`;
    startX = e.clientX; startY = e.clientY;
};

setInterval(() => { syncCounter--; if(syncCounter < 0) { syncCounter = 2; syncData(); } }, 1000);
initBattlefield(); syncData();