import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { ItemKind, KeptRow, MissStats, OpenItem, OptionRef, Outcome, PaneView, Tombstone } from '../types'
import { configCommand, LANGUAGE, loadConfig, pick, type ConfigIO, type Lang, type Specs } from './config'
import { emptyState, hintLine, switcher, TONE } from './ui'
import {
  KINDS,
  appendLog,
  bandText,
  carriedNote,
  cells,
  clip,
  combine,
  compactNote,
  endsWithQuestion,
  findSimilar,
  historyLines,
  isLogged,
  isStale,
  kindLabel,
  kindShort,
  listLines,
  loadSummary,
  markdownList,
  metaText,
  nextId,
  panelNote,
  parseOptions,
  readLog,
  readStored,
  renumber,
  toStored,
  trimItems,
  unchosen,
  wrapCells,
} from './items'

const items = atom({ plugin: 'open-items', key: 'items' } as const, [])
const options = atom({ plugin: 'open-items', key: 'options' } as const, [])
const loadedFor = atom({ plugin: 'open-items', key: 'loadedFor' } as const, '')
const announce = atom({ plugin: 'open-items', key: 'announce' } as const, false)
const autoDeferred = atom({ plugin: 'open-items', key: 'autoDeferred' } as const, [])
const panelResolved = atom({ plugin: 'open-items', key: 'panelResolved' } as const, [])
const tracked = atom({ plugin: 'open-items', key: 'tracked' } as const, false)
const asked = atom({ plugin: 'open-items', key: 'asked' } as const, '')
const view = atom({ plugin: 'open-items', key: 'view' } as const, 'open' as PaneView)
const focused = atom({ plugin: 'open-items', key: 'focused' } as const, '')
const kept = atom({ plugin: 'open-items', key: 'kept' } as const, [])

const COMMAND = 'open-items'
const SPECS: Specs = { language: LANGUAGE }
const PANE = 'open-items'
const TOOL = 'mcp__open-items__track'
const STATS_KEY = 'stats'
// A reply this short (in characters) to a question is taken as a confirmation, not a miss.
const SHORT_REPLY = 14
const MAX_ITEMS = 200
const MAX_NOTE = 160
const RESOLVED_SHOWN = 5
// The pane's id column: ids are o1…o200, so four cells plus a gap keep the texts aligned.
const ID_COLUMNS = 5
const ROW = 'row:'

const PROMPT_RULES =
  'open-items: when you ask the user to decide something, leave a question open, defer an item, ' +
  'or find an unresolved bug, call mcp__open-items__track with action "add" (kind, short text). ' +
  'When it is resolved, call it with action "resolve" and the id; for a decision add a note of what was ' +
  'chosen and why, and when it will not be done set dropped with the reason as the note. Action "history" ' +
  'looks up earlier decisions and dropped items. Do not mention this bookkeeping.'

function isKind(value: unknown): value is ItemKind {
  return KINDS.includes(value as ItemKind)
}

// Surfaces without the band above the prompt (mobile, the IDE) get a one-line summary instead.
async function showStatus($: EngineInterface, lang: Lang): Promise<void> {
  const surface = await $.session.surface()
  if (surface === 'terminal' || surface === 'desktop') {
    return
  }
  const text = bandText(await read($, items), undefined, lang)
  $.ui.status(text === '' ? undefined : text)
}

// The branch (undefined when detached) and short commit the session is on; both undefined outside git.
async function gitWhere($: EngineInterface): Promise<{ branch?: string; head?: string }> {
  try {
    const [branch, head] = await Promise.all([
      $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 3000 }),
      $.process.run(['git', 'rev-parse', '--short', 'HEAD'], { timeoutMs: 3000 }),
    ])
    const name = branch.exitCode === 0 ? branch.stdout.trim() : ''
    const sha = head.exitCode === 0 ? head.stdout.trim() : ''

    return { branch: name === '' || name === 'HEAD' ? undefined : name, head: sha === '' ? undefined : sha }
  } catch {
    return {}
  }
}

type Added = { id: string; uid: string; similar?: undefined } | { similar: OpenItem; id?: undefined; uid?: undefined }

