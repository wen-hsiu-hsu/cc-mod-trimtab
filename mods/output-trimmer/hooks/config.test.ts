import type { On } from 'claude-code'
import { describe, expect, mock, test, type Engine } from 'claude-code/testing'

import {
  LANGUAGE,
  applyRepoRule,
  fmtLeft,
  nextExpiry,
  onLine,
  parseDuration,
  parseOnArgs,
  parseInput,
  parseSetArgs,
  resolve,
  statusText,
  withLocalExclude,
  withSetting,
  type KeySpec,
  type Specs,
} from './config'
import { SPECS } from './register'
import { trim } from './trim'

const SPEC: Specs = {
  guard: { category: 'protect', type: 'boolean', default: false, repo: 'only-true', description: 'g' },
  rules: { category: 'protect', type: 'list', default: ['a'], repo: 'append', description: 'r' },
  skip: { category: 'protect', type: 'list', default: [], repo: 'never', description: 's' },
  model: { category: 'cost', type: 'boolean', default: false, repo: 'only-false', description: 'm' },
  every: { category: 'cost', type: 'number', default: 30, repo: 'only-higher', min: 5, max: 200, description: 'e' },
  lines: { category: 'plain', type: 'number', default: 150, repo: 'any', min: 50, max: 5000, description: 'l' },
  mode: { category: 'plain', type: 'string', default: 'suggest', repo: 'any', choices: ['suggest', 'off'], description: 'o' },
  language: LANGUAGE,
}

// These tests assert the zh-TW wording, so the user layer says zh-TW.
const none = { options: {}, user: { language: 'zh-TW' }, repo: {}, local: {}, session: {} }
const ZH_FILE = '{"*":{"language":"zh-TW"}}'

