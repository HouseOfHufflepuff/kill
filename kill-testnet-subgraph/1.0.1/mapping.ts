import {
  Spawned as SpawnedEvent,
  Moved as MovedEvent,
  Killed as KilledEvent,
  GlobalStats as GlobalStatsEvent,
  DefenderRewarded as DefenderRewardedEvent
} from "./generated/killgame/killgame"

import { 
  Spawned, 
  Moved, 
  Killed, 
  Stack, 
  AgentStack, 
  GlobalStat, 
  Agent, 
  DefenderReward 
} from "./generated/schema"
import { BigInt, Bytes } from "@graphprotocol/graph-ts"

const KILL_DECIMALS = BigInt.fromI32(10).pow(18);
const UNIT_PRICE_WEI = BigInt.fromI32(10).times(KILL_DECIMALS);
const MOVE_COST_WEI = BigInt.fromI32(10).times(KILL_DECIMALS);

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
    stack.save()
  }
  return stack
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

export function handleSpawned(event: SpawnedEvent): void {
  let entity = new Spawned(event.transaction.hash.toHex() + "-" + event.logIndex.toString())
  entity.agent = event.params.agent
  entity.stackId = event.params.stackId
  entity.units = event.params.units
  entity.reapers = event.params.reapers 
  entity.birthBlock = event.params.birthBlock
  entity.block_number = event.block.number
  entity.save()

  updateAgentFinance(event.params.agent, event.params.units.times(UNIT_PRICE_WEI), BigInt.fromI32(0), event.block.number)

  let stack = getOrCreateStack(event.params.stackId.toString())
  stack.totalStandardUnits = stack.totalStandardUnits.plus(event.params.units)
  stack.totalBoostedUnits = stack.totalBoostedUnits.plus(event.params.reapers)
  if (stack.birthBlock.equals(BigInt.fromI32(0))) stack.birthBlock = event.params.birthBlock
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
  // If source stack is emptied, reset its birth block
  if (fromStack.totalStandardUnits.equals(BigInt.fromI32(0))) {
    fromStack.birthBlock = BigInt.fromI32(0)
  }
  fromStack.save()

  let toStack = getOrCreateStack(toStackId.toString())
  toStack.totalStandardUnits = toStack.totalStandardUnits.plus(event.params.units)
  toStack.totalBoostedUnits = toStack.totalBoostedUnits.plus(event.params.reaper)
  // FIXED: Always update birthBlock on move to mirror contract reset logic
  toStack.birthBlock = event.params.birthBlock
  toStack.save()

  let aStackFrom = getOrCreateAgentStack(event.params.agent, fromStackId)
  aStackFrom.units = safeSubtract(aStackFrom.units, event.params.units)
  aStackFrom.reaper = safeSubtract(aStackFrom.reaper, event.params.reaper)
  if (aStackFrom.units.equals(BigInt.fromI32(0))) {
    aStackFrom.birthBlock = BigInt.fromI32(0)
  }
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

  updateAgentFinance(event.params.attacker, BigInt.fromI32(0), summary.attackerBounty, event.block.number)
  updateAgentFinance(event.params.target, BigInt.fromI32(0), summary.defenderBounty, event.block.number)

  let stack = getOrCreateStack(stackId.toString())
  stack.totalStandardUnits = safeSubtract(stack.totalStandardUnits, summary.targetUnitsLost)
  stack.totalBoostedUnits = safeSubtract(stack.totalBoostedUnits, summary.targetReaperLost)
  stack.save()

  let aStackTarget = getOrCreateAgentStack(event.params.target, stackId)
  aStackTarget.units = safeSubtract(aStackTarget.units, summary.targetUnitsLost)
  aStackTarget.reaper = safeSubtract(aStackTarget.reaper, summary.targetReaperLost)
  aStackTarget.save()
  
  // Note: Attacker losses usually occur on their originating stack, 
  // but if the game logic treats "Sent" as moved to the target stack, 
  // this subtraction remains on the target stackId.
}

export function handleDefenderRewarded(event: DefenderRewardedEvent): void {
  let reward = new DefenderReward(event.transaction.hash.toHex() + "-" + event.logIndex.toString())
  reward.defender = event.params.defender
  reward.amount = event.params.amount
  reward.block_number = event.block.number
  reward.save()

  updateAgentFinance(event.params.defender, BigInt.fromI32(0), event.params.amount, event.block.number)
}

export function handleGlobalStats(event: GlobalStatsEvent): void {
  let stats = GlobalStat.load("current")
  if (stats == null) stats = new GlobalStat("current")
  stats.totalUnitsKilled = event.params.totalUnitsKilled
  stats.totalReaperKilled = event.params.totalReaperKilled
  stats.killAdded = event.params.killAdded
  stats.killExtracted = event.params.killExtracted
  stats.killBurned = event.params.killBurned
  stats.totalPnL = stats.killAdded.minus(stats.killExtracted).minus(stats.killBurned)
  stats.currentTreasury = stats.killAdded.minus(stats.killExtracted).minus(stats.killBurned)
  stats.maxBounty = stats.currentTreasury.times(BigInt.fromI32(5)).div(BigInt.fromI32(100))
  stats.save()
}