/**
 * KILL SYSTEM CORE - app.js
 */

// --- STATE MANAGEMENT ---
var knownIds = new Set();
var agentPnL = {}; 
var lastBlock = 0;
var syncCounter = 2;
var stackRegistry = {}; 
var currentGlobalKillStacked = 0;
var isDragging = false, startX, startY, rotateX = 60, rotateZ = -45;

// Filtering State
var activeFilterAgent = null;
var isLogPaused = false;
var selectedStacks = new Set();

// --- BOOT SEQUENCE ---
const BOOT_LINES = [
    { t: `KILL SYSTEM v1.0.6 — ${NETWORK.toUpperCase()}`, c: '' },
    { t: 'LOADING CORE ENGINE...', c: 'ok' },
    { t: 'INITIALIZING TACTICAL DISPLAY...', c: 'ok' },
    { t: 'CONNECTING TO GOLDSKY SUBGRAPH...', c: 'ok' },
    { t: 'SYNCING BLOCK DATA...', c: 'ok' },
    { t: 'AGENT MODULE: STANDBY', c: 'warn' },
    { t: 'SPECTATOR MODE ACTIVE', c: '' },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function runBoot() {
    const bootEl = document.getElementById('boot');
    const linesEl = document.getElementById('boot-lines');
    const fillEl = document.getElementById('boot-fill');
    for (let i = 0; i < BOOT_LINES.length; i++) {
        const d = document.createElement('div');
        d.className = 'bline ' + BOOT_LINES[i].c;
        d.textContent = '> ' + BOOT_LINES[i].t;
        linesEl.appendChild(d);
        fillEl.style.width = ((i + 1) / BOOT_LINES.length * 100) + '%';
        await sleep(180 + Math.random() * 120);
    }
    fillEl.style.width = '100%';
    await sleep(380);
    bootEl.style.transition = 'opacity .55s';
    bootEl.style.opacity = '0';
    await sleep(560);
    bootEl.style.display = 'none';
    startGame();
}

function startGame() {
    initBattlefield();
    syncData();
    setInterval(() => {
        syncCounter--;
        if (syncCounter < 0) { syncCounter = 2; syncData(); }
    }, 1000);
}

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    if (networkLabel) networkLabel.innerText = NETWORK.toUpperCase();
    document.querySelectorAll('.net-var').forEach(el => el.innerText = NETWORK);
    runBoot();
});

/**
 * CAMERA: 3D Battlefield Controls
 */
window.onmousedown = (e) => {
    const isUI = e.target.className === 'node' || 
                 e.target.closest('.panel') || 
                 e.target.closest('.modal-content') || 
                 e.target.closest('.layer-controls');
                 
    if (isUI) return;
    
    isDragging = true; 
    startX = e.clientX; 
    startY = e.clientY;
};

window.onmouseup = () => { isDragging = false; };

window.onmousemove = (e) => {
    if (!isDragging || !battleField) return;
    
    rotateZ += (e.clientX - startX) * 0.5; 
    rotateX -= (e.clientY - startY) * 0.5;
    
    battleField.style.transform = `rotateX(${rotateX}deg) rotateZ(${rotateZ}deg)`;
    
    startX = e.clientX; 
    startY = e.clientY;
};

window.addEventListener('click', (e) => { 
    if (e.target === agentModal) toggleModal(false); 
});

console.log(`KILL AGENT MODULE INITIALIZED: ${NETWORK}`);