// A text equal to or containing an open item's (or contained in it) is not added: the open one is answered.
async function addItem($: EngineInterface, lang: Lang, kind: ItemKind, text: string, source: OpenItem['source']): Promise<Added> {
  await ensureLoaded($, lang)
  const similar = findSimilar(await read($, items), text)
  if (similar !== undefined) {
    return { similar }
  }
  const now = await $.clock.now()
  const session = await $.session.id()
  const where = await gitWhere($)
  let id = ''
  const list = await update($, items, current => {
    id = nextId(current)
    const item: OpenItem = { id, uid: `${session}:${id}:${now}`, kind, text: clip(text), source, isDone: false, createdAt: now, ...where }

    return trimItems([...current, item], MAX_ITEMS)
  })
  await writeStored($, list)
  await showStatus($, lang)

  return { id, uid: `${session}:${id}:${now}` }
}

type Resolution = { outcome: Outcome; note: string; fromPanel: boolean }

async function resolveItem($: EngineInterface, lang: Lang, id: string, how: Resolution): Promise<OpenItem | undefined> {
  await ensureLoaded($, lang)
  const now = await $.clock.now()
  const target = (await read($, items)).find(item => item.id === id && !item.isDone)
  if (target === undefined) {
    return undefined
  }
  const resolved: OpenItem = {
    ...target,
    isDone: true,
    doneAt: now,
    outcome: how.outcome,
    ...(how.note === '' ? {} : { note: clip(how.note, MAX_NOTE) }),
  }
  const list = await update($, items, current => current.map(item => (item.uid === target.uid ? resolved : item)))
  await writeStored($, list)
  if (isLogged(resolved)) {
    await writeLog($, resolved, now)
  }
  if (how.fromPanel) {
    await update($, panelResolved, current => [...current.filter(uid => uid !== target.uid), target.uid])
  }
  await showStatus($, lang)

  return resolved
}

// Takes back a resolution: the item opens again under a new uid, since the old one's tombstone
// stays in the store (and in other sessions' lists), and its log entry goes.
async function reopenItem($: EngineInterface, lang: Lang, id: string): Promise<OpenItem | undefined> {
  await ensureLoaded($, lang)
  const now = await $.clock.now()
  const target = (await read($, items)).find(item => item.id === id && item.isDone)
  if (target === undefined) {
    return undefined
  }
  const { doneAt: _doneAt, outcome: _outcome, note: _note, ...rest } = target
  const reopened: OpenItem = { ...rest, uid: `${target.uid}:r${now}`, isDone: false }
  const list = await update($, items, current => current.map(item => (item.uid === target.uid ? reopened : item)))
  await writeStored($, list)
  const logKey = `log:${await repoRoot($)}`
  const log = readLog(await $.store.get(logKey))
  if (log.some(entry => entry.uid === target.uid)) {
    await $.store.set(logKey, log.filter(entry => entry.uid !== target.uid))
  }
  await update($, panelResolved, current => current.filter(uid => uid !== target.uid))
  await showStatus($, lang)

  return target
}

async function openPane($: EngineInterface, lang: Lang): Promise<void> {
  await update($, view, () => 'open' as PaneView)
  await update($, focused, () => '')
  await update($, kept, () => [])
  await $.ui.open({ id: PANE, title: COMMAND, focus: true, closeOnEscape: true })
}

// What the focused-row keys do. In the open list d and x close the row, or reopen it when pressed
// again; in the resolved list d reopens it, and pressing it again puts the resolution back.
async function actOnRow($: EngineInterface, lang: Lang, id: string, action: Outcome): Promise<void> {
  const item = (await read($, items)).find(i => i.id === id)
  if (item === undefined) {
    return
  }
  const rows = await read($, kept)
  const row = rows.find(r => r.id === id)
  const keep = (next: KeptRow): Promise<KeptRow[]> => update($, kept, current => [...current.filter(r => r.id !== id), next])
  if ((await read($, view)) === 'resolved') {
    if (item.isDone) {
      await reopenItem($, lang, id)
      await keep({ id, ...(item.outcome === undefined ? {} : { was: item.outcome }), ...(item.note === undefined ? {} : { note: item.note }) })
    } else {
      await resolveItem($, lang, id, { outcome: row?.was ?? 'done', note: row?.note ?? '', fromPanel: false })
    }

    return
  }
  if (item.isDone) {
    await reopenItem($, lang, id)
    if ((item.outcome ?? 'done') === action) {
      return
    }
  }
  await resolveItem($, lang, id, { outcome: action, note: '', fromPanel: true })
  if (row === undefined) {
    await keep({ id })
  }
}

