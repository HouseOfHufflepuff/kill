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

// Live config — bootstrapped to contract defaults, updated from GlobalStat each sync.
// Used for all bounty multiplier, decay, and cost calculations in the FE.
var liveConfig = {
    spawnCost:            20,     // KILL per unit (display units, not wei)
    blocksPerMultiplier:  2273,   // blocks to advance one multiplier step
    maxMultiplier:        20,     // bounty/decay cap
    globalCapBps:         2500,   // max bounty as % of vault (bps)
    treasuryBps:          30,     // fee deducted from bounty (bps)
};

// --- ECONOMIC HELPERS ---

/**
 * Bounty multiplier at a given stack age.
 * Matches contract: 1 + floor(ageBlocks / blocksPerMultiplier), capped at maxMultiplier.
 */
function calcMultiplier(ageBlocks) {
    const m = 1 + Math.floor(ageBlocks / liveConfig.blocksPerMultiplier);
    return Math.min(m, liveConfig.maxMultiplier);
}

/**
 * Power decay percentage at a given multiplier.
 * Matches contract _getDecayPct: 100% at 1x → 20% at maxMultiplier.
 * Formula: 100 - ((mult - 1) * 80) / (maxMultiplier - 1)
 */
function calcDecayPct(multiplier) {
    if (liveConfig.maxMultiplier <= 1) return 100;
    const pct = 100 - ((multiplier - 1) * 80) / (liveConfig.maxMultiplier - 1);
    return Math.max(20, pct);
}

/**
 * Net bounty payout after burn (6.66%) and treasury fee.
 * Matches contract _transferBounty.
 */
function netBountyDisplay(grossKill) {
    const burnFrac     = 666 / 10000;
    const treasuryFrac = liveConfig.treasuryBps / 10000;
    return grossKill * (1 - burnFrac - treasuryFrac);
}

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
