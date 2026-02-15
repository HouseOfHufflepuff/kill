# KILL: A DeFi Strategy Game for Agentic AI

**Technical Specification v2.5**

## **1\. Game Overview: Post-Human Warfare**

KILL is a high-velocity, tokenized strategy engine designed for the ruthless efficiency of **Agentic AI**. Operating as an ERC-1155 contract on the Base Network, KILL transforms the blockchain into a 6x6x6 battlefield. The game is defined by massive bulk actions and near-instantaneous resolution loops where agents coordinate swarms across 216 cubes.

### 1.1 The Combat Cycle

Agents submit a single monolithic transaction each block to resolve three phases in strict order:

1. **KILL**: Combat resolves first. Bounties are extracted and settled instantly.  
2. **SPAWN**: Armies are replenished. The Treasury grows as new units enter.  
3. **MOVE**: Units change positions, resetting their "age" for tactical repositioning.

---

## **2\. Tokenomics & DeFi**

The KILL ecosystem is a "Hard-Cap Deflationary" model with a total supply of **6,666,666,666 tokens**.

### 2.1 Supply Allocation

* **66.6% (Treasury/Game Reserve)**: Locked in-contract to fund proportional bounties.  
* **33.4% (Ecosystem & Liquidity)**: Allocated for Agentic Airdrops and Uniswap V3 Liquidity.

### 2.2 The 6.66% Global Burn

A flat **6.66% burn tax** is applied to every bounty payout, casualty recycling event, and action fee. This creates a supply sink that increases the value density of the remaining tokens over time.

---

## **3\. Core Algorithms**

### 3.1 Proportional Bounty Algorithm

Bounties are a time-decayed percentage of the **Current Contract Balance (CCB)**.

- **Formula**: Bounty \= CCB \* (DeltaBlocks / 10,000) \* Multiplier  
- **Standard Multiplier**: 1x (Max 0.01% of CCB per REAPER).  
- **Boss Reaper Jackpot**: 666x (Max 6.66% of CCB per event).

### 3.2 The Meat-Grinder (Mutual Destruction)

There are no defense stats. Combat is a cold exchange of lives.

* **Standard Kill**: 2 Attackers : 1 Target. **1 Attacker is sacrificed.**  
* **HitBoost Kill**: 666 Attackers : 1 Target. **66 Attackers are sacrificed.**

### 3.3 Casualty Recycling

When an attacker is sacrificed, its 10 KILL spawn value is handled as follows:

* **93.34%**: Returned to the Treasury (CCB).  
* **6.66%**: Permanently Burned.

---

## **4\. Agentic AI Training: Tactical Logic**

Training an agent for KILL requires a deep understanding of "The Meat Grinder" and "Mempool Dominance."

### 4.1 The Profitability Threshold

An agent must never execute a "net-negative" attack. **Attack Condition**: `(Bounty × 0.9334) > (10 KILL × Casualty Rate) + Action Fee`

### 4.2 Mempool Tactics & Priority Gas Wars

* **Frontrunning**: Identifying a rival’s KILL transaction in the mempool and outbidding them on gas to steal the bounty.  
* **The Gas Trap**: Calculating if the priority fee required to win a gas war negates the bounty's profit.

### Stack Hunting & Strategy

In **KILLGame**, units are not just numbers on a map; they are time-locked financial assets tied to a specific player’s address. This creates a high-stakes meta-game called **Stack Hunting**.

---

#### 1\. The Core Mechanic: Individual Aging

Unlike a traditional territory game where you attack "the red team," you are attacking **Address X's specific stack**.

* **The Bounty Formula:** $Bounty \= Treasury \\times \\frac{Blocks\_Survived}{Scale}$  
* **The Logic:** A stack that has survived for 10,000 blocks is worth significantly more than several newer stacks combined.

#### 2\. The Hunter's Strategy

A "Hunter" scans the grid for the **oldest stack**, not the weakest defense.

* **Target Selection:** You ignore the player who just spawned. You target the player who has held a position for days. Their "time-accrued bounty" is the jackpot.  
* **Force Multipliers:** Using `boosted = true` allows you to liquidate these "ripe" stacks faster, provided you have the elite units (ID 217+) to back it up.

#### 3\. The Defender's Dilemma

Farmers want stacks to age to maximize value, but age increases their "heat" (attractiveness to hunters).

| Tactic | Pros | Cons |
| :---- | :---- | :---- |
| **Hiding** | Move to low-traffic cubes. | Isolated from allies. |
| **Refreshing** | Use `move()` to reset your `birthBlock`. | Resets accrued bounty to zero. |
| **Splitting** | Divide units across multiple addresses. | Higher gas costs; lower individual payouts. |

---

#### 4\. Technical Implementation

The `kill` function explicitly targets an address to resolve this:

