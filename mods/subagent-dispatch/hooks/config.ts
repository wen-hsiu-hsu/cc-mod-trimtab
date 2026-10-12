// Layered settings, shared by every mod: the same file sits in each mod's hooks folder (a mod
// cannot import outside its own folder), and scripts/check-copies.sh keeps the copies equal.
//
// Precedence, highest first: session (`/<mod> set --session`), `.claude/cc-mod-trimtab.local.json`,
// `.claude/cc-mod-trimtab.json` (committed, held to each key's repo rule), the user layer
// (`/config` for single values, `~/.claude/cc-mod-trimtab.json` for lists), the default.
// Every file holds `{ "<mod>": { "<key>": value } }`, and may hold a `"*"` section beside them: of
// that one only `language` is read, as the value every mod shares (a mod's own section wins).
//
// A feature that spends tokens is a key with a `toggle`: `/<mod> on [feature] [duration]` sets its
// session value until a time (2h by default), `/<mod> off [feature]` takes it back.

import type { PluginOptions } from 'claude-code'

export type Value = boolean | number | string | readonly string[]

// The language of everything shown on screen. Text for the model is English whatever this is.
export type Lang = 'en' | 'zh-TW'

export type Text = Readonly<Record<Lang, string>>

export function pick(lang: Lang, text: Text): string {
  return text[lang]
}

// A description is one string (tests) or a pair.
export function say(lang: Lang, text: string | Text): string {
  return typeof text === 'string' ? text : text[lang]
}

// Where the model writes for the person (memories, handoffs), the prompt names the language.
export function writeIn(lang: Lang): string {
  return lang === 'zh-TW' ? 'Write in Traditional Chinese (zh-TW).' : 'Write in English.'
}

export type Layer = 'default' | 'user' | 'repo' | 'local' | 'session'

// What the committed repo file may do: a clone must not loosen a protection or switch on spending.
// `append` adds to the list below it; `never` leaves the key to the person's own layers.
export type RepoRule = 'any' | 'only-true' | 'only-false' | 'only-lower' | 'only-higher' | 'append' | 'never'

export type Category = 'protect' | 'cost' | 'plain'

export type KeySpec = {
  category: Category
  type: 'boolean' | 'number' | 'string' | 'list'
  default: Value
  repo: RepoRule
  description: string | Text
  min?: number
  max?: number
  // The values a string may take.
  choices?: readonly string[]
  // A feature `/<mod> on|off` switches: the value each one sets.
  toggle?: { on: Value; off: Value }
}

export type Specs = Readonly<Record<string, KeySpec>>

// The key every mod has: the language of what it shows. One value may stand for all mods in a
// settings file's `"*"` section. It is the person's own taste, so the repo file cannot set it.
export const LANGUAGE: KeySpec = {
  category: 'plain',
  type: 'string',
  default: 'en',
  repo: 'never',
  choices: ['en', 'zh-TW'],
  description: {
    en: 'Language of what this mod shows: en or zh-TW. Put {"*": {"language": "..."}} in a settings file to set it for every mod.',
    'zh-TW': '這個 mod 顯示的語言：en 或 zh-TW。在設定檔放 {"*": {"language": "..."}} 可一次設定所有 mod。',
  },
}

export type Ignored = { key: string; layer: Layer; reason: string }

export type Resolved = {
  // The language the values come to (`language`, English without it).
  lang: Lang
  values: Readonly<Record<string, Value>>
  sources: Readonly<Record<string, Layer>>
  ignored: readonly Ignored[]
  // When each key switched on by `/<mod> on` goes back, for the keys whose value it decides.
  until: Readonly<Record<string, number>>
}

export type Target = 'session' | 'local' | 'repo'

type Raw = Readonly<Record<string, unknown>>

export type Layers = {
  options: PluginOptions
  user: Raw
  repo: Raw
  local: Raw
  session: Raw
  // When the session values set by `/<mod> on` run out; the expired ones are left out already.
  until?: Readonly<Record<string, number>>
}

export const REPO_FILE = '.claude/cc-mod-trimtab.json'
export const LOCAL_FILE = '.claude/cc-mod-trimtab.local.json'
const USER_FILE = 'cc-mod-trimtab.json'
// Both keyed by session id: `$.store` is one file every session of the mod shares.
const SESSION_KEY = 'config-sessions'
const NOTICED_KEY = 'config-noticed-sessions'
// The settings files' section for what every mod shares.
const SHARED = '*'