async function quoteRow($: EngineInterface, lang: Lang, item: OpenItem): Promise<void> {
  await $.prompt.fill({
    text: pick(lang, {
      en: `About ${item.id} (${kindLabel(item.kind, lang)}) "${item.text}": `,
      'zh-TW': `關於 ${item.id}（${kindLabel(item.kind, lang)}）「${item.text}」：`,
    }),
    mode: 'insert',
  })
}

// Per repository: a worktree's repo root is the main working tree's, so every worktree shares it.
async function repoRoot($: EngineInterface): Promise<string> {
  const repo = await $.session.repo()

  return repo?.root ?? (await $.session.root())
}

async function storeKey($: EngineInterface): Promise<string> {
  return `items:${await repoRoot($)}`
}

// The repo's resolution log: decisions and dropped items with their notes, kept without expiry.
async function writeLog($: EngineInterface, item: OpenItem, now: number): Promise<void> {
  const key = `log:${await repoRoot($)}`
  const entry = {
    uid: item.uid,
    kind: item.kind,
    text: item.text,
    outcome: item.outcome ?? 'done',
    note: item.note ?? '',
    at: now,
    ...(item.branch === undefined ? {} : { branch: item.branch }),
  }
  await $.store.set(key, appendLog(readLog(await $.store.get(key)), entry))
}

async function readHistory($: EngineInterface, lang: Lang, query: string): Promise<string> {
  const log = readLog(await $.store.get(`log:${await repoRoot($)}`))

  return historyLines(log, query, await $.clock.now(), lang)
}

// Keys the repo's items were kept under before: the session root, which was a worktree's or a
// subfolder's own path. Read once into the repo's key, then removed.
async function legacyKeys($: EngineInterface, key: string): Promise<string[]> {
  const old = `items:${await $.session.root()}`

  return (await $.store.keys()).filter(k => k !== key && (k === old || k.startsWith(`${key}/`)))
}

// Merges this session's list into the stored one and writes it back, on every change: a session
// that never ends cleanly loses nothing, and two sessions on one repo keep each other's items.
// `removed` are tombstones of items taken out of the list without being resolved (an undo).
async function writeStored($: EngineInterface, local: readonly OpenItem[], removed: Tombstone[] = []): Promise<void> {
  const key = await storeKey($)
  const now = await $.clock.now()
  const mine = toStored(local, now)
  const merged = combine(readStored(await $.store.get(key)), { ...mine, done: [...mine.done, ...removed] }, now, MAX_ITEMS)
  if (merged.items.length === 0 && merged.done.length === 0) {
    await $.store.delete(key)
  } else {
    await $.store.set(key, merged)
  }
  // Items another session resolved meanwhile are resolved here too.
  const gone = new Set(merged.done.map(t => t.uid))
  if (local.some(item => !item.isDone && gone.has(item.uid))) {
    await update($, items, current =>
      current.map(item => (!item.isDone && gone.has(item.uid) ? { ...item, isDone: true, doneAt: now } : item)),
    )
  }
}

// Brings the repo's stored open items into this session once. `/clear` starts a new session id
// without a `session.start`, so every path that reads or writes the list calls this first.
async function ensureLoaded($: EngineInterface, lang: Lang): Promise<void> {
  const session = await $.session.id()
  if ((await read($, loadedFor)) === session) {
    return
  }
  await update($, loadedFor, () => session)
  const key = await storeKey($)
  let stored = readStored(await $.store.get(key))
  const legacy = await legacyKeys($, key)
  if (legacy.length > 0) {
    const now = await $.clock.now()
    for (const old of legacy) {
      stored = combine(stored, readStored(await $.store.get(old)), now, MAX_ITEMS)
    }
    await $.store.set(key, stored)
    for (const old of legacy) {
      await $.store.delete(old)
    }
  }
  const current = await read($, items)
  const have = new Set(current.flatMap(item => [item.uid, `${item.kind}:${item.text}`]))
  const open = stored.items.filter(item => !have.has(item.uid) && !have.has(`${item.kind}:${item.text}`))
  if (open.length === 0) {
    return
  }
  // Stored ids come first; items added before the load get fresh ids after them.
  await update($, items, () => trimItems(renumber(open, current), MAX_ITEMS))
  await update($, announce, () => true)
  await showStatus($, lang)
  const summary = loadSummary(open, (await gitWhere($)).branch, await $.clock.now(), lang)
  $.ui.toast(
    pick(lang, {
      en: `open-items: ${open.length} open item(s) left from last time${summary}`,
      'zh-TW': `open-items：上次留下 ${open.length} 個待處理項目${summary}`,
    }),
  )
}

