import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderNode } from 'claude-code'

import type { WatchedAgent } from '../types'
import { configCommand, LANGUAGE, loadConfig, pick, type ConfigIO, type Lang, type Specs } from './config'
import { fitColumns, fitLegend, listBarWidth, movePeriod, periodMark, type Column } from './layout'
import { COLORS, emptyState, hintLine, MAIN_SHADES, switcher as switchIn, TONE } from './ui'
import {
  addDays,
  applyMeta,
  buildHeatmap,
  buildReport,
  cells,
  clockTime,
  shortCount,
  shortDay,
  span,
  countKinds,
  DAY_KEEP,
  DAY_PREFIX,
  dayHead,
  dayLabel,
  dayOf,
  dayRow,
  daysBetween,
  heatLevels,
  heatStart,
  heatWeeks,
  liveFrom,
  MAX_WEEKS,
  monthMarks,
  parseSubagent,
  parseTranscript,
  recordedDays,
  settledDays,
  transcriptLedger,
  weekdayLabels,
  windowReport,
  type HeatDay,
  elapsed,
  DEFAULT_DAYS,
  GROUP_BYS,
  groups,
  type Group,
  type GroupBy,
  n,
  repoName,
  sessionName,
  stamp,
  share,
  spawnParts,
  tokens,
  type Spawn,
  emptyText,
  fit,
  emptyLedger,
  daysLabel,
  readLedger,
  LEDGER_PREFIX,
  LEDGER_SPEC,
  MAX_DAYS,
  promptSummary,
  recordSpawn,
  recordStep,
  renderStats,
  RETENTION_MS,
  type Ledger,
  type Report,
  type SessionMeta,
} from './ledger'

// A list shows this many rows, and this many more at each "more".
const PAGE = 10

const running = atom({ plugin: 'subagent-dispatch', key: 'running' } as const, [])
const stopped = atom({ plugin: 'subagent-dispatch', key: 'stopped' } as const, [])
// What the stats pane shows: the period's length and its last day (`YYYY-MM-DD`, '' for today), the
// grouping, the row opened to its spawns, their order, how many rows are listed, and the spawn
// opened in place.
const view = atom({ plugin: 'subagent-dispatch', key: 'view' } as const, { days: 30, by: 'repo', item: '', sort: 'tokens', limit: PAGE, spawn: '', end: '' })

// How an opened row orders its spawns: most tokens, newest, or longest run first.
type SortBy = 'tokens' | 'time' | 'duration'
const SORTS: Record<SortBy, (spawn: Spawn) => number> = {
  tokens: spawn => tokens(spawn),
  time: spawn => spawn.at,
  duration: spawn => spawn.last - spawn.at,
}

const MOD = 'subagent-dispatch'
const REDISPATCH = 'redispatch'
const STATS = 'stats'
const BACKFILL = 'backfill'
const PANE = 'subagent-dispatch-stats'
const PERIODS = [1, 7, 30, 90]
// Below this many body columns the heatmap is not drawn: four weeks and the labels.
const HEAT_COLUMNS = 12
// The heatmap's colors (DESIGN.md「熱圖色階」): no use, levels 1–4, the day of a 1-day period.
const HEAT = { none: '#4a4a52', levels: ['#1f5a6d', '#2a7f9c', '#3aa6cc', '#86d6f0'], chosen: '#ff8c42' } as const
// Under `backfill`: whether the transcripts were read into ledgers, so it runs once per store.
const BACKFILL_KEY = 'backfill'
// A run marked `running` this long ago is taken as dead (its session closed partway).
const BACKFILL_STALE_MS = 10 * 60_000
// `$.fs.read` rejects a file over this; a larger transcript is read through `cat`.
const READ_LIMIT = 4 * 1024 * 1024
// From this many body columns an opened row's bars are twice as long.
const WIDE_COLUMNS = 80
const SPECS: Specs = { ledger: LEDGER_SPEC, language: LANGUAGE }
const POLL_MS = 3000
const STOPPED = new Set(['killed', 'failed'])
const FINISHED = new Set(['completed', 'idle'])

function label(agent: WatchedAgent): string {
  return agent.model ? `${agent.type}/${agent.model}` : agent.type
}

// Sent to Claude, so always English.
export function redispatchPrompt(agents: WatchedAgent[]): string {
  const list = agents.map(agent => `- ${agent.description} (${label(agent)}, agent id ${agent.id})`).join('\n')

  return `These background agents were just interrupted. Dispatch them again with their original prompt, subagent_type and model (the original Agent calls are earlier in the conversation):\n${list}`
}

// Moves agents the engine reports as finished or stopped out of `running`.
async function refresh($: EngineInterface, lang: Lang): Promise<void> {
  const tracked = await read($, running)
  if (tracked.length === 0) {
    return
  }
  const live = new Map((await $.agent.list()).map(info => [info.id, info.status]))
  const stillRunning: WatchedAgent[] = []
  const newlyStopped: WatchedAgent[] = []
  for (const agent of tracked) {
    const status = live.get(agent.id)
    if (status !== undefined && STOPPED.has(status)) {
      newlyStopped.push({ ...agent, status })
    } else if (status !== undefined && !FINISHED.has(status)) {
      stillRunning.push(agent)
    }
  }

  await update($, running, () => stillRunning)
  if (newlyStopped.length > 0) {
    await update($, stopped, list => [...list, ...newlyStopped])
    $.ui.toast(
      pick(lang, {
        en: `subagent-dispatch: ${newlyStopped.length} background agent(s) were interrupted; type /${MOD} ${REDISPATCH} to dispatch them again`,
        'zh-TW': `subagent-dispatch：${newlyStopped.length} 個背景 agent 被中斷，輸入 /${MOD} ${REDISPATCH} 重派`,
      }),
      { timeoutMs: 8000 },
    )
  }
  await showStatus($, lang)
}

// Surfaces without the band above the prompt (mobile, the IDE) get a one-line summary instead.
async function showStatus($: EngineInterface, lang: Lang): Promise<void> {
  const surface = await $.session.surface()
  if (surface === 'terminal' || surface === 'desktop') {
    return
  }
  const count = (await read($, running)).length
  const lost = (await read($, stopped)).length
  const runningText = pick(lang, { en: `${count} background agent(s)`, 'zh-TW': `${count} 個背景 agent` })
  const interrupted = pick(lang, { en: `${lost} interrupted (/${MOD} ${REDISPATCH})`, 'zh-TW': `${lost} 個被中斷（/${MOD} ${REDISPATCH}）` })
  const parts = [count > 0 ? runningText : '', lost > 0 ? interrupted : '']
  const text = parts.filter(Boolean).join(' · ')
  $.ui.status(text === '' ? undefined : text)
}

async function fillRedispatch($: EngineInterface, lang: Lang): Promise<string> {
  const agents = await read($, stopped)
  if (agents.length === 0) {
    return pick(lang, { en: 'No interrupted background agents.', 'zh-TW': '沒有被中斷的背景 agent。' })
  }
  await $.prompt.fill({ text: redispatchPrompt(agents), mode: 'replace' })
  await update($, stopped, () => [])
  await showStatus($, lang)

  return pick(lang, {
    en: `Put the redispatch instructions for ${agents.length} agent(s) in the prompt box; press Enter to confirm.`,
    'zh-TW': `已把 ${agents.length} 個 agent 的重派指示放進輸入框，確認後按 Enter。`,
  })
}

// `meta` belongs to session `sid`; `agents` maps an agent id to the ledger key it was spawned
// under, at most AGENT_KEYS of them; `redraw` says a redraw of the stats pane is waiting;
// `backfilling` is the backfill running in this process; `snapshot` is the store as the pane last
// read it.
type LedgerState = {
  recording: boolean
  writing: Promise<void>
  sid: string
  meta: SessionMeta
  agents: Map<string, string>
  redraw: boolean
  backfilling?: Promise<void>
  snapshot?: Snapshot
}

// Every ledger as stored, every day row by its day, and when they were read.
type Snapshot = { at: number; ledgers: unknown[]; dayRows: Record<string, unknown> }

const AGENT_KEYS = 500
// A write redraws the stats pane this long after it, once for every write meanwhile.
const REDRAW_MS = 1000
// A redraw of the pane this soon after the last read of the store reuses it.
const SNAPSHOT_MS = 30_000

// `/clear` starts a new session id in the same process without a session.start: the new
// session starts now and is named after its own first prompt.
async function sessionKey($: EngineInterface, state: LedgerState): Promise<string> {
  const sid = await $.session.id()
  if (state.sid !== sid) {
    if (state.sid !== '') {
      state.meta = { ...state.meta, started: await $.clock.now(), prompt: '' }
    }
    state.sid = sid
  }

  return `${LEDGER_PREFIX}${sid}`
}

