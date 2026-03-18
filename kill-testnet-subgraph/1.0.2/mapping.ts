import {
  Spawned as SpawnedEvent,
  Moved as MovedEvent,
  Killed as KilledEvent,
  GlobalStats as GlobalStatsEvent,
  ConfigUpdated as ConfigUpdatedEvent,
  Claimed as ClaimedEvent
} from "./generated/killgame/killgame"

import {
  Spawned,
  Moved,
  Killed,
  Claimed,
  Stack,
  AgentStack,
  GlobalStat,
  Agent,
  Config
} from "./generated/schema"
import { BigInt, Bytes } from "@graphprotocol/graph-ts"

// --- IMMUTABLE CONSTANTS (never change) ---
const BURN_BPS      = BigInt.fromI32(666);   // 6.66% burned from every bounty payout
const MOVE_COST_WEI = BigInt.fromI32(100).times(BigInt.fromI32(10).pow(18)); // 100 KILL fixed
const BPS_DENOM     = BigInt.fromI32(10000);

// --- CONTRACT DEFAULTS (bootstrapped on first event, kept in sync via ConfigUpdated) ---
const DEFAULT_SPAWN_COST            = BigInt.fromI32(20).times(BigInt.fromI32(10).pow(18));
const DEFAULT_TREASURY_BPS          = BigInt.fromI32(30);
const DEFAULT_MAX_MULTIPLIER        = BigInt.fromI32(20);
const DEFAULT_BLOCKS_PER_MULTIPLIER = BigInt.fromI32(2273);
const DEFAULT_GLOBAL_CAP_BPS        = BigInt.fromI32(2500);

// --- CONFIG HELPERS ---

function getOrCreateConfig(): Config {
  let cfg = Config.load("current")
  if (cfg == null) {
    cfg = new Config("current")
    cfg.spawnCost            = DEFAULT_SPAWN_COST
    cfg.treasuryBps          = DEFAULT_TREASURY_BPS
    cfg.maxMultiplier        = DEFAULT_MAX_MULTIPLIER
    cfg.blocksPerMultiplier  = DEFAULT_BLOCKS_PER_MULTIPLIER
    cfg.globalCapBps         = DEFAULT_GLOBAL_CAP_BPS
    cfg.save()
  }
  return cfg
}

// --- BOUNTY HELPERS ---

// Net payout = gross - burn% - treasury%.
// Both deductions use the gross amount as base (matching _transferBounty in contract).
function netPayout(gross: BigInt, treasuryBps: BigInt): BigInt {
  if (gross.equals(BigInt.fromI32(0))) return BigInt.fromI32(0);
  let burnAmt     = gross.times(BURN_BPS).div(BPS_DENOM);
  let treasuryAmt = gross.times(treasuryBps).div(BPS_DENOM);
  return gross.minus(burnAmt).minus(treasuryAmt);
}

// Bounty formula matches contract: headcount (units + reapers, NOT power) * 1e18 * multiplier.
// Power (666x reaper multiplier) is only for combat — never for economic payouts.
function calculateStackBounty(stack: Stack, currentBlock: BigInt, cfg: Config): void {
  if (stack.birthBlock.equals(BigInt.fromI32(0))) {
    stack.currentBounty = BigInt.fromI32(0);
    return;
  }

  let stats = GlobalStat.load("current");
  if (stats == null) {
    stack.currentBounty = BigInt.fromI32(0);
    return;
  }

  let age        = currentBlock.minus(stack.birthBlock);
  let multiplier = BigInt.fromI32(1).plus(age.div(cfg.blocksPerMultiplier));
  if (multiplier.gt(cfg.maxMultiplier)) multiplier = cfg.maxMultiplier;

  // Headcount only — reapers count as 1 for bounty, 666 for combat
  let headcount = stack.totalStandardUnits.plus(stack.totalBoostedUnits);
  let rawBounty = headcount.times(BigInt.fromI32(10).pow(18)).times(multiplier);

  let treasury  = stats.currentTreasury;
  let globalCap = treasury.times(cfg.globalCapBps).div(BPS_DENOM);

  stack.currentBounty = rawBounty.gt(globalCap) ? globalCap : rawBounty;
}

// --- AGENT HELPERS ---