async function saveStored($: EngineInterface, lang: Lang): Promise<void> {
  await ensureLoaded($, lang)
  await writeStored($, await read($, items))
}

// Takes back the items the latest prompt deferred on its own: out of the list and out of the store.
async function undoDeferred($: EngineInterface, lang: Lang): Promise<number> {
  const uids = new Set(await read($, autoDeferred))
  if (uids.size === 0) {
    return 0
  }
  const now = await $.clock.now()
  await update($, autoDeferred, () => [])
  const list = await update($, items, current => current.filter(item => !uids.has(item.uid)))
  await writeStored($, list, [...uids].map(uid => ({ uid, doneAt: now })))
  await showStatus($, lang)

  return uids.size
}

// The options the prompt left out of the remembered list become deferred items; what the previous
// prompt deferred can be undone only until this one.
async function deferUnchosen($: EngineInterface, lang: Lang, text: string, remembered: readonly OptionRef[]): Promise<void> {
  await update($, autoDeferred, () => [])
  if (remembered.length === 0) {
    return
  }
  const deferred: { label: string; text: string; uid: string }[] = []
  for (const option of unchosen(text, remembered)) {
    if (option.text === '') {
      continue
    }
    const added = await addItem($, lang, 'deferred', option.text, 'auto')
    if (added.uid !== undefined) {
      deferred.push({ label: option.label, text: clip(option.text), uid: added.uid })
    }
  }
  if (deferred.length > 0) {
    await update($, autoDeferred, () => deferred.map(d => d.uid))
    const what = deferred.map(d => `${d.label}${pick(lang, { en: ': ', 'zh-TW': '：' })}${d.text}`).join(pick(lang, { en: ', ', 'zh-TW': '、' }))
    $.ui.toast(
      pick(lang, {
        en: `open-items: deferred ${what}. Press [Undo] or type /open-items undo to cancel`,
        'zh-TW': `open-items：已延後 ${what}。按 [復原] 或 /open-items undo 取消`,
      }),
      { timeoutMs: 8000 },
    )
  }
  await update($, options, () => [])
}

async function copyList($: EngineInterface, lang: Lang, surface?: RenderSurface): Promise<string> {
  await ensureLoaded($, lang)
  const text = markdownList(await read($, items), lang)
  if (text === '') {
    return pick(lang, { en: 'No open items.', 'zh-TW': '目前沒有待處理項目。' })
  }
  const copied = await $.ui.copy(surface === undefined ? { text } : { text, surface })

  return copied.isCopied
    ? pick(lang, { en: 'Copied the open items as markdown.', 'zh-TW': '已把待處理項目複製成 markdown。' })
    : pick(lang, { en: `Cannot copy (${copied.reason}); here it is:\n\n${text}`, 'zh-TW': `無法複製（${copied.reason}），內容如下：\n\n${text}` })
}

// Counts kept before the next prompt decided misses ({ questions, missed }) are dropped: their
// misses included every confirmation the person answered with a word.
async function readStats($: EngineInterface): Promise<MissStats> {
  const stats = (await $.store.get(STATS_KEY)) as Partial<MissStats> | undefined

  return stats?.untracked === undefined ? { questions: 0, untracked: 0, missed: 0 } : (stats as MissStats)
}

async function statsText($: EngineInterface, lang: Lang): Promise<string> {
  const stats = await readStats($)
  if (stats.questions === 0) {
    return pick(lang, { en: 'No answers ending in a question yet.', 'zh-TW': '還沒有以問句結尾的回答。' })
  }
  const rate = Math.round((stats.missed / stats.questions) * 100)

  return pick(lang, {
    en:
      `${stats.questions} answer(s) ended with a question; ${stats.untracked} made no track call, ` +
      `and ${stats.missed} of those got a reply longer than ${SHORT_REPLY} characters (${rate}%). ` +
      'Short replies and prompts not typed by you are not counted. Each miss is recorded in the debug log (open-items: missed).',
    'zh-TW':
      `以問句結尾的回答 ${stats.questions} 次，其中 ${stats.untracked} 次沒有呼叫 track，` +
      `這些當中你回覆超過 ${SHORT_REPLY} 字的有 ${stats.missed} 次（${rate}%）。` +
      '短答和不是你輸入的訊息不計入。逐筆紀錄在 debug log（open-items: missed）。',
  })
}

