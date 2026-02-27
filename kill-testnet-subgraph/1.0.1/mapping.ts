import {
  Spawned as SpawnedEvent,
  Moved as MovedEvent,
  Killed as KilledEvent,
  GlobalStats as GlobalStatsEvent
} from "./generated/killgame/killgame"

import { 
  Spawned, 
  Moved, 
  Killed, 
  Stack, 
  AgentStack, 
  GlobalStat, 
  Agent 
} from "./generated/schema"
import { BigInt, Bytes } from "@graphprotocol/graph-ts"

// --- CONSTANTS ---
const KILL_DECIMALS = BigInt.fromI32(10).pow(18);
const UNIT_PRICE_WEI = BigInt.fromI32(10).times(KILL_DECIMALS);
const MOVE_COST_WEI = BigInt.fromI32(10).times(KILL_DECIMALS);
const REAPER_POWER = BigInt.fromI32(666);
const BURN_BPS = BigInt.fromI32(666); 
const BLOCKS_PER_MULTIPLIER = BigInt.fromI32(1080);
const MAX_MULTIPLIER = BigInt.fromI32(20);
const GLOBAL_CAP_BPS = BigInt.fromI32(2500);

// --- HELPERS ---

/**
 * Calculates net payout after contract-level burns/fees.
 * Matches the logic in the contract's _transferBounty function.
 */
function calculateNetBounty(grossAmount: BigInt): BigInt {
  if (grossAmount.equals(BigInt.fromI32(0))) return BigInt.fromI32(0);
  let burnAmt = grossAmount.times(BURN_BPS).div(BigInt.fromI32(10000));
  return grossAmount.minus(burnAmt);
}

function getOrCreateAgent(address: Bytes, blockNumber: BigInt): Agent {
  let id = address.toHex()
  let agent = Agent.load(id)
  if (agent == null) {
    agent = new Agent(id)
    agent.totalSpent = BigInt.fromI32(0)
    agent.totalEarned = BigInt.fromI32(0)
    agent.netPnL = BigInt.fromI32(0)
    agent.lastActiveBlock = blockNumber
    agent.save()
  }
  return agent
}

function updateAgentFinance(address: Bytes, spent: BigInt, earned: BigInt, blockNumber: BigInt): void {
  let agent = getOrCreateAgent(address, blockNumber)
  agent.totalSpent = agent.totalSpent.plus(spent)
  agent.totalEarned = agent.totalEarned.plus(earned)
  agent.netPnL = agent.totalEarned.minus(agent.totalSpent)
  agent.lastActiveBlock = blockNumber
  agent.save()
}

function getOrCreateStack(stackId: string): Stack {
  let stack = Stack.load(stackId)
  if (stack == null) {
    stack = new Stack(stackId)
    stack.totalStandardUnits = BigInt.fromI32(0)
    stack.totalBoostedUnits = BigInt.fromI32(0)
    stack.birthBlock = BigInt.fromI32(0)
    stack.currentBounty = BigInt.fromI32(0)
    stack.active = false
    stack.save()
  }
  return stack
}

function calculateStackBounty(stack: Stack, currentBlock: BigInt): void {
  let stats = GlobalStat.load("current")
  if (stats == null || stack.birthBlock.equals(BigInt.fromI32(0))) {
    stack.currentBounty = BigInt.fromI32(0);
    return;
  }

  let age = currentBlock.minus(stack.birthBlock);
  let multiplier = BigInt.fromI32(1).plus(age.div(BLOCKS_PER_MULTIPLIER));
  if (multiplier.gt(MAX_MULTIPLIER)) multiplier = MAX_MULTIPLIER;

  let stackPower = stack.totalStandardUnits.plus(stack.totalBoostedUnits.times(REAPER_POWER));
  let rawBounty = stackPower.times(UNIT_PRICE_WEI).times(multiplier);

  let treasury = stats.currentTreasury;
  let globalCap = treasury.times(GLOBAL_CAP_BPS).div(BigInt.fromI32(10000));

  stack.currentBounty = rawBounty.gt(globalCap) ? globalCap : rawBounty;
}