const DEFAULT_ON_MS = 2 * 3_600_000
const MAX_ON_MS = 24 * 3_600_000
// A session's entries are dropped once nothing wrote them for this long.
const KEEP_SESSION_MS = 7 * 86_400_000

const LAYER_NAMES: Readonly<Record<Layer, Text>> = {
  default: { en: 'default', 'zh-TW': '預設' },
  user: { en: 'user', 'zh-TW': '使用者' },
  repo: { en: 'repo', 'zh-TW': 'repo' },
  local: { en: 'local', 'zh-TW': 'local' },
  session: { en: 'session', 'zh-TW': 'session' },
}

const CATEGORY_NAMES: Readonly<Record<Category, Text>> = {
  protect: { en: 'protection', 'zh-TW': '保護' },
  cost: { en: 'cost', 'zh-TW': '花費' },
  plain: { en: 'general', 'zh-TW': '一般' },
}

const RULE_NAMES: Readonly<Record<RepoRule, Text>> = {
  any: { en: 'repo may set freely', 'zh-TW': 'repo 可自由設定' },
  'only-true': { en: 'repo may only turn on', 'zh-TW': 'repo 只能開啟' },
  'only-false': { en: 'repo may only turn off', 'zh-TW': 'repo 只能關閉' },
  'only-lower': { en: 'repo may only lower', 'zh-TW': 'repo 只能調低' },
  'only-higher': { en: 'repo may only raise', 'zh-TW': 'repo 只能調高' },
  append: { en: 'repo may only add items', 'zh-TW': 'repo 只能加項目' },
  never: { en: 'repo may not set', 'zh-TW': 'repo 不能設定' },
}

function langOf(value: unknown): Lang {
  return value === 'zh-TW' ? 'zh-TW' : 'en'
}

function listOf(lang: Lang, items: readonly string[]): string {
  return items.join(lang === 'zh-TW' ? '、' : ', ')
}

// ---------- pure ----------

// A stored value of the key's type, or why it is not one.
export function parseValue(spec: KeySpec, raw: unknown, lang: Lang = 'en'): { value: Value } | { error: string } {
  switch (spec.type) {
    case 'boolean':
      return typeof raw === 'boolean' ? { value: raw } : { error: pick(lang, { en: 'must be true or false', 'zh-TW': '要是 true 或 false' }) }
    case 'number': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return { error: pick(lang, { en: 'must be a number', 'zh-TW': '要是數字' }) }
      }
      if ((spec.min !== undefined && raw < spec.min) || (spec.max !== undefined && raw > spec.max)) {
        const min = spec.min ?? '-∞'
        const max = spec.max ?? '∞'

        return { error: pick(lang, { en: `must be between ${min} and ${max}`, 'zh-TW': `要在 ${min} 到 ${max} 之間` }) }
      }

      return { value: raw }
    }
    case 'string':
      if (typeof raw !== 'string') {
        return { error: pick(lang, { en: 'must be a string', 'zh-TW': '要是字串' }) }
      }
      if (spec.choices !== undefined && !spec.choices.includes(raw)) {
        return { error: pick(lang, { en: `must be one of ${listOf(lang, spec.choices)}`, 'zh-TW': `要是 ${listOf(lang, spec.choices)} 之一` }) }
      }

      return { value: raw }
    case 'list':
      return Array.isArray(raw) && raw.every(item => typeof item === 'string')
        ? { value: raw as readonly string[] }
        : { error: pick(lang, { en: 'must be an array of strings', 'zh-TW': '要是字串陣列' }) }
  }
}

// A value typed after `/<mod> set <key>`: on/off for booleans; for lists a JSON array, or the
// whole text as one item (commas are common in a pattern, so they do not split).
export function parseInput(spec: KeySpec, text: string, lang: Lang = 'en'): { value: Value } | { error: string } {
  const t = text.trim()
  switch (spec.type) {
    case 'boolean': {
      const on = ['true', 'on', 'yes', '1'].includes(t.toLowerCase())
      const off = ['false', 'off', 'no', '0'].includes(t.toLowerCase())

      return on || off ? { value: on } : { error: pick(lang, { en: 'must be on or off', 'zh-TW': '要是 on 或 off' }) }
    }
    case 'number':
      return parseValue(spec, t === '' ? Number.NaN : Number(t), lang)
    case 'string':
      return parseValue(spec, t, lang)
    case 'list': {
      if (t.startsWith('[')) {
        try {
          return parseValue(spec, JSON.parse(t), lang)
        } catch {
          return { error: pick(lang, { en: 'not a valid JSON array', 'zh-TW': 'JSON 陣列格式不對' }) }
        }
      }

      return { value: t === '' ? [] : [t] }
    }
  }
}