// An answer that ends on a question without any `track` call this turn may have left something
// untracked; the next prompt decides (see `judgeMiss`).
async function measureMiss($: EngineInterface, answer: string): Promise<void> {
  const didTrack = await read($, tracked)
  await update($, tracked, () => false)
  const isQuestion = endsWithQuestion(answer)
  const last = answer.split('\n').filter(line => line.trim() !== '').slice(-1)[0] ?? ''
  await update($, asked, () => (isQuestion && !didTrack ? last : ''))
  if (!isQuestion) {
    return
  }
  const stats = await readStats($)
  await $.store.set(STATS_KEY, { ...stats, questions: stats.questions + 1, untracked: stats.untracked + (didTrack ? 0 : 1) })
}

// A question answered with a word ("ok", "commit") was a confirmation, done once answered; only a
// longer reply typed by the person counts as a miss.
async function judgeMiss($: EngineInterface, question: string, reply: string | undefined): Promise<void> {
  await update($, asked, () => '')
  if (reply === undefined || [...reply.trim()].length <= SHORT_REPLY) {
    return
  }
  const stats = await readStats($)
  await $.store.set(STATS_KEY, { ...stats, missed: stats.missed + 1 })
  $.ui.log(`open-items: missed: answer ended with a question and no track call: ${clip(question, 120)}`, { to: 'debug' })
}

const USAGE = {
  en: 'Usage: /open-items (opens the panel), copy, undo, log [keyword], stats, status',
  'zh-TW': '用法：/open-items（開啟面板）、copy、undo、log [關鍵字]、stats、status',
} as const

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

