const ALCHEMY_URL = "https://base-sepolia.g.alchemy.com/v2/nnFLqX2LjPIlLmGBWsr2I5voBfb-6-Gs";
const SUBGRAPH_URL = "https://api.goldsky.com/api/public/project_cmlgypvyy520901u8f5821f19/subgraphs/kill-testnet-subgraph/1.0.1/gn";
const provider = new ethers.JsonRpcProvider(ALCHEMY_URL);

const stack = document.getElementById('battle-stack');
const leaderboardEl = document.getElementById('leaderboard');
const logFeed = document.getElementById('log-feed');
const ripeStacksEl = document.getElementById('ripe-stacks');
const footerBlock = document.getElementById('footer-block');
const timerEl = document.getElementById('timer');
const tooltip = document.getElementById('tooltip');
const agentModal = document.getElementById('agent-modal');

const unitsKilledEl = document.getElementById('stat-units-killed');
const reaperKilledEl = document.getElementById('stat-reaper-killed');

let knownIds = new Set();
let hunterStats = {};
let lastBlock = 0;
let seconds = 2;
let cubeRegistry = {}; 

function initStack() {
    for (let l = 0; l < 6; l++) {
        const layer = document.createElement('div');
        layer.className = 'layer';
        layer.dataset.layerIndex = l;
        layer.style.transform = `translateZ(${l * 45}px)`;
        for (let i = 0; i < 36; i++) {
            const cubeId = (l * 36) + i;
            const node = document.createElement('div');
            node.className = 'node';
            node.dataset.id = cubeId;
            node.onmouseover = (e) => showTooltip(e, cubeId);
            node.onmouseout = () => tooltip.style.opacity = 0;
            layer.appendChild(node);
        }
        stack.appendChild(layer);
    }
}

function showTooltip(e, id) {
    const data = cubeRegistry[id] || { units: "0", reaper: "0" };
    tooltip.style.opacity = 1;
    tooltip.style.left = (e.pageX + 15) + 'px';
    tooltip.style.top = (e.pageY + 15) + 'px';
    tooltip.innerHTML = `
        <strong style="color:var(--cyan)">CUBE_${id}</strong><br>
        LAYER: ${Math.floor(id/36) + 1}<br>
        <hr style="border:0; border-top:1px solid #333; margin:5px 0;">
        UNITS: ${parseInt(data.units).toLocaleString()}<br>
        <span style="color:var(--pink)">REAPER: ${parseInt(data.reaper).toLocaleString()}</span>
    `;
}

function updateRipeStacks(cubes) {
    cubeRegistry = {};
    cubes.forEach(c => { 
        cubeRegistry[c.id] = { 
            units: c.totalStandardUnits, 
            reaper: c.totalBoostedUnits 
        }; 
    });

    const activeCubes = cubes.filter(c => parseInt(c.totalStandardUnits) > 0 || parseInt(c.totalBoostedUnits) > 0);
    if (activeCubes.length === 0) {
        ripeStacksEl.innerHTML = '<div style="font-size:0.7rem; color:#444;">ARENA EMPTY...</div>';
        return;
    }
    ripeStacksEl.innerHTML = activeCubes.map(item => `
        <div class="ripe-item">
            <span class="ripe-id">CUBE_${item.id}</span>
            <span class="ripe-value">${parseInt(item.totalStandardUnits).toLocaleString()} [${parseInt(item.totalBoostedUnits)}]</span>
        </div>
    `).join('');
}

