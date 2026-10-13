import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { OpenItem } from '../types'
import {
  ageText,
  bandText,
  combine,
  endsWithQuestion,
  findSimilar,
  loadSummary,
  markdownList,
  parseChoice,
  parseOptions,
  readLog,
  readStored,
  cells,
  wrapCells,
  trimItems,
  unchosen,
} from './items'

const TRACK = 'mcp__open-items__track'
const ABC = `兩個方案：
**A.** 加快取
**B.** 重構模組
**C.** 補文件
你想怎麼做？`

describe('parseOptions', () => {
  test('reads bold, parenthesised and numbered lists', () => {
    expect(parseOptions(ABC).map(o => o.label)).toEqual(['A', 'B', 'C'])
    expect(parseOptions('- (a) 一\n- (b) 二').map(o => o.label)).toEqual(['A', 'B'])
    expect(parseOptions('A. 甲\nB. 乙').map(o => o.text)).toEqual(['甲', '乙'])
    expect(parseOptions('1. 先做\n2. 再做\n3. 收尾').map(o => o.label)).toEqual(['1', '2', '3'])
  })

  test('reads labels followed by a colon', () => {
    expect(parseOptions('   - A：補安裝指令\n   - B：註明載入時機\n   - C：保留換行').map(o => o.text)).toEqual([
      '補安裝指令',
      '註明載入時機',
      '保留換行',
    ])
    expect(parseOptions('A: x\nB: y').map(o => o.label)).toEqual(['A', 'B'])
  })

  test('keeps the latest list and ignores prose', () => {
    expect(parseOptions('A. x\nB. y\n\n之後：\n1. 一\n2. 二').map(o => o.label)).toEqual(['1', '2'])
    expect(parseOptions('沒有選項，只是說明。')).toEqual([])
    expect(parseOptions('A. 只有一個')).toEqual([])
  })

  test('skips a list the answer does not close on', () => {
    const steps = '做了這些：\n1. 讀檔\n2. 改寫\n3. 測試\n\n測試全部通過。\n另外更新了 README。\n型別檢查也沒問題。'
    expect(parseOptions(steps)).toEqual([])
    expect(parseOptions(`${steps}\n\nA. 現在 commit\nB. 先不要`).map(o => o.label)).toEqual(['A', 'B'])
  })

  test('takes a list followed by a question, and indented lines as part of the last option', () => {
    const asked = 'A. 加快取\nB. 重構\n要選哪個？\n選好後我再開始。\n大概要十分鐘。'
    expect(parseOptions(asked).map(o => o.label)).toEqual(['A', 'B'])
    const detailed = 'A. 加快取\nB. 重構\n   會動到三個檔案\n   需要補測試\n\n你想怎麼做？'
    expect(parseOptions(detailed).map(o => o.label)).toEqual(['A', 'B'])
  })
})

test('endsWithQuestion looks at the last two lines', () => {
  expect(endsWithQuestion('改好了。\n要 commit 嗎？')).toBe(true)
  expect(endsWithQuestion('要 commit 嗎？\n\n➡️ 開新 session')).toBe(true)
  expect(endsWithQuestion('**要 commit 嗎?**')).toBe(true)
  expect(endsWithQuestion('要 commit 嗎？\n第二行\n第三行')).toBe(false)
  expect(endsWithQuestion('改好了。')).toBe(false)
})

describe('parseChoice / unchosen', () => {
  const opts = parseOptions(ABC)
  const left = (prompt: string): string[] => unchosen(prompt, opts).map(o => o.label)

  test('defers the options that were not picked', () => {
    expect(left('A＋B')).toEqual(['C'])
    expect(left('做 A+B。C 先寫成觀察項')).toEqual(['C'])
    expect(left('選 (b)')).toEqual(['A', 'C'])
    expect(left('A')).toEqual(['B', 'C'])
  })

  test('"all" picks everything', () => {
    expect(parseChoice('全部', opts)?.isAll).toBe(true)
    expect(left('全部')).toEqual([])
    expect(left('A B C 都做')).toEqual([])
  })

  test('does nothing for unrelated, long or unlabelled prompts', () => {
    expect(left('好，繼續')).toEqual([])
    expect(left('please do a thing for me')).toEqual([])
    expect(left('A'.repeat(1) + ' 這個很好，' + '但我想先看看整體的設計與影響範圍，再決定要怎麼走，'.repeat(8))).toEqual([])
    expect(left('D')).toEqual([])
  })
})

test('bandText counts by group', () => {
  const base = { uid: 'u', source: 'model', isDone: false, createdAt: 0, text: 't' } as const
  expect(bandText([])).toBe('')
  expect(
    bandText([
      { ...base, id: 'o1', kind: 'decision' },
      { ...base, id: 'o2', kind: 'decision' },
      { ...base, id: 'o3', kind: 'question' },
      { ...base, id: 'o4', kind: 'deferred' },
      { ...base, id: 'o5', kind: 'deferred', isDone: true },
    ]),
  ).toBe('2 to decide · 1 unresolved · 1 deferred  /open-items')
})

test('bandText counts by group in zh-TW', () => {
  const base = { uid: 'u', source: 'model', isDone: false, createdAt: 0, text: 't' } as const
  expect(bandText([{ ...base, id: 'o1', kind: 'decision' }, { ...base, id: 'o4', kind: 'deferred' }], undefined, 'zh-TW')).toBe('1 待你決定 · 1 延後  /open-items')
})

