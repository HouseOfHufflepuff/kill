const SUBGRAPH_URL = "https://api.goldsky.com/api/public/project_cmlgypvyy520901u8f5821f19/subgraphs/kill-testnet-subgraph/1.0.0/gn";

const canvas = document.getElementById('battle-canvas');
const ctx = canvas.getContext('2d');
const feed = document.getElementById('feed');
const leaderboardEl = document.getElementById('leaderboard');
const footerBlock = document.getElementById('footer-block');
const blockTimer = document.getElementById('block-timer');

const BLOCK_SPEED = 2;
let countdown = BLOCK_SPEED;
let knownIds = new Set();
let hunterStats = {};

// --- Responsive Sim Scaling ---
function resize() {
    const container = canvas.parentElement;
    // Set internal resolution to match displayed size
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
}
window.addEventListener('resize', resize);
resize();

function drawGrid() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    // Scale grid size based on smallest dimension
    const size = Math.min(canvas.width, canvas.height) * 0.5;
    const rotation = Date.now() * 0.0005;

    ctx.strokeStyle = 'rgba(255, 45, 117, 0.2)';
    ctx.lineWidth = 1;

    for (let i = -3; i <= 3; i++) {
        for (let j = -3; j <= 3; j++) {
            let x = i * (size / 3);
            let y = j * (size / 3);
            let rx = x * Math.cos(rotation) - y * Math.sin(rotation);
            let ry = x * Math.sin(rotation) + y * Math.cos(rotation);

            ctx.beginPath();
            ctx.moveTo(centerX + rx, centerY + ry * 0.5 - (size / 2));
            ctx.lineTo(centerX + rx, centerY + ry * 0.5 + (size / 2));
            ctx.stroke();
        }
    }
    requestAnimationFrame(drawGrid);
}
drawGrid();

// --- Battlefield Logic ---
async function syncBattlefield() {
    const query = `
    {
      killeds(first: 30, orderBy: block_number, orderDirection: desc) {
        id
        attacker
        target
        targetStdLost
        block_number
      }
      spawneds(first: 10, orderBy: block_number, orderDirection: desc) {
        id
        cube
        block_number
      }
    }`;

    try {
        const response = await fetch(SUBGRAPH_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query })
        });

        const result = await response.json();
        if (result.errors) throw new Error(result.errors[0].message);

        const { killeds, spawneds } = result.data;
        let allEvents = [];

        if (killeds) killeds.forEach(k => allEvents.push({...k, type: 'KILL'}));
        if (spawneds) spawneds.forEach(s => allEvents.push({...s, type: 'SPAWN'}));

        // Sort ascending (oldest to newest) to append to bottom
        allEvents.sort((a, b) => a.block_number - b.block_number);

        if (allEvents.length > 0) {
            footerBlock.innerText = `BLOCK: ${allEvents[allEvents.length - 1].block_number}`;
            
            allEvents.forEach(evt => {
                if (!knownIds.has(evt.id)) {
                    addLogEntry(evt);
                    knownIds.add(evt.id);
                    if (evt.type === 'KILL') updateStats(evt);
                }
            });
            renderLeaderboard();
        }
    } catch (err) {
        console.error("Sync Error:", err.message);
    }
}

function addLogEntry(evt) {
    const div = document.createElement('div');
    div.className = 'kill-line';
    
    if (evt.type === 'KILL') {
        const std = Math.floor(evt.targetStdLost || 0);
        div.innerHTML = `
            <span class="pink-text">[TERMINATION]</span><br>
            ATK: ${evt.attacker.substring(0,8)}...<br>
            CULLED: <span style="color:#fff">${std} UNITS</span> FROM ${evt.target.substring(0,8)}...
        `;
    } else {
        div.innerHTML = `
            <span style="color:#00f0ff">[DEPLOYMENT]</span><br>
            AGENT_SPAWN IN <span style="color:#fff">CUBE_${evt.cube}</span><br>
            STATUS: ACTIVE
        `;
    }
    
    feed.appendChild(div);
    
    // Auto-scroll to bottom
    feed.scrollTop = feed.scrollHeight;

    // Prune old logs to maintain performance
    if(feed.childNodes.length > 50) feed.removeChild(feed.firstChild);
}

function updateStats(kill) {
    const atk = kill.attacker;
    const score = parseInt(kill.targetStdLost || 0);
    hunterStats[atk] = (hunterStats[atk] || 0) + score;
}

function renderLeaderboard() {
    const sorted = Object.entries(hunterStats)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10);

    leaderboardEl.innerHTML = sorted.map(([addr, score], i) => `
        <div style="margin-bottom: 15px;">
            <div style="font-size: 0.6rem; color: #555;">RANK 0${i+1}</div>
            <div class="pink-text">${addr.substring(0,12)}...</div>
            <div style="color: #fff; font-weight: bold;">${score.toLocaleString()} PTS</div>
        </div>
    `).join('');
}

// Timer Loop
setInterval(() => {
    countdown--;
    if (countdown < 0) {
        countdown = BLOCK_SPEED;
        syncBattlefield();
    }
    blockTimer.innerText = `0${countdown}s`;
}, 1000);

syncBattlefield();