async function syncData() {
    try {
        // HEARTBEAT RESTORATION: Direct block number fetch
        const currentBlock = await provider.getBlockNumber();
        footerBlock.innerText = `BLOCK: ${currentBlock}`;

        if (currentBlock > lastBlock) {
            if (lastBlock !== 0) {
                // Occasional network pulse log
                addLog(currentBlock, "[NETWORK] Pulse detected.", "log-network");
            }
            lastBlock = currentBlock;
        }

        const query = `{
          globalStat(id: "current") {
            totalUnitsKilled
            totalReaperKilled
          }
          cubes(orderBy: totalStandardUnits, orderDirection: desc, first: 10) { 
            id, totalStandardUnits, totalBoostedUnits 
          }
          killeds(first: 20, orderBy: block_number, orderDirection: desc) { 
            id, attacker, targetUnitsLost, block_number 
          }
          spawneds(first: 20, orderBy: block_number, orderDirection: desc) { id, agent, cube, block_number }
          moveds(first: 20, orderBy: block_number, orderDirection: desc) { id, agent, fromCube, toCube, block_number }
        }`;
        
        const resp = await fetch(SUBGRAPH_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query })
        });
        
        const result = await resp.json();
        if (!result || !result.data) return;

        const { globalStat, killeds = [], spawneds = [], moveds = [], cubes = [] } = result.data;
        
        if (globalStat) {
            unitsKilledEl.innerText = parseInt(globalStat.totalUnitsKilled).toLocaleString();
            reaperKilledEl.innerText = parseInt(globalStat.totalReaperKilled).toLocaleString();
        }

        updateRipeStacks(cubes);

        const allEvents = [
            ...spawneds.map(s => ({...s, type: 'spawn'})), 
            ...killeds.map(k => ({...k, type: 'kill'})),
            ...moveds.map(m => ({...m, type: 'move'}))
        ].sort((a, b) => Number(a.block_number) - Number(b.block_number));

        allEvents.forEach(evt => {
            if (!knownIds.has(evt.id)) {
                if (evt.type === 'spawn') {
                    addLog(evt.block_number, `[SPAWN] Agent ${evt.agent.substring(0,6)} @ CUBE_${evt.cube}`, 'log-spawn');
                } else if (evt.type === 'move') {
                    addLog(evt.block_number, `[MOVE] Agent ${evt.agent.substring(0,6)}: ${evt.fromCube} -> ${evt.toCube}`, 'log-move');
                } else if (evt.type === 'kill') {
                    const amount = parseInt(evt.targetUnitsLost);
                    addLog(evt.block_number, `[KILL] ${evt.attacker.substring(0,8)}... Reaped ${amount} KILL`, 'log-kill');
                    hunterStats[evt.attacker] = (hunterStats[evt.attacker] || 0) + amount;
                }
                knownIds.add(evt.id);
            }
        });
        renderLeaderboard();
    } catch (e) { 
        console.error("Sync Error:", e);
        footerBlock.innerText = "BLOCK: DISCONNECTED";
    }
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
    if (sorted.length === 0) {
        leaderboardEl.innerHTML = '<div style="font-size:0.7rem; color:#444;">WAITING FOR DATA...</div>';
        return;
    }
    leaderboardEl.innerHTML = sorted.map(([addr, score]) => `
        <div class="rank-item">
            <span class="rank-addr">${addr.substring(0,8)}...</span>
            <span class="rank-sep">//</span>
            <span class="rank-score">${score.toLocaleString()} KILL</span>
        </div>
    `).join('');
}

function toggleModal(show) { agentModal.style.display = show ? 'flex' : 'none'; }
function copyCommand() {
    const cmd = document.getElementById('curl-cmd').innerText;
    navigator.clipboard.writeText(cmd);
    const btn = document.querySelector('.btn-copy');
    btn.innerText = 'COPIED';
    setTimeout(() => btn.innerText = 'COPY', 2000);
}
document.querySelector('.btn-add').onclick = () => toggleModal(true);
window.onclick = (e) => { if (e.target == agentModal) toggleModal(false); }

function clearLog() {
    logFeed.innerHTML = '';
    knownIds.clear();
    addLog(lastBlock, "Log cleared by operator.", "log-network");
}

document.querySelectorAll('input[name="layer-toggle"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        const val = e.target.value;
        document.querySelectorAll('.layer').forEach(l => {
            l.style.opacity = (val === 'all' || l.dataset.layerIndex === val) ? "1" : "0";
        });
    });
});

let isDragging = false, startX, startY, rotateX = 60, rotateZ = -45;
window.onmousedown = (e) => {
    if (e.target.className === 'node' || e.target.closest('.panel') || e.target.closest('.modal-content')) return;
    isDragging = true; startX = e.clientX; startY = e.clientY;
};
window.onmouseup = () => isDragging = false;
window.onmousemove = (e) => {
    if (!isDragging) return;
    rotateZ += (e.clientX - startX) * 0.5;
    rotateX -= (e.clientY - startY) * 0.5;
    stack.style.transform = `rotateX(${rotateX}deg) rotateZ(${rotateZ}deg)`;
    startX = e.clientX; startY = e.clientY;
};

setInterval(() => {
    seconds--;
    if(seconds < 0) { 
        seconds = 2; 
        syncData(); 
    }
    timerEl.innerText = `0${seconds}s`;
}, 1000);

initStack();
syncData();