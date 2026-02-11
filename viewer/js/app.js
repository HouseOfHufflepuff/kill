const ALCHEMY_URL = "https://base-sepolia.g.alchemy.com/v2/nnFLqX2LjPIlLmGBWsr2I5voBfb-6-Gs";
const SUBGRAPH_URL = "https://api.goldsky.com/api/public/project_cmlgypvyy520901u8f5821f19/subgraphs/kill-testnet-subgraph/1.0.0/gn";
const provider = new ethers.JsonRpcProvider(ALCHEMY_URL);

const cube = document.getElementById('battle-cube');
const leaderboardEl = document.getElementById('leaderboard');
const logFeed = document.getElementById('log-feed');
const ripeStacksEl = document.getElementById('ripe-stacks');
const footerBlock = document.getElementById('footer-block');
const timerEl = document.getElementById('timer');

let knownIds = new Set();
let hunterStats = {};
let seconds = 2;

// Initialize Cube Faces
document.querySelectorAll('.cube-face').forEach(face => {
    for(let i=0; i<36; i++) {
        const node = document.createElement('div');
        node.className = 'node';
        face.appendChild(node);
    }
});

function updateRipeStacks() {
    const mockRipe = [
        { cube: 14, addr: "0x71...ea", kill: 842 },
        { cube: 102, addr: "0x32...01", kill: 615 },
        { cube: 89, addr: "0xaf...99", kill: 420 },
        { cube: 22, addr: "0xde...cc", kill: 190 }
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
        const block = await provider.getBlockNumber();
        footerBlock.innerText = `BLOCK: ${block}`;

        const query = `{
          killeds(first: 15, orderBy: block_number, orderDirection: desc) { id, attacker, targetStdLost, block_number }
          spawneds(first: 10, orderBy: block_number, orderDirection: desc) { id, cube, block_number }
        }`;

        const resp = await fetch(SUBGRAPH_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query })
        });
        
        const result = await resp.json();
        if (result.errors) throw new Error(result.errors[0].message);
        
        const { killeds, spawneds } = result.data;

        // Combine and Sort by Block (Descending)
        const allEvents = [
            ...spawneds.map(s => ({...s, type: 'spawn'})),
            ...killeds.map(k => ({...k, type: 'kill'}))
        ].sort((a, b) => b.block_number - a.block_number);

        allEvents.forEach(evt => {
            if (!knownIds.has(evt.id)) {
                if (evt.type === 'spawn') {
                    addLog(evt.block_number, `[SPAWN] Agent deployed to CUBE_${evt.cube}`, 'log-spawn');
                } else {
                    addLog(evt.block_number, `[KILL] ${evt.attacker.substring(0,8)}... Reaped ${evt.targetStdLost} KILL`, 'log-kill');
                    hunterStats[evt.attacker] = (hunterStats[evt.attacker] || 0) + parseInt(evt.targetStdLost);
                }
                knownIds.add(evt.id);
            }
        });

        renderLeaderboard();
    } catch (e) { 
        console.error("Sync Failure:", e.message); 
    }
}

function addLog(blockNum, msg, className) {
    const entry = document.createElement('div');
    entry.className = `log-entry ${className}`;
    entry.innerHTML = `<span class="log-block">${blockNum}</span> > ${msg}`;
    logFeed.prepend(entry); // Newest at top
    if (logFeed.childNodes.length > 50) logFeed.removeChild(logFeed.lastChild);
}

function renderLeaderboard() {
    const sorted = Object.entries(hunterStats).sort(([,a], [,b]) => b - a).slice(0, 10);
    leaderboardEl.innerHTML = sorted.map(([addr, score]) => `
        <div class="rank-item">
            <span class="rank-addr">${addr.substring(0,12)}...</span>
            <span class="rank-sep">//</span>
            <span class="rank-score">${score.toLocaleString()} KILL</span>
        </div>
    `).join('');
}

// Rotation Interaction
let isDragging = false, startX, startY, rotateX = -30, rotateY = 45;
window.onmousedown = (e) => { isDragging = true; startX = e.clientX; startY = e.clientY; };
window.onmouseup = () => isDragging = false;
window.onmousemove = (e) => {
    if(!isDragging) return;
    rotateY += (e.clientX - startX) * 0.5;
    rotateX -= (e.clientY - startY) * 0.5;
    cube.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
    startX = e.clientX; startY = e.clientY;
};

// Cycle Initialization
setInterval(() => {
    seconds--;
    if(seconds < 0) { 
        seconds = 2; 
        syncData(); 
        updateRipeStacks(); 
    }
    timerEl.innerText = `0${seconds}s`;
}, 1000);

syncData();
updateRipeStacks();