function same(a: Value, b: Value): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// What the repo file's value comes to over the one below it, or why it is ignored.
export function applyRepoRule(spec: KeySpec, below: Value, value: Value, lang: Lang = 'en'): { value: Value } | { error: string } {
  // `never` refuses even the value below it, so `set --repo` cannot write the key at all.
  if (spec.repo !== 'never' && (same(below, value) || spec.repo === 'any')) {
    return { value }
  }
  switch (spec.repo) {
    case 'only-true':
      return value === true ? { value } : { error: pick(lang, { en: 'protection key: the repo file may only turn it on', 'zh-TW': '保護類，repo 檔案只能開啟' }) }
    case 'only-false':
      return value === false ? { value } : { error: pick(lang, { en: 'cost key: the repo file may only turn it off', 'zh-TW': '花費類，repo 檔案只能關閉' }) }
    case 'only-lower':
      return (value as number) < (below as number) ? { value } : { error: pick(lang, { en: 'the repo file may only lower it', 'zh-TW': 'repo 檔案只能調低' }) }
    case 'only-higher':
      return (value as number) > (below as number) ? { value } : { error: pick(lang, { en: 'the repo file may only raise it', 'zh-TW': 'repo 檔案只能調高' }) }
    case 'append':
      return { value: [...new Set([...(below as readonly string[]), ...(value as readonly string[])])] }
    case 'never':
      return { error: pick(lang, { en: 'the repo file may not set it; use the local file', 'zh-TW': 'repo 檔案不能設定，改用 local 檔案' }) }
  }
}

// The one key whose user layer is the settings file, single value or not: `/config` cannot hold
// a value shared by every mod.
function isFileValue(key: string, spec: KeySpec): boolean {
  return spec.type === 'list' || key === 'language'
}

function resolveKey(key: string, spec: KeySpec, layers: Layers, lang: Lang, ignored: Ignored[]): { value: Value; source: Layer } {
  let value = spec.default
  let source: Layer = 'default'
  const take = (layer: Layer, raw: unknown) => {
    if (raw === undefined) {
      return
    }
    const parsed = parseValue(spec, raw, lang)
    if ('error' in parsed) {
      ignored.push({ key, layer, reason: parsed.error })

      return
    }
    const applied = layer === 'repo' ? applyRepoRule(spec, value, parsed.value, lang) : parsed
    if ('error' in applied) {
      ignored.push({ key, layer, reason: applied.error })

      return
    }
    if (layer === 'user' && same(applied.value, spec.default)) {
      // `/config` hands over defaults filled in: the same value is no choice of the person's.
      return
    }
    value = applied.value
    source = layer
  }
  // Lists have no `/config` row; their user layer is the file.
  take('user', isFileValue(key, spec) ? layers.user[key] : layers.options[key])
  take('repo', layers.repo[key])
  take('local', layers.local[key])
  take('session', layers.session[key])

  return { value, source }
}

export function resolve(specs: Specs, layers: Layers): Resolved {
  const values: Record<string, Value> = {}
  const sources: Record<string, Layer> = {}
  const ignored: Ignored[] = []
  // The language first: the other keys' reasons are worded in it.
  const languageSpec = Object.hasOwn(specs, 'language') ? (specs.language as KeySpec) : LANGUAGE
  const lang = langOf(resolveKey('language', languageSpec, layers, 'en', []).value)
  for (const [key, spec] of Object.entries(specs)) {
    const one = resolveKey(key, spec, layers, lang, ignored)
    values[key] = one.value
    sources[key] = one.source
  }
  for (const layer of ['user', 'repo', 'local', 'session'] as const) {
    for (const key of Object.keys(layers[layer])) {
      const spec = Object.hasOwn(specs, key) ? specs[key] : undefined
      if (spec === undefined) {
        ignored.push({ key, layer, reason: pick(lang, { en: 'no such setting', 'zh-TW': '沒有這個設定' }) })
      } else if (layer === 'user' && !isFileValue(key, spec)) {
        ignored.push({
          key,
          layer,
          reason: pick(lang, { en: 'the user settings file holds lists only; use /config for a single value', 'zh-TW': '使用者設定檔只放清單，單一值用 /config' }),
        })
      }
    }
  }

  const until: Record<string, number> = {}
  for (const [key, at] of Object.entries(layers.until ?? {})) {
    if (sources[key] === 'session' && Object.hasOwn(layers.session, key)) {
      until[key] = at
    }
  }

  return { lang, values, sources, ignored, until }
}

