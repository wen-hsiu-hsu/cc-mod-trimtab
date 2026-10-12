import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { ACTIONS_END, ACTIONS_START, MERGE_OPS, applyActions, distillPrompt, parseActions } from './distill'
import { INDEX_CAP, fileNameFor, indexEntries, isArchived, joinLive, notesOf, parseFile, readStore, renderMemory, renderRule, splitLive, storeOf, updateIndex, withActiveDay } from './notes'
import type { Memory, Notes, Procedure, Rule } from './notes'
import { renderProgress, withExclude, type Progress } from './progress'
import { applyPlaced, markAsked, promoteItems, promoteText, readReport } from './promote'
import { TAG, transcriptOf, userTextOf } from './transcript'
import type { Row } from './transcript'

const actions = (...lines: object[]) => [ACTIONS_START, ...lines.map(l => JSON.stringify(l)), ACTIONS_END].join('\n')
const EMPTY: Notes = { memory: [], rules: [], procedures: [] }
const mem = (over: Partial<Memory> = {}): Memory => ({ file: 'pm-project-a.md', type: 'project', title: '部署要先跑 migration', paths: [], evidence: ['2026-10-01｜x'], extra: [], ...over })
const rule = (over: Partial<Rule> = {}): Rule => ({ file: 'pm-rule-r.md', name: '規則一', rule: 'r', count: 2, sessions: ['s0', 's9'], paths: [], evidence: [], extra: [], ...over })
const proc = (over: Partial<Procedure> = {}): Procedure => ({ name: '發版', when: '要發版時', steps: ['a', 'b', 'c'], count: 3, sessions: [], evidence: [], ...over })
// Active days: one per calendar day from the first, n of them.
const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(from) + i * 86_400_000).toISOString().slice(0, 10))

describe('memory files', () => {
  test('render and parse back the same memory, keeping lines someone else wrote', () => {
    const m = mem({ how: '先跑 `npm run migrate`', why: '否則啟動失敗', paths: ['db/migrate.ts'], extra: ['自己加的備註'] })
    const p = parseFile(renderMemory(m, 'zh-TW'))
    expect(p).toMatchObject({ name: m.title, type: 'project', how: m.how, why: m.why, paths: ['db/migrate.ts'], evidence: m.evidence, extra: ['自己加的備註'] })
    expect(renderMemory({ ...m, title: p.name, how: p.how, why: p.why, paths: p.paths, evidence: p.evidence, extra: p.extra }, 'zh-TW')).toBe(renderMemory(m, 'zh-TW'))
    expect(renderMemory(m, 'zh-TW')).toStartWith('---\nname: 部署要先跑 migration\ndescription: 先跑 `npm run migrate`\ntype: project\n---\n')
    expect(renderMemory(m, 'zh-TW')).toContain('**做法：** 先跑')
  })

  test('the labels follow the language, and either language reads back', () => {
    const m = mem({ how: 'run it', why: 'else it fails', paths: ['db/migrate.ts'], evidence: ['2026-10-01 | x'] })
    const en = renderMemory(m)
    expect(en).toContain('**How:** run it')
    expect(en).toContain('\n## Evidence\n- 2026-10-01 | x\n')
    expect(parseFile(en)).toMatchObject({ how: 'run it', why: 'else it fails', paths: ['db/migrate.ts'], evidence: ['2026-10-01 | x'], extra: [] })
    // A file written in the other language is read, and rewritten in the current one.
    const zh = renderMemory(m, 'zh-TW')
    expect(zh).toContain('\n## 根據\n')
    expect(parseFile(zh)).toMatchObject({ how: 'run it', why: 'else it fails', paths: ['db/migrate.ts'], evidence: ['2026-10-01 | x'], extra: [] })
    expect(parseFile(en)).toEqual(parseFile(zh))
  })

  test('an invalidated memory keeps its date and successor in the frontmatter', () => {
    const p = parseFile(renderMemory(mem({ invalidated: '2026-10-09', supersededBy: '部署改用 deploy.sh' })))
    expect(p).toMatchObject({ invalidated: '2026-10-09', supersededBy: '部署改用 deploy.sh' })
  })

  test('a file the store lists is a rule; a placed rule without a file stays known', () => {
    const r = rule({ name: '測試用 test:brief', rule: '跑 npm run test:brief', file: 'pm-rule-x.md' })
    const store = readStore({
      rules: { 'pm-rule-x.md': { name: r.name, count: 2, sessions: ['s0', 's9'] }, 'project:舊規則': { name: '舊規則', count: 4, sessions: [], project: '已在 CLAUDE.md', rule: 'r' } },
    })
    const notes = notesOf([{ file: 'pm-rule-x.md', text: renderRule(r) }, { file: 'pm-project-a.md', text: renderMemory(mem()) }], store)
    expect(notes.rules.map(x => [x.name, x.count, x.file, x.project])).toEqual([
      [r.name, 2, 'pm-rule-x.md', undefined],
      ['舊規則', 4, undefined, '已在 CLAUDE.md'],
    ])
    expect(notes.memory.map(m => m.title)).toEqual(['部署要先跑 migration'])
    expect(storeOf(notes, {}, []).rules).toEqual(store.rules)
  })

  test('reads a store written before sessions and active days were kept', () => {
    const store = readStore({ rules: { 'pm-rule-x.md': { name: 'x', count: 3 } }, procedures: [{ name: 'p', when: 'w', steps: ['a', 'b'], count: 2, evidence: [] }] })
    expect(store.activeDays).toEqual([])
    expect(store.procedures[0]?.sessions).toEqual([])
    expect(notesOf([{ file: 'pm-rule-x.md', text: renderRule(rule({ file: 'pm-rule-x.md' })) }], store).rules[0]?.sessions).toEqual([])
  })

  test('names files by type, ASCII words of the title and a hash, never reusing one', () => {
    const a = fileNameFor('feedback', '用 npm run test:brief 跑測試', new Set())
    expect(a).toMatch(/^pm-feedback-npm-run-test-brief-[0-9a-f]{6}\.md$/)
    expect(fileNameFor('feedback', '用 npm run test:brief 跑測試', new Set([a]))).toBe(a.replace('.md', '-2.md'))
    expect(fileNameFor('user', '全中文標題', new Set())).toMatch(/^pm-user-[0-9a-f]{6}\.md$/)
  })
})

