const ALCHEMY_URL = "https://base-sepolia.g.alchemy.com/v2/nnFLqX2LjPIlLmGBWsr2I5voBfb-6-Gs";
const SUBGRAPH_URL = "https://api.goldsky.com/api/public/project_cmlgypvyy520901u8f5821f19/subgraphs/kill-testnet-subgraph-base-sepolia/1.0.1/gn";
const provider = new ethers.JsonRpcProvider(ALCHEMY_URL);

const stack = document.getElementById('battle-stack');
const leaderboardEl = document.getElementById('leaderboard');
const logFeed = document.getElementById('log-feed');
const ripeStacksEl = document.getElementById('ripe-stacks');
const footerBlock = document.getElementById('footer-block');
const timerEl = document.getElementById('timer');
const tooltip = document.getElementById('tooltip');

let knownIds = new Set();
let hunterStats = {};
let lastBlock = 0;
let seconds = 2;

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

document.querySelectorAll('input[name="layer-toggle"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        const val = e.target.value;
        document.querySelectorAll('.layer').forEach(l => {
            l.style.opacity = (val === 'all' || l.dataset.layerIndex === val) ? "1" : "0";
        });
    });
});

function showTooltip(e, id) {
    tooltip.style.opacity = 1;
    tooltip.style.left = (e.pageX + 15) + 'px';
    tooltip.style.top = (e.pageY + 15) + 'px';
    tooltip.innerHTML = `<strong>CUBE_${id}</strong><br>LAYER: ${Math.floor(id/36) + 1}`;
}

function updateRipeStacks() {
    // Restored Mock Ripe Stacks Functionality
    const mockRipe = [
        { cube: 42, addr: "0x88...12", kill: 1250 },
        { cube: 156, addr: "0x44...ff", kill: 980 },
        { cube: 12, addr: "0xee...aa", kill: 450 },
        { cube: 201, addr: "0x12...bc", kill: 320 }
    ];
    ripeStacksEl.innerHTML = mockRipe.map(item => `
        <div class="ripe-item" style="display:flex; justify-content:space-between; font-size:0.7rem; border-bottom:1px solid #222; padding:4px 0;">
            <span style="color:#666;">CUBE_${item.cube} // ${item.addr}</span>
            <span style="color:var(--pink); font-weight:bold;">${item.kill} KILL</span>
        </div>
    `).join('');
}

async function syncData() {
    try {
        const blockResponse = await provider.send("eth_blockNumber", []);
        const currentBlock = Number(blockResponse); 
        footerBlock.innerText = `BLOCK: ${currentBlock}`;

        if (currentBlock > lastBlock) {
            if (lastBlock !== 0) {
                addLog(currentBlock, "[NETWORK] Block resolution.", "log-network");
            }
            lastBlock = currentBlock;
        }

        const query = `{
          killeds(first: 20, orderBy: block_number, orderDirection: desc) { id, attacker, targetStdLost, block_number }
          spawneds(first: 20, orderBy: block_number, orderDirection: desc) { id, agent, cube, block_number }
          moveds(first: 20, orderBy: block_number, orderDirection: desc) { id, agent, fromCube, toCube, block_number }
        }`;
        
        const resp = await fetch(SUBGRAPH_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query })
        });
        
        const result = await resp.json();
        if (!result.data) return;

        const { killeds, spawneds, moveds } = result.data;
        
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
                    // NEW COLOR: CYAN
                    addLog(evt.block_number, `[MOVE] Agent ${evt.agent.substring(0,6)}: ${evt.fromCube} -> ${evt.toCube}`, 'log-move');
                } else {
                    const amount = parseInt(evt.targetStdLost);
                    addLog(evt.block_number, `[KILL] ${evt.attacker.substring(0,8)}... Reaped ${amount} KILL`, 'log-kill');
                    // Persistence: Update hunter stats
                    hunterStats[evt.attacker] = (hunterStats[evt.attacker] || 0) + amount;
                }
                knownIds.add(evt.id);
            }
        });
        renderLeaderboard();
    } catch (e) { console.error("Sync Error:", e); }
}

function addLog(blockNum, msg, className) {
    const entry = document.createElement('div');
    entry.className = `log-entry ${className}`;
    entry.innerHTML = `<span class="log-block">${blockNum}</span> > ${msg}`;
    logFeed.appendChild(entry);
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
            <span class="rank-addr">${addr.substring(0,12)}...</span>
            <span class="rank-sep">//</span>
            <span class="rank-score">${score.toLocaleString()} KILL</span>
        </div>
    `).join('');
}

let isDragging = false, startX, startY, rotateX = 60, rotateZ = -45;
window.onmousedown = (e) => {
    if (e.target.className === 'node' || e.target.closest('.panel')) return;
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
        updateRipeStacks(); // Restore interval update for ripe stacks
    }
    timerEl.innerText = `0${seconds}s`;
}, 1000);

initStack();
syncData();
updateRipeStacks();