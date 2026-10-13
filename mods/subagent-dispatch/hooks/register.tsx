import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderNode } from 'claude-code'

import type { WatchedAgent } from '../types'
import { configCommand, LANGUAGE, loadConfig, pick, type ConfigIO, type Lang, type Specs } from './config'
import { CARD, COLORS, emptyState, hintLine, MAIN_SHADES, switcher as switchIn, TONE } from './ui'
import {
  addDays,
  applyMeta,
  buildHeatmap,
  buildReport,
  cells,
  clockTime,
  shortCount,
  countKinds,
  DAY_KEEP,
  DAY_PREFIX,
  dayHead,
  dayLabel,
  dayName,
  dayOf,
  dayReport,
  dayRow,
  heatLevels,
  heatStart,
  heatWeeks,
  liveFrom,
  MAX_WEEKS,
  monthMarks,
  parseSubagent,
  parseTranscript,
  readDayRow,
  recordedDays,
  settledDays,
  transcriptLedger,
  weekdayLabels,
  type HeatDay,
  elapsed,
  DEFAULT_DAYS,
  GROUP_BYS,
  groups,
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
  range,
  recordSpawn,
  recordStep,
  renderStats,
  RETENTION_MS,
  type Ledger,
  type Report,
  type SessionMeta,
} from './ledger'

// An opened row lists this many spawns, and this many more at each "more".
const PAGE = 10

const running = atom({ plugin: 'subagent-dispatch', key: 'running' } as const, [])
const stopped = atom({ plugin: 'subagent-dispatch', key: 'stopped' } as const, [])
// What the stats pane shows: the period, the grouping, the row opened to its spawns, their
// order, how many of them are listed, the one opened in place, and the day chosen on the
// heatmap (`YYYY-MM-DD`, in place of the period).
const view = atom({ plugin: 'subagent-dispatch', key: 'view' } as const, { days: 30, by: 'repo', item: '', sort: 'tokens', limit: PAGE, spawn: '', day: '' })

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
// The heatmap's colors (DESIGN.md「熱圖色階」): no use, levels 1–4, the chosen day.
const HEAT = { none: '#4a4a52', levels: ['#1f5a6d', '#2a7f9c', '#3aa6cc', '#86d6f0'], chosen: '#ff8c42' } as const
// Under `backfill`: whether the transcripts were read into ledgers, so it runs once per store.
const BACKFILL_KEY = 'backfill'
// A run marked `running` this long ago is taken as dead (its session closed partway).
const BACKFILL_STALE_MS = 10 * 60_000
// `$.fs.read` rejects a file over this; a larger transcript is read through `cat`.
const READ_LIMIT = 4 * 1024 * 1024
// From this many body columns a row is one line; below, its bar goes on a second line.
const WIDE_COLUMNS = 80
// From this many body columns the two cards sit side by side; below, one above the other.
const CARD_COLUMNS = 60
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
    await update($, view, current => ({ ...current, days }))
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

function svgBar(cells: number, width: number): string {
  const unit = 8

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width * unit}" height="10"><rect width="${cells * unit}" height="10" rx="2" fill="${COLORS.sub.fill}"/></svg>`
}

