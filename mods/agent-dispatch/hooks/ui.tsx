// The parts every mod's screens share, as DESIGN.md sets them out. Mods cannot import outside their
// own folder, so each mod that draws a pane or a band keeps a copy; scripts/check-copies.sh checks
// they match.
import type { Elements, RenderNode } from 'claude-code'

import { pick, type Lang } from './config'

type Kit = Pick<Elements['terminal'], 'Box' | 'Button' | 'Text'>
type Words = { en: string; 'zh-TW': string }

// What a color means: yellow waits on the user, red is an error, an interruption or a risk.
export const TONE = { attention: 'yellow', danger: 'red' } as const

// A card, and the yellow frame of a pane that holds Claude until the user answers.
export const CARD = { borderStyle: 'round', borderDimColor: true, paddingX: 1 } as const
export const CONFIRM = { borderStyle: 'round', borderColor: TONE.attention, paddingX: 1 } as const

// Where a part of a bar comes from: `ink` on the terminal, `fill` in desktop's Svg. Main session
// purple, subagent cyan, named model yellow, default model gray, fork green.
export const COLORS = {
  main: { ink: 'magenta', fill: '#8a5cc7' },
  sub: { ink: 'cyan', fill: '#2f8fb0' },
  named: { ink: 'yellow', fill: '#c98a12' },
  default: { ink: 'gray', fill: '#8b8b93' },
  fork: { ink: 'green', fill: '#3f9a4f' },
} as const

// The main session's parts (its models), one after another in the same bar.
export const MAIN_SHADES = [COLORS.main, { ink: 'magentaBright', fill: '#b48ee6' }, { ink: 'magenta', fill: '#6b3fa8' }]

export type Option = { value: string; label: string }

// Switches in place, so nothing below moves (a Select pushes it down when it opens): in the
// terminal one button that steps to the next value (its hotkey too) and wraps, elsewhere a segment
// per value with the hotkey on the one after the current, so it steps forward the same way.
export function switcher(
  { Box, Button, Text }: Kit,
  surface: string,
  key: string,
  label: string,
  hotkey: string,
  options: Option[],
  value: string,
  onPick: (value: string) => void,
): RenderNode {
  const at = Math.max(0, options.findIndex(option => option.value === value))
  if (surface === 'terminal') {
    const next = options[(at + 1) % options.length]!.value

    return (
      <Box key={`switch:${key}`} flexDirection="row" flexShrink={0}>
        <Text dimColor>{label}</Text>
        <Button key={key} plain hotkey={hotkey} onPress={() => onPick(next)}>
          <Text bold>‹ {options[at]?.label ?? value} ›</Text>
        </Button>
      </Box>
    )
  }

  return (
    <Box key={`switch:${key}`} flexDirection="row" gap={1} flexShrink={0}>
      <Text dimColor>{label}</Text>
      {options.map((option, i) => (
        <Button
          key={`${key}:${option.value}`}
          label={option.label}
          {...(i === (at + 1) % options.length ? { hotkey } : {})}
          {...(i === at ? { variant: 'primary' as const } : { dimColor: true })}
          onPress={() => onPick(option.value)}
        />
      ))}
    </Box>
  )
}

// A pane's last line: each key and what it does, then how to close it unless `closes` is false
// (a pane that waits for an answer).
export function hintLine({ Box, Text }: Kit, lang: Lang, items: Words[], closes = true): RenderNode {
  const all = closes ? [...items, { en: 'Esc closes', 'zh-TW': 'Esc 關閉' }] : items

  return (
    <Box key="hint" marginTop={1}>
      <Text dimColor wrap="wrap">
        {all.map(item => pick(lang, item)).join(' · ')}
      </Text>
    </Box>
  )
}

// What a pane shows when it has nothing to list.
export function emptyState({ Box, Text }: Kit, text: string): RenderNode {
  return (
    <Box key="empty" marginTop={1}>
      <Text dimColor wrap="wrap">
        {text}
      </Text>
    </Box>
  )
}
