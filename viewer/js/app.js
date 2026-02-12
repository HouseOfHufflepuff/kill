const ALCHEMY_URL = "https://base-sepolia.g.alchemy.com/v2/nnFLqX2LjPIlLmGBWsr2I5voBfb-6-Gs";
const SUBGRAPH_URL = "https://api.goldsky.com/api/public/project_cmlgypvyy520901u8f5821f19/subgraphs/kill-testnet-subgraph/1.0.1/gn";
const provider = new ethers.JsonRpcProvider(ALCHEMY_URL);

const battleField = document.getElementById('battle-stack');
const leaderboardEl = document.getElementById('leaderboard');
const logFeed = document.getElementById('log-feed');
const topStacksEl = document.getElementById('ripe-stacks');
const footerBlock = document.getElementById('footer-block');
const timerEl = document.getElementById('timer');
const tooltip = document.getElementById('tooltip');
const agentModal = document.getElementById('agent-modal');
const unitsKilledEl = document.getElementById('stat-units-killed');
const reaperKilledEl = document.getElementById('stat-reaper-killed');
const killBurnedEl = document.getElementById('stat-kill-burned');

let knownIds = new Set();
let hunterStats = {};
let lastBlock = 0;
let seconds = 2;
let stackRegistry = {}; 

async function updateHeartbeat() {
    try {
        const hexBlock = await provider.send("eth_blockNumber", []);
        const currentBlock = parseInt(hexBlock, 16);
        if (currentBlock !== lastBlock && lastBlock !== 0) {
            addLog(currentBlock, "BLOCK SYNC: RESOLVED", "log-network");
        }
        footerBlock.innerText = `BLOCK: ${currentBlock}`;
        lastBlock = currentBlock;
    } catch (e) {
        footerBlock.innerText = "BLOCK: SYNCING...";
    }
}

function initBattlefield() {
    for (let l = 0; l < 6; l++) {
        const layer = document.createElement('div');
        layer.className = 'layer';
        layer.dataset.layerIndex = l;
        layer.style.transform = `translateZ(${l * 45}px)`;
        for (let i = 0; i < 36; i++) {
            const stackId = (l * 36) + i;
            const node = document.createElement('div');
            node.className = 'node';
            node.dataset.id = stackId;
            node.onmouseover = (e) => showTooltip(e, stackId);
            node.onmouseout = () => tooltip.style.opacity = 0;
            layer.appendChild(node);
        }
        battleField.appendChild(layer);
    }
}

function showTooltip(e, id) {
    const data = stackRegistry[id] || { units: "0", reaper: "0" };
    const u = parseInt(data.units);
    const r = parseInt(data.reaper);
    const killFactor = ((u + (r * 10)) / 1000).toFixed(2);

    tooltip.style.opacity = 1;
    tooltip.style.left = (e.pageX + 15) + 'px';
    tooltip.style.top = (e.pageY + 15) + 'px';
    tooltip.innerHTML = `
        <strong style="color:var(--cyan)">STACK_${id}</strong><br>
        UNITS: ${u.toLocaleString()}<br>
        REAPER: ${r.toLocaleString()}<br>
        <hr style="border:0; border-top:1px solid #333; margin:5px 0;">
        <span style="color:var(--pink)">KILL FACTOR: x${killFactor}</span><br>
        <div style="font-size:0.6rem; color:#888; margin-top:4px; line-height:1.2;">
            The Maturity Multiplier. Units on this stack generate a ${killFactor}x bonus to yield lethality based on time-weighted density.
        </div>
    `;
}