// One colored part of a card's bar and its legend line: `ink` on the terminal, `fill` on desktop.
// `tally` follows it on every card, `note` only on the overview's.
type Part = { key: string; label: string; short?: string; tally?: string; note?: string; value: number; ink: string; fill: string }

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
// weekday names at the left. Colors as DESIGN.md「熱圖色階」sets them.
function svgHeatmap(lang: Lang, days: HeatDay[], chosen: string, level: (value: number | null) => number): string {
  const [left, top, pitch, size] = [28, 14, 12, 10]
  const weeks = Math.ceil(days.length / 7)
  const rects = days.map((item, i) => {
    const x = left + Math.floor(i / 7) * pitch
    const y = top + (i % 7) * pitch
    if (item.day === chosen) {
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
  const text = (x: number, y: number, words: string) => `<text x="${x}" y="${y}" font-size="9" fill="${COLORS.default.fill}" font-family="sans-serif">${words}</text>`
  const months = monthMarks(lang, days).map(mark => text(left + mark.week * pitch, 9, mark.label))
  const names = weekdayLabels(lang).flatMap((name, row) => (name === '' ? [] : [text(0, top + row * pitch + 8, name)]))

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${left + weeks * pitch}" height="${top + 7 * pitch}">${[...months, ...names, ...rects].join('')}</svg>`
}

// A spawn's key in the pane: its agent id, or for one recorded without, when it started.
function spawnId(spawn: Spawn): string {
  return spawn.agentId ?? String(spawn.at)
}

// Where a spawn's model came from: forked, named, or the default.
function kindColor(spawn: Spawn): { ink: string; fill: string } {
  return spawn.fork ? COLORS.fork : spawn.requested !== undefined ? COLORS.named : COLORS.default
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
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
  // Each row is a button that opens it to its sessions and spawns; Back returns.
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
    // The heatmap's weeks and days; a chosen day it no longer reaches (the pane narrowed) is let go.
    const weeks = heatWeeks(body)
    const first = heatStart(weeks, now)
    const heat = buildHeatmap(store.ledgers, store.dayRows, MAX_WEEKS, now).days
    const drawn = heat.filter(item => item.day >= first)
    const chosen = typeof shown.day === 'string' && shown.day >= first && shown.day <= today ? shown.day : ''
    const chosenTokens = heat.find(item => item.day === chosen)?.tokens ?? null
    // A chosen day before the ledgers reach has only its day row: the cards, no sessions.
    const summaryOnly = chosen !== '' && chosen < liveFrom(now)
    const chosenRow = summaryOnly ? readDayRow(store.dayRows[chosen]) : undefined
    const report =
      chosen === ''
        ? buildReport(store.ledgers, shown.days, now)
        : chosenRow !== undefined
          ? dayReport(chosenRow, chosen, now)
          : buildReport(summaryOnly ? [] : store.ledgers, 1, now, chosen)
    const rows = groups(lang, report, by)
    const open = rows.find(row => row.key === shown.item)
    const wide = body >= WIDE_COLUMNS
    const all = report.main + report.sub
    const most = Math.max(1, ...rows.map(row => row.tokens))
    // A row is a card (its border and padding take four columns); its bar takes what the line leaves
    // after the tokens and the share.
    const rowInner = Math.max(8, body - 4)
    const barWidth = clamp(rowInner - 18, 8, 60)
    const byLabel: Record<GroupBy, string> = {
      repo: 'repo',
      session: 'session',
      model: pick(lang, { en: 'model', 'zh-TW': '模型' }),
      type: pick(lang, { en: 'type', 'zh-TW': '種類' }),
    }
    const switcher = (key: string, label: string, hotkey: string, options: { value: string; label: string }[], value: string, onPick: (value: string) => void) =>
      switchIn(parts, e.surface, key, label, hotkey, options, value, onPick)
    // The cache read line ends with when the ledgers were read; where both do not fit, the time goes
    // on the next line, at the left.
    const cacheText = pick(lang, { en: `Cache read ${n(report.cacheRead)}, not counted`, 'zh-TW': `快取讀取 ${n(report.cacheRead)}，不計入` })
    const updatedText = pick(lang, { en: `Updated ${clockTime(store.at)}`, 'zh-TW': `更新於 ${clockTime(store.at)}` })
    const spawnCount = (count: number) => pick(lang, { en: `${count} spawns`, 'zh-TW': `${count} 次` })
    const cellBar = (part: number, whole: number, width: number) => {
      const cells = barCells(part, whole, width)
      if (Svg !== undefined) {
        return <Svg source={svgBar(cells, width)} alt={n(part)} width={width * 8} height={10} />
      }

      return cells === 0 ? <Text> </Text> : <Text backgroundColor="cyan">{' '.repeat(cells)}</Text>
    }
    const bar = (part: number) => cellBar(part, most, barWidth)
    // As in open-items: the command's name over a dim rule at the top, the hint line at the foot.
    // A dock is as tall as its room, so the frame fills it; an inline pane keeps its own height.
    const heading = `${MOD} ${STATS}`
    const room = e.props.placement === 'dock' ? (e.props.scroll as { bodyRows?: number } | undefined)?.bodyRows : undefined
    const frame = room === undefined ? {} : { minHeight: room }
    const title = (
      <Box key="title" flexDirection="row" gap={1} marginBottom={1}>
        <Text bold>{heading}</Text>
        <Text dimColor>{'─'.repeat(Math.max(0, body - heading.length - 1))}</Text>
      </Box>
    )
    // A session by its first prompt; its time and repo go on a line of their own.
    const promptOf = (session: Report['sessions'][number]) => session.prompt || pick(lang, { en: '(no prompt)', 'zh-TW': '（沒有 prompt）' })
    // A dim rule across the pane, over a list.
    const rule = (key: string) => (
      <Text key={key} dimColor>
        {'─'.repeat(body)}
      </Text>
    )

    const periodLabel = pick(lang, { en: 'Period ', 'zh-TW': '期間 ' })
    // With a day chosen the period shows the day, and its first press lets the day go.
    const periodSwitch =
      chosen === '' ? (
        switcher(
          'days',
          periodLabel,
          'p',
          PERIODS.map(days => ({ value: String(days), label: daysLabel(lang, days) })),
          String(shown.days),
          value => void update($, view, current => ({ ...current, days: Number(value), item: '' })),
        )
      ) : (
        <Box key="switch:days" flexDirection="row" flexShrink={0}>
          <Text dimColor>{periodLabel}</Text>
          <Button key="days" plain hotkey="p" onPress={() => void update($, view, current => ({ ...current, day: '', item: '' }))}>
            <Text bold>‹ {dayName(lang, chosen)} ›</Text>
          </Button>
        </Box>
      )
    const choose = (day: string) => void update($, view, current => ({ ...current, day, item: '', limit: PAGE, spawn: '' }))
    // j steps back a day (from today when none is chosen) to the heatmap's first; k forward to today.
    const dayButtons = (
      <Box key="day-steps" flexDirection="row" gap={2} flexShrink={0}>
        <Button
          key="prev-day"
          plain
          hotkey="j"
          onPress={() => {
            const day = chosen === '' ? today : addDays(chosen, -1)
            if (day >= first) {
              choose(day)
            }
          }}
        >
          <Text>{pick(lang, { en: '‹ Prev day', 'zh-TW': '‹ 前一天' })}</Text>
        </Button>
        <Button
          key="next-day"
          plain
          hotkey="k"
          onPress={() => {
            if (chosen !== '' && chosen < today) {
              choose(addDays(chosen, 1))
            }
          }}
        >
          <Text>{pick(lang, { en: 'Next day ›', 'zh-TW': '後一天 ›' })}</Text>
        </Button>
      </Box>
    )
    const heatmap = () => {
      if (body < HEAT_COLUMNS) {
        return null
      }
      const level = heatLevels(drawn)
      const peak = drawn.reduce<HeatDay | undefined>((top, item) => ((item.tokens ?? 0) > (top?.tokens ?? 0) ? item : top), undefined)
      const ink = (item: HeatDay) => (item.day === chosen ? HEAT.chosen : item.tokens === 0 ? HEAT.none : HEAT.levels[level(item.tokens) - 1])
      // The columns of the grid: a week every two, its last cell one before the next week.
      const gridWidth = weeks * 2 - 1
      const column = (day: string) => Math.floor(drawn.findIndex(item => item.day === day) / 7) * 2
      const legend = (
        <Box key="heat-legend" flexDirection="row" flexWrap="wrap" justifyContent="space-between" columnGap={2} paddingLeft={4}>
          <Text>
            <Text dimColor>{pick(lang, { en: 'No data ', 'zh-TW': '無資料 ' })}</Text>
            <Text dimColor>·</Text>
            <Text dimColor>{pick(lang, { en: '  None ', 'zh-TW': '  無用量 ' })}</Text>
            <Text color={HEAT.none}>■</Text>
            <Text dimColor>{pick(lang, { en: '  Less ', 'zh-TW': '  少 ' })}</Text>
            {HEAT.levels.map(color => (
              <Text color={color}>■</Text>
            ))}
            <Text dimColor>{pick(lang, { en: ' More  Selected ', 'zh-TW': ' 多  選到 ' })}</Text>
            <Text bold color={HEAT.chosen}>
              ■
            </Text>
          </Text>
          {peak === undefined ? null : (
            <Text>
              <Text dimColor>{pick(lang, { en: 'Most ', 'zh-TW': '最多 ' })}</Text>
              {`${dayLabel(lang, Date.parse(`${peak.day}T12:00:00`))} ${shortCount(peak.tokens ?? 0)}`}
            </Text>
          )}
        </Box>
      )
      if (Svg !== undefined) {
        return (
          <Box key="heatmap" flexDirection="column" marginBottom={1}>
            <Svg source={svgHeatmap(lang, drawn, chosen, level)} alt={pick(lang, { en: `Tokens per day, ${weeks} weeks`, 'zh-TW': `每天的 token，${weeks} 週` })} width={28 + weeks * 12} height={14 + 7 * 12} />
            {legend}
          </Box>
        )
      }
      // The month row as one line of text: a label at its week's column where it fits.
      let months = ''
      for (const mark of monthMarks(lang, drawn)) {
        const at = mark.week * 2
        if (at >= cells(months) + (months === '' ? 0 : 1) && at + cells(mark.label) <= gridWidth + 1) {
          months += ' '.repeat(at - cells(months)) + mark.label
        }
      }
      // Under the grid: the chosen day's column, or the weeks the period covers.
      let note: RenderNode
      if (chosen !== '') {
        const name = dayName(lang, chosen)
        const at = column(chosen)
        const fits = at + cells(name) + 2 <= gridWidth
        note = (
          <Text>
            {' '.repeat(fits ? at : Math.max(0, at + 1 - cells(name) - 2))}
            <Text bold color={HEAT.chosen}>
              {fits ? `▲ ${name}` : `${name} ▲`}
            </Text>
          </Text>
        )
      } else if (shown.days === 1) {
        note = (
          <Text>
            {' '.repeat(column(today))}
            <Text bold>{pick(lang, { en: '▲ today', 'zh-TW': '▲ 今天' })}</Text>
          </Text>
        )
      } else {
        const from = addDays(today, -(Number(shown.days) - 1))
        const at = from < first ? 0 : column(from)
        const span = gridWidth - at
        const label = daysLabel(lang, Number(shown.days))
        // Inside the bracket with a rule each side, or where the weeks are too few, before it.
        const dashes = span - 4 - cells(label)
        note =
          dashes >= 2 ? (
            <Text>
              {' '.repeat(at)}
              <Text dimColor>{`└${'─'.repeat(Math.floor(dashes / 2))} `}</Text>
              <Text bold>{label}</Text>
              <Text dimColor>{` ${'─'.repeat(Math.ceil(dashes / 2))}┘`}</Text>
            </Text>
          ) : (
            <Text>
              {' '.repeat(Math.max(0, at - cells(label) - 1))}
              <Text bold>{label}</Text>
              <Text dimColor>{` └${'─'.repeat(Math.max(0, span - 2))}┘`}</Text>
            </Text>
          )
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
                    item.tokens === null && item.day !== chosen ? (
                      <Text dimColor>·</Text>
                    ) : (
                      <Text color={ink(item)} bold={item.day === chosen}>
                        ■
                      </Text>
                    ),
                  ]
                })}
              </Text>
            </Box>
          ))}
          <Box key="heat-note" paddingLeft={4}>
            {note}
          </Box>
          {legend}
        </Box>
      )
    }
    const groupSwitch = switcher(
      'group',
      pick(lang, { en: 'Group by ', 'zh-TW': '分組 ' }),
      'g',
      GROUP_BYS.map(value => ({ value, label: byLabel[value] })),
      by,
      value => void update($, view, current => ({ ...current, by: value, item: '' })),
    )
    // Two cards, each a total over a bar of what it is made of: stacked in a dock, side by side
    // from CARD_COLUMNS. A card's border and padding take four of its columns.
    const paired = body >= CARD_COLUMNS
    const cardWidth = paired ? Math.floor((body - 2) / 2) : body
    const tokenPartsOf = (main: number, sub: number): Part[] => [
      { key: 'main', label: pick(lang, { en: 'main session', 'zh-TW': '主 session' }), value: main, ...COLORS.main },
      { key: 'sub', label: 'subagent', value: sub, ...COLORS.sub },
    ]
    const tokenParts = tokenPartsOf(report.main, report.sub)
    // An opened session's main tokens by model, most first, in alternating shades of purple.
    const modelParts = (byModel: [string, number][]): Part[] =>
      [...byModel]
        .sort((a, b) => b[1] - a[1])
        .map(([model, value], i) => ({ key: `main:${model}`, label: model, value, ...MAIN_SHADES[i % MAIN_SHADES.length]! }))
    const kindPartsOf = (s: Report['spawned']): Part[] => [
      {
        key: 'named',
        label: pick(lang, { en: 'named a model', 'zh-TW': '指定模型' }),
        short: pick(lang, { en: 'named', 'zh-TW': '指定' }),
        tally: pick(lang, { en: ` (Opus: ${s.opus})`, 'zh-TW': `（Opus ${s.opus}）` }),
        value: s.explicit,
        ...COLORS.named,
      },
      { key: 'default', label: pick(lang, { en: 'default model', 'zh-TW': '沿用預設' }), short: pick(lang, { en: 'default', 'zh-TW': '預設' }), value: s.defaults, ...COLORS.default },
      {
        key: 'fork',
        label: 'fork',
        note: pick(lang, { en: " (main session's model)", 'zh-TW': '（用主 session 的模型）' }),
        short: 'fork',
        value: s.forks,
        ...COLORS.fork,
      },
    ]
    const kindParts = kindPartsOf(report.spawned)
    const card = (key: string, title: string, aside: RenderNode, total: string, parts: Part[], legendKey: string) => (
      <Box key={`card:${key}`} flexDirection="column" width={cardWidth} flexShrink={0} {...CARD}>
        <Box flexDirection="row" justifyContent="space-between" gap={1}>
          <Text dimColor>{title}</Text>
          {aside}
        </Box>
        <Text bold>{total}</Text>
        {stack(parts, cardWidth - 4)}
        {parts.map(part => (
          <Box key={`${legendKey}:${part.key}`} flexDirection="row" justifyContent="space-between" gap={1}>
            <Box flexShrink={1}>
              <Text wrap="truncate-end">
                <Text color={part.ink}>●</Text> {part.label}
                {part.tally === undefined && part.note === undefined ? '' : <Text dimColor>{`${part.tally ?? ''}${part.note ?? ''}`}</Text>}
              </Text>
            </Box>
            <Text>{n(part.value)}</Text>
          </Box>
        ))}
      </Box>
    )
    // An opened row's card: its total and `aside`, and only when it has more than one part, the bar and a
    // legend on one line by short labels: `named 22 (Opus: 0)`. A spawns card always splits.
    const compact = (key: string, total: RenderNode, aside: RenderNode, parts: Part[], kinds = false) => {
      const split = kinds || parts.filter(part => part.value > 0).length > 1

      return (
        <Box key={`card:${key}`} flexDirection="column" width={cardWidth} flexShrink={0} {...CARD}>
          <Box flexDirection="row" justifyContent="space-between" gap={1}>
            {total}
            {aside}
          </Box>
          {split ? stack(parts, cardWidth - 4) : null}
          {split ? (
            <Text wrap="wrap">
              {parts.map((part, i) => [
                i === 0 ? '' : '  ',
                <Text color={part.ink}>●</Text>,
                ` ${part.short ?? part.label} ${n(part.value)}`,
                part.tally === undefined ? '' : <Text dimColor>{part.tally}</Text>,
              ])}
            </Text>
          ) : null}
        </Box>
      )
    }
    const stack = (parts: Part[], width: number) => {
      const cells = splitCells(parts.map(part => part.value), width)
      if (Svg !== undefined) {
        return <Svg source={svgStack(parts.map((part, i) => ({ cells: cells[i] ?? 0, fill: part.fill })))} alt={parts.map(part => `${part.label} ${n(part.value)}`).join(', ')} width={width * 8} height={8} />
      }

      return (
        <Text>
          {parts.map((part, i) => ((cells[i] ?? 0) === 0 ? '' : <Text backgroundColor={part.ink}>{' '.repeat(cells[i] ?? 0)}</Text>))}
        </Text>
      )
    }

    if (open !== undefined) {
      const sort: SortBy = shown.sort in SORTS ? (shown.sort as SortBy) : 'tokens'
      const listed = open.detail
        .flatMap(part => part.spawns.map(spawn => ({ spawn, session: part.session })))
        .sort((a, b) => SORTS[sort](b.spawn) - SORTS[sort](a.spawn))
      const limit = Math.max(PAGE, Number(shown.limit) || PAGE)
      const openMain = open.detail.reduce((sum, part) => sum + part.main, 0)
      const openSub = open.tokens - openMain
      const counted = countKinds(listed.map(item => item.spawn))
      const top = Math.max(1, ...listed.map(item => tokens(item.spawn)))
      const rowBar = wide ? 16 : 8
      // A row with no spawns lists its sessions instead, by tokens or by when they started.
      const bySessions = listed.length === 0
      const sessionRows = bySessions ? [...open.detail].sort((a, b) => (sort === 'time' ? b.session.started - a.session.started : b.main - a.main)) : []
      const topMain = Math.max(1, ...sessionRows.map(part => part.main))
      const count = bySessions ? sessionRows.length : listed.length

      return (
        <Box flexDirection="column" {...frame}>
          {title}
          {/* The back button and the crumb keep their width; only the row's name gives way. */}
          <Box flexDirection="row" gap={1}>
            <Box flexShrink={0}>
              <Button key="back" plain hotkey="b" onPress={() => void update($, view, current => ({ ...current, item: '' }))}>
                <Text>{pick(lang, { en: '‹ Back', 'zh-TW': '‹ 返回' })}</Text>
              </Button>
            </Box>
            <Box flexShrink={0}>
              <Text dimColor>{byLabel[by]} ›</Text>
            </Box>
            <Box flexShrink={1} minWidth={0}>
              <Text bold wrap="truncate-end">
                {open.label}
              </Text>
            </Box>
          </Box>
          <Text dimColor>{chosen === '' ? daysLabel(lang, shown.days) : dayName(lang, chosen)}</Text>
          <Box key="cards" flexDirection={paired ? 'row' : 'column'} marginTop={1} gap={paired ? 2 : 0}>
            {compact(
              'tokens',
              <Text>
                <Text bold>{n(open.tokens)}</Text> <Text dimColor>token</Text>
              </Text>,
              openSub === 0 ? null : (
                <Text color={COLORS.sub.ink}>{pick(lang, { en: `by subagents ${share(openSub, open.tokens)}`, 'zh-TW': `subagent 佔 ${share(openSub, open.tokens)}` })}</Text>
              ),
              by === 'session' ? [...modelParts(open.detail.flatMap(part => part.session.mainByModel)), ...tokenPartsOf(openMain, openSub).slice(1)] : tokenPartsOf(openMain, openSub),
            )}
            {counted.all === 0
              ? null
              : compact(
                  'spawns',
                  <Text>
                    <Text bold>{counted.all}</Text> <Text dimColor>{pick(lang, { en: 'spawns', 'zh-TW': '次派出' })}</Text>
                  </Text>,
                  null,
                  kindPartsOf(counted),
                  true,
                )}
          </Box>
          {/* Under a rule: the sort, the column names, then a row per spawn, or for a row with no spawns
              (a model only the main session used, or the main session by type) a row per session. */}
          <Box key="list" flexDirection="column" marginTop={1}>
            {rule('list-rule')}
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
              <Box width={rowBar} flexShrink={0} />
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
                    <Text wrap="truncate-end">{promptOf(part.session)}</Text>
                  </Box>
                  <Box width={rowBar} flexShrink={0}>
                    {cellBar(part.main, topMain, rowBar)}
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
                      <Text wrap="truncate-end">{spawnParts(lang, spawn)[0]}</Text>
                    </Button>
                  </Box>
                  <Box width={rowBar} flexShrink={0}>
                    {cellBar(tokens(spawn), top, rowBar)}
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

    // A chosen day with nothing to count says why in place of the cards: no use, or no record.
    const chosenNote =
      chosen === ''
        ? undefined
        : chosenTokens === null
          ? pick(lang, {
              en: `${dayHead(lang, chosen)}: no data (neither a ledger nor a day row has this day: before the backfill, or its transcript was deleted).`,
              'zh-TW': `${dayHead(lang, chosen)}沒有資料（帳本與每日摘要都沒有這天：回填以前，或 transcript 已被刪掉）。`,
            })
          : chosenTokens === 0
            ? pick(lang, {
                en: `${dayHead(lang, chosen)}: no usage (the day was recorded; the main session and subagents used 0 tokens).`,
                'zh-TW': `${dayHead(lang, chosen)}沒有用量（這天有紀錄，主 session 和 subagent 都是 0 token）。`,
              })
            : undefined

    // The days the period covers, or for a chosen day how to go back. The day steps share the line
    // where it all fits, and go to the next line where it does not (a docked pane): the terminal
    // draws `p: ` before a plain button with a hotkey.
    const periodAside =
      chosen === '' ? range(lang, report) : pick(lang, { en: `1 day · p back to ${daysLabel(lang, shown.days)}`, 'zh-TW': `1 天 · p 回到 ${daysLabel(lang, shown.days)}` })
    const periodWidth = cells(periodLabel) + 3 + cells(`‹ ${chosen === '' ? daysLabel(lang, shown.days) : dayName(lang, chosen)} ›`) + 2 + cells(periodAside)
    const stepsWidth = 3 + cells(pick(lang, { en: '‹ Prev day', 'zh-TW': '‹ 前一天' })) + 2 + 3 + cells(pick(lang, { en: 'Next day ›', 'zh-TW': '後一天 ›' }))
    const headerFits = periodWidth + 2 + stepsWidth <= body

    return (
      <Box flexDirection="column" {...frame}>
        {title}
        {heatmap()}
        {/* The period, then the days it covers, and the day steps at the right; the grouping heads the list below. */}
        <Box key="header" flexDirection={headerFits ? 'row' : 'column'} justifyContent="space-between" columnGap={2}>
          <Box flexDirection="row" gap={2} flexShrink={1} minWidth={0}>
            <Box flexShrink={0}>{periodSwitch}</Box>
            <Box flexShrink={1}>
              <Text dimColor wrap="truncate-end">
                {periodAside}
              </Text>
            </Box>
          </Box>
          {dayButtons}
        </Box>
        {chosenNote !== undefined ? (
          <Box marginTop={1}>{emptyState(parts, chosenNote)}</Box>
        ) : report.sessions.length === 0 && chosenRow === undefined ? (
          <Box marginTop={1}>{emptyState(parts, emptyText(lang))}</Box>
        ) : (
          <Box flexDirection="column">
            <Box key="cards" flexDirection={paired ? 'row' : 'column'} marginTop={1} gap={paired ? 2 : 0}>
              {card(
                'tokens',
                pick(lang, { en: 'Tokens', 'zh-TW': '總 token' }),
                <Text color={COLORS.sub.ink}>{pick(lang, { en: `by subagents ${share(report.sub, all)}`, 'zh-TW': `subagent 佔 ${share(report.sub, all)}` })}</Text>,
                n(all),
                tokenParts,
                'share',
              )}
              {card(
                'spawns',
                pick(lang, { en: 'Spawns', 'zh-TW': '派出' }),
                <Text dimColor>{pick(lang, { en: 'where the model came from', 'zh-TW': '模型怎麼來' })}</Text>,
                pick(lang, { en: String(report.spawned.all), 'zh-TW': `${report.spawned.all} 次` }),
                kindParts,
                'spawned',
              )}
            </Box>
            <Box key="cache-read" flexDirection={cells(cacheText) + 1 + cells(updatedText) <= body ? 'row' : 'column'} justifyContent="space-between" columnGap={1}>
              <Text dimColor wrap="wrap">
                {cacheText}
              </Text>
              <Box flexShrink={0}>
                <Text dimColor>{updatedText}</Text>
              </Box>
            </Box>
            <Box key="list" flexDirection="column" marginTop={1}>
              {rule('list-rule')}
              {chosenRow === undefined ? (
                <Box key="group-line">{groupSwitch}</Box>
              ) : (
                emptyState(
                  parts,
                  pick(lang, {
                    en: `Only the day's summary is kept for ${dayHead(lang, chosen)}: its sessions and spawns were pruned with the ledgers after ${MAX_DAYS} days.`,
                    'zh-TW': `${dayHead(lang, chosen)}只剩每日摘要：各 session 與派出已隨帳本在 ${MAX_DAYS} 天後刪除。`,
                  }),
                )
              )}
            </Box>
            {rows.map(row => {
              // Each row is a card: its name with its spawns at the right, a session's time and repo, then its
              // bar with the tokens and share at the right. The name is cut by cells to leave the count its
              // own fixed width (a Button's text wraps instead of truncating once CJK and Latin mix), with two
              // columns to spare for what the terminal draws around a button.
              const session = by === 'session' ? row.detail[0]?.session : undefined
              const count = spawnCount(row.spawns)
              const label = fit(session === undefined ? row.label : promptOf(session), Math.max(1, rowInner - cells(count) - 3))

              return (
                <Box key={`line-${row.key}`} flexDirection="column" {...CARD}>
                  <Box key={`name:${row.key}`} flexDirection="row" gap={1}>
                    {/* A Button holds only text, so the name is the button and the count sits beside it. */}
                    <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
                      <Button key={`row:${row.key}`} plain onPress={() => void update($, view, current => ({ ...current, item: row.key, sort: 'tokens', limit: PAGE, spawn: '' }))}>
                        <Text wrap="truncate-end">{label}</Text>
                      </Button>
                    </Box>
                    <Box width={cells(count)} flexShrink={0}>
                      <Text dimColor wrap="truncate-end">
                        {count}
                      </Text>
                    </Box>
                  </Box>
                  {session === undefined ? null : (
                    <Box key={`meta:${row.key}`}>
                      <Text dimColor wrap="truncate-end">
                        {fit(`${stamp(lang, session.started)} · ${repoName(lang, session.repo)}`, rowInner)}
                      </Text>
                    </Box>
                  )}
                  <Box key={`bar:${row.key}`} flexDirection="row" gap={1}>
                    <Box flexGrow={1} flexShrink={1}>
                      {bar(row.tokens)}
                    </Box>
                    <Box width={11} flexShrink={0} justifyContent="flex-end">
                      <Text>{n(row.tokens)}</Text>
                    </Box>
                    <Box width={5} flexShrink={0} justifyContent="flex-end">
                      <Text dimColor>{share(row.tokens, all)}</Text>
                    </Box>
                  </Box>
                </Box>
              )
            })}
          </Box>
        )}
        {/* Takes up what the list leaves, so the hint line sits at the foot of a docked pane. The period
            and group buttons already show their keys. */}
        <Box key="spacer" flexGrow={1} />
        {hintLine(
          parts,
          lang,
          report.sessions.length === 0
            ? []
            : [
                { en: 'Tab moves', 'zh-TW': 'Tab 移動' },
                { en: 'Enter opens a row', 'zh-TW': 'Enter 打開一列' },
              ],
        )}
      </Box>
    )
  })
}