// `2h`, `90m`, `1h30m`, or a bare number of minutes.
export function parseDuration(text: string): number | undefined {
  const t = text.trim().toLowerCase()
  const match = /^(?:(\d+)h)?(?:(\d+)m?)?$/.exec(t)
  if (t === '' || match === null || (match[1] === undefined && match[2] === undefined)) {
    return undefined
  }
  const ms = Number(match[1] ?? 0) * 3_600_000 + Number(match[2] ?? 0) * 60_000

  return ms > 0 && ms <= MAX_ON_MS ? ms : undefined
}

// `1h42m`, `37m`, `<1m`.
export function fmtLeft(ms: number): string {
  const minutes = Math.ceil(ms / 60_000)
  if (ms < 60_000) {
    return '<1m'
  }
  const h = Math.floor(minutes / 60)
  const m = minutes % 60

  return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h${m}m`
}

// The band line while a feature is on for a while: `<mod> on · keep_warm 1h42m`, '' when none is.
export function onLine(mod: string, until: Readonly<Record<string, number>>, now: number): string {
  const parts = Object.entries(until)
    .filter(([, at]) => at > now)
    .map(([key, at]) => `${key} ${fmtLeft(at - now)}`)

  return parts.length === 0 ? '' : [`${mod} on`, ...parts].join(' · ')
}

// When the first of the features switched on for a while goes back.
export function nextExpiry(resolved: Resolved): number | undefined {
  const times = Object.values(resolved.until)

  return times.length === 0 ? undefined : Math.min(...times)
}

function show(value: Value): string {
  return Array.isArray(value) ? (value.length === 0 ? '[]' : value.join(', ')) : String(value)
}

export function statusText(mod: string, specs: Specs, resolved: Resolved, now = 0): string {
  const lang = resolved.lang
  const keys = Object.keys(specs)
  if (keys.length === 0) {
    return pick(lang, { en: `${mod} has no settings.`, 'zh-TW': `${mod} 沒有可調的設定。` })
  }
  const lines = [
    pick(lang, {
      en: `${mod} settings (precedence: session > local > repo > user > default)`,
      'zh-TW': `${mod} 設定（優先：session > local > repo > 使用者 > 預設）`,
    }),
  ]
  for (const key of keys) {
    const spec = specs[key] as KeySpec
    const value = resolved.values[key] as Value
    const source = resolved.sources[key] as Layer
    const at = resolved.until[key]
    const left = at === undefined ? '' : pick(lang, { en: `, on temporarily for ${fmtLeft(at - now)}`, 'zh-TW': `，臨時開啟剩 ${fmtLeft(at - now)}` })
    const kind = pick(lang, CATEGORY_NAMES[spec.category])
    const rule = pick(lang, RULE_NAMES[spec.repo])
    lines.push(`  ${key} = ${show(value)}  [${pick(lang, LAYER_NAMES[source])}${left}]  ${kind}${lang === 'zh-TW' ? '，' : ', '}${rule}`)
    lines.push(`    ${say(lang, spec.description)}`)
  }
  if (resolved.ignored.length > 0) {
    lines.push(pick(lang, { en: 'Ignored:', 'zh-TW': '已忽略：' }))
    for (const item of resolved.ignored) {
      const layer = pick(lang, LAYER_NAMES[item.layer])
      lines.push(pick(lang, { en: `  ${item.key} in ${layer}: ${item.reason}`, 'zh-TW': `  ${layer} 的 ${item.key}：${item.reason}` }))
    }
  }
  lines.push(
    pick(lang, {
      en: `Change: /${mod} set <key> <value> [--session|--local|--repo] (default --session); revert: /${mod} unset <key> [same flags]`,
      'zh-TW': `改值：/${mod} set <key> <value> [--session|--local|--repo]（預設 --session），還原：/${mod} unset <key> [同上]`,
    }),
  )
  const toggles = toggleKeys(specs)
  if (toggles.length > 0) {
    const names = listOf(lang, toggles)
    const feature = toggles.length === 1 ? '' : pick(lang, { en: ' <feature>', 'zh-TW': ' <功能>' })
    lines.push(
      pick(lang, {
        en: `Features that use the model (${names}): /${mod} on${feature} [duration, default 2h] turns one on for a while, /${mod} off${feature} turns it off`,
        'zh-TW': `用模型的功能（${names}）：/${mod} on${feature} [時長，預設 2h] 臨時開啟，/${mod} off${feature} 關閉`,
      }),
    )
  }

  return lines.join('\n')
}

function modSection(text: string, mod: string): Raw {
  if (text.trim() === '') {
    return {}
  }
  const parsed: unknown = JSON.parse(text)
  const section = typeof parsed === 'object' && parsed !== null ? (parsed as Raw)[mod] : undefined

  return typeof section === 'object' && section !== null && !Array.isArray(section) ? (section as Raw) : {}
}

// The file's text with the key set (or removed when `value` is undefined), other mods kept.
export function withSetting(text: string, mod: string, key: string, value: Value | undefined): string {
  const parsed: unknown = text.trim() === '' ? {} : JSON.parse(text)
  const all = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? { ...(parsed as Raw) } : {}
  const section = { ...modSection(text, mod) }
  if (value === undefined) {
    delete section[key]
  } else {
    section[key] = value
  }
  if (Object.keys(section).length === 0) {
    delete all[mod]
  } else {
    all[mod] = section
  }

  return `${JSON.stringify(all, null, 2)}\n`
}

export function withLocalExclude(text: string): string | undefined {
  const line = `/${LOCAL_FILE}`
  if (text.split('\n').some(l => l.trim() === line)) {
    return undefined
  }

  return `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}# cc-mod-trimtab\n${line}\n`
}