function updateTopStacks(stacks) {
    stackRegistry = {};
    stacks.forEach(s => { 
        stackRegistry[s.id] = { units: s.totalStandardUnits, reaper: s.totalBoostedUnits }; 
    });

    const activeStacks = stacks.filter(s => parseInt(s.totalStandardUnits) > 0 || parseInt(s.totalBoostedUnits) > 0);
    if (activeStacks.length === 0) {
        topStacksEl.innerHTML = '<div style="font-size:0.7rem; color:#444; padding:10px;">ARENA EMPTY...</div>';
        return;
    }

    topStacksEl.innerHTML = activeStacks.map(item => {
        const u = parseInt(item.totalStandardUnits);
        const r = parseInt(item.totalBoostedUnits);
        const killFactor = ((u + (r * 10)) / 1000).toFixed(2);
        return `
            <div class="stack-row">
                <span class="stack-id">${item.id}</span>
                <span class="stack-val">${u.toLocaleString()}</span>
                <span class="stack-val" style="color:#eee">${r.toLocaleString()}</span>
                <span class="stack-kill">x${killFactor}</span>
            </div>
        `;
    }).join('');
}

async function syncData() {
    await updateHeartbeat();
    try {
        const query = `{
          globalStat(id: "current") { totalUnitsKilled, totalReaperKilled, killBurned }
          stacks(orderBy: totalStandardUnits, orderDirection: desc, first: 10) { 
            id, totalStandardUnits, totalBoostedUnits 
          }
          killeds(first: 20, orderBy: block_number, orderDirection: desc) { 
            id, attacker, targetUnitsLost, block_number, stackId 
          }
          spawneds(first: 20, orderBy: block_number, orderDirection: desc) { id, agent, stackId, block_number }
        }`;
        
        const resp = await fetch(SUBGRAPH_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query })
        });
        const result = await resp.json();
        if (!result || !result.data) return;

        const { globalStat, killeds = [], spawneds = [], stacks = [] } = result.data;
        
        if (globalStat) {
            unitsKilledEl.innerText = parseInt(globalStat.totalUnitsKilled).toLocaleString();
            reaperKilledEl.innerText = parseInt(globalStat.totalReaperKilled).toLocaleString();
            const burned = ethers.formatEther(globalStat.killBurned || "0");
            killBurnedEl.innerText = `${parseFloat(burned).toLocaleString()} KILL`;
        }

        updateTopStacks(stacks);

        const events = [
            ...spawneds.map(s => ({...s, type: 'spawn'})),
            ...killeds.map(k => ({...k, type: 'kill'}))
        ].sort((a, b) => Number(a.block_number) - Number(b.block_number));

        events.forEach(evt => {
            if (!knownIds.has(evt.id)) {
                if (evt.type === 'spawn') {
                    addLog(evt.block_number, `[SPAWN] Agent ${evt.agent.substring(0,6)} @ STACK_${evt.stackId}`, 'log-spawn');
                } else if (evt.type === 'kill') {
                    const amount = parseInt(evt.targetUnitsLost);
                    addLog(evt.block_number, `[KILL] Agent ${evt.attacker.substring(0,8)} reaped ${amount} @ STACK_${evt.stackId}`, 'log-kill');
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
    tooltip.style.opacity = 1;
    tooltip.style.left = (e.pageX + 15) + 'px';
    tooltip.style.top = (e.pageY + 15) + 'px';
    tooltip.innerHTML = `<span style="color:var(--pink)">FULL ADDR:</span><br><span style="font-size:0.6rem;">${addr}</span>`;
}

function toggleModal(show) { agentModal.style.display = show ? 'flex' : 'none'; }
function copyCommand() {
    navigator.clipboard.writeText(document.getElementById('curl-cmd').innerText);
    const btn = document.querySelector('.btn-copy');
    btn.innerText = 'COPIED';
    setTimeout(() => btn.innerText = 'COPY', 2000);
}
document.querySelector('.btn-add').onclick = () => toggleModal(true);
function clearLog() { logFeed.innerHTML = ''; knownIds.clear(); }

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
    battleField.style.transform = `rotateX(${rotateX}deg) rotateZ(${rotateZ}deg)`;
    startX = e.clientX; startY = e.clientY;
};

setInterval(() => {
    seconds--;
    if(seconds < 0) { seconds = 2; syncData(); }
    timerEl.innerText = `0${seconds}s`;
}, 1000);

initBattlefield();
syncData();