function getOrCreateAgentStack(agent: Bytes, stackId: BigInt): AgentStack {
  let id = agent.toHex() + "-" + stackId.toString()
  let aStack = AgentStack.load(id)
  if (aStack == null) {
    aStack = new AgentStack(id)
    aStack.agent = agent
    aStack.stackId = stackId
    aStack.units = BigInt.fromI32(0)
    aStack.reaper = BigInt.fromI32(0)
    aStack.birthBlock = BigInt.fromI32(0)
  }
  return aStack
}

function safeSubtract(current: BigInt, amount: BigInt): BigInt {
  if (amount.gt(current)) return BigInt.fromI32(0)
  return current.minus(amount)
}

// --- HANDLERS ---

export function handleSpawned(event: SpawnedEvent): void {
  let entity = new Spawned(event.transaction.hash.toHex() + "-" + event.logIndex.toString())
  entity.agent = event.params.agent
  entity.stackId = event.params.stackId
  entity.units = event.params.units
  entity.reapers = event.params.reapers 
  entity.birthBlock = event.params.birthBlock
  entity.block_number = event.block.number
  entity.save()

  // FIX: Match contract cost logic: totalCost = amount * 10
  let actualCost = event.params.units.times(UNIT_PRICE_WEI);
  
  updateAgentFinance(event.params.agent, actualCost, BigInt.fromI32(0), event.block.number)

  let stack = getOrCreateStack(event.params.stackId.toString())
  stack.totalStandardUnits = stack.totalStandardUnits.plus(event.params.units)
  stack.totalBoostedUnits = stack.totalBoostedUnits.plus(event.params.reapers)
  stack.active = true
  if (stack.birthBlock.equals(BigInt.fromI32(0))) stack.birthBlock = event.params.birthBlock
  
  calculateStackBounty(stack, event.block.number)
  stack.save()

  let aStack = getOrCreateAgentStack(event.params.agent, event.params.stackId)
  aStack.units = aStack.units.plus(event.params.units)
  aStack.reaper = aStack.reaper.plus(event.params.reapers)
  aStack.birthBlock = event.params.birthBlock
  aStack.save()
}

export function handleMoved(event: MovedEvent): void {
  let entity = new Moved(event.transaction.hash.toHex() + "-" + event.logIndex.toString())
  let fromStackId = BigInt.fromI32(event.params.fromStack)
  let toStackId = BigInt.fromI32(event.params.toStack)

  entity.agent = event.params.agent
  entity.fromStack = fromStackId
  entity.toStack = toStackId
  entity.units = event.params.units
  entity.reaper = event.params.reaper
  entity.birthBlock = event.params.birthBlock
  entity.block_number = event.block.number
  entity.save()

  updateAgentFinance(event.params.agent, MOVE_COST_WEI, BigInt.fromI32(0), event.block.number)

  let fromStack = getOrCreateStack(fromStackId.toString())
  fromStack.totalStandardUnits = safeSubtract(fromStack.totalStandardUnits, event.params.units)
  fromStack.totalBoostedUnits = safeSubtract(fromStack.totalBoostedUnits, event.params.reaper)
  if (fromStack.totalStandardUnits.equals(BigInt.fromI32(0)) && fromStack.totalBoostedUnits.equals(BigInt.fromI32(0))) {
    fromStack.birthBlock = BigInt.fromI32(0)
    fromStack.active = false
  }
  calculateStackBounty(fromStack, event.block.number)
  fromStack.save()

  let toStack = getOrCreateStack(toStackId.toString())
  toStack.totalStandardUnits = toStack.totalStandardUnits.plus(event.params.units)
  toStack.totalBoostedUnits = toStack.totalBoostedUnits.plus(event.params.reaper)
  toStack.birthBlock = event.params.birthBlock
  toStack.active = true
  calculateStackBounty(toStack, event.block.number)
  toStack.save()

  let aStackFrom = getOrCreateAgentStack(event.params.agent, fromStackId)
  aStackFrom.units = safeSubtract(aStackFrom.units, event.params.units)
  aStackFrom.reaper = safeSubtract(aStackFrom.reaper, event.params.reaper)
  aStackFrom.save()

  let aStackTo = getOrCreateAgentStack(event.params.agent, toStackId)
  aStackTo.units = aStackTo.units.plus(event.params.units)
  aStackTo.reaper = aStackTo.reaper.plus(event.params.reaper)
  aStackTo.birthBlock = event.params.birthBlock
  aStackTo.save()
}