function item(id: string, extra: Partial<OpenItem> = {}): OpenItem {
  return { id, uid: `u-${id}`, kind: 'deferred', text: `t-${id}`, source: 'model', isDone: false, createdAt: 1, ...extra }
}

test('findSimilar matches equal or contained texts among open items', () => {
  const list = [item('o1', { text: '補 README 的安裝說明' }), item('o2', { text: '加快取', isDone: true }), item('o3', { text: 'bug' })]
  expect(findSimilar(list, '補 readme 的安裝說明。')?.id).toBe('o1')
  expect(findSimilar(list, 'README 的安裝說明')?.id).toBe('o1')
  expect(findSimilar(list, '加快取')).toBeUndefined()
  expect(findSimilar(list, '登入 bug 偶爾出現')).toBeUndefined()
  expect(findSimilar(list, 'BUG')?.id).toBe('o3')
})

test('ages, the load summary and the markdown list', () => {
  const day = 86_400_000
  expect(ageText(30_000, 'zh-TW')).toBe('剛剛')
  expect(ageText(5 * 60_000, 'zh-TW')).toBe('5 分鐘前')
  expect(ageText(3 * day, 'zh-TW')).toBe('3 天前')
  expect(ageText(30_000)).toBe('just now')
  expect(ageText(5 * 60_000)).toBe('5 min ago')
  expect(ageText(3 * day)).toBe('3 d ago')
  const list = [item('o1', { branch: 'feat/x', createdAt: 0 }), item('o2', { branch: 'master', createdAt: 9 * day }), item('o3')]
  expect(loadSummary(list, 'master', 10 * day, 'zh-TW')).toBe('（1 個在其他 branch、2 個超過 7 天）')
  expect(loadSummary(list, 'master', 10 * day)).toBe(' (1 on other branches, 2 older than 7 days)')
  expect(loadSummary([item('o2', { createdAt: 9 * day })], undefined, 10 * day, 'zh-TW')).toBe('')
  const marked = [item('o1', { kind: 'decision', text: '要不要加快取', branch: 'feat/x' }), item('o2', { text: '補文件' })]
  expect(markdownList(marked, 'zh-TW')).toBe('## 待處理項目\n\n### 待你決定\n\n- o1：要不要加快取（feat/x）\n\n### 延後\n\n- o2：補文件\n')
  expect(markdownList(marked)).toBe('## Open items\n\n### To decide\n\n- o1: 要不要加快取 (feat/x)\n\n### Deferred\n\n- o2: 補文件\n')
})

test('wrapCells counts wide characters as two cells and keeps Latin words whole', () => {
  expect(cells('待決定 ab')).toBe(9)
  expect(wrapCells('一二三四五六', 5)).toEqual(['一二', '三四', '五六'])
  expect(wrapCells('fix the pane width', 9)).toEqual(['fix the', 'pane', 'width'])
  expect(wrapCells('改 pane 寬度', 6)).toEqual(['改', 'pane', '寬度'])
  expect(wrapCells('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij'])
  expect(wrapCells('', 4)).toEqual([''])
})

test('trimItems drops the oldest resolved items before any open one', () => {
  const list = [item('o1'), item('o2', { isDone: true }), item('o3'), item('o4', { isDone: true }), item('o5')]
  expect(trimItems(list, 4).map(i => i.id)).toEqual(['o1', 'o3', 'o4', 'o5'])
  expect(trimItems(list, 2).map(i => i.id)).toEqual(['o3', 'o5'])
  expect(trimItems(list, 9)).toHaveLength(5)
})

test('combine keeps both sides and lets a tombstone win', () => {
  const now = 1000
  const merged = combine(
    { items: [item('o1'), item('o2')], done: [] },
    { items: [item('o3')], done: [{ uid: 'u-o1', doneAt: 900 }] },
    now,
    200,
  )
  expect(merged.items.map(i => i.id)).toEqual(['o2', 'o3'])
  expect(merged.done).toEqual([{ uid: 'u-o1', doneAt: 900 }])
  expect(combine(merged, { items: [], done: [] }, now + 31 * 24 * 3600 * 1000, 200).done).toEqual([])
})

test('readStored reads the older bare array and gives its items a uid', () => {
  const legacy = readStored([{ id: 'o1', kind: 'bug', text: 'x', source: 'model', isDone: false, createdAt: 5 }])
  expect(legacy.items[0]?.uid).toBe('legacy:5:bug:x')
  expect(readStored(undefined)).toEqual({ items: [], done: [] })
})

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } } as const

// The engine beneath: ops the plugin calls answer here. Returns the plugin's store.
// Ids of the panes the plugin asked to open.
let opened: string[] = []
// What the plugin passed to each ui.open.
let openedWith: Record<string, unknown>[] = []
// Set to make command.register refuse the name.
let refuseCommand: string | undefined
// Texts the plugin put into the prompt box.
let filled: string[] = []
// Toasts, clipboard writes and debug lines.
let toasts: string[] = []
let copied: string[] = []
let logged: string[] = []

type Where = { root?: string; repoRoot?: string | null; branch?: string; now?: number }

// The suite asserts the zh-TW wording, so the user settings file says zh-TW unless a test gives another.
const ZH = '{"*":{"language":"zh-TW"}}'

