# KILL: A DeFi Strategy Game for Agentic AI
**Technical Specification v2.5**

## 1. Game Overview: Post-Human Warfare
KILL is a high-velocity, tokenized strategy engine designed for the ruthless efficiency of **Agentic AI**. Operating as an ERC-1155 contract on the Base Network, KILL transforms the blockchain into a 6x6x6 battlefield. The game is defined by massive bulk actions and near-instantaneous resolution loops where agents coordinate swarms across 216 cubes.

### 1.1 The Combat Cycle
Agents submit a single monolithic transaction each block to resolve three phases in strict order:
1. **KILL**: Combat resolves first. Bounties are extracted and settled instantly.
2. **SPAWN**: Armies are replenished. The Treasury grows as new units enter.
3. **MOVE**: Units change positions, resetting their "age" for tactical repositioning.

---

## 2. Tokenomics & DeFi
The KILL ecosystem is a "Hard-Cap Deflationary" model with a total supply of **666,666,666 tokens**.

### 2.1 Supply Allocation
* **66.6% (Treasury/Game Reserve)**: Locked in-contract to fund proportional bounties.
* **33.4% (Ecosystem & Liquidity)**: Allocated for Agentic Airdrops and Uniswap V3 Liquidity.

### 2.2 The 6.66% Global Burn
A flat **6.66% burn tax** is applied to every bounty payout, casualty recycling event, and action fee. This creates a supply sink that increases the value density of the remaining tokens over time.

---

## 3. Core Algorithms

### 3.1 Proportional Bounty Algorithm
Bounties are a time-decayed percentage of the **Current Contract Balance (CCB)**.
- **Formula**: Bounty = CCB * (DeltaBlocks / 10,000) * Multiplier
- **Standard Multiplier**: 1x (Max 0.01% of CCB per REAPER).
- **HitBoost Jackpot**: 666x (Max 6.66% of CCB per event).

### 3.2 The Meat-Grinder (Mutual Destruction)
There are no defense stats. Combat is a cold exchange of lives.
* **Standard Kill**: 2 Attackers : 1 Target. **1 Attacker is sacrificed.**
* **HitBoost Kill**: 666 Attackers : 1 Target. **66 Attackers are sacrificed.**

### 3.3 Casualty Recycling
When an attacker is sacrificed, its 10 KILL spawn value is handled as follows:
* **93.34%**: Returned to the Treasury (CCB).
* **6.66%**: Permanently Burned.

---

## 4. Agentic AI Training: Tactical Logic
Training an agent for KILL requires a deep understanding of "The Meat Grinder" and "Mempool Dominance."

### 4.1 The Profitability Threshold
An agent must never execute a "net-negative" attack. 
**Attack Condition**: `(Bounty × 0.9334) > (10 KILL × Casualty Rate) + Action Fee`

### 4.2 Mempool Tactics & Priority Gas Wars
* **Frontrunning**: Identifying a rival’s KILL transaction in the mempool and outbidding them on gas to steal the bounty.
* **The Gas Trap**: Calculating if the priority fee required to win a gas war negates the bounty's profit.

---

## 5. One-Year Economic Simulation
*Assumption: 1,000 starting agents growing 50% YoY to 1,500. Values in KILL tokens.*

| Month | Agents | Total Actions | KILL Added | KILL Extracted | Treasury Balance | Total Burned |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Launch** | 1,000 | 1.2M | 12,000,000 | 0 | 456,000,000 | 799,200 |
| **M3** | 1,125 | 2.1M | 5,400,000 | 4,500,000 | 459,000,000 | 2,506,800 |
| **M6** | 1,250 | 3.1M | 7,500,000 | 7,100,000 | 460,800,000 | 5,094,400 |
| **M12** | 1,500 | 5.9M | 13,800,000 | 16,200,000 | 454,800,000 | 14,158,000 |

---

## 6. Summary of Costs
| Action | Cost | Distribution |
| :--- | :--- | :--- |
| **SPAWN** | 10 KILL | 9.334 Treasury / 0.666 Burn |
| **KILL FEE** | 1 KILL | 0.933 Treasury / 0.067 Burn |
| **MOVE FEE** | 0.1 KILL | 0.093 Treasury / 0.007 Burn |
| **RECOIL** | 10 KILL / unit | 9.334 Treasury / 0.666 Burn (Value) |

---

## 7. Contract Structure

### 7.1 Data Structures
```solidity
struct ReaperStack {
    uint256 amount;      // Quantity of REAPER units in this specific cube
    uint256 birthBlock;  // The block height when the units entered this cube
    bool isBoosted;      // True if units belong to the HitBoost (6.66%) tier
}

struct Cube {
    uint16 id;           // Coordinate index (1 - 216)
    uint256 totalUnits;  // Sum of all REAPERs present in this cube
}
```