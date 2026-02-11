const SUBGRAPH_URL = "https://api.goldsky.com/api/public/project_cmlgypvyy520901u8f5821f19/subgraphs/kill-testnet-subgraph/1.0.0/gn";

const canvas = document.getElementById('battle-canvas');
const ctx = canvas.getContext('2d');
const feed = document.getElementById('feed');
const leaderboardEl = document.getElementById('leaderboard');
const ripeStacksEl = document.getElementById('ripe-stacks');
const footerBlock = document.getElementById('footer-block');
const blockTimer = document.getElementById('block-timer');

let knownIds = new Set();
let hunterStats = {};
let countdown = 2;

function resize() {
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
}
window.addEventListener('resize', resize);
resize();

function drawGrid() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const size = Math.min(canvas.width, canvas.height) * 0.5;
    const rot = Date.now() * 0.0005;
    ctx.strokeStyle = 'rgba(255, 45, 117, 0.2)';
    for (let i = -3; i <= 3; i++) {
        for (let j = -3; j <= 3; j++) {
            let rx = (i * (size/3)) * Math.cos(rot) - (j * (size/3)) * Math.sin(rot);
            let ry = (i * (size/3)) * Math.sin(rot) + (j * (size/3)) * Math.cos(rot);
            ctx.beginPath();
            ctx.moveTo(canvas.width/2 + rx, canvas.height/2 + ry * 0.5 - (size/2));
            ctx.lineTo(canvas.width/2 + rx, canvas.height/2 + ry * 0.5 + (size/2));
            ctx.stroke();
        }
    }
    requestAnimationFrame(drawGrid);
}
drawGrid();

// --- API: Ripe Stacks ---
async function updateRipeStacks() {
    try {
        // Updated mock data with cubeId
        const mockData = {
            cubes: [122, 45, 89, 201, 15],
            addresses: ["0x71...66", "0x32...11", "0xaf...90", "0xde...44", "0x11...22"],
            kills: [450, 320, 210, 150, 90]
        };

        ripeStacksEl.innerHTML = mockData.addresses.map((addr, i) => `
            <div class="ripe-item">
                <span>CUBE_${mockData.cubes[i]} // ${addr}</span>
                <span class="pink-text">${mockData.kills[i]} KILL</span>
            </div>
        `).join('');
    } catch (err) { console.error(err); }
}

// --- Subgraph ---
async function syncBattlefield() {
    const query = `{
      killeds(first: 20, orderBy: block_number, orderDirection: desc) {
        id, attacker, target, targetStdLost, block_number
      }
      spawneds(first: 10, orderBy: block_number, orderDirection: desc) {
        id, cube, block_number
      }
    }`;
    try {
        const response = await fetch(SUBGRAPH_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query })
        });
        const result = await response.json();
        const { killeds, spawneds } = result.data;

        let all = [];
        if (killeds) killeds.forEach(k => all.push({...k, type: 'KILL'}));
        if (spawneds) spawneds.forEach(s => all.push({...s, type: 'SPAWN'}));
        all.sort((a,b) => a.block_number - b.block_number);

        all.forEach(evt => {
            if (!knownIds.has(evt.id)) {
                addLogEntry(evt);
                knownIds.add(evt.id);
                if (evt.type === 'KILL') hunterStats[evt.attacker] = (hunterStats[evt.attacker] || 0) + parseInt(evt.targetStdLost);
            }
        });
        renderLeaderboard();
        if(killeds.length) footerBlock.innerText = `BLOCK: ${killeds[0].block_number}`;
    } catch (err) { console.error(err); }
}

function addLogEntry(evt) {
    const div = document.createElement('div');
    // Restore Color Logic
    div.className = `kill-line ${evt.type === 'KILL' ? 'entry-kill' : 'entry-spawn'}`;
    
    if (evt.type === 'KILL') {
        div.innerHTML = `<span class="pink-text">[TERMINATION]</span><br>${evt.attacker.substring(0,8)}... CULLED ${evt.targetStdLost} KILL`;
    } else {
        div.innerHTML = `<span class="cyan-text">[DEPLOYMENT]</span><br>AGENT SPAWNED IN CUBE_${evt.cube}`;
    }
    feed.appendChild(div);
    feed.scrollTop = feed.scrollHeight;
}

function renderLeaderboard() {
    const sorted = Object.entries(hunterStats).sort(([,a], [,b]) => b - a).slice(0, 5);
    leaderboardEl.innerHTML = sorted.map(([addr, score], i) => `
        <div class="rank-item">
            <div class="rank-addr">RANK 0${i+1} // ${addr.substring(0,10)}...</div>
            <div class="rank-score">${score.toLocaleString()} KILL</div>
        </div>
    `).join('');
}

setInterval(() => {
    countdown--;
    if (countdown < 0) { countdown = 2; syncBattlefield(); updateRipeStacks(); }
    blockTimer.innerText = `0${countdown}s`;
}, 1000);

syncBattlefield();
updateRipeStacks();