// Applies `change` to this session's own ledger key, or for a step of an agent spawned under an
// earlier session id (one that outlived /clear) to that session's. Parallel subagents step at
// the same time and each write reads the ledger back, so they take turns. Bookkeeping must
// never break the engine's call.
function record($: EngineInterface, state: LedgerState, where: string, change: (ledger: Ledger, at: number) => void, agentId?: string): Promise<void> {
  if (!state.recording) {
    return Promise.resolve()
  }
  state.writing = state.writing.then(async () => {
    try {
      const own = await sessionKey($, state)
      const key = (agentId === undefined ? undefined : state.agents.get(agentId)) ?? own
      const stored = await $.store.get(key)
      const ledger = readLedger(stored) ?? emptyLedger()
      change(ledger, await $.clock.now())
      if (key === own) {
        applyMeta(ledger, state.meta)
      }
      await $.store.set(key, ledger)
      redrawStats($, state)
    } catch (error) {
      $.ui.log(`${where}: ledger not written: ${String(error)}`, { to: 'debug' })
    }
  })

  return state.writing
}

// The pane reads the ledgers from `$.store`, whose writes redraw nothing by themselves. Parallel
// subagents write at every step, so the writes of a second share one redraw, which reads the store
// afresh. It also redraws this mod's band above the prompt, which reads one value.
function redrawStats($: EngineInterface, state: LedgerState): void {
  state.snapshot = undefined
  if (state.redraw) {
    return
  }
  state.redraw = true
  $.clock.after(REDRAW_MS, () => {
    state.redraw = false
    $.ui.invalidate('ui.render')
  })
}

// Deletes the ledgers no session has written to for RETENTION_MS.
async function pruneLedgers($: EngineInterface): Promise<void> {
  const cutoff = (await $.clock.now()) - RETENTION_MS
  for (const key of (await $.store.keys()).filter(name => name.startsWith(LEDGER_PREFIX))) {
    const stored = (await $.store.get(key)) as Partial<Ledger> | undefined
    if (typeof stored?.updated !== 'number' || stored.updated < cutoff) {
      await $.store.delete(key)
    }
  }
}

// Every ledger as stored, and every day row by its day: a read per key.
async function loadStore($: EngineInterface): Promise<Snapshot> {
  const keys = await $.store.keys()
  const ledgers = await Promise.all(keys.filter(name => name.startsWith(LEDGER_PREFIX)).map(key => $.store.get(key)))
  const dayKeys = keys.filter(name => name.startsWith(DAY_PREFIX))
  const rows = await Promise.all(dayKeys.map(key => $.store.get(key)))

  return { at: await $.clock.now(), ledgers, dayRows: Object.fromEntries(dayKeys.map((key, i) => [key.slice(DAY_PREFIX.length), rows[i]])) }
}

// The store for a render of the pane. Reading every key is most of a render's time once there are
// a few hundred sessions, and a resize redraws many times a second, so a redraw within SNAPSHOT_MS
// reuses the last read; this session's writes and opening the pane drop it.
async function paneStore($: EngineInterface, state: LedgerState): Promise<Snapshot> {
  const now = await $.clock.now()
  if (state.snapshot === undefined || now - state.snapshot.at >= SNAPSHOT_MS) {
    state.snapshot = await loadStore($)
  }

  return state.snapshot
}

async function loadReport($: EngineInterface, days: number): Promise<Report> {
  return buildReport((await loadStore($)).ledgers, days, await $.clock.now())
}

// Writes the day rows that are due: each day a ledger recorded up to the day before yesterday that
// has no row yet, and each of `redo` the ledgers still hold whole (a backfill adds to them).
// Deletes the rows older than DAY_KEEP days. Runs before the ledgers are pruned.
async function writeDayRows($: EngineInterface, redo: Set<string> = new Set()): Promise<void> {
  const now = await $.clock.now()
  const { ledgers, dayRows } = await loadStore($)
  const read = ledgers.map(readLedger).filter((ledger): ledger is Ledger => ledger !== undefined)
  const live = liveFrom(now)
  for (const day of settledDays(read, now)) {
    if (!(day in dayRows) || (redo.has(day) && day >= live)) {
      await $.store.set(`${DAY_PREFIX}${day}`, dayRow(read, day, now))
    }
  }
  const oldest = addDays(dayOf(now), -(DAY_KEEP - 1))
  for (const day of Object.keys(dayRows).filter(day => day < oldest)) {
    await $.store.delete(`${DAY_PREFIX}${day}`)
  }
}

type BackfillMark = { state: 'running' | 'done'; at: number; sessions: number; skipped: number }

// A file's text: through `$.fs.read` up to its limit, through `cat` above it, or undefined where
// no process can be run (desktop).
async function readLarge($: EngineInterface, path: string, size: number): Promise<string | undefined> {
  if (size <= READ_LIMIT) {
    return (await $.fs.read(path)) as string
  }
  try {
    let text = ''
    for await (const piece of $.process.spawn({ argv: ['cat', path] })) {
      if (piece.stream === 'stdout') {
        text += piece.text
      }
    }

    return text
  } catch {
    return undefined
  }
}