function kill(

    address target,    // The specific prey

    uint16 cube,       // The hunting ground

    uint256 amount,    // The size of the bite

    bool boosted       // The intensity

) external returns (uint256 bountyPaid)

---

## **One-Year Economic Simulation**

*Assumption: 1,000 starting agents growing 50% YoY to 1,500. Values in KILL tokens.*

| Month | Agents | Total Actions | KILL Added (Spawn/Fees) | KILL Extracted (Bounties) | Treasury Balance (CCB) | Total Burned |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| **Launch** | 1,000 | 1.2M | 12,000,000 | 0 | 456,000,000 | 799,200 |
| **M1** | 1,040 | 1.5M | 4,200,000 | 3,100,000 | 457,100,000 | 1,278,400 |
| **M2** | 1,085 | 1.8M | 4,800,000 | 3,800,000 | 458,100,000 | 1,844,200 |
| **M3** | 1,125 | 2.1M | 5,400,000 | 4,500,000 | 459,000,000 | 2,506,800 |
| **M4** | 1,170 | 2.4M | 6,100,000 | 5,300,000 | 459,800,000 | 3,266,000 |
| **M5** | 1,210 | 2.8M | 6,800,000 | 6,200,000 | 460,400,000 | 4,121,600 |
| **M6** | 1,250 | 3.1M | 7,500,000 | 7,100,000 | 460,800,000 | 5,094,400 |
| **M7** | 1,295 | 3.5M | 8,300,000 | 8,200,000 | 460,900,000 | 6,192,800 |
| **M8** | 1,340 | 3.9M | 9,200,000 | 9,400,000 | 460,700,000 | 7,432,600 |
| **M9** | 1,380 | 4.3M | 10,100,000 | 10,800,000 | 460,000,000 | 8,826,800 |
| **M10** | 1,425 | 4.8M | 11,200,000 | 12,300,000 | 458,900,000 | 10,394,400 |
| **M11** | 1,460 | 5.3M | 12,400,000 | 14,100,000 | 457,200,000 | 12,160,200 |
| **M12** | 1,500 | 5.9M | 13,800,000 | 16,200,000 | 454,800,000 | 14,158,000 |

---

## **6\. Summary of Costs**

| Action | Cost | Distribution |
| :---- | :---- | :---- |
| **SPAWN** | 10 KILL | 9.334 Treasury / 0.666 Burn |
| **KILL FEE** | 1 KILL | 0.933 Treasury / 0.067 Burn |
| **MOVE FEE** | 0.1 KILL | 0.093 Treasury / 0.007 Burn |
|  |  |  |

---

### 4.4 The Overwhelming Force Paradox (Attrition Mechanics)

Under the Inverse Square Law, a "fair fight" is a mathematical failure. Agents must prioritize "Steamrolling" to preserve capital. As your power ratio relative to the defender increases, your casualties drop exponentially, not linearly.

* **1.1x Advantage**: Attacker wins but loses ~82% of their force.
* **2.0x Advantage**: Attacker wins and loses only ~25% of their force.
* **10.0x Advantage**: Attacker wins and loses only 1% of their force.

**Agent Logic**: Successful agents should never commit to an attack unless the Force Ratio is $> 5:1$, unless the Bounty accrued by the target is large enough to offset a high-casualty "Strategic Exchange."



### 4.5 Battle Progression: 50-Step Attrition Simulation

This table simulates an Attacker's casualties against a fixed Defender stack (100 units + 10% Defense Bonus = 110 Effective Power).

| Step | Attacker Units | Attacker Power | Winner | Units Lost | Loss % |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | 100 | 100 | Defender | 100 | 100% |
| 2 | 111 | 111 | Attacker | 109 | 98.2% |
| 3 | 120 | 120 | Attacker | 100 | 83.3% |
| 5 | 140 | 140 | Attacker | 86 | 61.4% |
| 7 | 160 | 160 | Attacker | 75 | 46.8% |
| 10 | 190 | 190 | Attacker | 63 | 33.1% |
| 15 | 240 | 240 | Attacker | 50 | 20.8% |
| 20 | 300 | 300 | Attacker | 40 | 13.3% |
| 25 | 350 | 350 | Attacker | 34 | 9.7% |
| 30 | 400 | 400 | Attacker | 30 | 7.5% |
| 35 | 450 | 450 | Attacker | 26 | 5.7% |
| 40 | 500 | 500 | Attacker | 24 | 4.8% |
| 45 | 1000 | 1000 | Attacker | 12 | 1.2% |
| 50 | 10000 | 10000 | Attacker | 1 | 0.01% |

## **Viewer**
* **cube**: 6x6x6 cube, each of 216 cubes clicable and can view num reaper, kills, wallet rank on stack, bounty
* **leaderboard**: top wallets by kill token received in game
* **totals**: Total kill token burned, total kill token in treasury, total kills in game, total token spent, total token earned, price of kill token.
* **real time**: Real time log of actions performed in game (via solidity events)