function getOrCreateAgent(address: Bytes, blockNumber: BigInt): Agent {
  let id    = address.toHex()
  let agent = Agent.load(id)
  if (agent == null) {
    agent = new Agent(id)
    agent.totalSpent      = BigInt.fromI32(0)
    agent.totalEarned     = BigInt.fromI32(0)
    agent.netPnL          = BigInt.fromI32(0)
    agent.lastActiveBlock = blockNumber
    agent.airdropClaimed  = false
    agent.save()
  }
  return agent
}

function updateAgentFinance(address: Bytes, spent: BigInt, earned: BigInt, blockNumber: BigInt): void {
  let agent = getOrCreateAgent(address, blockNumber)
  agent.totalSpent      = agent.totalSpent.plus(spent)
  agent.totalEarned     = agent.totalEarned.plus(earned)
  agent.netPnL          = agent.totalEarned.minus(agent.totalSpent)
  agent.lastActiveBlock = blockNumber
  agent.save()
}

// --- STACK HELPERS ---

function getOrCreateStack(stackId: string): Stack {
  let stack = Stack.load(stackId)
  if (stack == null) {
    stack = new Stack(stackId)
    stack.totalStandardUnits = BigInt.fromI32(0)
    stack.totalBoostedUnits  = BigInt.fromI32(0)
    stack.birthBlock         = BigInt.fromI32(0)
    stack.currentBounty      = BigInt.fromI32(0)
    stack.active             = false
    stack.save()
  }
  return stack
}

function getOrCreateAgentStack(agent: Bytes, stackId: BigInt): AgentStack {
  let id     = agent.toHex() + "-" + stackId.toString()
  let aStack = AgentStack.load(id)
  if (aStack == null) {
    aStack            = new AgentStack(id)
    aStack.agent      = agent
    aStack.stackId    = stackId
    aStack.units      = BigInt.fromI32(0)
    aStack.reaper     = BigInt.fromI32(0)
    aStack.birthBlock = BigInt.fromI32(0)
  }
  return aStack
}

function safeSubtract(current: BigInt, amount: BigInt): BigInt {
  if (amount.gt(current)) return BigInt.fromI32(0)
  return current.minus(amount)
}

// --- EVENT HANDLERS ---

export function handleSpawned(event: SpawnedEvent): void {
  let entity          = new Spawned(event.transaction.hash.toHex() + "-" + event.logIndex.toString())
  entity.agent        = event.params.agent
  entity.stackId      = event.params.stackId
  entity.units        = event.params.units
  entity.reapers      = event.params.reapers
  entity.birthBlock   = event.params.birthBlock
  entity.block_number = event.block.number
  entity.save()

  // Cost = spawnCost (from Config) * units spawned
  let cfg       = getOrCreateConfig()
  let spawnCost = cfg.spawnCost.times(event.params.units)
  updateAgentFinance(event.params.agent, spawnCost, BigInt.fromI32(0), event.block.number)

  let stack = getOrCreateStack(event.params.stackId.toString())
  stack.totalStandardUnits = stack.totalStandardUnits.plus(event.params.units)
  stack.totalBoostedUnits  = stack.totalBoostedUnits.plus(event.params.reapers)
  stack.active             = true
  if (stack.birthBlock.equals(BigInt.fromI32(0))) stack.birthBlock = event.params.birthBlock
  calculateStackBounty(stack, event.block.number, cfg)
  stack.save()

  let aStack        = getOrCreateAgentStack(event.params.agent, event.params.stackId)
  aStack.units      = aStack.units.plus(event.params.units)
  aStack.reaper     = aStack.reaper.plus(event.params.reapers)
  aStack.birthBlock = event.params.birthBlock
  aStack.save()
}