function engine(on: On, stored: Record<string, unknown> = {}, where: Where = {}, userFile = ZH): Map<string, unknown> {
  opened = []
  openedWith = []
  refuseCommand = undefined
  filled = []
  toasts = []
  copied = []
  logged = []
  const store = new Map(Object.entries(stored))
  const root = where.root ?? '/repo'
  const repoRoot = where.repoRoot === undefined ? '/repo' : where.repoRoot
  mock.clock(on, where.now === undefined ? undefined : { now: where.now })
  mock.env(on, {})
  on('fs.read', ($, e) => {
    if (e.path === '/.claude/cc-mod-trimtab.json') {
      return { value: userFile }
    }
    throw new Error('ENOENT')
  })
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => (store.set(e.key, e.value), { value: undefined }))
  on('store.delete', ($, e) => (store.delete(e.key), { value: undefined }))
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('session.id', () => ({ value: 's1' }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => {
    if (refuseCommand !== undefined) {
      throw new Error(refuseCommand)
    }

    return { value: { command: e.name } }
  })
  on('tool.register', () => ({ value: { tool: TRACK } }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('session.root', () => ({ value: root }))
  on('session.repo', () => ({
    value: repoRoot === null ? null : { root: repoRoot, remote: null, internal: false, name: null },
  }))
  on('prompt.fill', ($, e) => (filled.push(e.text), { isFilled: true }) as never)
  on('session.surface', () => ({ value: 'terminal' }))
  // Another plugin's band beneath: it must stay visible under the items.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>band beneath</Text>
  })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)

    return <Box />
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.messages', () => ({ value: [] }))
  on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }))
  on('ui.copy', ($, e) => (copied.push(e.text), { value: { isCopied: true } }) as never)
  on('ui.log', ($, e) => (logged.push(e.text), { value: undefined }))
  on('process.run', ($, e) => ({
    value: { exitCode: 0, stdout: e.argv.includes('--short') ? 'abc1234\n' : `${where.branch ?? 'main'}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.focus', () => ({}))
  on('ui.open', ($, e) => (opened.push(e.id), openedWith.push(e as never), { value: { isPlaced: true } }) as never)

  return store
}

async function started($: Engine): Promise<void> {
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
}

test('track add and resolve go through the tool call and show in the band', async ($, on) => {
  engine(on)
  await started($)
  const added = await $.tool.call({ tool: TRACK, action: 'add', kind: 'decision', text: '要不要加快取' } as never)
  expect(added.deny).toBeUndefined()
  expect(JSON.stringify(added.result)).toContain('o1')

  const ui = await $.ui.mount({ plugin: 'open-items', surface: 'terminal', ...BAND } as never)
  expect(await ui.find({ type: 'Text', text: /1 待你決定/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'band beneath' })).toBeDefined()
  await ui.unmount()

  const bad = await $.tool.call({ tool: TRACK, action: 'resolve', id: 'o9' } as never)
  expect(bad.deny).toBeDefined()
  await $.tool.call({ tool: TRACK, action: 'resolve', id: 'o1' } as never)
  const after = await $.ui.mount({ plugin: 'open-items', surface: 'terminal', ...BAND } as never)
  expect(await after.find({ type: 'Text', text: /待你決定/ })).toBeUndefined()
  await after.unmount()
})

// The focus ring landing on a row, as Tab or ↑↓ moves it there.
async function focusRow($: Engine, id: string): Promise<void> {
  await $.ui.focus({ component: 'Pane', requestId: 'open-items', plugin: 'open-items', element: `row:${id}`, origin: { kind: 'person' } } as never)
}

test('the pane acts on the focused row, keeps a closed row in place, and the same key reopens it', async ($, on) => {
  const store = engine(on)
  await started($)
  await $.tool.call({ tool: TRACK, action: 'add', kind: 'bug', text: '登入偶爾失敗' } as never)
  await $.tool.call({ tool: TRACK, action: 'add', kind: 'deferred', text: '補文件' } as never)
  const pane = await $.ui.mount({ ...PANE_MOUNT, props: { ...PANE_MOUNT.props, bodyColumns: 80 } } as never)
  expect((await pane.find({ key: 'row:o1' }))?.props.label).toBe('o1')
  expect((await pane.find({ type: 'Text', text: /登入偶爾失敗/ }))?.text).toBe('登入偶爾失敗')
  // Nothing is focused yet: the keys do nothing, and no row shows its age.
  await pane.press({ key: 'done' })
  expect(await pane.find({ type: 'Text', text: /^剛剛/ })).toBeUndefined()
  expect(JSON.stringify((await $.tool.call({ tool: TRACK, action: 'list' } as never)).result)).toContain('o1')

  await focusRow($, 'o1')
  expect(await pane.find({ type: 'Text', text: /^剛剛/ })).toBeDefined()
  await pane.press({ key: 'quote' })
  expect(filled).toEqual(['關於 o1（未解決 bug）「登入偶爾失敗」：'])
  await pane.press({ key: 'done' })
  const closed = await pane.find({ type: 'Text', text: /完成 登入偶爾失敗/ })
  expect(closed?.props).toMatchObject({ strikethrough: true, dimColor: true })
  expect(String((await $.tool.call({ tool: TRACK, action: 'list' } as never)).result)).not.toContain('o1')

  // Again on the same row: open again, under a new uid so the store's tombstone does not close it.
  await pane.press({ key: 'done' })
  expect((await pane.find({ type: 'Text', text: /登入偶爾失敗/ }))?.text).toBe('登入偶爾失敗')
  expect(String((await $.tool.call({ tool: TRACK, action: 'list' } as never)).result)).toContain('o1')
  expect(readStored(store.get('items:/repo')).items.map(item => item.text)).toContain('登入偶爾失敗')

  // x on a row closed with d changes it to won't do.
  await pane.press({ key: 'done' })
  await pane.press({ key: 'drop' })
  expect(await pane.find({ type: 'Text', text: /不做 登入偶爾失敗/ })).toBeDefined()
  await pane.unmount()

  // Opened again, the closed row is gone.
  await $.command.run({ command: 'open-items', args: '' } as never)
  const again = await $.ui.mount(PANE_MOUNT as never)
  expect(await again.find({ type: 'Text', text: /登入偶爾失敗/ })).toBeUndefined()
  expect(await again.find({ type: 'Text', text: /補文件/ })).toBeDefined()
  await again.unmount()
})

test('the resolved list reopens the focused row with d and puts the resolution back on a second d', async ($, on) => {
  const store = engine(on)
  await started($)
  await $.tool.call({ tool: TRACK, action: 'add', kind: 'decision', text: '要不要加快取' } as never)
  await $.tool.call({ tool: TRACK, action: 'resolve', id: 'o1', note: '要，先做讀取' } as never)
  const log = () => readLog(store.get('log:/repo')).map(entry => entry.text)
  expect(log()).toEqual(['要不要加快取'])
  const pane = await $.ui.mount(PANE_MOUNT as never)
  expect((await pane.find({ key: 'empty' }))?.text).toBe('目前沒有待處理項目。')
  await pane.press({ key: 'view' })
  expect((await pane.find({ key: 'view' }))?.text).toContain('最近完成')
  await focusRow($, 'o1')
  expect(await pane.find({ type: 'Text', text: '要，先做讀取' })).toBeDefined()
  await pane.press({ key: 'reopen' })
  expect(await pane.find({ type: 'Text', text: /重新打開 要不要加快取/ })).toBeDefined()
  expect(log()).toEqual([])
  expect(String((await $.tool.call({ tool: TRACK, action: 'list' } as never)).result)).toContain('要不要加快取')
  await pane.press({ key: 'reopen' })
  expect(await pane.find({ type: 'Text', text: /完成 要不要加快取/ })).toBeDefined()
  expect(log()).toEqual(['要不要加快取'])
  expect(readLog(store.get('log:/repo'))[0]?.note).toBe('要，先做讀取')
  await pane.unmount()
})

test('the focused row wraps its whole text to the body width, each line behind the kind-colored side line', async ($, on) => {
  engine(on)
  await started($)
  const text = '這是一段很長的待決定事項，用來確認焦點列會依照 pane 的寬度自己折行並在每行前畫線'
  await $.tool.call({ tool: TRACK, action: 'add', kind: 'decision', text } as never)
  const pane = await $.ui.mount({ ...PANE_MOUNT, props: { ...PANE_MOUNT.props, bodyColumns: 55 } } as never)
  expect((await pane.find({ type: 'Text', text: '待決定' }))?.props.color).toBe('yellow')
  expect((await pane.find({ type: 'Text', text: /很長/ }))?.props.wrap).toBe('truncate-end')
  await focusRow($, 'o1')
  const lines = await pane.findAll({ type: 'Text', text: /./ })
  const bars = lines.filter(t => t.text === '│')
  expect(bars.length).toBeGreaterThanOrEqual(2)
  expect(bars.every(t => t.props.color === 'yellow')).toBe(true)
  const body = lines.filter(t => text.includes(t.text) && t.text.length > 1 && t.text !== '待決定')
  expect(body.map(t => t.text).join('')).toBe(text)
  expect(body.every(t => cells(t.text) <= 55 - 5 - 7)).toBe(true)
  await pane.unmount()
})

test('a partly chosen option list defers the rest on the next prompt', async ($, on) => {
  engine(on)
  on('prompt.submit', ($, e) => ({ text: e.text }))
  await started($)
  await $.turn.complete({ answer: ABC, reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1' } as never)
  await $.prompt.submit({ text: '做 A+B。C 先寫成觀察項', origin: { kind: 'composer' } } as never)

  const ui = await $.ui.mount({ plugin: 'open-items', surface: 'terminal', ...BAND } as never)
  expect(await ui.find({ type: 'Text', text: /1 延後/ })).toBeDefined()
  await ui.unmount()
})

test('an answer without options keeps the remembered list', async ($, on) => {
  engine(on)
  on('prompt.submit', ($, e) => ({ text: e.text }))
  await started($)
  await $.turn.complete({ answer: ABC, reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1' } as never)
  await $.turn.complete({ answer: '背景工作完成了。', reason: 'answer', durationMs: 1, isAborted: false, turnId: 't2' } as never)
  await $.prompt.submit({ text: 'A＋B', origin: { kind: 'composer' } } as never)

  const ui = await $.ui.mount({ plugin: 'open-items', surface: 'terminal', ...BAND } as never)
  expect(await ui.find({ type: 'Text', text: /1 延後/ })).toBeDefined()
  await ui.unmount()
})

test('open items are kept across sessions per repo and added to the compacted context', async ($, on) => {
  engine(on)
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'summary', toolUses: [] }] }))
  await started($)
  await $.tool.call({ tool: TRACK, action: 'add', kind: 'deferred', text: '補文件' } as never)
  const compacted = await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] } as never)
  expect(compacted.messages?.[1]?.text).toContain('o1: 補文件')
  await $.session.end({ reason: 'other', sessionId: 's', resume: {} } as never)
})

test('after /clear the stored items come back on the next prompt and are not deleted on exit', async ($, on) => {
  // What a /clear leaves: the state empty, the store holding the repo's items, no session.start (so the wording is the default English).
  const stored = { source: 'model', isDone: false, createdAt: 0 } as const
  const store = engine(on, { 'items:/repo': [{ ...stored, id: 'o4', kind: 'deferred', text: '補文件' }] })
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
  const first = await $.prompt.submit({ text: '繼續', origin: { kind: 'composer' } } as never)
  expect(first.context?.join('\n')).toContain('o4: 補文件')
  const second = await $.prompt.submit({ text: '好', origin: { kind: 'composer' } } as never)
  expect(second.context ?? []).toEqual([])

  const ui = await $.ui.mount({ plugin: 'open-items', surface: 'terminal', ...BAND } as never)
  expect(await ui.find({ type: 'Text', text: /1 deferred/ })).toBeDefined()
  await ui.unmount()

  const added = await $.tool.call({ tool: TRACK, action: 'add', kind: 'bug', text: '登入偶爾失敗' } as never)
  expect(JSON.stringify(added.result)).toContain('o5')
  await $.session.end({ reason: 'other', sessionId: 's1', resume: {} } as never)
  expect(readStored(store.get('items:/repo')).items.map(item => item.text)).toEqual(['補文件', '登入偶爾失敗'])
})

test('after /clear the pane opened before any prompt shows the stored items', async ($, on) => {
  const stored = { source: 'model', isDone: false, createdAt: 0 } as const
  engine(on, { 'items:/repo': [{ ...stored, id: 'o4', kind: 'deferred', text: '補文件' }] })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ran = await $.command.run({ command: 'open-items', args: '' } as never)
    expect(ran.text).toBe('Opened the open items list.')
    const pane = await $.ui.mount({ ...PANE_MOUNT, surface } as never)
    expect((await pane.find({ type: 'Text', text: /補文件/ }))?.text).toBe('補文件')
    await pane.unmount()
    const band = await $.ui.mount({ plugin: 'open-items', surface, ...BAND } as never)
    expect(await band.find({ type: 'Text', text: /1 deferred/ })).toBeDefined()
    await band.unmount()
  }
})

test('a /clear loads the stored items at once, so the band shows them before any prompt', async ($, on) => {
  const stored = { source: 'model', isDone: false, createdAt: 0 } as const
  engine(on, { 'items:/repo': [{ ...stored, id: 'o4', kind: 'deferred', text: '補文件' }] })
  on('classic.SessionStart', () => ({}))
  await $.classic.SessionStart({ source: 'clear' })
  const band = await $.ui.mount({ plugin: 'open-items', surface: 'desktop', ...BAND } as never)
  expect(await band.find({ type: 'Text', text: /1 deferred/ })).toBeDefined()
  await band.unmount()
  expect(toasts.some(text => text.includes('1 open item(s) left from last time'))).toBe(true)
})

test('every change is written at once, without waiting for the session to end', async ($, on) => {
  const store = engine(on)
  await started($)
  await $.tool.call({ tool: TRACK, action: 'add', kind: 'bug', text: '登入偶爾失敗' } as never)
  expect(readStored(store.get('items:/repo')).items.map(item => item.text)).toEqual(['登入偶爾失敗'])
  await $.tool.call({ tool: TRACK, action: 'resolve', id: 'o1' } as never)
  const after = readStored(store.get('items:/repo'))
  expect(after.items).toEqual([])
  expect(after.done).toHaveLength(1)
})

test('two sessions on one repo keep what the other added and resolved', async ($, on) => {
  const store = engine(on, { 'items:/repo': { items: [item('o1', { text: '補文件' })], done: [] } })
  await started($)
  // Meanwhile another session resolves o1 and adds its own item.
  store.set('items:/repo', { items: [item('o7', { uid: 'other', text: '別的 session' })], done: [{ uid: 'u-o1', doneAt: 2 }] })
  await $.tool.call({ tool: TRACK, action: 'add', kind: 'question', text: '要不要加快取' } as never)

  const kept = readStored(store.get('items:/repo'))
  expect(kept.items.map(i => i.text)).toEqual(['別的 session', '要不要加快取'])
  expect(kept.done.map(t => t.uid)).toEqual(['u-o1'])
  const listed = await $.tool.call({ tool: TRACK, action: 'list' } as never)
  expect(JSON.stringify(listed.result)).not.toContain('補文件')
})

test('a worktree reads the repo key and moves the items kept under its own path', async ($, on) => {
  const wt = '/repo/.claude/worktrees/x'
  const store = engine(
    on,
    { [`items:${wt}`]: [{ id: 'o1', kind: 'deferred', text: '補文件', source: 'model', isDone: false, createdAt: 0 }] },
    { root: wt, repoRoot: '/repo' },
  )
  await started($)
  expect(store.has(`items:${wt}`)).toBe(false)
  expect(readStored(store.get('items:/repo')).items.map(i => i.text)).toEqual(['補文件'])
})

test('outside a repository the session root is the key', async ($, on) => {
  const store = engine(on, {}, { root: '/tmp/x', repoRoot: null })
  await started($)
  await $.tool.call({ tool: TRACK, action: 'add', kind: 'bug', text: 'x' } as never)
  expect(store.has('items:/tmp/x')).toBe(true)
})

test('resolving an unknown id answers with the open list', async ($, on) => {
  engine(on)
  await started($)
  await $.tool.call({ tool: TRACK, action: 'add', kind: 'decision', text: '要不要加快取' } as never)
  const bad = await $.tool.call({ tool: TRACK, action: 'resolve', id: 'o9' } as never)
  expect(bad.deny).toContain('o1: 要不要加快取')
})

test('the band opens the pane with its button', async ($, on) => {
  engine(on)
  await started($)
  await $.tool.call({ tool: TRACK, action: 'add', kind: 'question', text: '要不要加快取' } as never)
  const ui = await $.ui.mount({ plugin: 'open-items', surface: 'terminal', ...BAND } as never)
  await ui.press({ key: 'open' })
  expect(opened).toEqual(['open-items'])
  await ui.unmount()
})

const PANE_MOUNT = {
  plugin: 'open-items',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'open-items',
  props: { title: '待處理項目', isFocused: true, bodyColumns: 120, placement: 'inline' },
} as const

test('an auto-deferral is toasted and can be undone from the band until the next prompt', async ($, on) => {
  const store = engine(on)
  on('prompt.submit', ($, e) => ({ text: e.text }))
  await started($)
  await $.turn.complete({ answer: ABC, reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1' } as never)
  await $.prompt.submit({ text: 'A', origin: { kind: 'composer' } } as never)
  expect(toasts.some(t => t.includes('已延後 B：重構模組、C：補文件'))).toBe(true)

  const ui = await $.ui.mount({ ...BAND, plugin: 'open-items', surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /2 延後/ })).toBeDefined()
  await ui.press({ key: 'undo' })
  await ui.unmount()
  expect((await $.tool.call({ tool: TRACK, action: 'list' } as never)).result).toBe('No open items.')
  const kept = readStored(store.get('items:/repo'))
  expect(kept.items).toEqual([])
  expect(kept.done).toHaveLength(2)
})

test('the undo is gone after the next prompt', async ($, on) => {
  engine(on)
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('command.run', () => ({ text: '' }))
  await started($)
  await $.turn.complete({ answer: ABC, reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1' } as never)
  await $.prompt.submit({ text: 'A＋B', origin: { kind: 'composer' } } as never)
  await $.prompt.submit({ text: '繼續', origin: { kind: 'composer' } } as never)
  const ran = await $.command.run({ command: 'open-items', args: 'undo' } as never)
  expect(ran.text).toBe('沒有可以復原的自動延後項目。')
})

test('an add similar to an open item is not added, by the model or by an auto-deferral', async ($, on) => {
  engine(on)
  on('prompt.submit', ($, e) => ({ text: e.text }))
  await started($)
  await $.tool.call({ tool: TRACK, action: 'add', kind: 'deferred', text: '補文件' } as never)
  const again = await $.tool.call({ tool: TRACK, action: 'add', kind: 'question', text: '補文件。' } as never)
  expect(String(again.result)).toContain('similar to open item o1')

  await $.turn.complete({ answer: ABC, reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1' } as never)
  await $.prompt.submit({ text: 'A＋B', origin: { kind: 'composer' } } as never)
  expect(toasts.some(t => t.includes('已延後'))).toBe(false)
  expect(String((await $.tool.call({ tool: TRACK, action: 'list' } as never)).result).split('\n')).toHaveLength(1)
})

test('dropping keeps the reason in the repo log, which history reads in a later session', async ($, on) => {
  const store = engine(on)
  await started($)
  await $.tool.call({ tool: TRACK, action: 'add', kind: 'decision', text: '要不要加快取' } as never)
  await $.tool.call({ tool: TRACK, action: 'add', kind: 'deferred', text: '補文件' } as never)
  await $.tool.call({ tool: TRACK, action: 'resolve', id: 'o1', note: '選 A：讀取是瓶頸' } as never)
  const dropped = await $.tool.call({ tool: TRACK, action: 'resolve', id: 'o2', dropped: true, note: 'README 已涵蓋' } as never)
  expect(dropped.result).toBe('dropped o2')

  const log = readLog(store.get('log:/repo'))
  expect(log.map(e => [e.outcome, e.note])).toEqual([
    ['done', '選 A：讀取是瓶頸'],
    ['dropped', 'README 已涵蓋'],
  ])
  const history = String((await $.tool.call({ tool: TRACK, action: 'history', query: '快取' } as never)).result)
  expect(history).toContain('要不要加快取 — 選 A：讀取是瓶頸')
  expect(history).not.toContain('補文件')

  const pane = await $.ui.mount(PANE_MOUNT as never)
  await pane.press({ key: 'view' })
  expect(await pane.find({ type: 'Text', text: /不做 補文件/ })).toBeDefined()
  await focusRow($, 'o2')
  expect(await pane.find({ type: 'Text', text: /^README 已涵蓋$/ })).toBeDefined()
  await pane.unmount()
})

test('items closed in the pane are told to the model with the next prompt, once', async ($, on) => {
  engine(on)
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
  await started($)
  await $.tool.call({ tool: TRACK, action: 'add', kind: 'bug', text: '登入偶爾失敗' } as never)
  await $.tool.call({ tool: TRACK, action: 'add', kind: 'deferred', text: '補文件' } as never)
  const pane = await $.ui.mount(PANE_MOUNT as never)
  await focusRow($, 'o1')
  await pane.press({ key: 'done' })
  await focusRow($, 'o2')
  await pane.press({ key: 'drop' })
  await pane.unmount()

  const first = await $.prompt.submit({ text: '繼續', origin: { kind: 'composer' } } as never)
  const note = (first.context ?? []).join('\n')
  expect(note).toContain('o1 (resolved): 登入偶爾失敗')
  expect(note).toContain('o2 (marked as will not do): 補文件')
  const second = await $.prompt.submit({ text: '好', origin: { kind: 'composer' } } as never)
  expect(second.context ?? []).toEqual([])
})

test('a prompt dropped beneath changes nothing, so the next one defers and tells as before', async ($, on) => {
  engine(on)
  // A plugin beneath (secret-scrub when its check fails) holds the first prompt back.
  let isBlocked = true
  on('prompt.submit', ($, e) => (isBlocked ? { drop: 'blocked' } : { text: e.text, context: e.context }))
  await started($)
  await $.tool.call({ tool: TRACK, action: 'add', kind: 'bug', text: '登入偶爾失敗' } as never)
  const pane = await $.ui.mount(PANE_MOUNT as never)
  await focusRow($, 'o1')
  await pane.press({ key: 'done' })
  await pane.unmount()
  await $.turn.complete({ answer: ABC, reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1' } as never)

  const dropped = await $.prompt.submit({ text: 'A＋B', origin: { kind: 'composer' } } as never)
  expect(dropped.drop).toBe('blocked')
  expect(toasts.some(text => text.includes('已延後'))).toBe(false)
  const band = await $.ui.mount({ plugin: 'open-items', surface: 'terminal', ...BAND } as never)
  expect(await band.find({ type: 'Text', text: /延後/ })).toBeUndefined()
  await band.unmount()

  isBlocked = false
  const sent = await $.prompt.submit({ text: 'A＋B', origin: { kind: 'composer' } } as never)
  expect((sent.context ?? []).join('\n')).toContain('o1 (resolved): 登入偶爾失敗')
  const after = await $.ui.mount({ plugin: 'open-items', surface: 'terminal', ...BAND } as never)
  expect(await after.find({ type: 'Text', text: /1 延後/ })).toBeDefined()
  await after.unmount()
})

test('/open-items copy puts the list on the clipboard as markdown', async ($, on) => {
  engine(on)
  on('command.run', () => ({ text: '' }))
  await started($)
  await $.tool.call({ tool: TRACK, action: 'add', kind: 'decision', text: '要不要加快取' } as never)
  const ran = await $.command.run({ command: 'open-items', args: 'copy' } as never)
  expect(ran.text).toBe('已把待處理項目複製成 markdown。')
  expect(copied).toEqual(['## 待處理項目\n\n### 待你決定\n\n- o1：要不要加快取（main）\n'])
})

test('a question left untracked is a miss only when the person then replies at length', async ($, on) => {
  const store = engine(on, { stats: { questions: 9, missed: 9 } })
  on('command.run', () => ({ text: '' }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  await started($)
  const done = (answer: string, turnId: string) =>
    $.turn.complete({ answer, reason: 'answer', durationMs: 1, isAborted: false, turnId } as never)
  const reply = (text: string, kind = 'composer') => $.prompt.submit({ text, origin: { kind } } as never)
  // Tracked: not untracked, whatever the reply.
  await $.tool.call({ tool: TRACK, action: 'add', kind: 'decision', text: '要不要 commit' } as never)
  await done('要 commit 嗎？', 't1')
  await reply('好，先不要，等我把這段文件也改完再一起送出去')
  // A confirmation answered with a word.
  await done('要 commit 嗎？', 't2')
  await reply('ok')
  // Answered by a prompt the person did not type.
  await done('要照這個方向做嗎？', 't3')
  await reply('<task-notification> agent finished with a long report', 'system')
  // Answered at length: a miss.
  await done('A 和 B 你想先做哪個？', 't4')
  await reply('先做 B，因為 A 要等上游的 API 定下來，順便把測試補齊')
  // Not a question: nothing counted, and the reply after it is not judged.
  await done('改好了。', 't5')
  await reply('那再幫我把剩下的三個檔案也一起改一下吧，謝謝')

  // The old { questions, missed } counts are dropped.
  expect(store.get('stats')).toEqual({ questions: 4, untracked: 3, missed: 1 })
  const misses = logged.filter(line => line.startsWith('open-items: missed'))
  expect(misses).toHaveLength(1)
  expect(misses[0]).toContain('A 和 B 你想先做哪個？')
  const ran = await $.command.run({ command: 'open-items', args: 'stats' } as never)
  expect(ran.text).toContain('其中 3 次沒有呼叫 track，這些當中你回覆超過 14 字的有 1 次（25%）')
})

test('items keep their branch; the pane shows age and branch, the load toast counts the rest', async ($, on) => {
  const day = 86_400_000
  const old = { source: 'model', isDone: false, createdAt: 0 } as const
  engine(
    on,
    {
      'items:/repo': {
        items: [
          { ...old, id: 'o1', uid: 'a', kind: 'deferred', text: '補文件', branch: 'feat/x' },
          { ...old, id: 'o2', uid: 'b', kind: 'bug', text: '登入偶爾失敗', branch: 'main' },
        ],
        done: [],
      },
    },
    { branch: 'main', now: 10 * day },
  )
  await started($)
  expect(toasts).toContain('open-items：上次留下 2 個待處理項目（1 個在其他 branch、2 個超過 7 天）')
  await $.tool.call({ tool: TRACK, action: 'add', kind: 'question', text: '要不要加快取' } as never)
  const pane = await $.ui.mount(PANE_MOUNT as never)
  await focusRow($, 'o1')
  expect(await pane.find({ type: 'Text', text: /10 天前 · feat\/x/ })).toBeDefined()
  // Older than 7 days: the kind and the text are dim.
  expect((await pane.find({ type: 'Text', text: '延　後' }))?.props.dimColor).toBe(true)
  expect((await pane.find({ type: 'Text', text: '登入偶爾失敗' }))?.props.dimColor).toBe(true)
  await focusRow($, 'o3')
  expect(await pane.find({ type: 'Text', text: /剛剛 · main/ })).toBeDefined()
  expect((await pane.find({ type: 'Text', text: '問　題' }))?.props.color).toBe('cyan')
  await pane.unmount()
})

test('/open-items status lists the language setting', async ($, on) => {
  engine(on)
  await started($)
  const ran = await $.command.run({ command: 'open-items', args: 'status' } as never)
  expect(ran.text).toMatch(/^open-items 設定[\s\S]*language = zh-TW {2}\[使用者\]/)
})

test('the wording is English by default: the band, the pane and the commands', async ($, on) => {
  engine(on, {}, {}, '')
  await started($)
  await $.tool.call({ tool: TRACK, action: 'add', kind: 'decision', text: 'cache it?' } as never)
  const ui = await $.ui.mount({ plugin: 'open-items', surface: 'terminal', ...BAND } as never)
  expect(await ui.find({ type: 'Text', text: /1 to decide/ })).toBeDefined()
  expect(await ui.find({ key: 'open', text: 'Open' })).toBeDefined()
  await ui.unmount()
  const pane = await $.ui.mount(PANE_MOUNT as never)
  expect(await pane.find({ type: 'Text', text: 'Decide' })).toBeDefined()
  await focusRow($, 'o1')
  expect(await pane.find({ type: 'Text', text: /^just now/ })).toBeDefined()
  await pane.unmount()
  const run = (args: string) => $.command.run({ command: 'open-items', args } as never)
  expect((await run('')).text).toBe('Opened the open items list.')
  expect((await run('stats')).text).toBe('No answers ending in a question yet.')
  expect((await run('copy')).text).toBe('Copied the open items as markdown.')
  expect(copied[0]).toContain('## Open items')
  // The tool's answer for Claude stays English in any language.
  await $.tool.call({ tool: TRACK, action: 'resolve', id: 'o1', note: 'yes' } as never)
  expect(JSON.stringify((await $.tool.call({ tool: TRACK, action: 'history' } as never)).result)).toMatch(/resolved just now/)
})

test('the track history for Claude is English even in zh-TW, while /open-items log follows the setting', async ($, on) => {
  engine(on)
  await started($)
  await $.tool.call({ tool: TRACK, action: 'add', kind: 'decision', text: '要不要加快取' } as never)
  await $.tool.call({ tool: TRACK, action: 'resolve', id: 'o1', note: '要' } as never)
  expect(JSON.stringify((await $.tool.call({ tool: TRACK, action: 'history' } as never)).result)).toMatch(/\[decision, resolved just now\]/)
  expect((await $.command.run({ command: 'open-items', args: 'log' } as never)).text).toMatch(/\[待你決定, 已解決 剛剛\]/)
})

test('the pane follows DESIGN.md: named after the mod, focused, Esc closes it, keys listed at the bottom', async ($, on) => {
  engine(on, {}, {}, '')
  await started($)
  await $.command.run({ command: 'open-items', args: '' } as never)
  expect(openedWith[0]).toMatchObject({ title: 'open-items', focus: true, closeOnEscape: true })

  const empty = await $.ui.mount(PANE_MOUNT as never)
  expect((await empty.find({ key: 'empty' }))?.text).toBe('No open items.')
  expect((await empty.find({ key: 'hint' }))?.text).toBe('Esc closes')
  expect(await empty.find({ key: 'done' })).toBeUndefined()
  await empty.unmount()

  await $.tool.call({ tool: TRACK, action: 'add', kind: 'decision', text: 'cache it?' } as never)
  const pane = await $.ui.mount(PANE_MOUNT as never)
  expect((await pane.find({ key: 'view' }))?.props.hotkey).toBe('v')
  expect((await pane.find({ key: 'copy' }))?.props).toMatchObject({ hotkey: 'c', label: 'Copy whole list' })
  expect((await pane.find({ key: 'act:done' }))?.text).toBe('d: Done')
  expect((await pane.find({ key: 'done' }))?.props.hotkey).toBe('d')
  expect((await pane.find({ key: 'drop' }))?.props.hotkey).toBe('x')
  expect((await pane.find({ key: 'quote' }))?.props.hotkey).toBe('q')
  expect((await pane.find({ key: 'hint' }))?.text).toBe('Tab/↑↓ moves · Esc closes')
  // The keys keep the default color; what they do is dim.
  const hint = (await pane.findAll({ type: 'Text', text: /./ })).filter(t => ['Tab/↑↓', ' moves', 'Esc', ' closes'].includes(t.text))
  expect(hint.map(t => [t.text, t.props.dimColor === true])).toEqual([
    ['Tab/↑↓', false],
    [' moves', true],
    ['Esc', false],
    [' closes', true],
  ])
  await pane.unmount()
})

test('says so when the command name is taken', async ($, on) => {
  engine(on)
  refuseCommand = "it is the user's /open-items"
  await started($)
  expect(toasts).toContainEqual(expect.stringMatching(/^open-items：\/open-items 指令沒有註冊成功/))
})