describe('staleness', () => {
  test('counts active days, not calendar days, and never archives preferences', () => {
    // Confirmed 2026-10-01; a month away adds no active day.
    expect(isArchived(mem(), ['2026-10-01', '2026-11-20'])).toBe(false)
    expect(isArchived(mem(), days('2026-10-02', 30))).toBe(false)
    expect(isArchived(mem(), days('2026-10-02', 31))).toBe(true)
    expect(isArchived(mem({ type: 'feedback' }), days('2026-10-02', 31))).toBe(false)
    expect(indexEntries({ ...EMPTY, memory: [mem()] }, days('2026-10-02', 31))).toEqual([])
  })

  test('records each active day once, in order', () => {
    expect(withActiveDay(['2026-10-02'], '2026-10-01')).toEqual(['2026-10-01', '2026-10-02'])
    expect(withActiveDay(['2026-10-01'], '2026-10-01')).toBeUndefined()
  })

  test('keeps an invalidated file 90 days, out of what the model sees', () => {
    const dead = mem({ file: 'pm-old.md', invalidated: '2026-07-01' })
    const notes: Notes = { ...EMPTY, memory: [mem(), dead] }
    const { live, dead: gone } = splitLive(notes)
    expect(live.memory.map(m => m.file)).toEqual(['pm-project-a.md'])
    expect(indexEntries(notes, []).map(e => e.file)).toEqual(['pm-project-a.md'])
    expect(joinLive(live, gone, '2026-09-29').memory.length).toBe(2)
    expect(joinLive(live, gone, '2026-09-30').memory.length).toBe(1)
  })
})

describe('MEMORY.md', () => {
  test('changes only the lines that link pm- files', () => {
    const before = ['# Memory', '- [自己寫的](user_role.md) — 主 session 的', '- [舊的](pm-a.md) — x', '- [刪掉的](pm-b.md) — y', ''].join('\n')
    const after = updateIndex(before, [
      { file: 'pm-a.md', title: '新標題', hook: 'h' },
      { file: 'pm-c.md', title: '新增的', hook: 'z' },
    ])
    expect(after).toBe(['# Memory', '- [自己寫的](user_role.md) — 主 session 的', '- [新標題](pm-a.md) — h', '- [新增的](pm-c.md) — z', ''].join('\n'))
    expect(updateIndex(after, [{ file: 'pm-a.md', title: '新標題', hook: 'h' }, { file: 'pm-c.md', title: '新增的', hook: 'z' }])).toBe(after)
    expect(updateIndex('', [])).toBe('')
  })

  test('holds to the cap, keeping the most recently confirmed', () => {
    const memory = [mem({ file: 'pm-1.md', evidence: ['2026-10-03｜x'] }), mem({ file: 'pm-2.md', evidence: ['2026-10-01｜x'] }), mem({ file: 'pm-3.md', evidence: ['2026-10-02｜x'] })]
    expect(indexEntries({ ...EMPTY, memory }, [], 2).map(e => e.file)).toEqual(['pm-1.md', 'pm-3.md'])
  })
})