export function handleMoved(event: MovedEvent): void {
  let entity          = new Moved(event.transaction.hash.toHex() + "-" + event.logIndex.toString())
  let fromStackId     = BigInt.fromI32(event.params.fromStack)
  let toStackId       = BigInt.fromI32(event.params.toStack)

  entity.agent        = event.params.agent
  entity.fromStack    = fromStackId
  entity.toStack      = toStackId
  entity.units        = event.params.units
  entity.reaper       = event.params.reaper
  entity.birthBlock   = event.params.birthBlock
  entity.block_number = event.block.number
  entity.save()

  // Move cost is a fixed constant — 100 KILL, not configurable
  updateAgentFinance(event.params.agent, MOVE_COST_WEI, BigInt.fromI32(0), event.block.number)

  let cfg = getOrCreateConfig()

  let fromStack = getOrCreateStack(fromStackId.toString())
  fromStack.totalStandardUnits = safeSubtract(fromStack.totalStandardUnits, event.params.units)
  fromStack.totalBoostedUnits  = safeSubtract(fromStack.totalBoostedUnits, event.params.reaper)
  if (fromStack.totalStandardUnits.equals(BigInt.fromI32(0)) && fromStack.totalBoostedUnits.equals(BigInt.fromI32(0))) {
    fromStack.birthBlock = BigInt.fromI32(0)
    fromStack.active     = false
  }
  calculateStackBounty(fromStack, event.block.number, cfg)
  fromStack.save()

  let toStack = getOrCreateStack(toStackId.toString())
  toStack.totalStandardUnits = toStack.totalStandardUnits.plus(event.params.units)
  toStack.totalBoostedUnits  = toStack.totalBoostedUnits.plus(event.params.reaper)
  toStack.birthBlock         = event.params.birthBlock
  toStack.active             = true
  calculateStackBounty(toStack, event.block.number, cfg)
  toStack.save()

  let aStackFrom    = getOrCreateAgentStack(event.params.agent, fromStackId)
  aStackFrom.units  = safeSubtract(aStackFrom.units, event.params.units)
  aStackFrom.reaper = safeSubtract(aStackFrom.reaper, event.params.reaper)
  aStackFrom.save()

  let aStackTo        = getOrCreateAgentStack(event.params.agent, toStackId)
  aStackTo.units      = aStackTo.units.plus(event.params.units)
  aStackTo.reaper     = aStackTo.reaper.plus(event.params.reaper)
  aStackTo.birthBlock = event.params.birthBlock
  aStackTo.save()
}

export function handleKilled(event: KilledEvent): void {
  let entity          = new Killed(event.transaction.hash.toHex() + "-" + event.logIndex.toString())
  let summary         = event.params.summary
  let stackId         = BigInt.fromI32(event.params.stackId as i32)

  entity.attacker              = event.params.attacker
  entity.target                = event.params.target
  entity.stackId               = stackId
  entity.attackerUnitsSent     = summary.attackerUnitsSent
  entity.attackerReaperSent    = summary.attackerReaperSent
  entity.attackerUnitsLost     = summary.attackerUnitsLost
  entity.attackerReaperLost    = summary.attackerReaperLost
  entity.targetUnitsLost       = summary.targetUnitsLost
  entity.targetReaperLost      = summary.targetReaperLost
  entity.initialDefenderUnits  = summary.initialDefenderUnits
  entity.initialDefenderReaper = summary.initialDefenderReaper
  entity.attackerBounty        = summary.attackerBounty
  entity.defenderBounty        = summary.defenderBounty
  entity.targetBirthBlock      = event.params.targetBirthBlock
  entity.block_number          = event.block.number
  entity.save()

  // Bounties in BattleSummary are gross values before deductions.
  // Net payout = gross - burn (6.66%) - treasury fee (treasuryBps).
  let cfg    = getOrCreateConfig()
  let netAtk = netPayout(summary.attackerBounty, cfg.treasuryBps)
  let netDef = netPayout(summary.defenderBounty, cfg.treasuryBps)

  updateAgentFinance(event.params.attacker, BigInt.fromI32(0), netAtk, event.block.number)
  updateAgentFinance(event.params.target,   BigInt.fromI32(0), netDef, event.block.number)

  let stack = getOrCreateStack(stackId.toString())
  stack.totalStandardUnits = safeSubtract(stack.totalStandardUnits, summary.targetUnitsLost)
  stack.totalBoostedUnits  = safeSubtract(stack.totalBoostedUnits,  summary.targetReaperLost)
  if (stack.totalStandardUnits.equals(BigInt.fromI32(0)) && stack.totalBoostedUnits.equals(BigInt.fromI32(0))) {
    stack.active     = false
    stack.birthBlock = BigInt.fromI32(0)
  }
  calculateStackBounty(stack, event.block.number, cfg)
  stack.save()

  let aStackTarget       = getOrCreateAgentStack(event.params.target, stackId)
  aStackTarget.units     = safeSubtract(aStackTarget.units,  summary.targetUnitsLost)
  aStackTarget.reaper    = safeSubtract(aStackTarget.reaper, summary.targetReaperLost)
  aStackTarget.save()
}

