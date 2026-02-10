const SUBGRAPH_URL = "https://api.goldsky.com/api/public/project_cmlgypvyy520901u8f5821f19/subgraphs/kill-testnet-subgraph/1.0.0/gn";

const canvas = document.getElementById('battle-canvas');
const ctx = canvas.getContext('2d');
const feed = document.getElementById('feed');
const blockTimer = document.getElementById('block-timer');
const lastBlockEl = document.getElementById('last-block');

let time = 5; // Poll every 5 seconds
let knownKillIds = new Set();

// --- 3D Grid Animation ---
function resize() {
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
}
window.addEventListener('resize', resize);
resize();

function drawGrid() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const size = 180;
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
            ctx.moveTo(centerX + rx, centerY + ry * 0.5 - 100);
            ctx.lineTo(centerX + rx, centerY + ry * 0.5 + 100);
            ctx.stroke();
        }
    }
    
    if (Math.random() > 0.95) {
        ctx.fillStyle = 'rgba(255, 45, 117, 0.6)';
        ctx.fillRect(centerX + (Math.random()-0.5)*200, centerY + (Math.random()-0.5)*100, 10, 10);
    }
    requestAnimationFrame(drawGrid);
}
drawGrid();

// --- Subgraph Data Fetching ---
async function fetchKills() {
    const query = `
    {
      killeds(first: 10, orderBy: block_number, orderDirection: desc) {
        id
        attacker
        target
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
        const killeds = result.data.killeds;

        if (killeds && killeds.length > 0) {
            lastBlockEl.innerText = killeds[0].block_number;
            // Process new kills only
            killeds.reverse().forEach(kill => {
                if (!knownKillIds.has(kill.id)) {
                    addEventToFeed(kill);
                    knownKillIds.add(kill.id);
                }
            });
        }
    } catch (err) {
        console.error("Subgraph sync failed:", err);
    }
}

function addEventToFeed(kill) {
    const div = document.createElement('div');
    div.className = 'kill-line';
    
    const shortAtk = `${kill.attacker.substring(0,6)}...${kill.attacker.substring(38)}`;
    const shortTgt = `${kill.target.substring(0,6)}...${kill.target.substring(38)}`;
    
    div.innerHTML = `
        <span class="pink-text">${shortAtk}</span> <br>
        CULLED UNITS FROM <span style="color:#fff">${shortTgt}</span><br>
        > BLOCK: ${kill.block_number} 💀
    `;
    
    feed.prepend(div);
    if(feed.childNodes.length > 15) feed.removeChild(feed.lastChild);
}

// --- Timer Loop ---
setInterval(() => {
    time--;
    if (time < 0) {
        time = 5;
        fetchKills();
    }
    blockTimer.innerText = `${time}s`;
}, 1000);

// Initial Load
fetchKills();