export function handleKilled(event: KilledEvent): void {
  let entity = new Killed(event.transaction.hash.toHex() + "-" + event.logIndex.toString())
  let summary = event.params.summary
  let stackId = BigInt.fromI32(event.params.stackId as i32)

  entity.attacker = event.params.attacker
  entity.target = event.params.target
  entity.stackId = stackId
  entity.attackerUnitsSent = summary.attackerUnitsSent
  entity.attackerReaperSent = summary.attackerReaperSent
  entity.attackerUnitsLost = summary.attackerUnitsLost
  entity.attackerReaperLost = summary.attackerReaperLost
  entity.targetUnitsLost = summary.targetUnitsLost
  entity.targetReaperLost = summary.targetReaperLost
  entity.initialDefenderUnits = summary.initialDefenderUnits
  entity.initialDefenderReaper = summary.initialDefenderReaper
  entity.attackerBounty = summary.attackerBounty
  entity.defenderBounty = summary.defenderBounty
  entity.targetBirthBlock = event.params.targetBirthBlock
  entity.block_number = event.block.number
  entity.save()

  // NET bounty (Gross - Burn)
  let netAttackerBounty = calculateNetBounty(summary.attackerBounty);
  let netDefenderBounty = calculateNetBounty(summary.defenderBounty);

  updateAgentFinance(event.params.attacker, BigInt.fromI32(0), netAttackerBounty, event.block.number)
  updateAgentFinance(event.params.target, BigInt.fromI32(0), netDefenderBounty, event.block.number)

  let stack = getOrCreateStack(stackId.toString())
  stack.totalStandardUnits = safeSubtract(stack.totalStandardUnits, summary.targetUnitsLost)
  stack.totalBoostedUnits = safeSubtract(stack.totalBoostedUnits, summary.targetReaperLost)
  
  if (stack.totalStandardUnits.equals(BigInt.fromI32(0)) && stack.totalBoostedUnits.equals(BigInt.fromI32(0))) {
    stack.active = false
  }

  calculateStackBounty(stack, event.block.number)
  stack.save()

  let aStackTarget = getOrCreateAgentStack(event.params.target, stackId)
  aStackTarget.units = safeSubtract(aStackTarget.units, summary.targetUnitsLost)
  aStackTarget.reaper = safeSubtract(aStackTarget.reaper, summary.targetReaperLost)
  aStackTarget.save()
}

export function handleGlobalStats(event: GlobalStatsEvent): void {
  let stats = GlobalStat.load("current")
  if (stats == null) stats = new GlobalStat("current")
  
  stats.totalUnitsKilled = event.params.totalUnitsKilled
  stats.totalReaperKilled = event.params.totalReaperKilled
  stats.killAdded = event.params.killAdded
  stats.killExtracted = event.params.killExtracted
  stats.killBurned = event.params.killBurned
  
  let outflows = stats.killExtracted.plus(stats.killBurned)
  stats.currentTreasury = stats.killAdded.minus(outflows)
  stats.totalPnL = stats.currentTreasury
  stats.maxBounty = stats.currentTreasury.times(GLOBAL_CAP_BPS).div(BigInt.fromI32(10000))
  stats.save()
}