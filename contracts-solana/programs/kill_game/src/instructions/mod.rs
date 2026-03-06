pub mod admin;
pub mod initialize;
pub mod kill;
pub mod move_units;
pub mod spawn;

use crate::constants::*;
use crate::state::AgentStack;

// ── Shared helpers ─────────────────────────────────────────────────────────────

/// Returns true when two stack IDs are adjacent (Manhattan distance = 1) in the
/// 6×6×6 grid.  Equivalent to the EVM isAdjacent() check.
pub fn is_adjacent(a: u16, b: u16) -> bool {
    if a == b || a > MAX_STACK_ID || b > MAX_STACK_ID {
        return false;
    }
    let ax = (a % GRID_SIZE) as i16;
    let ay = ((a / GRID_SIZE) % GRID_SIZE) as i16;
    let az = (a / (GRID_SIZE * GRID_SIZE)) as i16;
    let bx = (b % GRID_SIZE) as i16;
    let by = ((b / GRID_SIZE) % GRID_SIZE) as i16;
    let bz = (b / (GRID_SIZE * GRID_SIZE)) as i16;
    (ax - bx).abs() + (ay - by).abs() + (az - bz).abs() == 1
}

/// Combat resolution matching EVM KillGame.sol `_resolveCombat`.
///
/// Reapers count as THERMAL_PARITY (666) units each.  Defender receives a 10%
/// power bonus: we compare `atkRaw × 10  vs  defRaw × 11` to avoid fractions.
/// Equivalent to EVM: `atkP > (defU + defR*666) * 110 / 100`.
///
/// Returns `(attacker_won, surviving_units, surviving_reapers)`.
/// - Win:  attacker keeps ALL sent forces (EVM awards zero casualties to winner).
/// - Loss: attacker loses all sent forces.
pub fn resolve_combat(
    def_units: u64,
    atk_units: u64,
    def_reapers: u64,
    atk_reapers: u64,
) -> (bool, u64, u64) {
    let def_raw = def_units.saturating_add(def_reapers.saturating_mul(THERMAL_PARITY));
    let atk_raw = atk_units.saturating_add(atk_reapers.saturating_mul(THERMAL_PARITY));

    // 10% defender bonus: atkRaw×10 must beat defRaw×11
    if atk_raw.saturating_mul(10) > def_raw.saturating_mul(11) {
        // Attacker wins — EVM: winner suffers zero casualties
        (true, atk_units, atk_reapers)
    } else {
        // Defender wins — attacker loses all sent forces
        (false, 0, 0)
    }
}

/// Calculate the bounty owed for a defender stack based on its age in slots.
///
/// Matches EVM KillGame.sol getPendingBounty():
///   power      = units + reapers × THERMAL_PARITY
///   multiplier = clamp(1 + age_slots / SLOTS_PER_MULTIPLIER, 1, MAX_MULTIPLIER)
///   raw_bounty = power × SPAWN_COST × multiplier
///   cap        = vault_amount × GLOBAL_CAP_BPS / BPS_DENOM  (25% of treasury)
///   bounty     = min(raw_bounty, cap)
pub fn get_pending_bounty(stack: &AgentStack, current_slot: u64, vault_amount: u64) -> u64 {
    if stack.units == 0 && stack.reapers == 0 {
        return 0;
    }
    let age_slots = current_slot.saturating_sub(stack.spawn_slot);
    let mult = (1u64 + age_slots / SLOTS_PER_MULTIPLIER).min(MAX_MULTIPLIER);
    let power = stack.units.saturating_add(stack.reapers.saturating_mul(THERMAL_PARITY));
    let raw = power.saturating_mul(SPAWN_COST).saturating_mul(mult);
    let cap = vault_amount.saturating_mul(GLOBAL_CAP_BPS) / BPS_DENOM;
    if cap == 0 { raw } else { raw.min(cap) }
}