describe('distill actions', () => {
  test('keeps a feedback memory only with a quote the person said', () => {
    const user = userTextOf([{ role: 'user', text: '以後 commit 前都要先跑 lint', toolUses: [] }])
    const good = { op: 'add_memory', type: 'feedback', title: 'commit 前先跑 lint', evidence: 'e', quote: 'commit 前都要…跑 lint' }
    const bad = { ...good, quote: '我說過要跑 lint' }
    const none = { ...good, quote: undefined }
    const { actions: list, rejected } = parseActions(actions(good, bad, none), EMPTY, user)
    expect(list.length).toBe(1)
    expect(rejected.count).toBe(2)
  })

  test('drops a line holding a secret without recording it', () => {
    const secret = actions({ op: 'add_memory', type: 'project', title: 't', evidence: 'token=abcdefghijklmnop' })
    const { actions: list, rejected } = parseActions(secret, EMPTY, '', undefined, 'zh-TW')
    expect(list).toEqual([])
    expect(rejected.samples).toEqual(['疑似金鑰：（不記錄內容）'])
    expect(parseActions(secret, EMPTY).rejected.samples).toEqual(['looks like a secret: (content not recorded)'])
  })

  test('takes repository-relative paths only', () => {
    const add = (paths: unknown) => parseActions(actions({ op: 'add_memory', type: 'project', title: 't', evidence: 'e', paths }), EMPTY).actions
    expect(add(['./src/a.ts'])).toMatchObject([{ paths: ['src/a.ts'] }])
    for (const bad of [['/etc/passwd'], ['../x'], ['a', 'b', 'c', 'd'], 'src/a.ts']) expect(add(bad)).toEqual([])
  })

  test('marks a deleted memory invalidated, naming what replaced it', () => {
    const notes: Notes = { ...EMPTY, memory: [mem(), mem({ file: 'pm-project-b.md', title: '第二條' })] }
    const { actions: list } = parseActions(
      actions(
        { op: 'update_memory', id: 'M2', type: 'project', title: '部署改用 deploy.sh', evidence: '改了流程' },
        { op: 'delete_memory', id: 'M1', reason: '被取代', superseded_by: 'M2' },
      ),
      notes,
    )
    const { notes: out, changes } = applyActions(list, notes, '2026-10-09', 's1', new Set(), 'zh-TW')
    expect(out.memory[0]).toMatchObject({ invalidated: '2026-10-09', supersededBy: '部署改用 deploy.sh' })
    expect(changes).toContain('記憶失效：部署要先跑 migration')
  })

  test('counts a rule or procedure once per session', () => {
    const notes: Notes = { memory: [], rules: [rule()], procedures: [proc({ count: 1, sessions: ['s1'] })] }
    const confirm = parseActions(actions({ op: 'confirm_rule', id: 'R1', evidence: '又證實' }, { op: 'confirm_procedure', id: 'P1', evidence: '又做一次' }), notes).actions
    const same = applyActions(confirm, notes, '2026-10-09', 's9', new Set(), 'zh-TW')
    expect(same.notes.rules[0]?.count).toBe(2)
    expect(same.changes[0]).toBe('證實規則：規則一（同一個 session，不加次數）')
    const other = applyActions(confirm, notes, '2026-10-09', 's2', new Set())
    expect([other.notes.rules[0]?.count, other.notes.procedures[0]?.count]).toEqual([3, 2])
    expect(other.notes.rules[0]?.sessions).toEqual(['s0', 's9', 's2'])
  })

  test('shows the model which related files are gone', () => {
    const live: Notes = { ...EMPTY, memory: [mem({ paths: ['db/migrate.ts', 'README.md'] })] }
    const prompt = distillPrompt(undefined, live, [], '(none)', new Map([['pm-project-a.md', ['db/migrate.ts']]]))
    expect(prompt).toContain('M1 [project] 部署要先跑 migration | evidence: 2026-10-01｜x | files: db/migrate.ts, README.md (files that no longer exist: db/migrate.ts)')
  })

  test('a merge answer may only update and invalidate', () => {
    const notes: Notes = { ...EMPTY, memory: [mem()] }
    const { actions: list, rejected } = parseActions(
      actions({ op: 'add_memory', type: 'project', title: 'n', evidence: 'e' }, { op: 'delete_memory', id: 'M1', reason: '重複' }),
      notes,
      '',
      MERGE_OPS,
    )
    expect(list.map(a => a.op)).toEqual(['delete_memory'])
    expect(rejected.count).toBe(1)
  })
})