describe('config', () => {
  test('reads durations for /<mod> on, up to a day', () => {
    expect(parseDuration('2h')).toBe(2 * 3_600_000)
    expect(parseDuration('90m')).toBe(90 * 60_000)
    expect(parseDuration('1h30m')).toBe(90 * 60_000)
    expect(parseDuration('45')).toBe(45 * 60_000)
    for (const bad of ['', '0m', '25h', '3d', 'h', 'soon']) {
      expect(parseDuration(bad)).toBeUndefined()
    }
  })

  test('formats the time left and the band line', () => {
    expect(fmtLeft(102 * 60_000)).toBe('1h42m')
    expect(fmtLeft(2 * 3_600_000)).toBe('2h')
    expect(fmtLeft(36.5 * 60_000)).toBe('37m')
    expect(fmtLeft(30_000)).toBe('<1m')
    expect(onLine('session-keeper', { keep_warm: 102 * 60_000, away_handoff: 30 * 60_000 }, 0)).toBe('session-keeper on · keep_warm 1h42m · away_handoff 30m')
    expect(onLine('session-keeper', { keep_warm: 10 }, 10)).toBe('')
    expect(onLine('session-keeper', {}, 0)).toBe('')
  })

  test('reads the feature and the duration of /<mod> on in either order', () => {
    const one: Specs = { distill: { ...SPEC.model, toggle: { on: true, off: false } } as KeySpec }
    const two: Specs = { ...one, gate: { ...SPEC.mode, toggle: { on: 'suggest', off: 'off' } } as KeySpec }
    expect(parseOnArgs(one, '', true)).toEqual({ key: 'distill', ms: 2 * 3_600_000 })
    expect(parseOnArgs(two, '30m gate', true)).toEqual({ key: 'gate', ms: 30 * 60_000 })
    expect(parseOnArgs(two, '30m', true, 'zh-TW')).toEqual({ error: '要指定功能：distill、gate' })
    expect(parseOnArgs(two, 'gate 30m', false)).toHaveProperty('error')
    expect(parseOnArgs(two, 'gate gate', true)).toHaveProperty('error')
  })

  test('keeps the end of a value /<mod> on set only while that value wins', () => {
    const r = resolve(SPEC, { ...none, session: { model: true }, until: { model: 5_000, lines: 9_000 } })
    expect(r.values.model).toBe(true)
    expect(r.until).toEqual({ model: 5_000 })
    expect(nextExpiry(r)).toBe(5_000)
    expect(nextExpiry(resolve(SPEC, none))).toBeUndefined()
  })

  test('higher layers win: session > local > repo > user > default', () => {
    expect(resolve(SPEC, none).values.lines).toBe(150)
    const r = resolve(SPEC, { options: { lines: 200 }, user: { language: 'zh-TW' }, repo: { lines: 300 }, local: { lines: 400 }, session: { lines: 500 } })
    expect(r.values.lines).toBe(500)
    expect(r.sources.lines).toBe('session')
    expect(resolve(SPEC, { ...none, options: { lines: 200 }, repo: { lines: 300 } }).sources.lines).toBe('repo')
    // `/config` hands over its defaults; they are not the person's choice.
    expect(resolve(SPEC, { ...none, options: { lines: 150 } }).sources.lines).toBe('default')
  })

  test('the repo file only tightens protections and only cuts spending', () => {
    const tight = resolve(SPEC, { ...none, repo: { guard: true, rules: ['b'], skip: ['/x'], model: true, every: 10 } })
    expect(tight.values.guard).toBe(true)
    expect(tight.values.rules).toEqual(['a', 'b'])
    expect(tight.values.skip).toEqual([])
    expect(tight.values.model).toBe(false)
    expect(tight.values.every).toBe(30)
    expect(tight.ignored.map(item => item.key).sort()).toEqual(['every', 'model', 'skip'])

    // Over the person's own choice: a repo cannot switch their guard off, but local can.
    const loose = resolve(SPEC, { ...none, options: { guard: true, model: true }, repo: { guard: false, model: false } })
    expect(loose.values.guard).toBe(true)
    expect(loose.values.model).toBe(false)
    expect(resolve(SPEC, { ...none, options: { guard: true }, local: { guard: false } }).values.guard).toBe(false)
  })

  test('applies each repo rule against the value below', () => {
    const spec = (repo: KeySpec['repo']): KeySpec => ({ category: 'plain', type: 'number', default: 0, repo, description: '' })
    expect(applyRepoRule(spec('only-lower'), 10, 5)).toEqual({ value: 5 })
    expect(applyRepoRule(spec('only-lower'), 10, 20)).toHaveProperty('error')
    expect(applyRepoRule(spec('never'), 10, 10)).toHaveProperty('error')
  })

  test('ignores values of the wrong type and unknown keys', () => {
    const r = resolve(SPEC, { ...none, local: { lines: 'many', nope: 1 }, session: { mode: 'loud' } })
    expect(r.values.lines).toBe(150)
    expect(r.values.mode).toBe('suggest')
    expect(r.ignored.map(item => `${item.layer}:${item.key}`).sort()).toEqual(['local:lines', 'local:nope', 'session:mode'])
    // Single values come from `/config`; the user file holds lists.
    const user = resolve(SPEC, { ...none, user: { ...none.user, lines: 300, rules: ['b'] } })
    expect(user.values.lines).toBe(150)
    expect(user.values.rules).toEqual(['b'])
    expect(user.ignored).toEqual([{ key: 'lines', layer: 'user', reason: '使用者設定檔只放清單，單一值用 /config' }])
  })

  test('reads typed values', () => {
    expect(parseInput(SPEC.guard as KeySpec, 'on')).toEqual({ value: true })
    expect(parseInput(SPEC.guard as KeySpec, 'maybe')).toHaveProperty('error')
    expect(parseInput(SPEC.lines as KeySpec, '20')).toHaveProperty('error')
    // A pattern's commas stay in it; several items take a JSON array.
    expect(parseInput(SPEC.rules as KeySpec, 'AKIA[0-9]{16,20}')).toEqual({ value: ['AKIA[0-9]{16,20}'] })
    expect(parseInput(SPEC.rules as KeySpec, '["a,b", "c"]')).toEqual({ value: ['a,b', 'c'] })
    expect(parseSetArgs('lines 300 --repo')).toEqual({ key: 'lines', rest: '300', target: 'repo' })
    expect(parseSetArgs('lines 300')).toMatchObject({ target: 'session' })
    expect(parseSetArgs('rules a  b --local')).toEqual({ key: 'rules', rest: 'a  b', target: 'local' })
    expect(parseSetArgs('rules --x')).toEqual({ key: 'rules', rest: '--x', target: 'session' })
    expect(parseSetArgs('lines 1 --repo --local')).toHaveProperty('error')
  })

  test('edits one key of one mod in a shared file', () => {
    const text = withSetting('{"other":{"k":1}}', 'me', 'lines', 300)
    expect(JSON.parse(text)).toEqual({ other: { k: 1 }, me: { lines: 300 } })
    expect(JSON.parse(withSetting(text, 'me', 'lines', undefined))).toEqual({ other: { k: 1 } })
    expect(withLocalExclude('')).toContain('/.claude/cc-mod-trimtab.local.json')
    expect(withLocalExclude('/.claude/cc-mod-trimtab.local.json\n')).toBeUndefined()
  })

  test('lists every key with its value, source and repo rule', () => {
    const text = statusText('me', SPEC, resolve(SPEC, { ...none, repo: { model: true } }))
    expect(text).toMatch(/model = false {2}\[預設\] {2}花費，repo 只能關閉/)
    expect(text).toMatch(/已忽略：\n {2}repo 的 model：花費類，repo 檔案只能關閉/)
    expect(statusText('me', {}, resolve({}, none))).toBe('me 沒有可調的設定。')
  })
})