const TARGET_FLAG = /(^|\s)--(session|local|repo)(?=\s|$)/g

// `<key> [value] [--session|--local|--repo]`, the flag anywhere. The value keeps its spacing.
export function parseSetArgs(args: string, lang: Lang = 'en'): { key: string; rest: string; target: Target } | { error: string } {
  const targets = [...args.matchAll(TARGET_FLAG)].map(match => match[2] as Target)
  if (targets.length > 1) {
    return { error: pick(lang, { en: 'give only one of --session, --local or --repo', 'zh-TW': '只能加一個 --session、--local 或 --repo' }) }
  }
  const text = args.replace(TARGET_FLAG, '$1').trim()
  const key = text.split(/\s+/)[0] ?? ''
  if (key === '') {
    return { error: pick(lang, { en: 'name a setting', 'zh-TW': '要指定設定名稱' }) }
  }

  return { key, rest: text.slice(key.length).trim(), target: targets[0] ?? 'session' }
}

// ---------- through the mod's I/O ----------

// What the settings need from `$`. `$` cannot cross an import, so each mod builds this in its own
// register file (the `configIO` block, kept equal across mods by scripts/check-copies.sh).
export type ConfigIO = {
  // The file's text, '' when it is missing.
  read: (path: string) => Promise<string>
  write: (path: string, text: string) => Promise<void>
  isDir: (path: string) => Promise<boolean>
  // `CLAUDE_CONFIG_DIR`, else `$HOME/.claude`.
  configDir: () => Promise<string>
  root: () => Promise<string>
  // The main working tree, whose `.git/info/exclude` covers every worktree.
  repoRoot: () => Promise<string | undefined>
  sessionId: () => Promise<string>
  now: () => Promise<number>
  storeGet: (key: string) => Promise<unknown>
  storeSet: (key: string, value: unknown) => Promise<void>
}

// What a file adds to the layers: the mod's section, with `language` from `"*"` when the section
// has none of its own, and the problems found on the way.
type Problem = { key: string; layer: Layer; reason: Text }