describe('promotion', () => {
  const notes: Notes = { memory: [], rules: [rule({ count: 3 })], procedures: [proc()] }

  test('asks for what three sessions confirmed, twice at most, hours apart', () => {
    const now = 1_000_000_000
    const due = promoteItems(notes, {}, now)
    expect(due.map(d => d.key)).toEqual(['r:規則一', 'p:發版'])
    const asked = markAsked({}, due, now)
    expect(promoteItems(notes, asked, now + 60_000)).toEqual([])
    expect(promoteItems(notes, asked, now + 7 * 3_600_000).length).toBe(2)
    expect(promoteItems(notes, markAsked(asked, due, now), now + 99 * 3_600_000)).toEqual([])
    expect(promoteItems({ ...notes, rules: [rule({ count: 3, invalidated: '2026-10-01' })] }, {}, now).map(d => d.key)).toEqual(['p:發版'])
  })

  test('proposes rules for CLAUDE.md and waits for a yes', () => {
    const text = promoteText(promoteItems(notes, {}, 0), 'tool')
    expect(text).toContain('do not edit it directly')
    expect(text).toContain('Write it only after the user agrees')
    expect(text).toContain('.claude/skills/')
    expect(text).toContain('Write in English.')
    expect(promoteText(promoteItems(notes, {}, 0), 'tool', 'zh-TW')).toContain('Write in Traditional Chinese (zh-TW).')
  })

  test('a placed rule loses its file; a declined one stays a memory', () => {
    const { placed, failed } = readReport([{ rule: '規則一', where: 'CLAUDE.md' }, { procedure: '發版', declined: true }, { rule: '沒有', where: 'x' }], notes, 'zh-TW')
    expect(failed).toEqual(['rule "沒有": not in the notes'])
    const out = applyPlaced(notes, placed)
    expect(out.rules[0]).toMatchObject({ project: '已在 CLAUDE.md' })
    expect(out.rules[0]?.file).toBeUndefined()
    expect(out.procedures[0]?.project).toBe('不放')
    expect(applyPlaced(notes, [{ kind: 'rule', name: '規則一', value: '不放' }]).rules[0]?.file).toBe('pm-rule-r.md')
    // In English the marks are English; both languages are read.
    const en = readReport([{ rule: '規則一', where: 'CLAUDE.md' }, { procedure: '發版', declined: true }], notes)
    expect(en.placed.map(p => p.value)).toEqual(['in CLAUDE.md', 'declined'])
    expect(applyPlaced(notes, en.placed).procedures[0]?.project).toBe('declined')
    expect(applyPlaced(notes, [{ kind: 'rule', name: '規則一', value: 'declined' }]).rules[0]?.file).toBe('pm-rule-r.md')
  })
})

describe('transcript and progress', () => {
  test('masks secrets in tool inputs and results, and starts after the anchor', () => {
    const rows: Row[] = [
      { role: 'user', text: '先前的訊息', toolUses: [] },
      { role: 'user', text: '設定部署', toolUses: [] },
      { role: 'assistant', text: '好', toolUses: [{ tool: 'Bash', input: { command: 'export API_KEY=abcdefghijklmnop' }, text: 'Bearer abcdefghijklmnopqrstuv' }] },
    ]
    const { text, found } = transcriptOf(rows, '設定部署')
    expect(found).toBe(true)
    expect(text).not.toContain('先前的訊息')
    expect(text).not.toContain('abcdefghijklmnop')
    expect(text).toContain('‹redacted›')
  })

  test('lists the progress file in .git/info/exclude once', () => {
    expect(withExclude('')).toBe('# project-memory\n/.claude/progress.md\n')
    expect(withExclude('*.log')).toBe('*.log\n# project-memory\n/.claude/progress.md\n')
    expect(withExclude('a\n/.claude/progress.md\n')).toBeUndefined()
    const progress: Progress = { task: 't', state: 'blocked', next: 'n', files: ['a.ts'], session: 's', at: 0 }
    expect(renderProgress(progress, '2026-10-09 10:00', 'zh-TW')).toContain('- 狀態：卡住')
    expect(renderProgress(progress, '2026-10-09 10:00')).toContain('- State: blocked')
  })
})