export const register: Register = (on, pluginOptions) => {
  // Re-read at session start and after `/open-items set`.
  let lang: Lang = 'en'

  on('session.start', async ($, e, next) => {
    try {
      lang = (await loadConfig(configIO($), COMMAND, SPECS, pluginOptions)).lang
    } catch (error) {
      $.ui.log(`session.start: settings not read: ${String(error)}`, { to: 'debug' })
    }
    await $.tool.register({
      name: 'track',
      description:
        'Track an open item. add: kind+text, returns id (or the similar open item, not added); ' +
        'for deferred, the text names when to come back to it. ' +
        'resolve: id, optional note (a decision: what was chosen and why), dropped=true when it will not be done (note: why). ' +
        'list: the open items with their ids. history: earlier decisions and dropped items, optional query.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'resolve', 'list', 'history'] },
          kind: { type: 'string', enum: ['decision', 'question', 'deferred', 'bug'] },
          text: { type: 'string', maxLength: 80 },
          id: { type: 'string' },
          note: { type: 'string', maxLength: MAX_NOTE },
          dropped: { type: 'boolean' },
          query: { type: 'string' },
        },
        required: ['action'],
      },
    })
    try {
      await $.command.register({
        name: COMMAND,
        description: pick(lang, { en: 'List the unresolved questions, pending decisions and deferred items', 'zh-TW': '列出尚未解決的問題、待決定與延後事項' }),
        argumentHint: pick(lang, { en: '[copy | undo | log [keyword] | stats | status]', 'zh-TW': '[copy | undo | log [關鍵字] | stats | status]' }),
      })
    } catch (error) {
      $.ui.log(`session.start: /${COMMAND} not registered: ${String(error)}`, { to: 'debug' })
      $.ui.toast(pick(lang, { en: `${COMMAND}: /${COMMAND} was not registered (${String(error)})`, 'zh-TW': `${COMMAND}：/${COMMAND} 指令沒有註冊成功（${String(error)}）` }))
    }
    await ensureLoaded($, lang)

    return next(e)
  }).catch(($, e, next) => next(e))

  // A `/clear` fires no `session.start`; its classic SessionStart loads the repo's items at once,
  // so the band and the pane show them before the first prompt.
  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'clear') {
      await ensureLoaded($, lang)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    await saveStored($, lang)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: COMMAND }, async ($, e) => {
    await ensureLoaded($, lang)
    const [sub = '', ...rest] = e.args.trim().split(/\s+/)
    if (sub === '') {
      await openPane($, lang)

      return { text: pick(lang, { en: 'Opened the open items list.', 'zh-TW': '已開啟待處理項目清單。' }) }
    }
    if (sub === 'copy') {
      return { text: await copyList($, lang) }
    }
    if (sub === 'undo') {
      const n = await undoDeferred($, lang)

      return {
        text:
          n === 0
            ? pick(lang, { en: 'No automatic deferrals to undo.', 'zh-TW': '沒有可以復原的自動延後項目。' })
            : pick(lang, { en: `Undid ${n} automatic deferral(s).`, 'zh-TW': `已復原 ${n} 個自動延後的項目。` }),
      }
    }
    if (sub === 'log') {
      return { text: await readHistory($, lang, rest.join(' ')) }
    }
    if (sub === 'stats') {
      return { text: await statsText($, lang) }
    }
    const text = await configCommand(configIO($), COMMAND, SPECS, pluginOptions, e.args, resolved => {
      lang = resolved.lang
    })

    return { text: text ?? pick(lang, USAGE) }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    return { ...composed, sections: [...composed.sections, { id: 'open-items:rules', text: PROMPT_RULES, scope: 'session' }] }
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const input = e as unknown as {
      action?: unknown
      kind?: unknown
      text?: unknown
      id?: unknown
      note?: unknown
      dropped?: unknown
      query?: unknown
      agentId?: unknown
    }
    if (input.agentId === undefined) {
      await update($, tracked, () => true)
    }
    if (input.action === 'add') {
      const text = typeof input.text === 'string' ? input.text.trim() : ''
      if (text === '') {
        return { deny: 'track add needs text.' }
      }
      const added = await addItem($, lang, isKind(input.kind) ? input.kind : 'question', text, 'model')
      if (added.similar !== undefined) {
        return { result: `not added: similar to open item ${added.similar.id} ("${added.similar.text}"). Use ${added.similar.id}.` }
      }

      return { result: `added ${added.id}` }
    }
    if (input.action === 'resolve' && typeof input.id === 'string') {
      const id = input.id.replace(/^#/, '')
      const note = typeof input.note === 'string' ? input.note.trim() : ''
      const outcome: Outcome = input.dropped === true ? 'dropped' : 'done'
      if (await resolveItem($, lang, id, { outcome, note, fromPanel: false })) {
        return { result: outcome === 'dropped' ? `dropped ${id}` : `resolved ${id}` }
      }

      return { deny: `no open item ${id}. Open items:\n${listLines(await read($, items))}` }
    }
    if (input.action === 'list') {
      await ensureLoaded($, lang)

      return { result: listLines(await read($, items)) }
    }
    if (input.action === 'history') {
      await ensureLoaded($, lang)

      return { result: await readHistory($, 'en', typeof input.query === 'string' ? input.query : '') }
    }

    return { deny: 'track needs action add, resolve (with id), list or history.' }
  }).catch(($, e, next) => next(e))

  // Remember the latest option list of the main loop's answer. An answer without one (e.g. to a
  // background-task notification) keeps it; the next prompt from the person clears it.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && e.reason === 'answer') {
      const found = parseOptions(e.answer)
      if (found.length > 0) {
        await update($, options, () => found)
      }
      await measureMiss($, e.answer)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // A short prompt that picks some of those options defers the rest. The prompt is never altered.
  // State is only read before `next` and changed once the prompt went in: a plugin beneath may
  // drop it (secret-scrub when its check fails), and the next prompt must find everything as it was.
  on('prompt.submit', async ($, e, next) => {
    await ensureLoaded($, lang)
    const context: string[] = []
    const isPerson = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    const remembered = isPerson ? await read($, options) : []
    const question = await read($, asked)
    // Items the person closed in the pane are told beside the prompt, so the model stops raising them.
    const closed = isPerson ? await read($, panelResolved) : []
    if (closed.length > 0) {
      const uids = new Set(closed)
      const list = (await read($, items)).filter(item => uids.has(item.uid))
      if (list.length > 0) {
        context.push(panelNote(list))
      }
    }
    // Items brought in from the store reach the model with the first prompt after the load,
    // beside the prompt rather than in the system prompt, which would break the prompt cache.
    const isAnnounced = await read($, announce)
    if (isAnnounced) {
      const list = await read($, items)
      if (list.some(item => !item.isDone)) {
        context.push(carriedNote(list))
      }
    }

    const submitted = await (context.length === 0 ? next(e) : next({ ...e, context: [...(e.context ?? []), ...context] }))
    if (submitted.drop !== undefined) {
      return submitted
    }
    // Nothing may throw past `next`: the prompt went in, and the catch would only replay it.
    try {
      if (isAnnounced) {
        await update($, announce, () => false)
      }
      if (closed.length > 0) {
        const told = new Set(closed)
        await update($, panelResolved, list => list.filter(uid => !told.has(uid)))
      }
      if (isPerson) {
        await deferUnchosen($, lang, e.text, remembered)
      }
      if (question !== '') {
        await judgeMiss($, question, isPerson ? e.text : undefined)
      }
    } catch (error) {
      $.ui.log(`open-items: prompt.submit after next: ${String(error)}`, { to: 'debug' })
    }

    return submitted
  }).catch(($, e, next) => next(e))

  // Carry the open list through a compaction as one more message after the summary.
  on('session.compact', async ($, e, next) => {
    // Defensive: the engine always hands a list; a bare dispatch (tests) may not.
    const ran = await next(Array.isArray(e.messages) ? e : { ...e, messages: [] })
    const list = await read($, items)
    if (ran.skip !== undefined || e.trigger === 'precompute' || !list.some(item => !item.isDone)) {
      return ran
    }

    return { ...ran, messages: [...ran.messages, { role: 'user' as const, text: compactNote(list), toolUses: [] }] }
  }).catch(($, e, next) => next(e))

  // The band is one instance shared by every plugin: draw above what the plugins beneath drew,
  // never in place of it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const text = bandText(await read($, items), ' ', lang)
    if (e.props.hasSurvey || text === '') {
      return next(e)
    }
    const below = await next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const canUndo = (await read($, autoDeferred)).length > 0

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color={TONE.attention} wrap="truncate-end">{text}</Text>
          <Button key="open" label={pick(lang, { en: 'Open', 'zh-TW': '開啟' })} hotkey="o" onPress={() => void openPane($, lang)} />
          {canUndo && <Button key="undo" label={pick(lang, { en: 'Undo deferral', 'zh-TW': '復原延後' })} hotkey="u" onPress={() => void undoDeferred($, lang)} />}
        </Box>
        {below}
      </Box>
    )
  })

  // The ring's last stop on a row is the row the keys act on; another button keeps it, so Tab onto
  // the actions still acts on that row, while the engine's own stops (the close mark) clear it.
  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    if (e.element === undefined || e.element.startsWith(ROW)) {
      await update($, focused, () => e.element ?? '')
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // One line per item in fixed columns: the id (the row's only button, so Tab and ↑↓ step through
  // the rows), the kind, the text cut at the edge. The focused row opens to its whole text, wrapped
  // here so each line can carry the kind's side line, then its age and branch.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const parts = $.ui.resolve(e)
    const { Box, Button, Text } = parts
    const list = await read($, items)
    const now = await $.clock.now()
    const which = await read($, view)
    const at = await read($, focused)
    const keptIds = new Set((await read($, kept)).map(row => row.id))
    const hasOpen = list.some(item => !item.isDone)
    const rows =
      which === 'open'
        ? list.filter(item => !item.isDone || keptIds.has(item.id))
        : list.filter(item => item.isDone || keptIds.has(item.id)).slice(-RESOLVED_SHOWN)
    const target = rows.find(item => `${ROW}${item.id}` === at)
    const kindColumns = Math.max(...KINDS.map(kind => cells(kindShort(kind, lang)))) + 1
    const textColumns = Math.max(10, e.props.bodyColumns - ID_COLUMNS - kindColumns)
    const word = (en: string, zh: string): string => pick(lang, { en, 'zh-TW': zh })
    const status = (item: OpenItem): string => {
      if (which === 'resolved') {
        return item.isDone ? (item.outcome === 'dropped' ? word("Won't do", '不做') : word('Done', '完成')) : word('Reopened', '重新打開')
      }

      return item.isDone ? (item.outcome === 'dropped' ? word("Won't do", '不做') : word('Done', '完成')) : ''
    }
    const ink = (item: OpenItem, isDim: boolean) => {
      if (isDim || item.kind === 'deferred') {
        return { dimColor: true }
      }

      return { color: item.kind === 'decision' ? TONE.attention : item.kind === 'bug' ? TONE.danger : 'cyan' }
    }

    const row = (item: OpenItem, index: number) => {
      // Closed in the open list: struck through. The resolved list is dim except a reopened row.
      const isStruck = which === 'open' && item.isDone
      const isDim = isStruck || (which === 'resolved' && item.isDone) || isStale(item, now)
      const label = status(item)
      const text = label === '' ? item.text : `${label} ${item.text}`
      const kindInk = ink(item, isDim)
      const textStyle = { dimColor: isDim, strikethrough: isStruck }
      const isAt = item === target
      const lines = isAt ? wrapCells(text, textColumns) : [text]
      const extra = isAt
        ? [
            ...lines.slice(1).map(line => ({ line, isMeta: false })),
            ...(item.note === undefined ? [] : wrapCells(item.note, textColumns).map(line => ({ line, isMeta: true }))),
            { line: metaText(item, now, lang), isMeta: true },
          ]
        : []

      return (
        <Box key={`line:${item.id}`} flexDirection="column" marginTop={index === 0 ? 0 : 1}>
          <Box flexDirection="row">
            <Box width={ID_COLUMNS} flexShrink={0}>
              <Button key={`${ROW}${item.id}`} label={item.id} plain onPress={() => undefined} />
            </Box>
            <Box width={kindColumns} flexShrink={0}>
              <Text {...kindInk}>{kindShort(item.kind, lang)}</Text>
            </Box>
            <Box flexGrow={1} flexShrink={1}>
              {isAt ? (
                <Text {...textStyle}>{lines[0]}</Text>
              ) : (
                <Text wrap="truncate-end" {...textStyle}>
                  {text}
                </Text>
              )}
            </Box>
          </Box>
          {extra.map(({ line, isMeta }, i) => (
            <Box key={`more:${item.id}:${i}`} flexDirection="row" paddingLeft={ID_COLUMNS}>
              <Box width={kindColumns} flexShrink={0}>
                <Text {...kindInk}>│</Text>
              </Box>
              <Text {...(isMeta ? { dimColor: true } : textStyle)}>{line}</Text>
            </Box>
          ))}
        </Box>
      )
    }

    // A plain Button with a hotkey draws its key itself: `d: Done`.
    const action = (key: string, hotkey: string, label: string, onPress: () => void) => (
      <Button key={key} label={label} plain hotkey={hotkey} onPress={onPress} />
    )
    const onTarget = (fn: (item: OpenItem) => Promise<unknown>) => () => {
      if (target !== undefined) {
        void fn(target)
      }
    }
    const quote = action('quote', 'q', word('Quote', '引用'), onTarget(item => quoteRow($, lang, item)))

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" marginBottom={1}>
          <Box flexDirection="row" flexShrink={0}>
            {switcher(
              parts,
              e.surface,
              'view',
              '',
              'v',
              [
                { value: 'open', label: word('Open', '未完成') },
                { value: 'resolved', label: word('Recently resolved', '最近完成') },
              ],
              which,
              value =>
                void update($, view, () => value as PaneView)
                  .then(() => update($, kept, () => []))
                  .then(() => update($, focused, () => '')),
            )}
          </Box>
          {which === 'open' &&
            hasOpen &&
            action('copy', 'c', word('Copy whole list', '複製整份清單'), () =>
              void copyList($, lang, e.surface).then(text => $.ui.toast(`open-items${word(': ', '：')}${text.split('\n')[0]}`)),
            )}
        </Box>
        {rows.length === 0 &&
          emptyState(parts, which === 'open' ? word('No open items.', '目前沒有待處理項目。') : word('Nothing resolved yet.', '還沒有完成的項目。'))}
        {rows.map(row)}
        {rows.length > 0 && (
          <Box flexDirection="row" gap={2} marginTop={1}>
            {which === 'open'
              ? [
                  action('done', 'd', word('Done', '完成'), onTarget(item => actOnRow($, lang, item.id, 'done'))),
                  action('drop', 'x', word("Won't do", '不做'), onTarget(item => actOnRow($, lang, item.id, 'dropped'))),
                  quote,
                ]
              : [action('reopen', 'd', word('Reopen', '重新打開'), onTarget(item => actOnRow($, lang, item.id, 'done'))), quote]}
          </Box>
        )}
        {hintLine(parts, lang, rows.length === 0 ? [] : [{ en: 'Tab/↑↓ moves', 'zh-TW': 'Tab/↑↓ 移動' }])}
      </Box>
    )
  })
}