export function handleGlobalStats(event: GlobalStatsEvent): void {
  let stats = GlobalStat.load("current")
  if (stats == null) stats = new GlobalStat("current")

  stats.totalUnitsKilled  = event.params.totalUnitsKilled
  stats.totalReaperKilled = event.params.totalReaperKilled
  stats.killAdded         = event.params.killAdded
  stats.killExtracted     = event.params.killExtracted
  stats.killBurned        = event.params.killBurned

  let outflows           = stats.killExtracted.plus(stats.killBurned)
  stats.currentTreasury  = stats.killAdded.minus(outflows)
  stats.totalPnL         = stats.currentTreasury

  // Mirror live config so FE can get everything in one GlobalStat query
  let cfg                   = getOrCreateConfig()
  stats.spawnCost           = cfg.spawnCost
  stats.blocksPerMultiplier = cfg.blocksPerMultiplier
  stats.maxMultiplier       = cfg.maxMultiplier
  stats.globalCapBps        = cfg.globalCapBps
  stats.maxBounty           = stats.currentTreasury.times(cfg.globalCapBps).div(BPS_DENOM)

  stats.save()
}

// Updates Config singleton whenever the owner calls setConfig().
// All subsequent bounty and P&L calculations automatically use the new values.
export function handleConfigUpdated(event: ConfigUpdatedEvent): void {
  let cfg                  = getOrCreateConfig()
  cfg.spawnCost            = event.params.spawnCost
  cfg.treasuryBps          = event.params.treasuryBps
  cfg.maxMultiplier        = event.params.maxMultiplier
  cfg.blocksPerMultiplier  = event.params.blocksPerMultiplier
  cfg.globalCapBps         = event.params.globalCapBps
  cfg.save()

  // Keep GlobalStat mirror in sync immediately
  let stats = GlobalStat.load("current")
  if (stats != null) {
    stats.spawnCost           = cfg.spawnCost
    stats.blocksPerMultiplier = cfg.blocksPerMultiplier
    stats.maxMultiplier       = cfg.maxMultiplier
    stats.globalCapBps        = cfg.globalCapBps
    stats.maxBounty           = stats.currentTreasury.times(cfg.globalCapBps).div(BPS_DENOM)
    stats.save()
  }
}

// Airdrop claims — free spawn funded by vault, no cost to agent P&L.
// Units and reapers are credited to AgentStack and Stack identically to a normal spawn,
// but totalSpent is NOT incremented.
export function handleClaimed(event: ClaimedEvent): void {
  let entity          = new Claimed(event.transaction.hash.toHex() + "-" + event.logIndex.toString())
  entity.claimer      = event.params.claimer
  entity.stackId      = BigInt.fromI32(event.params.stackId as i32)
  entity.units        = event.params.units
  entity.block_number = event.block.number
  entity.save()

  // Mark agent as having claimed — do NOT add to totalSpent
  let agent             = getOrCreateAgent(event.params.claimer, event.block.number)
  agent.airdropClaimed  = true
  agent.lastActiveBlock = event.block.number
  agent.save()

  // Reapers minted by contract = units / 666 (mirrors _mintAndReg logic in claim())
  let reapers = event.params.units.div(BigInt.fromI32(666))
  let stackId = BigInt.fromI32(event.params.stackId as i32)

  let cfg   = getOrCreateConfig()
  let stack = getOrCreateStack(stackId.toString())
  stack.totalStandardUnits = stack.totalStandardUnits.plus(event.params.units)
  stack.totalBoostedUnits  = stack.totalBoostedUnits.plus(reapers)
  stack.active             = true
  if (stack.birthBlock.equals(BigInt.fromI32(0))) stack.birthBlock = event.block.number
  calculateStackBounty(stack, event.block.number, cfg)
  stack.save()

  let aStack        = getOrCreateAgentStack(event.params.claimer, stackId)
  aStack.units      = aStack.units.plus(event.params.units)
  aStack.reaper     = aStack.reaper.plus(reapers)
  aStack.birthBlock = event.block.number
  aStack.save()
}