// ---------- the module in an engine ----------

const DIR = '/home/u/.claude/projects/-repo/memory'
const MIN = 60_000

const ZH = '{"*":{"language":"zh-TW"}}'

function engine(on: On, replies: (string | null)[], stored: Record<string, unknown> = {}, userFile = ZH) {
  const files = new Map<string, string>([
    [`${DIR}/MEMORY.md`, '- [自己寫的](user_role.md) — 主 session 的\n'],
    // The suite asserts the zh-TW wording, so the user settings file says zh-TW unless a test gives another.
    ['/home/u/.claude/cc-mod-trimtab.json', userFile],
  ])
  const toasts: string[] = []
  const prompts: { system: string; prompt: string }[] = []
  const state = { turns: 0, tokens: 50_000, sid: 's1', rateLimits: [] as { kind: string; percentUsed: number }[] }
  const clock = mock.clock(on)
  mock.store(on, stored)
  mock.env(on, { HOME: '/home/u' })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }) as never)
  on('session.id', () => ({ value: state.sid }))
  on('session.root', () => ({ value: '/repo' }))
  on('session.repo', () => ({ value: { root: '/repo', remote: null, internal: false, name: null } }))
  on('session.turns', () => ({ value: state.turns }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: state.tokens, window: 200_000 }, rateLimits: state.rateLimits } }) as never)
  on('session.messages', () => ({
    value: [
      { role: 'user', text: '以後 commit 前都要先跑 lint', toolUses: [] },
      { role: 'assistant', text: '好', toolUses: [] },
    ],
  }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__project-memory__${e.name}` } }) as never)
  on('turn.complete', ($, e) => ({ text: e.answer }) as never)
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }) as never)
  on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('model.complete', ($, e) => {
    prompts.push({ system: e.system ?? '', prompt: e.prompt })
    const reply = replies.length > 1 ? replies.shift() : replies[0]
    if (reply === null || reply === undefined) {
      return { value: { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never
    }

    return { value: { isAnswered: true, text: reply, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  on('fs.read', ($, e) => {
    const text = files.get(e.path)
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)

    return { value: text }
  })
  on('fs.write', ($, e) => (files.set(e.path, e.text), { value: undefined }))
  on('fs.exists', ($, e) => ({ value: files.has(e.path) }))
  on('fs.list', ($, e) => ({
    value: [...files.keys()]
      .filter(p => p.startsWith(`${e.path}/`) && !p.slice(e.path.length + 1).includes('/'))
      .map(p => ({ name: p.slice(e.path.length + 1), kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })),
  }))
  on('fs.stat', ($, e) => {
    if (e.path === '/repo/.git') return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } }
    throw new Error('ENOENT')
  })
  on('process.run', ($, e) => {
    if (e.argv[0] === 'rm') files.delete(e.argv.at(-1) ?? '')

    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  return { files, toasts, prompts, state, clock }
}

const answered = { answer: 'ok', reason: 'answer', durationMs: 1, isAborted: false, turnId: 't' } as never
const typed = (text: string) => ({ text, origin: { kind: 'composer' } }) as never
const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as const
const REPLY = actions(
  { op: 'add_rule', name: 'commit 前先跑 lint', rule: '每次 commit 前執行 npm run lint', applies: 'commit 前', not_applies: '只改文件', evidence: '使用者要求' },
  { op: 'set_progress', task: '加上 lint 檢查', state: 'in_progress', next: '跑一次 lint', files: ['package.json'] },
)

test('distills every N prompts into memory files, MEMORY.md and the progress file', { options: { distill: true, distill_every: 5 } }, async ($, on) => {
  const world = engine(on, [REPLY])
  await $.session.start(START)
  world.state.turns = 4
  await $.turn.complete(answered)
  await world.clock.advance(1)
  expect(world.prompts.length).toBe(0)

  world.state.turns = 5
  await $.turn.complete(answered)
  await world.clock.advance(1)
  expect(world.prompts.length).toBe(1)
  expect(world.prompts[0]?.prompt).toContain('以後 commit 前都要先跑 lint')

  const file = [...world.files.keys()].find(p => /\/pm-rule-.*\.md$/.test(p))
  expect(world.files.get(file!)).toContain('**做法：** 每次 commit 前執行 npm run lint')
  expect(world.files.get(`${DIR}/MEMORY.md`)).toStartWith('- [自己寫的](user_role.md) — 主 session 的\n- [commit 前先跑 lint](pm-rule-')
  expect(world.files.get('/repo/.claude/progress.md')).toContain('- 下一步：跑一次 lint')
  expect(world.files.get('/repo/.git/info/exclude')).toBe('# project-memory\n/.claude/progress.md\n')
  // The first automatic distill of the session says what it sends where; the second toast is its changes.
  expect(world.toasts).toEqual([expect.stringMatching(/自動整理開始把新增的對話送給 Sonnet/), expect.stringMatching(/記憶有 \d+ 項變動/)])

  // The changes ride the person's next prompt, once.
  const first = (await $.prompt.submit(typed('下一步'))) as { context?: string[] }
  expect(first.context?.some(c => c.startsWith(TAG) && c.includes('新增規則：commit 前先跑 lint'))).toBe(true)
  const second = (await $.prompt.submit(typed('再下一步'))) as { context?: string[] }
  expect(second.context ?? []).toEqual([])
})

test('does not distill a short context every N prompts', { options: { distill: true, distill_every: 5 } }, async ($, on) => {
  const world = engine(on, [REPLY])
  await $.session.start(START)
  world.state.turns = 5
  world.state.tokens = 10_000
  await $.turn.complete(answered)
  await world.clock.advance(1)
  expect(world.prompts.length).toBe(0)
})

test('distills after ten idle minutes, whatever the context, once five prompts are new', { options: { distill: true } }, async ($, on) => {
  const world = engine(on, [REPLY])
  await $.session.start(START)
  world.state.tokens = 1_000
  world.state.turns = 4
  await $.turn.complete(answered)
  await world.clock.advance(10 * MIN)
  expect(world.prompts.length).toBe(0)

  world.state.turns = 5
  await $.turn.complete(answered)
  await world.clock.advance(9 * MIN)
  // A prompt in the meantime puts the idle timer off.
  await $.prompt.submit(typed('還在'))
  await world.clock.advance(5 * MIN)
  expect(world.prompts.length).toBe(0)
  await $.turn.complete(answered)
  await world.clock.advance(10 * MIN)
  expect(world.prompts.length).toBe(1)
})

test('takes the idle minutes from the options', { options: { distill: true, idle_minutes: 3 } }, async ($, on) => {
  const world = engine(on, [REPLY])
  await $.session.start(START)
  world.state.turns = 5
  await $.turn.complete(answered)
  await world.clock.advance(2 * MIN)
  expect(world.prompts.length).toBe(0)
  await world.clock.advance(MIN)
  expect(world.prompts.length).toBe(1)
})

test('does not distill on idling with idle_minutes 0', { options: { distill: true, idle_minutes: 0 } }, async ($, on) => {
  const world = engine(on, [REPLY])
  await $.session.start(START)
  world.state.turns = 5
  await $.turn.complete(answered)
  await world.clock.advance(200 * MIN)
  expect(world.prompts.length).toBe(0)
})

test('distills the conversation a /clear ended', { options: { distill: true } }, async ($, on) => {
  const world = engine(on, [REPLY])
  await $.session.start(START)
  world.state.turns = 5
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} } as never)
  world.state.sid = 's2'
  world.state.turns = 0
  await world.clock.advance(1)
  expect(world.prompts.length).toBe(1)
  expect(world.prompts[0]?.prompt).toContain('以後 commit 前都要先跑 lint')
  expect(world.files.get('/repo/.claude/progress.md')).toContain('session: s1')
})

test('skips the automatic distill past the usage limit, and says so in the status; run still distills', { options: { distill: true, distill_every: 5 } }, async ($, on) => {
  const world = engine(on, [REPLY])
  await $.session.start(START)
  world.state.rateLimits = [{ kind: 'five_hour', percentUsed: 85 }, { kind: 'seven_day', percentUsed: 20 }]
  world.state.turns = 5
  await $.turn.complete(answered)
  await world.clock.advance(1)
  expect(world.prompts.length).toBe(0)
  // Skipping is no failure: no first-use toast, no retry wait.
  expect(world.toasts).toEqual([])
  const status = (await $.command.run({ command: 'project-memory', args: 'status' } as never)).text
  expect(status).toContain('5 小時或 7 天額度用量超過 80% 時跳過')
  expect(status).toMatch(/最近一次跳過：.*（每 5 則：5 小時額度已用 85%，超過 80%）/)
  expect(status).toContain('還沒整理過')

  world.state.rateLimits = [{ kind: 'five_hour', percentUsed: 80 }]
  world.state.turns = 6
  await $.turn.complete(answered)
  await world.clock.advance(1)
  expect(world.prompts.length).toBe(1)
  expect((await $.command.run({ command: 'project-memory', args: 'status' } as never)).text).not.toContain('最近一次跳過')
})

test('run is not limited by usage; another window kind is not counted', { options: { max_rate_used: 50 } }, async ($, on) => {
  const world = engine(on, [REPLY])
  await $.session.start(START)
  world.state.rateLimits = [{ kind: 'seven_day', percentUsed: 99 }]
  world.state.turns = 1
  await $.command.run({ command: 'project-memory', args: 'run' } as never)
  expect(world.prompts.length).toBe(1)
})

test('drops the conversation a /clear ended while the usage is high', { options: { distill: true } }, async ($, on) => {
  const world = engine(on, [REPLY])
  await $.session.start(START)
  world.state.rateLimits = [{ kind: 'seven_day', percentUsed: 90 }, { kind: 'spend_limit', percentUsed: 120 }]
  world.state.turns = 5
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} } as never)
  await world.clock.advance(1)
  expect(world.prompts.length).toBe(0)
  expect((await $.command.run({ command: 'project-memory', args: 'status' } as never)).text).toContain('（/clear：7 天額度已用 90%，超過 80%）')
})

test('waits five prompts after a failed distill before trying again', { options: { distill: true, distill_every: 5 } }, async ($, on) => {
  const world = engine(on, [null])
  await $.session.start(START)
  for (const turns of [5, 6, 9, 10]) {
    world.state.turns = turns
    await $.turn.complete(answered)
    await world.clock.advance(1)
  }
  expect(world.prompts.length).toBe(2)
  expect(world.files.has('/repo/.claude/progress.md')).toBe(false)
})

test('/project-memory distills on demand, then reports nothing new', async ($, on) => {
  const world = engine(on, [REPLY])
  await $.session.start(START)
  world.state.turns = 1
  const ran = await $.command.run({ command: 'project-memory', args: 'run' } as never)
  expect(JSON.stringify(ran)).toContain('記憶有 1 項變動')
  const again = await $.command.run({ command: 'project-memory', args: 'run' } as never)
  expect(JSON.stringify(again)).toContain('上次整理後沒有新的對話')
})

test('asks a merge when the index runs over its cap', async ($, on) => {
  const many = Array.from({ length: INDEX_CAP + 1 }, (_, i) => mem({ file: `pm-project-${i}.md`, title: `事實 ${i}` }))
  const world = engine(on, [actions({ op: 'confirm_memory', id: 'M1', evidence: '又用上' }), actions({ op: 'delete_memory', id: 'M2', reason: '重複', superseded_by: 'M3' })])
  for (const m of many) world.files.set(`${DIR}/${m.file}`, renderMemory(m))
  await $.session.start(START)
  world.state.turns = 1
  await $.command.run({ command: 'project-memory', args: 'run' } as never)
  expect(world.prompts.length).toBe(2)
  expect(world.prompts[1]?.system).toContain(`the limit is ${INDEX_CAP}`)
  expect(world.files.get(`${DIR}/pm-project-1.md`)).toContain('superseded_by: 事實 2')
  expect((world.files.get(`${DIR}/MEMORY.md`) ?? '').split('\n').filter(l => l.includes('](pm-')).length).toBe(INDEX_CAP)
})

test('asks once per session to propose a rule for the repo, and drops its file when placed', async ($, on) => {
  const r = rule({ file: 'pm-rule-lint.md', name: 'commit 前先跑 lint', rule: '每次 commit 前執行 npm run lint', count: 3 })
  const world = engine(on, [''], { 'repo:/repo': { rules: { [r.file!]: { name: r.name, count: 3, sessions: [] } }, procedures: [], asked: {} } })
  world.files.set(`${DIR}/${r.file}`, renderRule(r))
  world.files.set(`${DIR}/MEMORY.md`, updateIndex('- [自己寫的](user_role.md) — x\n', [{ file: r.file!, title: r.name, hook: r.rule }]))
  await $.session.start(START)

  const first = (await $.prompt.submit(typed('開始'))) as { context?: string[] }
  expect(first.context?.some(c => c.includes('Rule "commit 前先跑 lint" (confirmed in 3 sessions)') && c.includes('Write it only after the user agrees'))).toBe(true)
  const second = (await $.prompt.submit(typed('繼續'))) as { context?: string[] }
  expect(second.context ?? []).toEqual([])

  const done = await $.tool.call({ tool: 'mcp__project-memory__mark_in_project', items: [{ rule: r.name, where: 'CLAUDE.md' }] } as never)
  expect(JSON.stringify(done.result)).toContain('已在 CLAUDE.md')
  expect(world.files.has(`${DIR}/${r.file}`)).toBe(false)
  expect(world.files.get(`${DIR}/MEMORY.md`)).toBe('- [自己寫的](user_role.md) — x\n')
  // A new distill sees the rule as placed, with no file of its own.
  world.state.turns = 1
  await $.command.run({ command: 'project-memory', args: 'run' } as never)
  expect(world.prompts[0]?.system).toContain('R1 commit 前先跑 lint | confirmed in 3 sessions | 每次 commit 前執行 npm run lint | 已在 CLAUDE.md')
})

test('/project-memory set turns distilling off; status shows the memory and the settings', async ($, on) => {
  const world = engine(on, [REPLY])
  await $.session.start(START)
  const run = async (args: string) => (await $.command.run({ command: 'project-memory', args } as never)).text
  expect(await run('set distill off')).toMatch(/distill 現在是 false（來自 session）/)
  const status = await run('status')
  expect(status).toMatch(/^自動整理：關/)
  expect(status).toMatch(/distill = false {2}\[session\] {2}花費，repo 只能關閉/)
  world.state.turns = 30
  await $.turn.complete(answered)
  await world.clock.advance(1)
  expect(world.prompts.length).toBe(0)
  expect(await run('')).toMatch(/^用法/)
})

test('distilling is off by default; /project-memory on turns it on for a while, with a line above the prompt', async ($, on) => {
  const world = engine(on, [REPLY])
  // Another plugin's band beneath: it stays under the line.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>band beneath</Text>
  })
  await $.session.start(START)
  const run = async (args: string) => (await $.command.run({ command: 'project-memory', args } as never)).text
  world.state.turns = 30
  await $.turn.complete(answered)
  await world.clock.advance(1)
  expect(world.prompts.length).toBe(0)

  expect(await run('on 1h')).toMatch(/^distill 臨時開啟 1h（到 \d\d:\d\d），到期或 session 結束自動關；關閉：\/project-memory off$/)
  const band = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } } as const
  const ui = await $.ui.mount({ plugin: 'project-memory', surface: 'terminal', ...band } as never)
  expect(await ui.find({ type: 'Text', text: 'project-memory on · distill 1h' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'band beneath' })).toBeDefined()
  await ui.unmount()
  await $.turn.complete(answered)
  await world.clock.advance(1)
  expect(world.prompts.length).toBe(1)

  await world.clock.advance(60 * 60_000)
  expect(await run('status')).toMatch(/distill = false {2}\[預設\]/)
  const gone = await $.ui.mount({ plugin: 'project-memory', surface: 'terminal', ...band } as never)
  expect(await gone.find({ type: 'Text', text: /project-memory on/ })).toBeUndefined()
  await gone.unmount()
})

test('the wording is English by default, and the distill prompt names the language the notes are written in', async ($, on) => {
  const world = engine(on, [REPLY], {}, '')
  await $.session.start(START)
  world.state.turns = 1
  const ran = await $.command.run({ command: 'project-memory', args: 'run' } as never)
  expect(JSON.stringify(ran)).toContain('1 change(s) to the memory')
  expect(world.prompts[0]?.system).toContain('Write in English.')
  expect(world.prompts[0]?.system).not.toContain('Write in Traditional Chinese')
  expect(world.prompts[0]?.system).not.toMatch(/[\u4e00-\u9fff]/)
  const file = [...world.files.keys()].find(p => /\/pm-rule-.*\.md$/.test(p))
  expect(world.files.get(file!)).toContain('**How:** 每次 commit 前執行 npm run lint')
  expect(world.files.get('/repo/.claude/progress.md')).toContain('- Next step: 跑一次 lint')
  expect(world.files.get('/repo/.claude/progress.md')).toContain('# Progress (')
  expect((await $.command.run({ command: 'project-memory', args: '' } as never)).text).toMatch(/^Usage: /)
})

test('with zh-TW the distill prompt asks for Traditional Chinese and stays English otherwise', async ($, on) => {
  const world = engine(on, [REPLY])
  await $.session.start(START)
  world.state.turns = 1
  await $.command.run({ command: 'project-memory', args: 'run' } as never)
  expect(world.prompts[0]?.system).toContain('Write in Traditional Chinese (zh-TW).')
  expect(world.prompts[0]?.system).not.toContain('Write in English.')
  expect(world.prompts[0]?.system).not.toMatch(/[\u4e00-\u9fff]/)
})