// The main working tree of a directory, as a live session names its repo: git's common directory
// without its `.git`. A directory gone since is taken as is, or for a worktree under
// `.claude/worktrees/` the folder that held it.
async function repoOf($: EngineInterface, cwd: string, known: Map<string, string>): Promise<string> {
  if (cwd === '') {
    return ''
  }
  const found = known.get(cwd)
  if (found !== undefined) {
    return found
  }
  let repo = cwd.split('/.claude/worktrees/')[0] ?? cwd
  try {
    const run = await $.process.run(['git', '-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { timeoutMs: 5000 })
    const common = run.stdout.trim()
    if (run.exitCode === 0 && common.endsWith('/.git')) {
      repo = common.slice(0, -'/.git'.length)
    }
  } catch {
    // No process here (desktop): keep the guess.
  }
  known.set(cwd, repo)

  return repo
}

// The spawns of a session from `<dir>/subagents/agent-<id>.jsonl` and their `.meta.json`.
async function readSpawns($: EngineInterface, dir: string, skip: (path: string, why: string) => void): Promise<Spawn[]> {
  const entries = await $.fs.list(`${dir}/subagents`).catch(() => [])
  const spawns: Spawn[] = []
  for (const entry of entries.filter(item => item.kind === 'file' && /^agent-.+\.jsonl$/.test(item.name))) {
    const path = `${dir}/subagents/${entry.name}`
    try {
      const text = await readLarge($, path, entry.size)
      if (text === undefined) {
        skip(path, 'too large to read here')
        continue
      }
      const meta = await $.fs
        .read(path.replace(/\.jsonl$/, '.meta.json'))
        .then(raw => JSON.parse(raw as string) as unknown)
        .catch(() => undefined)
      const spawn = parseSubagent(meta, text, entry.name.slice('agent-'.length, -'.jsonl'.length))
      if (spawn !== undefined) {
        spawns.push(spawn)
      }
    } catch (error) {
      skip(path, String(error))
    }
  }

  return spawns
}

// Rebuilds a ledger from the transcript of each session on this machine that has none (ADR 0025),
// one file at a time, then writes the day rows. Unless `force`, only once per store: a run another
// session marked `running` within BACKFILL_STALE_MS is left to it. Answers how many sessions it
// added, or undefined when it did not run.
async function backfill($: EngineInterface, lang: Lang, force: boolean): Promise<number | undefined> {
  const started = await $.clock.now()
  const mark = (await $.store.get(BACKFILL_KEY)) as BackfillMark | undefined
  if (!force && (mark?.state === 'done' || (mark?.state === 'running' && started - mark.at < BACKFILL_STALE_MS))) {
    return undefined
  }
  await $.store.set(BACKFILL_KEY, { state: 'running', at: started, sessions: 0, skipped: 0 } satisfies BackfillMark)
  const root = `${await configIO($).configDir()}/projects`
  const own = await $.session.id()
  const repos = new Map<string, string>()
  const redo = new Set<string>()
  let sessions = 0
  let skipped = 0
  let since = Infinity
  const skip = (path: string, why: string) => {
    skipped += 1
    $.ui.log(`backfill: skipped ${path}: ${why}`, { to: 'debug' })
  }
  const projects = await $.fs.list(root).catch((error: unknown) => {
    $.ui.log(`backfill: ${root} not read: ${String(error)}`, { to: 'debug' })

    return undefined
  })
  // Nothing to read is not done: a later session tries again.
  if (projects === undefined) {
    await $.store.delete(BACKFILL_KEY)

    return undefined
  }
  for (const project of projects.filter(item => item.kind === 'dir')) {
    const dir = `${root}/${project.name}`
    const files = await $.fs.list(dir).catch(() => [])
    for (const file of files.filter(item => item.kind === 'file' && item.name.endsWith('.jsonl'))) {
      const sid = file.name.slice(0, -'.jsonl'.length)
      const key = `${LEDGER_PREFIX}${sid}`
      if (sid === own) {
        continue
      }
      try {
        if ((await $.store.get(key)) !== undefined) {
          continue
        }
        const text = await readLarge($, `${dir}/${file.name}`, file.size)
        if (text === undefined) {
          skip(`${dir}/${file.name}`, 'too large to read here')
          continue
        }
        const parsed = parseTranscript(text)
        const spawns = await readSpawns($, `${dir}/${sid}`, skip)
        if (parsed.steps.length === 0 && spawns.length === 0) {
          continue
        }
        const ledger = transcriptLedger(parsed, spawns, await repoOf($, parsed.cwd, repos))
        // A live session may have written its own since: its record wins.
        if ((await $.store.get(key)) !== undefined) {
          continue
        }
        await $.store.set(key, ledger)
        sessions += 1
        since = Math.min(since, ledger.started || ledger.updated)
        for (const day of recordedDays(ledger)) {
          redo.add(day)
        }
      } catch (error) {
        skip(`${dir}/${file.name}`, String(error))
      }
    }
  }
  // The day rows before the mark: should they fail, the mark stays `running` and a later session
  // redoes it all once it is stale.
  await writeDayRows($, redo)
  await $.store.set(BACKFILL_KEY, { state: 'done', at: await $.clock.now(), sessions, skipped } satisfies BackfillMark)
  $.ui.log(`backfill: ${sessions} session(s) added, ${skipped} file(s) skipped`, { to: 'debug' })
  if (sessions > 0) {
    const from = dayLabel(lang, since)
    $.ui.toast(
      pick(lang, {
        en: `${MOD}: added ${sessions} session(s) from the transcripts (since ${from})`,
        'zh-TW': `${MOD}：已從 transcript 補上 ${sessions} 個 session（${from} 起）`,
      }),
    )
  }

  return sessions
}

// `stats [--text] [days]`: opens the pane, or prints the report with `--text`, in a `-p` run
// or where the pane cannot be placed (a narrow terminal).
async function stats($: EngineInterface, lang: Lang, args: string[], interactive: boolean): Promise<string> {
  const text = args.includes('--text')
  const rest = args.filter(arg => arg !== '--text')
  const days = rest[0] === undefined ? DEFAULT_DAYS : Number(rest[0])
  if (rest.length > 1 || !Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    return pick(lang, {
      en: `Usage: /${MOD} ${STATS} [--text] [days], days from 1 to ${MAX_DAYS} (default ${DEFAULT_DAYS})`,
      'zh-TW': `用法：/${MOD} ${STATS} [--text] [天數]，天數 1 到 ${MAX_DAYS}（預設 ${DEFAULT_DAYS}）`,
    })
  }
  if (!text && interactive) {
    await update($, view, current => ({ ...current, days, end: '', item: '', limit: PAGE }))
    const opened = await $.ui.open({ id: PANE, title: pick(lang, { en: 'subagent-dispatch usage', 'zh-TW': 'subagent-dispatch 用量' }), focus: true, closeOnEscape: true })
    if (opened.isPlaced) {
      return pick(lang, { en: 'Opened the usage pane (Esc closes it).', 'zh-TW': '已開啟用量 pane（Esc 關閉）。' })
    }
    $.ui.log(`stats: pane not placed (${opened.reason}), printing the text report`, { to: 'debug' })
    await $.ui.close({ id: PANE }).catch(() => undefined)
  }

  return renderStats(lang, await loadReport($, days))
}

// Starts a backfill in the background unless one is running in this process; a pane open meanwhile
// redraws with what it added. Answers whether it started one.
function startBackfill($: EngineInterface, lang: Lang, state: LedgerState, force: boolean): boolean {
  if (state.backfilling !== undefined) {
    return false
  }
  state.backfilling = backfill($, lang, force)
    .then(added => {
      if (added !== undefined && added > 0) {
        redrawStats($, state)
      }
    })
    .catch(error => $.ui.log(`backfill: stopped: ${String(error)}`, { to: 'debug' }))
    .finally(() => {
      state.backfilling = undefined
    })

  return true
}

// How many cells of `width` a bar for `part` of `most` fills: at least one when there is any.
function barCells(part: number, most: number, width: number): number {
  return part <= 0 ? 0 : Math.max(1, Math.round((part / most) * width))
}

// One colored part of a summary's bar and of the line above it: `ink` on the terminal, `fill` on desktop.
type Part = { key: string; label: string; value: number; ink: string; fill: string }

// `width` cells shared out by `values`, each part with any value at least one cell.
function splitCells(values: number[], width: number): number[] {
  const total = values.reduce((sum, value) => sum + value, 0)
  if (total === 0) {
    return values.map(() => 0)
  }
  const cells = values.map(value => (value > 0 ? Math.max(1, Math.round((value / total) * width)) : 0))
  // Rounding can miss the width by a cell or two: the largest part takes the difference.
  const largest = cells.indexOf(Math.max(...cells))
  cells[largest] = (cells[largest] ?? 0) + width - cells.reduce((sum, cell) => sum + cell, 0)

  return cells
}

function svgStack(parts: { cells: number; fill: string }[]): string {
  const unit = 8
  let x = 0
  const rects = parts.map(part => {
    const rect = part.cells === 0 ? '' : `<rect x="${x * unit}" width="${part.cells * unit}" height="8" fill="${part.fill}"/>`
    x += part.cells

    return rect
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${x * unit}" height="8">${rects.join('')}</svg>`
}

// The heatmap on desktop: a 10px cell every 12px, a week a column, the month row above and the
// weekday names at the left, each cell colored by its use alone; under the grid, the bracket and
// length of the period from `from` to `to`, or for one day (`one`) a `▲` and its `name`. Colors as
// DESIGN.md「熱圖色階」sets them.
function svgHeatmap(lang: Lang, days: HeatDay[], from: string, to: string, one: boolean, level: (value: number | null) => number, length: string, name: string): string {
  const [left, top, pitch, size] = [28, 14, 12, 10]
  const weeks = Math.ceil(days.length / 7)
  const width = left + weeks * pitch
  const rects = days.map((item, i) => {
    const x = left + Math.floor(i / 7) * pitch
    const y = top + (i % 7) * pitch
    if (one && item.day === to) {
      return `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="2" fill="${HEAT.chosen}"/>`
    }
    if (item.tokens === null) {
      return `<rect x="${x + 0.5}" y="${y + 0.5}" width="${size - 1}" height="${size - 1}" rx="2" fill="none" stroke="${COLORS.default.fill}" stroke-dasharray="2 2"/>`
    }
    if (item.tokens === 0) {
      return `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="2" fill="${COLORS.default.fill}" fill-opacity="0.25"/>`
    }

    return `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="2" fill="${COLORS.sub.fill}" fill-opacity="${[0.35, 0.55, 0.75, 1][level(item.tokens) - 1]}"/>`
  })
  const text = (x: number, y: number, words: string, extra = '') =>
    `<text x="${x}" y="${y}" font-size="9" fill="${COLORS.default.fill}" font-family="sans-serif"${extra}>${words}</text>`
  const months = monthMarks(lang, days).map(mark => text(left + mark.week * pitch, 9, mark.label))
  const names = weekdayLabels(lang).flatMap((label, row) => (label === '' ? [] : [text(0, top + row * pitch + 8, label)]))
  // The period's weeks; none where it ends before the first.
  const last = days.findIndex(item => item.day === to)
  const firstAt = days.findIndex(item => item.day >= from)
  const bottom = top + 7 * pitch
  const marks: string[] = []
  if (last >= 0 && firstAt >= 0) {
    const [w0, w1] = [Math.floor(firstAt / 7), Math.floor(last / 7)]
    const [x0, x1] = [left + w0 * pitch, left + w1 * pitch + size]
    if (one) {
      // About 6px a cell; where the name runs past the edge it goes before the mark.
      const after = `▲ ${name}`
      const fits = x0 + cells(after) * 6 <= width
      marks.push(
        `<text x="${fits ? x0 : x1}" y="${bottom + 12}" font-size="10" font-weight="700" fill="${HEAT.chosen}" font-family="sans-serif"${fits ? '' : ' text-anchor="end"'}>${fits ? after : `${name} ▲`}</text>`,
      )
    } else {
      marks.push(`<path d="M${x0} ${bottom + 1}V${bottom + 6}H${x1}V${bottom + 1}" fill="none" stroke="#a8a8b0"/>`)
      marks.push(`<text x="${(x0 + x1) / 2}" y="${bottom + 17}" font-size="10" fill="#d4d4d4" font-family="sans-serif" text-anchor="middle">${length}</text>`)
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${bottom + 22}">${[...months, ...names, ...rects, ...marks].join('')}</svg>`
}

// A spawn's key in the pane: its agent id, or for one recorded without, when it started.
function spawnId(spawn: Spawn): string {
  return spawn.agentId ?? String(spawn.at)
}

// Where a spawn's model came from: forked, named, or the default.
function kindColor(spawn: Spawn): { ink: string; fill: string } {
  return spawn.fork ? COLORS.fork : spawn.requested !== undefined ? COLORS.named : COLORS.default
}

// --- configIO: the same block in every mod (scripts/check-copies.sh) ---
function configIO($: EngineInterface): ConfigIO {
  return {
    read: async path => {
      try {
        return await $.fs.read(path)
      } catch {
        return ''
      }
    },
    write: (path, text) => $.fs.write(path, text),
    isDir: async path => (await $.fs.stat(path).catch(() => undefined))?.kind === 'dir',
    configDir: async () => (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${(await $.env.get('HOME')) ?? ''}/.claude`,
    root: () => $.session.root(),
    repoRoot: async () => (await $.session.repo())?.root,
    sessionId: () => $.session.id(),
    now: () => $.clock.now(),
    storeGet: key => $.store.get(key),
    storeSet: (key, value) => $.store.set(key, value),
  }
}
// --- end configIO ---

export const register: Register = (on, options) => {
  // Re-read at session start and after `/subagent-dispatch set`.
  let lang: Lang = 'en'
  // A `-p` run has no pane: `stats` prints its report there.
  let interactive = true
  const ledger: LedgerState = { recording: true, writing: Promise.resolve(), sid: '', meta: { repo: '', started: 0, prompt: '' }, agents: new Map(), redraw: false }

  on('session.start', async ($, e, next) => {
    interactive = e.isInteractive
    try {
      const config = await loadConfig(configIO($), MOD, SPECS, options)
      lang = config.lang
      ledger.recording = config.values.ledger !== false
    } catch (error) {
      $.ui.log(`session.start: settings not read: ${String(error)}`, { to: 'debug' })
    }
    try {
      ledger.meta = { ...ledger.meta, repo: (await $.session.repo())?.root ?? e.cwd, started: await $.clock.now() }
    } catch (error) {
      $.ui.log(`session.start: repo not read: ${String(error)}`, { to: 'debug' })
    }
    // The day rows first: a ledger pruned now has its days in rows already.
    try {
      await writeDayRows($)
    } catch (error) {
      $.ui.log(`session.start: day rows not written: ${String(error)}`, { to: 'debug' })
    }
    try {
      await pruneLedgers($)
    } catch (error) {
      $.ui.log(`session.start: ledgers not pruned: ${String(error)}`, { to: 'debug' })
    }
    try {
      await $.command.register({
        name: MOD,
        description: pick(lang, {
          en: 'Put the redispatch instructions for interrupted background agents in the prompt box (redispatch), or show token use by subagents and models (stats)',
          'zh-TW': '把被中斷的背景 agent 重派指示放進輸入框（redispatch），或看 subagent 與各模型的 token 用量（stats）',
        }),
        argumentHint: pick(lang, { en: 'redispatch | stats [--text] [days] | backfill | status', 'zh-TW': 'redispatch | stats [--text] [天數] | backfill | status' }),
      })
    } catch (error) {
      $.ui.log(`session.start: /${MOD} not registered: ${String(error)}`, { to: 'debug' })
      $.ui.toast(pick(lang, { en: `${MOD}: /${MOD} was not registered (${String(error)})`, 'zh-TW': `${MOD}：/${MOD} 指令沒有註冊成功（${String(error)}）` }))
    }
    $.clock.every(POLL_MS, () => void refresh($, lang))
    // No hook runs at install: the first session to find no mark reads the transcripts, in the
    // background. A `-p` run may end before it does, so it leaves them to the next session.
    if (ledger.recording && interactive) {
      startBackfill($, lang, ledger, false)
    }

    return next(e)
  })

  on('command.run', { command: MOD }, async ($, e) => {
    if (e.args.trim().split(/\s+/)[0] === REDISPATCH) {
      return { text: await fillRedispatch($, lang) }
    }
    const [command, ...rest] = e.args.trim().split(/\s+/)
    if (command === STATS) {
      ledger.snapshot = undefined

      return { text: await stats($, lang, rest, interactive) }
    }
    if (command === BACKFILL) {
      if (!ledger.recording) {
        return { text: pick(lang, { en: 'The ledger setting is off; nothing to backfill into.', 'zh-TW': 'ledger 設定已關閉，不回填。' }) }
      }

      return {
        text: startBackfill($, lang, ledger, true)
          ? pick(lang, {
              en: 'Reading the transcripts of sessions with no ledger, in the background; a toast says how many were added.',
              'zh-TW': '在背景讀取還沒有帳本的 session 的 transcript，補上後會跳 toast 說補了幾個。',
            })
          : pick(lang, { en: 'A backfill is already running.', 'zh-TW': '回填已經在跑。' }),
      }
    }
    const text = await configCommand(configIO($), MOD, SPECS, options, e.args, resolved => {
      lang = resolved.lang
      ledger.recording = resolved.values.ledger !== false
    })

    return {
      text:
        text ??
        pick(lang, {
          en: `Usage: /${MOD} ${REDISPATCH}, /${MOD} ${STATS} [--text] [days], /${MOD} ${BACKFILL}, /${MOD} status`,
          'zh-TW': `用法：/${MOD} ${REDISPATCH}、/${MOD} ${STATS} [--text] [天數]、/${MOD} ${BACKFILL}、/${MOD} status`,
        }),
    }
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if (spawned.deny !== undefined) {
      return spawned
    }
    await record($, ledger, 'agent.spawn', (entries, at) =>
      recordSpawn(entries, at, {
        ...(spawned.agentId === undefined ? {} : { agentId: spawned.agentId }),
        type: e.subagentType,
        model: spawned.model,
        ...(e.model === undefined ? {} : { requested: e.model }),
        fork: e.fork || e.subagentType === 'fork',
        background: e.background,
        description: e.description,
      }),
    )
    if (spawned.agentId !== undefined && ledger.recording) {
      ledger.agents.set(spawned.agentId, await sessionKey($, ledger))
      for (const old of [...ledger.agents.keys()].slice(0, -AGENT_KEYS)) {
        ledger.agents.delete(old)
      }
    }

    return spawned
  })

  // The session is named after its first prompt that is not a slash command; a resumed one
  // keeps the name it has. Mods cannot read the session's own title.
  on('prompt.submit', async ($, e, next) => {
    await sessionKey($, ledger).catch(() => undefined)
    if (ledger.meta.prompt === '' && ['composer', 'bridge', 'sdk'].includes(e.origin.kind) && !e.text.trimStart().startsWith('/')) {
      ledger.meta = { ...ledger.meta, prompt: promptSummary(e.text) }
    }

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const usage = result.usage
    if (usage !== null) {
      await record($, ledger, 'turn.step', (entries, at) =>
        recordStep(entries, at, {
          ...(e.agentId === undefined ? {} : { agentId: e.agentId }),
          model: usage.model || e.model,
          input: usage.input_tokens,
          cacheWrite: usage.cache_creation_input_tokens,
          cacheRead: usage.cache_read_input_tokens,
          output: usage.output_tokens,
        }),
        e.agentId,
      )
    }

    return result
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const ran = await next(e)
    const result = ran.result as { status?: string; agentId?: string; resolvedModel?: string } | undefined
    if (e.agentId === undefined && result?.status === 'async_launched' && result.agentId) {
      const agent: WatchedAgent = {
        id: result.agentId,
        description: e.description,
        type: e.subagent_type ?? 'general-purpose',
        startedAt: await $.clock.now(),
        status: 'running',
        ...((e.model ?? result.resolvedModel) ? { model: e.model ?? result.resolvedModel } : {}),
      }
      await update($, running, list => [...list, agent])
      await showStatus($, lang)
    }

    return ran
  }).catch(($, e, next) => next(e))

  // The band is one instance shared by every plugin: draw above what the plugins beneath drew
  // (open-items), never in place of it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const lost = await read($, stopped)
    if (e.props.hasSurvey || lost.length === 0) {
      return next(e)
    }
    const below = await next(e)
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color={TONE.danger} wrap="truncate-end">
            {pick(lang, { en: `${lost.length} agent(s) interrupted`, 'zh-TW': `${lost.length} 個 agent 被中斷` })}
            {pick(lang, { en: ': ', 'zh-TW': '：' })}
            {lost.map(agent => agent.description).join(pick(lang, { en: ', ', 'zh-TW': '、' }))}{' '}
          </Text>
          <Button key="redispatch" label={pick(lang, { en: 'Redispatch', 'zh-TW': '重派' })} hotkey="r" onPress={() => void fillRedispatch($, lang)} />
          <Button key="dismiss" label={pick(lang, { en: 'Dismiss', 'zh-TW': '略過' })} hotkey="d" onPress={() => void update($, stopped, () => [])} />
        </Box>
        {below}
      </Box>
    )
  })

  // Laid out by the body's columns, never padded with spaces (a CJK character takes two cells).
  // The overview: the heatmap, the period, its summary and a row a line; a row opens to its spawns,
  // Back returns.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const parts = $.ui.resolve(e)
    const { Box, Button, Text } = parts
    // Desktop draws the bars as Svg; the terminal has no Svg and gets colored spaces. The runtime
    // hands every constructor over, so the surface decides, not their presence.
    const Svg = e.surface !== 'terminal' && 'Svg' in parts ? parts.Svg : undefined
    const shown = await read($, view)
    const by = (GROUP_BYS as readonly string[]).includes(shown.by) ? (shown.by as GroupBy) : 'repo'
    const now = await $.clock.now()
    const store = await paneStore($, ledger)
    const body = e.props.bodyColumns
    const today = dayOf(now)
    // The period: `days` days to its last day, today unless moved back, never before the day rows reach.
    const oldest = addDays(today, -(DAY_KEEP - 1))
    const days = Number.isInteger(shown.days) && shown.days >= 1 && shown.days <= MAX_DAYS ? shown.days : DEFAULT_DAYS
    const end = typeof shown.end === 'string' && shown.end >= oldest && shown.end < today ? shown.end : today
    const begin = addDays(end, -(days - 1))
    const report = windowReport(store.ledgers, store.dayRows, begin, end, now)
    const heat = buildHeatmap(store.ledgers, store.dayRows, MAX_WEEKS, now).days
    const all = report.main + report.sub
    const rows = report.kept ? groups(lang, report, by) : []
    const open = rows.find(row => row.key === shown.item)
    const limit = Math.max(PAGE, Number(shown.limit) || PAGE)
    const crumbLabel: Record<GroupBy, string> = {
      repo: 'repo',
      session: 'session',
      model: pick(lang, { en: 'model', 'zh-TW': '模型' }),
      type: pick(lang, { en: 'type', 'zh-TW': '種類' }),
    }
    const switcher = (key: string, label: string, hotkey: string, options: { value: string; label: string }[], value: string, onPick: (value: string) => void) =>
      switchIn(parts, e.surface, key, label, hotkey, options, value, onPick)
    // The period's days: one day by its name, more by their first and last.
    const periodName = (tight = false) => (days === 1 ? dayHead(lang, end) : span(lang, begin, end, tight))
    // As in open-items: the command's name over a dim rule at the top, here with when the ledgers were
    // read at its right (the time alone where both do not fit), and the hint line at the foot. A dock
    // is as tall as its room, so the frame fills it; an inline pane keeps its own height.
    const heading = `${MOD} ${STATS}`
    const updated = pick(lang, { en: `Updated ${clockTime(store.at)}`, 'zh-TW': `更新於 ${clockTime(store.at)}` })
    const stamped = cells(heading) + cells(updated) + 6 <= body ? updated : clockTime(store.at)
    const room = e.props.placement === 'dock' ? (e.props.scroll as { bodyRows?: number } | undefined)?.bodyRows : undefined
    const frame = room === undefined ? {} : { minHeight: room }
    const title = (
      <Box key="title" flexDirection="row" gap={1} marginBottom={1}>
        <Text bold>{heading}</Text>
        <Text dimColor>{'─'.repeat(Math.max(1, body - cells(heading) - cells(stamped) - 2))}</Text>
        <Text dimColor>{stamped}</Text>
      </Box>
    )
    // A dim rule across the pane, under a list's column names or over an opened row's list.
    const rule = (
      <Box key="list-rule">
        <Text dimColor>{'─'.repeat(body)}</Text>
      </Box>
    )
    // A session by its first prompt.
    const promptOf = (session: Report['sessions'][number]) => session.prompt || pick(lang, { en: '(no prompt)', 'zh-TW': '（沒有 prompt）' })

    // A bar of `width` cells shared by `of`: colored spaces in the terminal, an Svg on desktop.
    const stack = (of: Part[], width: number) => {
      const shares = splitCells(of.map(part => part.value), width)
      if (Svg !== undefined) {
        return <Svg source={svgStack(of.map((part, i) => ({ cells: shares[i] ?? 0, fill: part.fill })))} alt={of.map(part => `${part.label} ${n(part.value)}`).join(', ')} width={width * 8} height={8} />
      }

      return <Text>{of.map((part, i) => ((shares[i] ?? 0) === 0 ? '' : <Text backgroundColor={part.ink}>{' '.repeat(shares[i] ?? 0)}</Text>))}</Text>
    }
    // A list row's bar: `cells` of `width` in `▆`, lines apart from the rows above and below
    // (DESIGN.md「長條」), parts in their own colors.
    const rowBar = (of: { cells: number; ink: string; fill: string }[], width: number) => {
      if (Svg !== undefined) {
        return <Svg source={svgStack(of)} alt="" width={Math.max(1, of.reduce((sum, part) => sum + part.cells, 0)) * 8} height={8} />
      }

      return <Text>{of.map(part => (part.cells === 0 ? '' : <Text color={part.ink}>{'▆'.repeat(part.cells)}</Text>))}</Text>
    }
    // A figure in two lines: its total and unit, what it is made of at the right where that fits, and
    // a bar the width of the pane.
    const figure = (key: string, total: string, unit: string, of: Part[], listed: Part[], count: (value: number) => string) => {
      const aside = listed.map(part => `${part.label} ${count(part.value)}`).join('  ')
      const fits = cells(`${total} ${unit}`) + 2 + cells(aside) <= body

      return [
        <Box key={`${key}-line`} flexDirection="row" justifyContent="space-between">
          <Text>
            <Text bold>{total}</Text> <Text dimColor>{unit}</Text>
          </Text>
          {fits ? <Text>{listed.map((part, i) => [i === 0 ? '' : '  ', <Text color={part.ink}>{part.label}</Text>, ` ${count(part.value)}`])}</Text> : null}
        </Box>,
        <Box key={`${key}-bar`}>{stack(of, body)}</Box>,
      ]
    }
    const tokenParts = (main: number, sub: number): Part[] => [
      { key: 'main', label: pick(lang, { en: 'main', 'zh-TW': '主' }), value: main, ...COLORS.main },
      { key: 'sub', label: 'sub', value: sub, ...COLORS.sub },
    ]
    // An opened session's main tokens by model, most first, in alternating shades of purple.
    const modelParts = (byModel: [string, number][]): Part[] =>
      [...byModel]
        .sort((a, b) => b[1] - a[1])
        .map(([model, value], i) => ({ key: `main:${model}`, label: model, value, ...MAIN_SHADES[i % MAIN_SHADES.length]! }))
    const kindParts = (s: Report['spawned']): Part[] => [
      { key: 'named', label: pick(lang, { en: 'named', 'zh-TW': '指定' }), value: s.explicit, ...COLORS.named },
      { key: 'default', label: pick(lang, { en: 'default', 'zh-TW': '預設' }), value: s.defaults, ...COLORS.default },
      { key: 'fork', label: 'fork', value: s.forks, ...COLORS.fork },
    ]
    // The tokens and the spawns, each a figure, then the cache read they leave out.
    const summary = (made: Part[], spawned: Report['spawned'], cacheRead: number) => (
      <Box key="summary" flexDirection="column" marginTop={1}>
        {figure('tokens', shortCount(made.reduce((sum, part) => sum + part.value, 0)), 'token', made, made.filter(part => part.value > 0), shortCount)}
        {spawned.all === 0 ? null : figure('spawns', String(spawned.all), pick(lang, { en: 'spawns', 'zh-TW': '次派出' }), kindParts(spawned), kindParts(spawned), String)}
        <Box key="cache-read">
          <Text dimColor>{pick(lang, { en: `Cache read ${shortCount(cacheRead)}, not counted`, 'zh-TW': `快取讀取 ${shortCount(cacheRead)} 另計` })}</Text>
        </Box>
      </Box>
    )
    const note = (key: string, text: string) => (
      <Box key={key} marginTop={1}>
        {emptyState(parts, text)}
      </Box>
    )

    if (open !== undefined) {
      const sort: SortBy = shown.sort in SORTS ? (shown.sort as SortBy) : 'tokens'
      const listed = open.detail
        .flatMap(part => part.spawns.map(spawn => ({ spawn, session: part.session })))
        .sort((a, b) => SORTS[sort](b.spawn) - SORTS[sort](a.spawn))
      const openSub = open.tokens - open.main
      const counted = countKinds(listed.map(item => item.spawn))
      const top = Math.max(1, ...listed.map(item => tokens(item.spawn)))
      const barWidth = body >= WIDE_COLUMNS ? 16 : 8
      // A row with no spawns lists its sessions instead, by tokens or by when they started.
      const bySessions = listed.length === 0
      const sessionRows = bySessions ? [...open.detail].sort((a, b) => (sort === 'time' ? b.session.started - a.session.started : b.main - a.main)) : []
      const topMain = Math.max(1, ...sessionRows.map(part => part.main))
      const count = bySessions ? sessionRows.length : listed.length
      const cellsOf = (part: number, whole: number) => barCells(part, whole, barWidth)
      // What a row's name leaves the rest: the dot, the bar, the tokens (9), the date (6) and four gaps.
      // The name is cut to it by cells, with two to spare for what the terminal draws around a button:
      // a Button's `truncate-end` wraps instead once CJK and Latin mix (DESIGN.md「控制項」).
      const nameCells = Math.max(1, body - 20 - barWidth - 2)

      return (
        <Box flexDirection="column" {...frame}>
          {title}
          {/* The back button and the crumb keep their width; only the row's name gives way. */}
          <Box key="crumb" flexDirection="row" gap={1}>
            <Box flexShrink={0}>
              <Button key="back" plain hotkey="b" onPress={() => void update($, view, current => ({ ...current, item: '', limit: PAGE }))}>
                <Text>{pick(lang, { en: '‹ Back', 'zh-TW': '‹ 返回' })}</Text>
              </Button>
            </Box>
            <Box flexShrink={0}>
              <Text dimColor> {crumbLabel[by]} ›</Text>
            </Box>
            <Box flexShrink={1} minWidth={0}>
              <Text bold wrap="truncate-end">
                {open.label}
              </Text>
            </Box>
          </Box>
          {/* The period as the overview set it, to read only. */}
          <Box key="period" marginTop={1}>
            <Text wrap="truncate-end">
              <Text dimColor>{pick(lang, { en: 'Period ', 'zh-TW': '期間 ' })}</Text>
              {daysLabel(lang, days)}
              <Text dimColor> · </Text>
              <Text bold>{periodName()}</Text>
            </Text>
          </Box>
          {summary(
            by === 'session' ? [...modelParts(open.detail.flatMap(part => part.session.mainByModel)), ...tokenParts(open.main, openSub).slice(1)] : tokenParts(open.main, openSub),
            counted,
            open.cacheRead,
          )}
          {/* Under a rule: the sort, the column names, then a row per spawn, or for a row with no spawns
              (a model only the main session used, or the main session by type) a row per session. */}
          <Box key="list" flexDirection="column" marginTop={1}>
            {rule}
            <Box>
              {switcher(
                'sort',
                pick(lang, { en: 'Sort ', 'zh-TW': '排序 ' }),
                's',
                [
                  { value: 'tokens', label: pick(lang, { en: 'most tokens', 'zh-TW': 'token 多到少' }) },
                  { value: 'time', label: pick(lang, { en: 'time', 'zh-TW': '時間' }) },
                  ...(bySessions ? [] : [{ value: 'duration', label: pick(lang, { en: 'duration', 'zh-TW': '耗時' }) }]),
                ],
                sort,
                value => void update($, view, current => ({ ...current, sort: value, limit: PAGE })),
              )}
            </Box>
            <Box key="list-columns" flexDirection="row" gap={1} marginTop={1}>
              <Box width={1} flexShrink={0} />
              <Box flexGrow={1} flexShrink={1}>
                <Text dimColor>{bySessions ? 'session' : pick(lang, { en: 'Spawns', 'zh-TW': '派出' })}</Text>
              </Box>
              <Box width={barWidth} flexShrink={0} />
              <Box width={9} flexShrink={0} justifyContent="flex-end">
                <Text dimColor>token</Text>
              </Box>
              <Box width={6} flexShrink={0} justifyContent="flex-end">
                <Text dimColor>{pick(lang, { en: 'date', 'zh-TW': '日期' })}</Text>
              </Box>
            </Box>
            {sessionRows.slice(0, limit).map(part => {
              const id = `${part.session.repo}|${part.session.started}`

              return (
                <Box key={`session:${id}`} flexDirection="row" gap={1}>
                  <Box width={1} flexShrink={0}>
                    <Text color={COLORS.main.ink}>●</Text>
                  </Box>
                  <Box flexGrow={1} flexShrink={1}>
                    <Text wrap="truncate-end">{fit(promptOf(part.session), nameCells)}</Text>
                  </Box>
                  <Box width={barWidth} flexShrink={0}>
                    {rowBar([{ cells: cellsOf(part.main, topMain), ...COLORS.main }], barWidth)}
                  </Box>
                  <Box width={9} flexShrink={0} justifyContent="flex-end">
                    <Text>{n(part.main)}</Text>
                  </Box>
                  <Box width={6} flexShrink={0} justifyContent="flex-end">
                    <Text dimColor>{dayLabel(lang, part.session.started)}</Text>
                  </Box>
                </Box>
              )
            })}
            {listed.slice(0, limit).map(({ spawn, session }) => {
              const id = spawnId(spawn)
              const color = kindColor(spawn)
              const how = spawn.fork ? 'fork' : spawn.requested === undefined ? pick(lang, { en: 'default', 'zh-TW': '預設' }) : pick(lang, { en: 'named', 'zh-TW': '指定' })
              const lines: [string, string, RenderNode][] = [
                ['type', pick(lang, { en: 'Type', 'zh-TW': '種類' }), spawn.type],
                [
                  'model',
                  pick(lang, { en: 'Model', 'zh-TW': '模型' }),
                  <Text wrap="truncate-end">
                    <Text color={color.ink}>{how}</Text>
                    {spawn.requested === undefined || spawn.fork ? '' : ` ${spawn.requested}`} → {spawn.model}
                  </Text>,
                ],
                [
                  'run',
                  pick(lang, { en: 'Run', 'zh-TW': '執行' }),
                  [
                    ...(spawn.background ? [pick(lang, { en: 'background', 'zh-TW': '背景' })] : []),
                    pick(lang, { en: `${spawn.steps} steps`, 'zh-TW': `${spawn.steps} 步` }),
                    elapsed(spawn.last - spawn.at),
                  ].join(' · '),
                ],
                ['session', 'session', sessionName(lang, session)],
              ]

              return [
                <Box key={`line:${id}`} flexDirection="row" gap={1}>
                  <Box key={`dot:${id}`} width={1} flexShrink={0}>
                    <Text color={kindColor(spawn).ink}>●</Text>
                  </Box>
                  <Box flexGrow={1} flexShrink={1}>
                    <Button key={`spawn:${id}`} plain onPress={() => void update($, view, current => ({ ...current, spawn: current.spawn === id ? '' : id }))}>
                      <Text>{fit(spawnParts(lang, spawn)[0], nameCells)}</Text>
                    </Button>
                  </Box>
                  <Box width={barWidth} flexShrink={0}>
                    {rowBar([{ cells: cellsOf(tokens(spawn), top), ...COLORS.sub }], barWidth)}
                  </Box>
                  <Box width={9} flexShrink={0} justifyContent="flex-end">
                    <Text>{n(tokens(spawn))}</Text>
                  </Box>
                  <Box width={6} flexShrink={0} justifyContent="flex-end">
                    <Text dimColor>{dayLabel(lang, spawn.at)}</Text>
                  </Box>
                </Box>,
                shown.spawn === id ? (
                  // Opened in place: a line in the color of where its model came from runs down the left
                  // (a Box border cannot be drawn on one side only).
                  <Box key={`detail:${id}`} flexDirection="column" marginLeft={1} marginTop={1} marginBottom={1}>
                    {lines.map(([key, name, value]) => (
                      <Box key={`detail:${id}:${key}`} flexDirection="row" gap={1}>
                        <Box width={2} flexShrink={0}>
                          <Text color={color.ink}>│</Text>
                        </Box>
                        <Box width={8} flexShrink={0}>
                          <Text dimColor>{name}</Text>
                        </Box>
                        <Box flexShrink={1}>{typeof value === 'string' ? <Text wrap="truncate-end">{value}</Text> : value}</Box>
                      </Box>
                    ))}
                  </Box>
                ) : null,
              ]
            })}
            {count > limit ? (
              <Box paddingLeft={2}>
                <Button key="more" plain hotkey="m" onPress={() => void update($, view, current => ({ ...current, limit: limit + PAGE }))}>
                  <Text>{pick(lang, { en: `${count - limit} more ▸`, 'zh-TW': `還有 ${count - limit} 筆 ▸` })}</Text>
                </Button>
              </Box>
            ) : null}
          </Box>
          <Box key="spacer" flexGrow={1} />
          {hintLine(parts, lang, [
            // The back, sort and more buttons already show their keys.
            { en: 'Tab moves', 'zh-TW': 'Tab 移動' },
            ...(bySessions ? [] : [{ en: 'Enter opens a spawn', 'zh-TW': 'Enter 展開一筆' }]),
          ])}
        </Box>
      )
    }

    // The heatmap: a cell a day, a week a column, colored by use alone (dimming would read as gray, as
    // no use does), and under it the period's mark beside as much of the legend as fits.
    const heatmap = () => {
      if (body < HEAT_COLUMNS) {
        return null
      }
      const weeks = heatWeeks(body)
      const first = heatStart(weeks, now)
      const drawn = heat.filter(item => item.day >= first)
      const level = heatLevels(drawn)
      const one = (day: string) => days === 1 && day === end
      const peak = drawn.reduce<HeatDay | undefined>((most, item) => ((item.tokens ?? 0) > (most?.tokens ?? 0) ? item : most), undefined)
      const ink = (item: HeatDay) => (one(item.day) ? HEAT.chosen : item.tokens === 0 ? HEAT.none : HEAT.levels[level(item.tokens) - 1])
      const weekOf = (day: string) => Math.floor((daysBetween(first, day) - 1) / 7)
      const lengthLabel = daysLabel(lang, days)
      const legend: { width: number; node: RenderNode }[] = [
        {
          width: cells(pick(lang, { en: 'Less ■■■■ More', 'zh-TW': '少 ■■■■ 多' })),
          node: (
            <Text>
              <Text dimColor>{pick(lang, { en: 'Less ', 'zh-TW': '少 ' })}</Text>
              {HEAT.levels.map(color => (
                <Text color={color}>■</Text>
              ))}
              <Text dimColor>{pick(lang, { en: ' More', 'zh-TW': ' 多' })}</Text>
            </Text>
          ),
        },
        {
          width: cells(pick(lang, { en: 'None ■', 'zh-TW': '無用量 ■' })),
          node: (
            <Text>
              <Text dimColor>{pick(lang, { en: 'None ', 'zh-TW': '無用量 ' })}</Text>
              <Text color={HEAT.none}>■</Text>
            </Text>
          ),
        },
        { width: cells(pick(lang, { en: 'No data ·', 'zh-TW': '無資料 ·' })), node: <Text dimColor>{pick(lang, { en: 'No data ·', 'zh-TW': '無資料 ·' })}</Text> },
      ]
      if (peak !== undefined) {
        const most = `${shortDay(lang, peak.day)} ${shortCount(peak.tokens ?? 0)}`
        const word = pick(lang, { en: 'Most ', 'zh-TW': '最多 ' })
        legend.push({
          width: cells(word + most),
          node: (
            <Text>
              <Text dimColor>{word}</Text>
              {most}
            </Text>
          ),
        })
      }
      if (Svg !== undefined) {
        const height = 14 + 7 * 12 + 22
        return (
          <Box key="heatmap" flexDirection="column" marginBottom={1}>
            <Svg
              source={svgHeatmap(lang, drawn, begin, end, days === 1, level, lengthLabel, dayHead(lang, end))}
              alt={pick(lang, { en: `Tokens per day, ${weeks} weeks; the period bracketed`, 'zh-TW': `每天的 token，${weeks} 週，括號標出期間` })}
              width={28 + weeks * 12}
              height={height}
            />
            <Box key="heat-note">
              <Text wrap="wrap">{legend.map((item, i) => [i === 0 ? '' : '  ', item.node])}</Text>
            </Box>
          </Box>
        )
      }
      // The month row as one line of text: a label at its week's column where it fits.
      const gridWidth = weeks * 2 - 1
      let months = ''
      for (const mark of monthMarks(lang, drawn)) {
        const at = mark.week * 2
        if (at >= cells(months) + (months === '' ? 0 : 1) && at + cells(mark.label) <= gridWidth + 1) {
          months += ' '.repeat(at - cells(months)) + mark.label
        }
      }
      // Under the grid, one line: the period's mark and as much of the legend as fits beside it.
      const mark = periodMark(body, weekOf(begin), weekOf(end), lengthLabel, days === 1 ? dayHead(lang, end) : undefined)
      const fitted = fitLegend(body, mark === undefined ? undefined : { at: mark.at, width: cells(mark.text) }, legend.map(item => item.width))
      const line: RenderNode[] = []
      let column = 0
      const moveTo = (at: number) => {
        if (at > column) {
          line.push(' '.repeat(at - column))
          column = at
        }
      }
      const putLegend = () => {
        moveTo(fitted.at)
        legend.slice(0, fitted.count).forEach((item, i) => {
          line.push(i === 0 ? '' : '  ', item.node)
          column += (i === 0 ? 0 : 2) + item.width
        })
      }
      const putMark = () => {
        if (mark !== undefined) {
          moveTo(mark.at)
          line.push(days === 1 ? <Text bold color={HEAT.chosen}>{mark.text}</Text> : mark.text)
          column += cells(mark.text)
        }
      }
      if (fitted.count > 0 && fitted.at <= (mark?.at ?? body)) {
        putLegend()
        putMark()
      } else {
        putMark()
        putLegend()
      }
      const labels = weekdayLabels(lang)

      return (
        <Box key="heatmap" flexDirection="column" marginBottom={1}>
          <Box key="heat-months" paddingLeft={4}>
            <Text dimColor wrap="truncate-end">
              {months === '' ? ' ' : months}
            </Text>
          </Box>
          {labels.map((name, row) => (
            <Box key={`heat-row:${row}`} flexDirection="row">
              <Box width={4} flexShrink={0}>
                <Text dimColor>{name}</Text>
              </Box>
              {/* One Text a row, a colored glyph a day: a button a cell made each redraw slow (ADR 0026). */}
              <Text>
                {Array.from({ length: weeks }, (_, week) => {
                  const item = drawn[week * 7 + row]
                  const gap = week === 0 ? '' : ' '
                  if (item === undefined) {
                    return gap
                  }

                  return [
                    gap,
                    item.tokens === null && !one(item.day) ? (
                      <Text dimColor>·</Text>
                    ) : (
                      <Text color={ink(item)} bold={one(item.day)}>
                        ■
                      </Text>
                    ),
                  ]
                })}
              </Text>
            </Box>
          ))}
          <Box key="heat-note">
            <Text>{line.length === 0 ? ' ' : line}</Text>
          </Box>
        </Box>
      )
    }

    // The period: its length, moved back and forth by that length, and today at the right. Where it
    // does not fit, the word goes, then the spaces in the days and around them; then `t` wraps. The
    // terminal draws `p: ` before a plain button with a hotkey.
    const periodWord = pick(lang, { en: 'Period ', 'zh-TW': '期間 ' })
    const todayWord = pick(lang, { en: 'Today', 'zh-TW': '今天' })
    const fullName = days === 1 && end === today ? pick(lang, { en: `Today, ${periodName()}`, 'zh-TW': `今天 ${periodName()}` }) : periodName()
    const variants = [
      { word: true, gap: 2, name: fullName },
      { word: false, gap: 2, name: fullName },
      { word: false, gap: 1, name: periodName(true) },
    ]
    const widthOf = (v: (typeof variants)[number]) =>
      (v.word ? cells(periodWord) : 0) + 3 + cells(`‹ ${daysLabel(lang, days)} ›`) + v.gap + cells('h: ‹') + cells(` ${v.name} `) + cells('l: ›') + 2 + 3 + cells(todayWord)
    const variant = variants.find(v => widthOf(v) <= body) ?? variants[2]!
    const moveEnd = (to: string) => void update($, view, current => ({ ...current, end: to === today ? '' : to, item: '', limit: PAGE }))
    const period = (
      <Box key="period" flexDirection="row" flexWrap="wrap" justifyContent="space-between" columnGap={2}>
        <Box key="period-days" flexDirection="row" flexShrink={0}>
          {switcher(
            'days',
            variant.word ? periodWord : '',
            'p',
            PERIODS.map(value => ({ value: String(value), label: daysLabel(lang, value) })),
            String(days),
            value => void update($, view, current => ({ ...current, days: Number(value), end: end === today ? '' : end, item: '', limit: PAGE })),
          )}
          <Text>{' '.repeat(variant.gap)}</Text>
          <Button key="earlier" plain hotkey="h" onPress={() => moveEnd(movePeriod(end, days, -1, today, oldest))}>
            <Text>‹</Text>
          </Button>
          <Text bold {...(days === 1 ? { color: HEAT.chosen } : {})}>{` ${variant.name} `}</Text>
          <Button key="later" plain hotkey="l" onPress={() => moveEnd(movePeriod(end, days, 1, today, oldest))}>
            <Text>›</Text>
          </Button>
        </Box>
        <Button key="today" plain hotkey="t" onPress={() => void update($, view, current => ({ ...current, days: 1, end: '', item: '', limit: PAGE }))}>
          <Text {...(days === 1 && end === today ? { dimColor: true } : {})}>{todayWord}</Text>
        </Button>
      </Box>
    )

    // A row a line: the name, then the columns that fit by how much they matter (DESIGN.md「欄位清單」).
    type ListColumn = Column & { head: string; value?: (row: Group) => string; left?: boolean; max?: number; ink?: string }
    const subOf = (row: Group) => row.tokens - row.main
    const listed = rows.reduce((sum, row) => sum + row.tokens, 0)
    const last: ListColumn = { key: 'last', head: pick(lang, { en: 'Last', 'zh-TW': '上次' }), width: 0, priority: 7, value: row => (row.last === '' ? '—' : shortDay(lang, row.last)) }
    const average: ListColumn = {
      key: 'average',
      head: pick(lang, { en: 'Avg/spawn', 'zh-TW': '平均/次' }),
      width: 0,
      priority: 6,
      value: row => (row.spawns === 0 ? '—' : shortCount(subOf(row) / row.spawns)),
    }
    const own: Record<GroupBy, ListColumn[]> = {
      repo: [{ key: 'sessions', head: 'session', width: 0, priority: 6, value: row => String(new Set(row.detail.map(part => part.session)).size) }, last],
      session: [
        { key: 'repo', head: 'repo', width: 0, priority: 6, left: true, max: 14, value: row => repoName(lang, row.detail[0]?.session.repo ?? '') },
        { key: 'started', head: pick(lang, { en: 'Started', 'zh-TW': '開始' }), width: 0, priority: 7, value: row => stamp(lang, row.detail[0]?.session.started ?? 0) },
      ],
      model: [average, last],
      type: [average, last],
    }
    const barWidth = listBarWidth(body)
    const base: ListColumn[] = [
      { key: 'tokens', head: 'token', width: 0, priority: 1, value: row => shortCount(row.tokens) },
      { key: 'share', head: pick(lang, { en: 'Share', 'zh-TW': '佔比' }), width: 0, priority: 4, value: row => share(row.tokens, listed) },
      { key: 'bar', head: '', width: barWidth, priority: 3 },
      { key: 'sub', head: 'sub', width: 0, priority: 5, value: row => share(subOf(row), row.tokens), ink: COLORS.sub.ink },
      { key: 'spawns', head: pick(lang, { en: 'Spawns', 'zh-TW': '派出' }), width: 0, priority: 2, value: row => String(row.spawns) },
      {
        key: 'kinds',
        head: pick(lang, { en: 'Named/default/fork', 'zh-TW': '指定/預設/fork' }),
        width: 0,
        priority: 8,
        value: row => {
          const kinds = countKinds(row.detail.flatMap(part => part.spawns))

          return `${kinds.explicit}/${kinds.defaults}/${kinds.forks}`
        },
      },
      ...own[by],
      { key: 'cache', head: pick(lang, { en: 'Cache read', 'zh-TW': '快取讀取' }), width: 0, priority: 9, value: row => shortCount(row.cacheRead) },
    ]
    const columns = base.map(column =>
      column.value === undefined ? column : { ...column, width: Math.min(column.max ?? Infinity, Math.max(cells(column.head), ...rows.map(row => cells(column.value!(row))))) },
    )
    const groupLabel: Record<GroupBy, string> = {
      repo: pick(lang, { en: 'by repo', 'zh-TW': '依 repo' }),
      session: pick(lang, { en: 'by session', 'zh-TW': '依 session' }),
      model: pick(lang, { en: 'by model', 'zh-TW': '依模型' }),
      type: pick(lang, { en: 'by type', 'zh-TW': '依種類' }),
    }
    // The name keeps 16 cells, and room for the grouping's switch heading it in the terminal.
    const nameMin = Math.max(16, ...(Svg === undefined ? GROUP_BYS.map(value => 3 + cells(`‹ ${groupLabel[value]} ›`)) : []))
    const fitted = fitColumns(columns, body, nameMin)
    const nameWidth = Math.max(1, body - fitted.used)
    const maxTokens = Math.max(1, ...rows.map(row => row.tokens))
    const groupSwitch = switcher(
      'group',
      '',
      'g',
      GROUP_BYS.map(value => ({ value, label: groupLabel[value] })),
      by,
      value => void update($, view, current => ({ ...current, by: value, item: '', limit: PAGE })),
    )
    const cell = (column: ListColumn, row: Group) => {
      if (column.key === 'bar') {
        const length = barCells(row.tokens, maxTokens, column.width)
        const sub = subOf(row) > 0 ? Math.max(1, Math.round((length * subOf(row)) / row.tokens)) : 0

        return rowBar(
          [
            { cells: Math.max(0, length - sub), ...COLORS.main },
            { cells: Math.min(sub, length), ...COLORS.sub },
          ],
          column.width,
        )
      }
      const value = fit(column.value!(row), column.width)
      const plain = column.key === 'tokens' || column.key === 'spawns'

      return column.ink !== undefined ? <Text color={column.ink}>{value}</Text> : <Text dimColor={!plain}>{value}</Text>
    }
    const list = (
      <Box key="list" flexDirection="column" marginTop={1}>
        {Svg === undefined ? null : <Box key="group-line">{groupSwitch}</Box>}
        <Box key="list-columns" flexDirection="row">
          <Box width={nameWidth} flexShrink={0}>
            {Svg === undefined ? groupSwitch : null}
          </Box>
          {fitted.shown.map(column => (
            <Box key={`head:${column.key}`} width={column.width} marginLeft={2} flexShrink={0} justifyContent={column.left ? 'flex-start' : 'flex-end'}>
              <Text dimColor>{column.head}</Text>
            </Box>
          ))}
        </Box>
        {rule}
        {rows.slice(0, limit).map(row => {
          // The name is cut by cells, with two to spare for what the terminal draws around a button (a
          // Button's text wraps instead of truncating once CJK and Latin mix).
          const session = by === 'session' ? row.detail[0]?.session : undefined

          return (
            <Box key={`line-${row.key}`} flexDirection="row">
              <Box width={nameWidth} flexShrink={0}>
                <Button key={`row:${row.key}`} plain onPress={() => void update($, view, current => ({ ...current, item: row.key, sort: 'tokens', limit: PAGE, spawn: '' }))}>
                  <Text>{fit(session === undefined ? row.label : promptOf(session), Math.max(1, nameWidth - 2))}</Text>
                </Button>
              </Box>
              {fitted.shown.map(column => (
                <Box key={`${row.key}:${column.key}`} width={column.width} marginLeft={2} flexShrink={0} justifyContent={column.left ? 'flex-start' : 'flex-end'}>
                  {cell(column, row)}
                </Box>
              ))}
            </Box>
          )
        })}
        {rows.length > limit ? (
          <Box key="more-line">
            <Button key="more" plain hotkey="m" onPress={() => void update($, view, current => ({ ...current, limit: limit + PAGE }))}>
              <Text>{pick(lang, { en: `${rows.length - limit} more ▸`, 'zh-TW': `還有 ${rows.length - limit} 筆 ▸` })}</Text>
            </Button>
          </Box>
        ) : null}
      </Box>
    )

    // In place of the summary: why there is nothing to count. Nothing recorded at all keeps the long
    // sentence on how recording starts.
    const said = days === 1 ? dayHead(lang, end) : span(lang, begin, end)
    const nothing = heat.every(item => item.tokens === null) && report.sessions.length === 0
    const inPeriod = heat.filter(item => item.day >= begin && item.day <= end)
    const empty =
      all > 0
        ? undefined
        : nothing
          ? emptyText(lang)
          : inPeriod.some(item => item.tokens !== null)
            ? pick(lang, { en: `${said}: no usage.`, 'zh-TW': `${said}${days === 1 ? '' : ' '}沒有用量。` })
            : pick(lang, { en: `${said}: no data.`, 'zh-TW': `${said}${days === 1 ? '' : ' '}沒有資料。` })
    const pruned = pick(lang, {
      en: `${said}: the details are kept ${MAX_DAYS} days and were deleted.`,
      'zh-TW': `${said}${days === 1 ? '' : ' '}的詳細資料保存超過 ${MAX_DAYS} 天，已刪除。`,
    })

    return (
      <Box flexDirection="column" {...frame}>
        {title}
        {heatmap()}
        {period}
        {empty !== undefined ? (
          note('empty-note', empty)
        ) : (
          <Box key="body" flexDirection="column">
            {summary(tokenParts(report.main, report.sub), report.spawned, report.cacheRead)}
            {!report.kept ? note('pruned', pruned) : rows.length === 0 ? null : list}
          </Box>
        )}
        {/* Takes up what the list leaves, so the hint line sits at the foot of a docked pane. The period
            and group buttons already show their keys. */}
        <Box key="spacer" flexGrow={1} />
        {hintLine(parts, lang, [{ en: 'Tab moves', 'zh-TW': 'Tab 移動' }, ...(empty === undefined && rows.length > 0 ? [{ en: 'Enter opens a row', 'zh-TW': 'Enter 打開一列' }] : [])])}
      </Box>
    )
  })
}
