import { describe, expect, test } from 'claude-code/testing'

import { fitColumns, fitLegend, listBarWidth, movePeriod, periodMark } from './layout'

describe('stats layout', () => {
  // The overview's columns as the canvas lays them out, left to right, by repo.
  const COLUMNS = [
    { key: 'tokens', width: 5, priority: 1 },
    { key: 'share', width: 4, priority: 4 },
    { key: 'bar', width: 12, priority: 3 },
    { key: 'sub', width: 3, priority: 5 },
    { key: 'spawns', width: 4, priority: 2 },
    { key: 'kinds', width: 14, priority: 8 },
    { key: 'sessions', width: 7, priority: 6 },
    { key: 'last', width: 5, priority: 7 },
    { key: 'cache', width: 8, priority: 9 },
  ]
  const shown = (body: number) => fitColumns(COLUMNS, body, 16).shown.map(column => column.key)

  test('columns go in by priority beside a name of at least 16, keeping their order', () => {
    expect(shown(40)).toEqual(['tokens', 'spawns'])
    expect(shown(55)).toEqual(['tokens', 'share', 'bar', 'sub', 'spawns'])
    expect(shown(80)).toEqual(['tokens', 'share', 'bar', 'sub', 'spawns', 'sessions', 'last'])
    expect(shown(110)).toEqual(COLUMNS.map(column => column.key))
    expect(fitColumns(COLUMNS, 40, 16).used).toBe(2 + 5 + 2 + 4)
  })

  test('the first column that does not fit stops the rest, even a narrower one after it', () => {
    // 16 + 13 + 16 = 45: the bar (14) does not fit in 42, and the share (4) after it is not tried.
    const wide = COLUMNS.map(column => (column.key === 'bar' ? { ...column, width: 14 } : column))
    expect(fitColumns(wide, 42, 16).shown.map(column => column.key)).toEqual(['tokens', 'spawns'])
  })

  test('the list bar is 12% of the width, 6 to 14 columns', () => {
    expect([40, 55, 80, 100, 120, 200].map(listBarWidth)).toEqual([6, 7, 10, 12, 14, 14])
  })

  test('h and l move the period by its length, l no later than today, h no earlier than the first day kept', () => {
    const today = '2026-10-14'
    const first = '2025-10-14'
    expect(movePeriod('2026-10-14', 30, -1, today, first)).toBe('2026-09-14')
    expect(movePeriod('2026-10-14', 7, -1, today, first)).toBe('2026-10-07')
    expect(movePeriod('2026-10-10', 7, 1, today, first)).toBe('2026-10-14')
    expect(movePeriod('2026-10-14', 1, 1, today, first)).toBe('2026-10-14')
    expect(movePeriod('2025-11-01', 90, -1, today, first)).toBe('2025-10-14')
  })

  test('a period of days is bracketed from its first week to its last, a day pointed at', () => {
    // 24 weeks in 52 columns; the last week is week 23.
    expect(periodMark(52, 17, 23, '30 天', undefined)).toEqual({ at: 38, text: '└── 30 天 ──┘' })
    expect(periodMark(52, 22, 23, '7 天', undefined)).toEqual({ at: 48, text: '└─┘' })
    expect(periodMark(52, 23, 23, '7 天', undefined)).toEqual({ at: 50, text: '▲' })
    // A first day before the heatmap starts the bracket at its first week; a period wholly before it has none.
    expect(periodMark(52, -3, 2, '90 天', undefined)?.at).toBe(4)
    expect(periodMark(52, -9, -1, '30 天', undefined)).toBeUndefined()
    // One day: the label after its mark, or before it where the line ends first.
    expect(periodMark(52, 10, 10, '', '10/02（五）')).toEqual({ at: 24, text: '▲ 10/02（五）' })
    expect(periodMark(52, 23, 23, '', '10/14（三）')).toEqual({ at: 50 - 12, text: '10/14（三） ▲' })
  })

  test('the legend fits item by item left of the mark, else right of it, else not at all', () => {
    const items = [10, 8, 8, 16]
    // No mark: as many as fit after the labels' four columns.
    expect(fitLegend(80, undefined, items)).toEqual({ count: 4, at: 4 })
    expect(fitLegend(40, undefined, items)).toEqual({ count: 3, at: 4 })
    // A mark at the right leaves the left; one at the left sends the legend right, flush with the edge.
    expect(fitLegend(55, { at: 42, width: 11 }, items)).toEqual({ count: 3, at: 4 })
    expect(fitLegend(55, { at: 6, width: 11 }, items)).toEqual({ count: 3, at: 55 - 30 })
    expect(fitLegend(30, { at: 8, width: 20 }, items)).toEqual({ count: 0, at: 0 })
  })
})
