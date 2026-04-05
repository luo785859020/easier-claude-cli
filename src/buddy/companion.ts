import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import {
  type Companion,
  type CompanionBones,
  EYES,
  HATS,
  RARITIES,
  RARITY_WEIGHTS,
  type Rarity,
  SPECIES,
  type StoredCompanion,
  STAT_NAMES,
  type StatName,
} from './types.js'

// Mulberry32 — tiny seeded PRNG, good enough for picking ducks
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashString(s: string): number {
  if (typeof Bun !== 'undefined') {
    return Number(BigInt(Bun.hash(s)) & 0xffffffffn)
  }
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!
}

function rollRarity(rng: () => number): Rarity {
  const total = Object.values(RARITY_WEIGHTS).reduce((a, b) => a + b, 0)
  let roll = rng() * total
  for (const rarity of RARITIES) {
    roll -= RARITY_WEIGHTS[rarity]
    if (roll < 0) return rarity
  }
  return 'common'
}

const RARITY_FLOOR: Record<Rarity, number> = {
  common: 5,
  uncommon: 15,
  rare: 25,
  epic: 35,
  legendary: 50,
}

// One peak stat, one dump stat, rest scattered. Rarity bumps the floor.
function rollStats(
  rng: () => number,
  rarity: Rarity,
): Record<StatName, number> {
  const floor = RARITY_FLOOR[rarity]
  const peak = pick(rng, STAT_NAMES)
  let dump = pick(rng, STAT_NAMES)
  while (dump === peak) dump = pick(rng, STAT_NAMES)

  const stats = {} as Record<StatName, number>
  for (const name of STAT_NAMES) {
    if (name === peak) {
      stats[name] = Math.min(100, floor + 50 + Math.floor(rng() * 30))
    } else if (name === dump) {
      stats[name] = Math.max(1, floor - 10 + Math.floor(rng() * 15))
    } else {
      stats[name] = floor + Math.floor(rng() * 40)
    }
  }
  return stats
}

export type Roll = {
  bones: CompanionBones
  inspirationSeed: number
}

function rollFrom(rng: () => number): Roll {
  const rarity = rollRarity(rng)
  const bones: CompanionBones = {
    rarity,
    species: pick(rng, SPECIES),
    eye: pick(rng, EYES),
    hat: rarity === 'common' ? 'none' : pick(rng, HATS),
    shiny: rng() < 0.01,
    stats: rollStats(rng, rarity),
  }
  return { bones, inspirationSeed: Math.floor(rng() * 1e9) }
}

function newRandomSeed(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

// Draw a new random companion roll. Kept signature-compatible for older callers.
export function roll(_legacyUserId?: string): Roll {
  return rollWithSeed(newRandomSeed())
}

export function rollWithSeed(seed: string): Roll {
  return rollFrom(mulberry32(hashString(seed)))
}

// Legacy helper kept for compatibility with older buddy command code paths.
export function companionUserId(): string {
  const config = getGlobalConfig()
  return config.oauthAccount?.accountUuid ?? config.userID ?? 'anon'
}

function hasStoredBones(
  stored: StoredCompanion,
): stored is StoredCompanion & CompanionBones {
  const maybe = stored as Partial<CompanionBones>
  if (!maybe.rarity || !RARITIES.includes(maybe.rarity)) return false
  if (!maybe.species || !SPECIES.includes(maybe.species)) return false
  if (!maybe.eye || !EYES.includes(maybe.eye)) return false
  if (!maybe.hat || !HATS.includes(maybe.hat)) return false
  if (typeof maybe.shiny !== 'boolean') return false
  if (!maybe.stats) return false
  for (const name of STAT_NAMES) {
    const value = maybe.stats[name]
    if (typeof value !== 'number' || !Number.isFinite(value)) return false
  }
  return true
}

function clampActiveIndex(activeIndex: number, length: number): number {
  if (length <= 0) return 0
  if (!Number.isInteger(activeIndex)) return 0
  return Math.min(length - 1, Math.max(0, activeIndex))
}

// Bones are now persisted at hatch time. For old configs that only stored
// soul fields, we migrate once by assigning a random roll and writing it back.
export function getCompanion(): Companion | undefined {
  const config = getGlobalConfig()

  const collection = config.companionCollection
  if (collection && collection.length > 0) {
    const activeIndex = clampActiveIndex(
      config.companionActiveIndex ?? 0,
      collection.length,
    )
    const selected = collection[activeIndex]!
    if (hasStoredBones(selected)) {
      return selected
    }

    const { bones } = roll()
    const upgraded: Companion = { ...selected, ...bones }
    saveGlobalConfig(current => {
      const currentCollection = current.companionCollection
      if (!currentCollection || currentCollection.length === 0) return current
      const nextActiveIndex = clampActiveIndex(
        current.companionActiveIndex ?? 0,
        currentCollection.length,
      )
      const currentSelected = currentCollection[nextActiveIndex]
      if (!currentSelected || hasStoredBones(currentSelected)) return current

      const nextCollection = [...currentCollection]
      nextCollection[nextActiveIndex] = { ...currentSelected, ...bones }
      return {
        ...current,
        companionCollection: nextCollection,
        companionActiveIndex: nextActiveIndex,
        companion: nextCollection[nextActiveIndex],
      }
    })
    return upgraded
  }

  const stored = config.companion
  if (!stored) return undefined
  if (hasStoredBones(stored)) {
    return stored
  }

  const { bones } = roll()
  const upgraded: Companion = { ...stored, ...bones }
  saveGlobalConfig(current => {
    const currentCompanion = current.companion
    if (!currentCompanion || hasStoredBones(currentCompanion)) return current
    const migratedCompanion = {
      ...currentCompanion,
      ...bones,
    }
    return {
      ...current,
      companion: migratedCompanion,
      companionCollection: [migratedCompanion],
      companionActiveIndex: 0,
    }
  })
  return upgraded
}
