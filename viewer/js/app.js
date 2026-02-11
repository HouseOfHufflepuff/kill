const ALCHEMY_URL = "https://base-sepolia.g.alchemy.com/v2/nnFLqX2LjPIlLmGBWsr2I5voBfb-6-Gs";
const SUBGRAPH_URL = "https://api.goldsky.com/api/public/project_cmlgypvyy520901u8f5821f19/subgraphs/kill-testnet-subgraph/1.0.0/gn";

// Initialize Ethers Provider
const provider = new ethers.JsonRpcProvider(ALCHEMY_URL);

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

// --- Ethers Block Polling ---
async function pollBlock() {
    try {
        const blockNumber = await provider.getBlockNumber();
        footerBlock.innerText = `BLOCK: ${blockNumber}`;
    } catch (err) {
        console.error("Alchemy Sync Error:", err);
    }
}

// --- Sim Animation ---
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
        const mockData = {
            cubes: [122, 45, 89, 201, 15],
            addresses: ["0x71...66", "0x32...11", "0xaf...90", "0xde...44", "0x11...22"],
            kills: [550, 320, 210, 150, 90] 
        };

        ripeStacksEl.innerHTML = mockData.addresses.map((addr, i) => {
            const isCritical = mockData.kills[i] > 400;
            return `
                <div class="ripe-item ${isCritical ? 'warning-flash' : ''}">
                    <span style="color:#555">CUBE_${mockData.cubes[i]} // ${addr}</span>
                    <span class="${isCritical ? 'pink-text' : ''}" style="font-weight:bold;">${mockData.kills[i]} KILL</span>
                </div>
            `;
        }).join('');
    } catch (err) { console.error(err); }
}

// --- Subgraph Sync ---
async function syncBattlefield() {
    const query = `{
      killeds(first: 20, orderBy: block_number, orderDirection: desc) {
        id, attacker, target, targetStdLost, block_number
      }
    }`;
    try {
        const response = await fetch(SUBGRAPH_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query })
        });
        const result = await response.json();
        const killeds = result.data.killeds;

        killeds.sort((a,b) => a.block_number - b.block_number).forEach(evt => {
            if (!knownIds.has(evt.id)) {
                addLogEntry(evt);
                knownIds.add(evt.id);
                hunterStats[evt.attacker] = (hunterStats[evt.attacker] || 0) + parseInt(evt.targetStdLost);
            }
        });
        renderLeaderboard();
    } catch (err) { console.error(err); }
}

function addLogEntry(evt) {
    const div = document.createElement('div');
    div.className = 'kill-line entry-kill';
    div.innerHTML = `<span style="color:var(--pink)">[TERMINATION]</span><br>${evt.attacker.substring(0,8)}... CULLED ${evt.targetStdLost} KILL`;
    feed.appendChild(div);
    feed.scrollTop = feed.scrollHeight;
}

function renderLeaderboard() {
    const sorted = Object.entries(hunterStats).sort(([,a], [,b]) => b - a).slice(0, 10);
    leaderboardEl.innerHTML = sorted.map(([addr, score]) => `
        <div class="rank-item">
            <span class="rank-addr">${addr.substring(0,10)}...</span>
            <span class="rank-sep">//</span>
            <span class="rank-score">${score.toLocaleString()} KILL</span>
        </div>
    `).join('');
}

// Main Loop
setInterval(() => {
    countdown--;
    if (countdown < 0) { 
        countdown = 2; 
        syncBattlefield(); 
        updateRipeStacks();
        pollBlock(); // Direct Ethers call
    }
    blockTimer.innerText = `0${countdown}s`;
}, 1000);

// Initial Load
pollBlock();
syncBattlefield();
updateRipeStacks();