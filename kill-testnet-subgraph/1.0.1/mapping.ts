import {
  Spawned as SpawnedEvent,
  Moved as MovedEvent,
  Killed as KilledEvent,
  GlobalStats as GlobalStatsEvent
} from "./generated/killgame/killgame"

import { Spawned, Moved, Killed, Cube, GlobalStat } from "./generated/schema"
import { BigInt } from "@graphprotocol/graph-ts"

function getOrCreateCube(cubeId: string): Cube {
  let cube = Cube.load(cubeId)
  if (cube == null) {
    cube = new Cube(cubeId)
    cube.totalStandardUnits = BigInt.fromI32(0)
    cube.totalBoostedUnits = BigInt.fromI32(0)
    cube.save()
  }
  return cube
}

function safeSubtract(current: BigInt, amount: BigInt): BigInt {
  if (amount.gt(current)) return BigInt.fromI32(0)
  return current.minus(amount)
}

export function handleSpawned(event: SpawnedEvent): void {
  let entity = new Spawned(event.transaction.hash.toHex() + "-" + event.logIndex.toString())
  entity.agent = event.params.agent
  entity.cube = event.params.cube
  entity.units = event.params.units
  entity.block_number = event.block.number
  entity.save()

  let cube = getOrCreateCube(event.params.cube.toString())
  cube.totalStandardUnits = cube.totalStandardUnits.plus(event.params.units)
  cube.save()
}

export function handleMoved(event: MovedEvent): void {
  let entity = new Moved(event.transaction.hash.toHex() + "-" + event.logIndex.toString())
  entity.agent = event.params.agent
  entity.fromCube = event.params.fromCube
  entity.toCube = event.params.toCube
  entity.units = event.params.units
  entity.reaper = event.params.reaper
  entity.block_number = event.block.number
  entity.save()

  let fromCube = getOrCreateCube(event.params.fromCube.toString())
  fromCube.totalStandardUnits = safeSubtract(fromCube.totalStandardUnits, event.params.units)
  fromCube.totalBoostedUnits = safeSubtract(fromCube.totalBoostedUnits, event.params.reaper)
  fromCube.save()

  let toCube = getOrCreateCube(event.params.toCube.toString())
  toCube.totalStandardUnits = toCube.totalStandardUnits.plus(event.params.units)
  toCube.totalBoostedUnits = toCube.totalBoostedUnits.plus(event.params.reaper)
  toCube.save()
}

export function handleKilled(event: KilledEvent): void {
  let entity = new Killed(event.transaction.hash.toHex() + "-" + event.logIndex.toString())
  entity.attacker = event.params.attacker
  entity.target = event.params.target
  entity.cube = event.params.cube
  entity.attackerUnitsLost = event.params.attackerUnitsLost
  entity.attackerReaperLost = event.params.attackerReaperLost
  entity.targetUnitsLost = event.params.targetUnitsLost
  entity.targetReaperLost = event.params.targetReaperLost
  entity.netBounty = event.params.netBounty
  entity.block_number = event.block.number
  entity.save()

  let cube = getOrCreateCube(event.params.cube.toString())
  cube.totalStandardUnits = safeSubtract(cube.totalStandardUnits, event.params.targetUnitsLost)
  cube.totalBoostedUnits = safeSubtract(cube.totalBoostedUnits, event.params.targetReaperLost)
  cube.save()
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