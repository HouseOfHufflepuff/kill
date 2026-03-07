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
/// Returns `(attacker_won, rem_atk_units, rem_atk_reapers, atk_units_lost, atk_reapers_lost, def_units_lost, def_reapers_lost)`.
/// - Win:  attacker keeps ALL sent forces (EVM awards zero casualties to winner).
///         All defender forces are destroyed.
/// - Loss: attacker loses all sent forces.
///         Defender suffers Lanchester partial loss: defLost = defCount * atkP^2 / defP^2
pub fn resolve_combat(
    def_units: u64,
    atk_units: u64,
    def_reapers: u64,
    atk_reapers: u64,
) -> (bool, u64, u64, u64, u64, u64, u64) {
    let def_raw = def_units.saturating_add(def_reapers.saturating_mul(THERMAL_PARITY));
    let atk_raw = atk_units.saturating_add(atk_reapers.saturating_mul(THERMAL_PARITY));

    // 10% defender bonus: atkRaw×10 must beat defRaw×11
    if atk_raw.saturating_mul(10) > def_raw.saturating_mul(11) {
        // Attacker wins — winner suffers zero casualties, all defender forces destroyed
        (true, atk_units, atk_reapers, 0, 0, def_units, def_reapers)
    } else {
        // Defender wins — attacker loses all sent forces
        // Lanchester partial defender loss: defLost = defCount * atkP^2 / defP^2
        // Using scaled integer math: atkP_scaled = atk_raw*10, defP_scaled = def_raw*11
        let atk_p = (atk_raw as u128).saturating_mul(10);
        let def_p = (def_raw as u128).saturating_mul(11);
        let p_sq = atk_p.saturating_mul(atk_p);
        let d_sq = def_p.saturating_mul(def_p);

        let def_u_lost = if d_sq == 0 {
            0u64
        } else {
            ((def_units as u128).saturating_mul(p_sq) / d_sq)
                .min(def_units as u128) as u64
        };
        let def_r_lost = if d_sq == 0 {
            0u64
        } else {
            ((def_reapers as u128).saturating_mul(p_sq) / d_sq)
                .min(def_reapers as u128) as u64
        };

        (false, 0, 0, atk_units, atk_reapers, def_u_lost, def_r_lost)
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