function readSection(text: string, path: string, mod: string, layer: Layer, broken: Problem[]): Raw {
  try {
    const own = modSection(text, mod)
    const shared = modSection(text, SHARED)
    for (const key of Object.keys(shared)) {
      if (key !== 'language') {
        broken.push({
          key: `${SHARED}.${key}`,
          layer,
          reason: { en: `only language is read from "${SHARED}"`, 'zh-TW': `"${SHARED}" 只讀 language` },
        })
      }
    }

    return shared.language === undefined || own.language !== undefined ? own : { ...own, language: shared.language }
  } catch {
    broken.push({ key: path, layer, reason: { en: 'not valid JSON; the whole file is not used', 'zh-TW': 'JSON 格式不對，整個檔案沒有採用' } })

    return {}
  }
}

type SessionEntry = { values: Raw; until?: Readonly<Record<string, number>> }
type Sessions<T> = Readonly<Record<string, T & { written: number }>>

// Every session's entry under `key`, with `id`'s replaced by `entry` and those not written for a
// week dropped.
async function writeSessions<T>(io: ConfigIO, key: string, id: string, entry: T): Promise<void> {
  const now = await io.now()
  const kept: Record<string, T & { written: number }> = {}
  for (const [other, stored] of Object.entries(((await io.storeGet(key)) ?? {}) as Sessions<T>)) {
    if (other !== id && now - stored.written < KEEP_SESSION_MS) {
      kept[other] = stored
    }
  }
  kept[id] = { ...entry, written: now }
  await io.storeSet(key, kept)
}

async function sessionEntry<T>(io: ConfigIO, key: string, id: string): Promise<T | undefined> {
  const stored = (await io.storeGet(key)) as Sessions<T> | undefined

  return stored !== undefined && Object.hasOwn(stored, id) ? stored[id] : undefined
}

// This session's values; those `/<mod> on` set left out once they ran out.
async function sessionValues(io: ConfigIO): Promise<{ values: Raw; until: Record<string, number> }> {
  const stored = await sessionEntry<SessionEntry>(io, SESSION_KEY, await io.sessionId())
  if (stored === undefined) {
    return { values: {}, until: {} }
  }
  const timed = Object.entries(stored.until ?? {})
  // Read only when needed: a mod without features to switch never asks the clock.
  const now = timed.length === 0 ? 0 : await io.now()
  const values: Record<string, unknown> = { ...stored.values }
  const until: Record<string, number> = {}
  for (const [key, at] of timed) {
    if (at > now) {
      until[key] = at
    } else {
      delete values[key]
    }
  }

  return { values, until }
}

async function writeSession(io: ConfigIO, key: string, value: Value | undefined, until: number | undefined): Promise<void> {
  const current = await sessionValues(io)
  const values: Record<string, unknown> = { ...current.values }
  const times = { ...current.until }
  delete values[key]
  delete times[key]
  if (value !== undefined) {
    values[key] = value
  }
  if (value !== undefined && until !== undefined) {
    times[key] = until
  }
  await writeSessions(io, SESSION_KEY, await io.sessionId(), { values, until: times })
}

// True the first time a feature does its work in this session, for the one notice it gets.
export async function firstUse(io: ConfigIO, key: string): Promise<boolean> {
  const sessionId = await io.sessionId()
  const keys = (await sessionEntry<{ keys: string[] }>(io, NOTICED_KEY, sessionId))?.keys ?? []
  if (keys.includes(key)) {
    return false
  }
  await writeSessions(io, NOTICED_KEY, sessionId, { keys: [...keys, key] })

  return true
}

async function filePaths(io: ConfigIO): Promise<{ user: string; repo: string; local: string }> {
  const root = (await io.root()).replace(/\/$/, '')

  return { user: `${(await io.configDir()).replace(/\/$/, '')}/${USER_FILE}`, repo: `${root}/${REPO_FILE}`, local: `${root}/${LOCAL_FILE}` }
}

async function loadLayers(io: ConfigIO, mod: string, options: PluginOptions): Promise<{ layers: Layers; broken: Problem[] }> {
  const paths = await filePaths(io)
  const broken: Problem[] = []
  const session = await sessionValues(io)
  const layers = {
    options,
    user: readSection(await io.read(paths.user), paths.user, mod, 'user', broken),
    repo: readSection(await io.read(paths.repo), paths.repo, mod, 'repo', broken),
    local: readSection(await io.read(paths.local), paths.local, mod, 'local', broken),
    session: session.values,
    until: session.until,
  }

  return { layers, broken }
}

export async function loadConfig(io: ConfigIO, mod: string, specs: Specs, options: PluginOptions): Promise<Resolved> {
  const { layers, broken } = await loadLayers(io, mod, options)
  const resolved = resolve(specs, layers)

  const problems = broken.map(item => ({ ...item, reason: pick(resolved.lang, item.reason) }))

  return { ...resolved, ignored: [...problems, ...resolved.ignored] }
}