test('trims at the configured limits', () => {
  const lines = Array.from({ length: 120 }, (_, i) => `line ${i}`).join('\n')
  expect(trim(lines, '/tmp/x.log')).toBeUndefined()
  expect(trim(lines, '/tmp/x.log', { maxLines: 100, maxChars: 15000 })).toBeDefined()
})

test('the trimmed note follows the language', () => {
  const lines = Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\n')
  expect(trim(lines, '/tmp/x.log')?.text).toContain('The output was 300 lines')
  expect(trim(lines, '/tmp/x.log', undefined, 'zh-TW')?.text).toContain('原輸出 300 行')
})

// ---------- through the engine ----------

function world(on: On) {
  const files = new Map<string, string>([['/home/.claude/cc-mod-trimtab.json', ZH_FILE]])
  mock.store(on)
  mock.env(on, { HOME: '/home' })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('session.root', () => ({ value: '/repo' }))
  on('session.repo', () => ({ value: { root: '/repo', remote: null, internal: false, name: null } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.log', () => ({ value: undefined }))
  on('fs.read', ($, e) => {
    const text = files.get(e.path)
    if (text === undefined) {
      throw new Error('ENOENT')
    }

    return { value: text }
  })
  on('fs.write', ($, e) => {
    files.set(e.path, e.text)

    return { value: undefined }
  })
  on('fs.stat', () => ({ value: { kind: 'dir' } }) as never)

  return files
}

const run = (args: string) => ({ command: 'output-trimmer', args }) as never

test('/output-trimmer set writes the chosen layer and status shows it', async ($, on) => {
  const files = world(on)
  files.set('/repo/.claude/cc-mod-trimtab.json', '{"output-trimmer":{"max_lines":400}}')
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  expect((await $.command.run(run('status'))).text).toMatch(/max_lines = 400 {2}\[repo\]/)

  expect((await $.command.run(run('set max_lines 300 --local'))).text).toMatch(/已設定（\.claude\/cc-mod-trimtab\.local\.json）。max_lines 現在是 300（來自 local）/)
  expect(JSON.parse(files.get('/repo/.claude/cc-mod-trimtab.local.json') ?? '')).toEqual({ 'output-trimmer': { max_lines: 300 } })
  expect(files.get('/repo/.git/info/exclude')).toContain('/.claude/cc-mod-trimtab.local.json')

  expect((await $.command.run(run('set max_lines 250'))).text).toMatch(/只在這個 session）。max_lines 現在是 250（來自 session）/)
  expect((await $.command.run(run('unset max_lines'))).text).toMatch(/max_lines 現在是 300（來自 local）/)

  expect((await $.command.run(run('set max_lines 10'))).text).toMatch(/max_lines 要在 50 到 5000 之間/)
  expect((await $.command.run(run('set nope 1'))).text).toMatch(/沒有 nope 這個設定/)
  expect((await $.command.run(run('set constructor 1'))).text).toMatch(/沒有 constructor 這個設定/)
  expect((await $.command.run(run(''))).text).toMatch(/^用法/)
  expect(Object.keys(SPECS)).toEqual(['max_lines', 'max_chars', 'language'])
})

test('a broken settings file is reported and skipped', async ($, on) => {
  const files = world(on)
  files.set('/repo/.claude/cc-mod-trimtab.json', '{oops')
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  expect((await $.command.run(run('status'))).text).toMatch(/max_lines = 150 {2}\[預設\][\s\S]*repo 的 \/repo\/\.claude\/cc-mod-trimtab\.json：JSON 格式不對/)
})

async function started($: Engine, on: On, files: Record<string, string>) {
  const written = world(on)
  written.clear()
  for (const [path, text] of Object.entries(files)) {
    written.set(path, text)
  }
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  return written
}

test('the language is English until a file says otherwise', async ($, on) => {
  await started($, on, {})
  const status = (await $.command.run(run('status'))).text ?? ''
  expect(status).toMatch(/^output-trimmer settings \(precedence: session > local > repo > user > default\)/)
  expect(status).toMatch(/language = en {2}\[default\] {2}general, repo may not set/)
  expect((await $.command.run(run('set max_lines 10'))).text).toBe('max_lines must be between 50 and 5000')
  expect((await $.command.run(run(''))).text).toMatch(/^Usage: /)
})

test('"*" in the user file sets the language for the mod; the mod section wins over it', async ($, on) => {
  const files = await started($, on, { '/home/.claude/cc-mod-trimtab.json': '{"*":{"language":"zh-TW"}}' })
  expect((await $.command.run(run('status'))).text).toMatch(/language = zh-TW {2}\[使用者\]/)
  files.set('/home/.claude/cc-mod-trimtab.json', '{"*":{"language":"zh-TW"},"output-trimmer":{"language":"en"}}')
  const status = (await $.command.run(run('status'))).text ?? ''
  expect(status).toMatch(/^output-trimmer settings/)
  expect(status).not.toMatch(/Ignored/)
})

test('a single language value is accepted in the user file, in the mod section too', async ($, on) => {
  await started($, on, { '/home/.claude/cc-mod-trimtab.json': '{"output-trimmer":{"language":"zh-TW"}}' })
  const status = (await $.command.run(run('status'))).text ?? ''
  expect(status).toMatch(/language = zh-TW {2}\[使用者\]/)
  expect(status).not.toMatch(/已忽略/)
})

test('the repo file cannot set the language, "*" included, and other "*" keys are listed as ignored', async ($, on) => {
  await started($, on, { '/repo/.claude/cc-mod-trimtab.json': '{"*":{"language":"zh-TW","max_lines":100}}' })
  const status = (await $.command.run(run('status'))).text ?? ''
  expect(status).toMatch(/language = en {2}\[default\]/)
  expect(status).toContain('language in repo: the repo file may not set it; use the local file')
  expect(status).toContain('*.max_lines in repo: only language is read from "*"')
})

test('/output-trimmer set language switches the wording for this session; --repo is refused', async ($, on) => {
  const files = await started($, on, {})
  expect((await $.command.run(run('set language zh-TW'))).text).toBe('已設定（只在這個 session）。language 現在是 zh-TW（來自 session）')
  expect((await $.command.run(run('set language zh-TW --repo'))).text).toBe('沒有寫入：repo 檔案不能設定，改用 local 檔案')
  expect((await $.command.run(run('set language en --repo'))).text).toBe('沒有寫入：repo 檔案不能設定，改用 local 檔案')
  expect(files.has('/repo/.claude/cc-mod-trimtab.json')).toBe(false)
  expect((await $.command.run(run('set language fr'))).text).toBe('language 要是 en、zh-TW 之一')
})
