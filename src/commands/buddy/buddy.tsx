import * as React from 'react'
import { useState } from 'react'
import { roll } from '../../buddy/companion.js'
import { renderSprite } from '../../buddy/sprites.js'
import {
  EYES,
  HATS,
  RARITIES,
  RARITY_COLORS,
  RARITY_STARS,
  SPECIES,
  STAT_NAMES,
  type CompanionBones,
  type Species,
  type StoredCompanion,
} from '../../buddy/types.js'
import { type OptionWithDescription, Select } from '../../components/CustomSelect/select.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'

type OwnedCompanion = StoredCompanion & CompanionBones

type BuddyState = {
  collection: OwnedCompanion[]
  activeIndex: number
}

type Stage = 'main' | 'choose' | 'soul-action' | 'soul-choose' | 'profile'

const SOUL_OPTIONS = [
  '元气',
  '冷静',
  '勇敢',
  '治愈',
  '机灵',
  '社牛',
  '傲娇',
  '学者',
  '吐槽',
  '佛系',
] as const

const NAME_PREFIX = ['小', '阿', '软', '闪', '星', '圆', '暖', '糯'] as const
const NAME_SUFFIX = [
  '团子',
  '泡泡',
  '豆豆',
  '球球',
  '可可',
  '布丁',
  '丸子',
  '崽崽',
] as const

const SPECIES_ALIAS: Record<Species, string> = {
  duck: '鸭鸭',
  goose: '鹅鹅',
  blob: '团团',
  cat: '喵喵',
  dragon: '龙龙',
  octopus: '章章',
  owl: '咕咕',
  penguin: '企鹅',
  turtle: '龟龟',
  snail: '蜗蜗',
  ghost: '幽幽',
  axolotl: '六角',
  capybara: '卡皮',
  cactus: '仙仙',
  robot: '机机',
  rabbit: '兔兔',
  mushroom: '菇菇',
  chonk: '团墩',
}

const RARITY_LABEL: Record<(typeof RARITIES)[number], string> = {
  common: '普通',
  uncommon: '稀有',
  rare: '珍稀',
  epic: '史诗',
  legendary: '传说',
}

const HAT_LABEL: Record<(typeof HATS)[number], string> = {
  none: '无',
  crown: '王冠',
  tophat: '礼帽',
  propeller: '竹蜻蜓',
  halo: '光环',
  wizard: '法师帽',
  beanie: '毛线帽',
  tinyduck: '小黄鸭',
}

const STAT_LABEL: Record<(typeof STAT_NAMES)[number], string> = {
  DEBUGGING: '调试',
  PATIENCE: '耐心',
  CHAOS: '混沌',
  WISDOM: '智慧',
  SNARK: '吐槽',
}

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!
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

function randomSoul(species: Species): Pick<StoredCompanion, 'name' | 'personality'> {
  return {
    name: `${pickRandom(NAME_PREFIX)}${SPECIES_ALIAS[species]}${pickRandom(NAME_SUFFIX)}`,
    personality: pickRandom(SOUL_OPTIONS),
  }
}

function drawRandomCompanion(): OwnedCompanion {
  const { bones } = roll()
  const soul = randomSoul(bones.species)
  return {
    ...bones,
    ...soul,
    hatchedAt: Date.now(),
  }
}

function saveBuddyState(collection: OwnedCompanion[], activeIndex: number): void {
  const hasAny = collection.length > 0
  const nextActiveIndex = hasAny ? clampActiveIndex(activeIndex, collection.length) : 0
  saveGlobalConfig(current => ({
    ...current,
    companionCollection: hasAny ? collection : undefined,
    companionActiveIndex: hasAny ? nextActiveIndex : undefined,
    companion: hasAny ? collection[nextActiveIndex] : undefined,
  }))
}

function normalizeBuddyState(): BuddyState {
  const config = getGlobalConfig()
  const source =
    config.companionCollection && config.companionCollection.length > 0
      ? config.companionCollection
      : config.companion
        ? [config.companion]
        : []

  let changed = false
  const collection: OwnedCompanion[] = source.map(item => {
    if (hasStoredBones(item)) return item
    changed = true
    return {
      ...item,
      ...roll().bones,
    }
  })

  const activeIndex = clampActiveIndex(config.companionActiveIndex ?? 0, collection.length)

  if (!config.companionCollection && collection.length > 0) {
    changed = true
  }
  if ((config.companionActiveIndex ?? 0) !== activeIndex) {
    changed = true
  }
  if (collection.length === 0 && config.companion) {
    changed = true
  }
  if (collection.length > 0) {
    const active = collection[activeIndex]!
    if (
      !config.companion ||
      config.companion.hatchedAt !== active.hatchedAt ||
      config.companion.name !== active.name
    ) {
      changed = true
    }
  }

  if (changed) {
    saveBuddyState(collection, activeIndex)
  }

  return {
    collection,
    activeIndex,
  }
}

function buddyLabel(companion: OwnedCompanion): string {
  return `${companion.name} · ${SPECIES_ALIAS[companion.species]} ${RARITY_STARS[companion.rarity]}`
}

