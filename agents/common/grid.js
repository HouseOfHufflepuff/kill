"use strict";
// agents/common/grid.js — Chain-agnostic 6×6×6 grid math for KILL agents
//
// Base uses 1-indexed stacks (1–216), Solana uses 0-indexed (0–215).
// All functions here work with raw 0-based coordinates internally.
// Use the factory to get helpers bound to the correct offset.

// ── Raw (0-based) helpers ────────────────────────────────────────────────────

function _coords(v) {
    return { x: v % 6, y: Math.floor(v / 6) % 6, z: Math.floor(v / 36) };
}

function _id(x, y, z) { return (z * 36) + (y * 6) + x; }

// ── Factory: returns grid helpers for a given offset (0 or 1) ────────────────

function createGrid(offset) {
    function getCoords(id) { return _coords(Number(id) - offset); }

    function getId(x, y, z) { return _id(x, y, z) + offset; }

    function getManhattanDist(id1, id2) {
        const c1 = getCoords(id1), c2 = getCoords(id2);
        return Math.abs(c1.x - c2.x) + Math.abs(c1.y - c2.y) + Math.abs(c1.z - c2.z);
    }

    function isAdjacent(id1, id2) { return getManhattanDist(id1, id2) === 1; }

    function getPath3D(startId, endId) {
        let current = getCoords(startId);
        const target = getCoords(endId);
        const steps = [];
        while (current.x !== target.x || current.y !== target.y || current.z !== target.z) {
            const fromId = getId(current.x, current.y, current.z);
            if      (current.x !== target.x) current.x += (target.x > current.x ? 1 : -1);
            else if (current.y !== target.y) current.y += (target.y > current.y ? 1 : -1);
            else if (current.z !== target.z) current.z += (target.z > current.z ? 1 : -1);
            steps.push({ from: fromId, to: getId(current.x, current.y, current.z) });
        }
        return steps;
    }

    return { getCoords, getId, getManhattanDist, isAdjacent, getPath3D };
}

module.exports = { createGrid };
