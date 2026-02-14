import {
  Spawned as SpawnedEvent,
  Moved as MovedEvent,
  Killed as KilledEvent,
  GlobalStats as GlobalStatsEvent
} from "./generated/killgame/killgame"

import { Spawned, Moved, Killed, Stack, AgentStack, GlobalStat, Agent } from "./generated/schema"
import { BigInt, Bytes } from "@graphprotocol/graph-ts"

const REAPER_COST = BigInt.fromI32(1000);

function getOrCreateAgent(address: Bytes): Agent {
  let id = address.toHex()
  let agent = Agent.load(id)
  if (agent == null) {
    agent = new Agent(id)
    agent.totalSpent = BigInt.fromI32(0)
    agent.totalEarned = BigInt.fromI32(0)
    agent.netPnL = BigInt.fromI32(0)
    agent.save()
  }
  return agent
}

function updateAgentPnL(address: Bytes, spent: BigInt, earned: BigInt): void {
  let agent = getOrCreateAgent(address)
  agent.totalSpent = agent.totalSpent.plus(spent)
  agent.totalEarned = agent.totalEarned.plus(earned)
  agent.netPnL = agent.totalEarned.minus(agent.totalSpent)
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

function getOrCreateAgentStack(agent: Bytes, stackId: i32): AgentStack {
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
  entity.birthBlock = event.params.birthBlock
  entity.block_number = event.block.number
  entity.save()

  // Update Persistent Agent Stats
  updateAgentPnL(event.params.agent, REAPER_COST, BigInt.fromI32(0))

  let stack = getOrCreateStack(event.params.stackId.toString())
  stack.totalStandardUnits = stack.totalStandardUnits.plus(event.params.units)
  if (stack.birthBlock.equals(BigInt.fromI32(0))) {
    stack.birthBlock = event.params.birthBlock
  }
  stack.save()

  let aStack = getOrCreateAgentStack(event.params.agent, event.params.stackId.toI32())
  aStack.units = aStack.units.plus(event.params.units)
  aStack.birthBlock = event.params.birthBlock
  aStack.save()
}

export function handleMoved(event: MovedEvent): void {
  let entity = new Moved(event.transaction.hash.toHex() + "-" + event.logIndex.toString())
  entity.agent = event.params.agent
  entity.fromStack = event.params.fromStack
  entity.toStack = event.params.toStack
  entity.units = event.params.units
  entity.reaper = event.params.reaper
  entity.birthBlock = event.params.birthBlock
  entity.block_number = event.block.number
  entity.save()

  let fromStack = getOrCreateStack(event.params.fromStack.toString())
  fromStack.totalStandardUnits = safeSubtract(fromStack.totalStandardUnits, event.params.units)
  fromStack.totalBoostedUnits = safeSubtract(fromStack.totalBoostedUnits, event.params.reaper)
  if (fromStack.totalStandardUnits.equals(BigInt.fromI32(0)) && fromStack.totalBoostedUnits.equals(BigInt.fromI32(0))) {
    fromStack.birthBlock = BigInt.fromI32(0)
  }
  fromStack.save()

  let toStack = getOrCreateStack(event.params.toStack.toString())
  toStack.totalStandardUnits = toStack.totalStandardUnits.plus(event.params.units)
  toStack.totalBoostedUnits = toStack.totalBoostedUnits.plus(event.params.reaper)
  if (toStack.birthBlock.equals(BigInt.fromI32(0))) {
    toStack.birthBlock = event.params.birthBlock
  }
  toStack.save()

  let aStackFrom = getOrCreateAgentStack(event.params.agent, event.params.fromStack)
  aStackFrom.units = safeSubtract(aStackFrom.units, event.params.units)
  aStackFrom.reaper = safeSubtract(aStackFrom.reaper, event.params.reaper)
  aStackFrom.save()

  let aStackTo = getOrCreateAgentStack(event.params.agent, event.params.toStack)
  aStackTo.units = aStackTo.units.plus(event.params.units)
  aStackTo.reaper = aStackTo.reaper.plus(event.params.reaper)
  aStackTo.birthBlock = event.params.birthBlock
  aStackTo.save()
}

export function handleKilled(event: KilledEvent): void {
  let entity = new Killed(event.transaction.hash.toHex() + "-" + event.logIndex.toString())
  entity.attacker = event.params.attacker
  entity.target = event.params.target
  entity.stackId = event.params.stackId
  entity.attackerUnitsLost = event.params.attackerUnitsLost
  entity.attackerReaperLost = event.params.attackerReaperLost
  entity.targetUnitsLost = event.params.targetUnitsLost
  entity.targetReaperLost = event.params.targetReaperLost
  entity.netBounty = event.params.netBounty
  entity.targetBirthBlock = event.params.targetBirthBlock
  entity.block_number = event.block.number
  entity.save()

  // Update Attacker persistent stats (Earned netBounty)
  updateAgentPnL(event.params.attacker, BigInt.fromI32(0), event.params.netBounty)

  let stack = getOrCreateStack(event.params.stackId.toString())
  stack.totalStandardUnits = safeSubtract(stack.totalStandardUnits, event.params.targetUnitsLost)
  stack.totalBoostedUnits = safeSubtract(stack.totalBoostedUnits, event.params.targetReaperLost)
  if (stack.totalStandardUnits.equals(BigInt.fromI32(0)) && stack.totalBoostedUnits.equals(BigInt.fromI32(0))) {
    stack.birthBlock = BigInt.fromI32(0)
  }
  stack.save()

  let aStackTarget = getOrCreateAgentStack(event.params.target, event.params.stackId)
  aStackTarget.units = safeSubtract(aStackTarget.units, event.params.targetUnitsLost)
  aStackTarget.reaper = safeSubtract(aStackTarget.reaper, event.params.targetReaperLost)
  if (event.params.netBounty.gt(BigInt.fromI32(0))) {
    aStackTarget.birthBlock = BigInt.fromI32(0) 
  }
  aStackTarget.save()

  let aStackAttacker = getOrCreateAgentStack(event.params.attacker, event.params.stackId)
  aStackAttacker.units = safeSubtract(aStackAttacker.units, event.params.attackerUnitsLost)
  aStackAttacker.reaper = safeSubtract(aStackAttacker.reaper, event.params.attackerReaperLost)
  aStackAttacker.save()
}

export function handleGlobalStats(event: GlobalStatsEvent): void {
  let stats = GlobalStat.load("current")
  if (stats == null) {
    stats = new GlobalStat("current")
  }
  stats.totalUnitsKilled = event.params.totalUnitsKilled
  stats.totalReaperKilled = event.params.totalReaperKilled
  stats.killAdded = event.params.killAdded
  stats.killExtracted = event.params.killExtracted
  stats.killBurned = event.params.killBurned
  stats.save()
}