type MainAction = 'choose' | 'draw' | 'finish'
type SoulAction =
  | 'view-profile'
  | 'choose-soul'
  | 'reroll-soul'
  | 'back-main'
  | 'finish'

type ProfileAction = 'back' | 'finish'

function renderStatBar(value: number): string {
  const width = 20
  const ratio = Math.max(0, Math.min(1, value / 100))
  const fill = Math.round(width * ratio)
  return `[${'█'.repeat(fill)}${'.'.repeat(width - fill)}]`
}

function BuddyMenu({
  onDone,
  initialState,
}: {
  onDone: LocalJSXCommandOnDone
  initialState: BuddyState
}): React.ReactNode {
  const [collection, setCollection] = useState(initialState.collection)
  const [activeIndex, setActiveIndex] = useState(initialState.activeIndex)
  const [selectedIndex, setSelectedIndex] = useState(initialState.activeIndex)
  const [stage, setStage] = useState<Stage>('main')
  const [statusLine, setStatusLine] = useState<string | undefined>(undefined)

  const selected = collection[selectedIndex]
  const active = collection[activeIndex]

  function applyState(
    nextCollection: OwnedCompanion[],
    nextActiveIndex: number,
    nextSelectedIndex = nextActiveIndex,
  ): void {
    const normalizedActiveIndex = clampActiveIndex(nextActiveIndex, nextCollection.length)
    const normalizedSelectedIndex = clampActiveIndex(
      nextSelectedIndex,
      nextCollection.length,
    )
    setCollection(nextCollection)
    setActiveIndex(normalizedActiveIndex)
    setSelectedIndex(normalizedSelectedIndex)
    saveBuddyState(nextCollection, normalizedActiveIndex)
  }

  function finishWithCurrent(): void {
    if (!active) {
      onDone('已退出萌宠系统（当前还没有萌宠）。', { display: 'system' })
      return
    }
    onDone(
      `当前萌宠：${buddyLabel(active)} · Soul：${active.personality}`,
      { display: 'system' },
    )
  }

  if (stage === 'main') {
    const options: OptionWithDescription<MainAction>[] = [
      {
        label: '选择萌宠（在已抽取列表中选择）',
        value: 'choose',
        description:
          collection.length > 0
            ? `已拥有 ${collection.length} 只萌宠`
            : '当前还没有萌宠，请先抽取',
        disabled: collection.length === 0,
      },
      {
        label: '抽取萌宠（随机）',
        value: 'draw',
        description: '每次都会随机抽取一只新萌宠，可重复抽取',
      },
      {
        label: '完成并返回命令行',
        value: 'finish',
      },
    ]

    return (
      <Dialog
        title="萌宠系统"
        subtitle="/buddy 主菜单"
        onCancel={() => onDone(undefined, { display: 'skip' })}
        color="suggestion"
      >
        <Box flexDirection="column">
          <Text>
            当前萌宠：{active ? `${buddyLabel(active)} · Soul：${active.personality}` : '未设置'}
          </Text>
          {statusLine ? <Text color="success">{statusLine}</Text> : null}
        </Box>
        <Select
          options={options}
          onChange={action => {
            if (action === 'choose') {
              setStage('choose')
              setStatusLine(undefined)
              return
            }
            if (action === 'draw') {
              const fresh = drawRandomCompanion()
              const nextCollection = [...collection, fresh]
              const nextIndex = nextCollection.length - 1
              applyState(nextCollection, nextIndex, nextIndex)
              setStatusLine(`已抽取：${buddyLabel(fresh)}。`)
              setStage('soul-action')
              return
            }
            finishWithCurrent()
          }}
          visibleOptionCount={options.length}
        />
      </Dialog>
    )
  }

  if (stage === 'choose') {
    const options: OptionWithDescription<string>[] = [
      { label: '← 返回主菜单', value: 'back' },
      ...collection.map((companion, index) => ({
        label: buddyLabel(companion),
        value: `pick:${index}`,
        description:
          `${index === activeIndex ? '当前已选择 · ' : ''}Soul：${companion.personality}`,
      })),
    ]

    return (
      <Dialog
        title="第 1/2 步：选择萌宠"
        subtitle="从已抽取列表中选中一只"
        onCancel={() => setStage('main')}
        color="permission"
      >
        <Select
          options={options}
          onChange={value => {
            if (value === 'back') {
              setStage('main')
              return
            }
            const index = Number.parseInt(value.slice('pick:'.length), 10)
            if (!Number.isFinite(index) || !collection[index]) {
              setStatusLine('选择失败：目标萌宠不存在。')
              setStage('main')
              return
            }
            applyState(collection, index, index)
            setStatusLine(`已选择：${buddyLabel(collection[index]!)}。`)
            setStage('soul-action')
          }}
          visibleOptionCount={Math.min(options.length, 10)}
        />
      </Dialog>
    )
  }

  if (!selected) {
    return (
      <Dialog
        title="萌宠系统"
        subtitle="当前未选中有效萌宠"
        onCancel={() => setStage('main')}
        color="warning"
      >
        <Select
          options={[{ label: '返回主菜单', value: 'back' }]}
          onChange={() => setStage('main')}
          visibleOptionCount={1}
        />
      </Dialog>
    )
  }

  if (stage === 'soul-action') {
    const options: OptionWithDescription<SoulAction>[] = [
      { label: '查看属性', value: 'view-profile' },
      { label: '选择 Soul 性格属性', value: 'choose-soul' },
      {
        label: '重置性格属性（随机）',
        value: 'reroll-soul',
        description: `当前 Soul：${selected.personality}`,
      },
      { label: '← 返回主菜单', value: 'back-main' },
      { label: '完成并返回命令行', value: 'finish' },
    ]

    return (
      <Dialog
        title="第 2/2 步：设置 Soul"
        subtitle={`已选萌宠：${buddyLabel(selected)}`}
        onCancel={() => setStage('choose')}
        color="suggestion"
      >
        <Select
          options={options}
          onChange={action => {
            if (action === 'view-profile') {
              setStage('profile')
              return
            }
            if (action === 'choose-soul') {
              setStage('soul-choose')
              return
            }
            if (action === 'reroll-soul') {
              const nextSoul = pickRandom(SOUL_OPTIONS)
              const nextCollection = collection.map((item, index) =>
                index === selectedIndex
                  ? {
                      ...item,
                      personality: nextSoul,
                    }
                  : item,
              )
              applyState(nextCollection, activeIndex, selectedIndex)
              setStatusLine(`已重置 Soul：${nextSoul}。`)
              return
            }
            if (action === 'back-main') {
              setStage('main')
              return
            }
            finishWithCurrent()
          }}
          visibleOptionCount={options.length}
        />
      </Dialog>
    )
  }

  if (stage === 'profile') {
    const spriteLines = renderSprite(selected, 0)
    const profileOptions: OptionWithDescription<ProfileAction>[] = [
      { label: '← 返回上一步', value: 'back' },
      { label: '完成并返回命令行', value: 'finish' },
    ]

    return (
      <Dialog
        title="萌宠属性"
        subtitle={`萌宠：${selected.name}`}
        onCancel={() => setStage('soul-action')}
        color={RARITY_COLORS[selected.rarity]}
      >
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor={RARITY_COLORS[selected.rarity]}
          alignSelf="flex-start"
          paddingX={1}
          marginBottom={1}
        >
          <Box flexDirection="row">
            <Text color={RARITY_COLORS[selected.rarity]}>
              {RARITY_STARS[selected.rarity]} {RARITY_LABEL[selected.rarity]} · {SPECIES_ALIAS[selected.species]}
            </Text>
          </Box>
          <Text color={RARITY_COLORS[selected.rarity]}>
            {selected.shiny ? '✨ 闪光 ✨' : '普通'}
          </Text>
          <Text> </Text>
          {spriteLines.map((line, index) => (
            <Text key={index} color={RARITY_COLORS[selected.rarity]}>
              {line}
            </Text>
          ))}
          <Text> </Text>
          <Text>{selected.name}</Text>
          <Text dimColor>{`"${selected.personality}"`}</Text>
          <Text dimColor>帽子：{HAT_LABEL[selected.hat]}</Text>
          <Text> </Text>
          {STAT_NAMES.map(stat => (
            <Text key={stat}>
              {STAT_LABEL[stat].padEnd(4)} {renderStatBar(selected.stats[stat])} {selected.stats[stat]}
            </Text>
          ))}
        </Box>
        <Select
          options={profileOptions}
          onChange={action => {
            if (action === 'back') {
              setStage('soul-action')
              return
            }
            finishWithCurrent()
          }}
          visibleOptionCount={profileOptions.length}
        />
      </Dialog>
    )
  }

  const soulOptions: OptionWithDescription<string>[] = [
    { label: '← 返回上一步', value: 'back' },
    ...SOUL_OPTIONS.map(soul => ({
      label: soul,
      value: `soul:${soul}`,
      description: soul === selected.personality ? '当前 Soul' : undefined,
    })),
  ]

  return (
    <Dialog
      title="选择 Soul 性格属性"
      subtitle={`萌宠：${buddyLabel(selected)}`}
      onCancel={() => setStage('soul-action')}
      color="permission"
    >
      <Select
        options={soulOptions}
        onChange={value => {
          if (value === 'back') {
            setStage('soul-action')
            return
          }
          const nextSoul = value.slice('soul:'.length)
          const nextCollection = collection.map((item, index) =>
            index === selectedIndex
              ? {
                  ...item,
                  personality: nextSoul,
                }
              : item,
          )
          applyState(nextCollection, activeIndex, selectedIndex)
          setStatusLine(`已设置 Soul：${nextSoul}。`)
          setStage('soul-action')
        }}
        visibleOptionCount={Math.min(soulOptions.length, 10)}
      />
    </Dialog>
  )
}

export async function call(onDone: LocalJSXCommandOnDone): Promise<React.ReactNode> {
  const initialState = normalizeBuddyState()
  return <BuddyMenu onDone={onDone} initialState={initialState} />
}