async function writeSetting(io: ConfigIO, mod: string, key: string, value: Value | undefined, target: Target): Promise<void> {
  if (target === 'session') {
    await writeSession(io, key, value, undefined)

    return
  }
  const paths = await filePaths(io)
  const path = target === 'repo' ? paths.repo : paths.local
  await io.write(path, withSetting(await io.read(path), mod, key, value))
  if (target === 'local') {
    const repo = await io.repoRoot()
    if (repo !== undefined && (await io.isDir(`${repo}/.git`))) {
      const exclude = `${repo}/.git/info/exclude`
      const added = withLocalExclude(await io.read(exclude))
      if (added !== undefined) {
        await io.write(exclude, added)
      }
    }
  }
}

// Answers `/<mod> status|set|unset …`; undefined for any other sub-command. `reload` hands the
// mod the new values after a change.
export async function configCommand(
  io: ConfigIO,
  mod: string,
  specs: Specs,
  options: PluginOptions,
  args: string,
  reload: (resolved: Resolved) => void,
): Promise<string | undefined> {
  const sub = args.trim().split(/\s+/)[0] ?? ''
  const rest = args.trim().slice(sub.length)
  if (sub === 'status') {
    const resolved = await loadConfig(io, mod, specs, options)
    reload(resolved)

    return statusText(mod, specs, resolved, Object.keys(resolved.until).length === 0 ? 0 : await io.now())
  }
  if ((sub === 'on' || sub === 'off') && toggleKeys(specs).length > 0) {
    return switchFeature(io, mod, specs, options, sub, rest, reload)
  }
  if (sub !== 'set' && sub !== 'unset') {
    return undefined
  }
  const before = await loadLayers(io, mod, options)
  const lang = resolve(specs, before.layers).lang
  const parsed = parseSetArgs(rest, lang)
  if ('error' in parsed) {
    return parsed.error
  }
  const spec = Object.hasOwn(specs, parsed.key) ? specs[parsed.key] : undefined
  if (spec === undefined) {
    return pick(lang, {
      en: `${mod} has no setting ${parsed.key}; /${mod} status lists them all`,
      'zh-TW': `${mod} 沒有 ${parsed.key} 這個設定；/${mod} status 列出全部`,
    })
  }
  let value: Value | undefined
  if (sub === 'set') {
    const input = parseInput(spec, parsed.rest, lang)
    if ('error' in input) {
      return `${parsed.key} ${input.error}`
    }
    value = input.value
  }
  if (parsed.target === 'repo' && value !== undefined) {
    // Do not commit a value every reader would ignore.
    const { layers } = before
    const trial = resolve(specs, { ...layers, repo: { ...layers.repo, [parsed.key]: value } })
    const refused = trial.ignored.find(item => item.layer === 'repo' && item.key === parsed.key)
    if (refused !== undefined) {
      return pick(lang, { en: `Not written: ${refused.reason}`, 'zh-TW': `沒有寫入：${refused.reason}` })
    }
  }
  await writeSetting(io, mod, parsed.key, value, parsed.target)
  const resolved = await loadConfig(io, mod, specs, options)
  reload(resolved)
  const shown = show(resolved.values[parsed.key] as Value)
  const from = pick(resolved.lang, LAYER_NAMES[resolved.sources[parsed.key] as Layer])
  const now = pick(resolved.lang, { en: `${parsed.key} is now ${shown} (from ${from})`, 'zh-TW': `${parsed.key} 現在是 ${shown}（來自 ${from}）` })
  const where =
    parsed.target === 'session' ? pick(resolved.lang, { en: 'this session only', 'zh-TW': '只在這個 session' }) : parsed.target === 'repo' ? REPO_FILE : LOCAL_FILE
  const done = sub === 'set' ? pick(resolved.lang, { en: 'Set', 'zh-TW': '已設定' }) : pick(resolved.lang, { en: 'Removed', 'zh-TW': '已移除' })

  return pick(resolved.lang, { en: `${done} (${where}). ${now}`, 'zh-TW': `${done}（${where}）。${now}` })
}

export function toggleKeys(specs: Specs): string[] {
  return Object.keys(specs).filter(key => specs[key]?.toggle !== undefined)
}

