// How the stats pane lays itself out by width (DESIGN.md「欄位清單」「日曆熱圖」「期間」): pure,
// so each rule is tested without drawing.
import { addDays, cells } from './ledger'

// The heatmap's weekday labels take this many columns before the first week.
export const HEAT_LABELS = 4

// A column of the overview list: its width in cells and how much it matters (1 most).
export type Column = { key: string; width: number; priority: number }

// The columns that fit beside a name of `nameMin` cells, two cells apart, taken by priority and
// kept in their own order. The first that does not fit stops the rest, so which columns show does
// not jump around as the pane is resized. `used` is the cells they take with their gaps.
export function fitColumns<C extends Column>(columns: C[], body: number, nameMin: number): { shown: C[]; used: number } {
  const on = new Set<string>()
  let used = 0
  for (const column of [...columns].sort((a, b) => a.priority - b.priority)) {
    if (nameMin + used + 2 + column.width > body) {
      break
    }
    on.add(column.key)
    used += 2 + column.width
  }

  return { shown: columns.filter(column => on.has(column.key)), used }
}

// A list row's bar: 12% of the width, 6 to 14 cells.
export function listBarWidth(body: number): number {
  return Math.min(14, Math.max(6, Math.round(body * 0.12)))
}

// The period's last day moved by its own length, back (`-1`) or forward (`1`): never after
// `today`, never before `first`.
export function movePeriod(end: string, days: number, step: -1 | 1, today: string, first: string): string {
  const next = addDays(end, step * days)

  return next > today ? today : next < first ? first : next
}

// Where the period is marked under the heatmap, by the weeks of its first and last day (negative
// before the first week drawn): a bracket over its weeks with `label` inside where it fits, or for
// one day (`name` given) a `▲` under it with the day's name after it, or before it where the line
// ends first. `at` is the column it starts at, the weekday labels included.
export function periodMark(body: number, firstWeek: number, lastWeek: number, label: string, name: string | undefined): { at: number; text: string } | undefined {
  if (lastWeek < 0) {
    return undefined
  }
  if (name !== undefined) {
    const at = HEAT_LABELS + lastWeek * 2
    const after = `▲ ${name}`
    if (at + cells(after) <= body) {
      return { at, text: after }
    }
    const before = `${name} ▲`

    return { at: at - cells(before) + 1, text: before }
  }
  const from = Math.max(0, firstWeek)
  const width = (lastWeek - from) * 2 + 1
  const at = HEAT_LABELS + from * 2
  if (width < 3) {
    return { at, text: '▲' }
  }
  const inner = width - 2
  const inside = ` ${label} `
  if (inner < cells(inside) + 2) {
    return { at, text: `└${'─'.repeat(inner)}┘` }
  }
  const dashes = inner - cells(inside)
  const left = Math.floor(dashes / 2)

  return { at, text: `└${'─'.repeat(left)}${inside}${'─'.repeat(dashes - left)}┘` }
}

// How many of the legend's items (`widths`, in order, two cells apart) fit on the mark's line, and
// the column they start at: left of the mark after the weekday labels, else right of it flush with
// the edge, else none. An item that does not fit stops the rest.
export function fitLegend(body: number, mark: { at: number; width: number } | undefined, widths: number[]): { count: number; at: number } {
  const fit = (room: number) => {
    let count = 0
    let used = 0
    for (const width of widths) {
      const need = count === 0 ? width : used + 2 + width
      if (need > room) {
        break
      }
      count += 1
      used = need
    }

    return { count, used }
  }
  const left = fit((mark?.at ?? body) - 2 - HEAT_LABELS)
  if (left.count > 0) {
    return { count: left.count, at: HEAT_LABELS }
  }
  const right = fit(body - ((mark === undefined ? body : mark.at + mark.width) + 2))

  return right.count > 0 ? { count: right.count, at: body - right.used } : { count: 0, at: 0 }
}