// `[feature] [duration]` in either order; the feature may go when the mod has one.
export function parseOnArgs(specs: Specs, args: string, withDuration: boolean, lang: Lang = 'en'): { key: string; ms: number } | { error: string } {
  const toggles = toggleKeys(specs)
  let key: string | undefined
  let ms: number | undefined
  for (const word of args.trim().split(/\s+/).filter(w => w !== '')) {
    if (key === undefined && toggles.includes(word)) {
      key = word
      continue
    }
    const duration = withDuration && ms === undefined ? parseDuration(word) : undefined
    if (duration === undefined) {
      const names = listOf(lang, toggles)
      const hint = withDuration ? pick(lang, { en: '; a duration looks like 2h, 90m, 1h30m (24h at most)', 'zh-TW': '，時長像 2h、90m、1h30m（最多 24h）' }) : ''

      return { error: pick(lang, { en: `Cannot read "${word}": the features are ${names}${hint}`, 'zh-TW': `看不懂「${word}」：功能是 ${names}${hint}` }) }
    }
    ms = duration
  }
  if (key === undefined && toggles.length === 1) {
    key = toggles[0]
  }
  if (key === undefined) {
    return { error: pick(lang, { en: `Name a feature: ${listOf(lang, toggles)}`, 'zh-TW': `要指定功能：${listOf(lang, toggles)}` }) }
  }

  return { key, ms: ms ?? DEFAULT_ON_MS }
}

async function switchFeature(
  io: ConfigIO,
  mod: string,
  specs: Specs,
  options: PluginOptions,
  sub: 'on' | 'off',
  args: string,
  reload: (resolved: Resolved) => void,
): Promise<string> {
  const { layers } = await loadLayers(io, mod, options)
  const lang = resolve(specs, layers).lang
  const parsed = parseOnArgs(specs, args, sub === 'on', lang)
  if ('error' in parsed) {
    return parsed.error
  }
  const { key, ms } = parsed
  const toggle = (specs[key] as KeySpec).toggle as { on: Value; off: Value }
  const rest: Record<string, unknown> = { ...layers.session }
  delete rest[key]
  const below = resolve(specs, { ...layers, session: rest })
  const belowValue = below.values[key] as Value
  const isOnBelow = !same(belowValue, toggle.off)
  const now = await io.now()
  const from = pick(lang, LAYER_NAMES[below.sources[key] as Layer])
  if (sub === 'on') {
    if (isOnBelow) {
      const wasOff = Object.hasOwn(layers.session, key)
      await writeSession(io, key, undefined, undefined)
      reload(await loadConfig(io, mod, specs, options))
      const source = pick(lang, { en: `${show(belowValue)}, from ${from}`, 'zh-TW': `${show(belowValue)}，來自 ${from}` })

      return wasOff
        ? pick(lang, { en: `${key}: this session's off is cancelled, back to always on (${source})`, 'zh-TW': `${key} 取消這個 session 的關閉，回到常開（${source}）` })
        : pick(lang, { en: `${key} is already always on (${source}); no need to turn it on for a while`, 'zh-TW': `${key} 已經常開（${source}），不用臨時開啟` })
    }
    await writeSession(io, key, toggle.on, now + ms)
    reload(await loadConfig(io, mod, specs, options))
    const at = new Date(now + ms)
    const clock = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
    const off = `/${mod} off${toggleKeys(specs).length === 1 ? '' : ` ${key}`}`

    return pick(lang, {
      en: `${key} on for ${fmtLeft(ms)} (until ${clock}); it goes off by itself when that runs out or the session ends; turn off: ${off}`,
      'zh-TW': `${key} 臨時開啟 ${fmtLeft(ms)}（到 ${clock}），到期或 session 結束自動關；關閉：${off}`,
    })
  }
  // Off for the rest of the session; nothing to keep when the layers below are off already.
  await writeSession(io, key, isOnBelow ? toggle.off : undefined, undefined)
  reload(await loadConfig(io, mod, specs, options))

  return isOnBelow
    ? pick(lang, {
        en: `${key} is off for this session (${from} has it on; it comes back next session)`,
        'zh-TW': `${key} 在這個 session 關閉（${from} 設定是開啟，下個 session 恢復）`,
      })
    : pick(lang, { en: `${key} is already off`, 'zh-TW': `${key} 已關閉` })
}
