// The two nudges as pure logic (no $): the same failure twice in a row, and a claim of done with nothing verified.
// Adapted from hooks/loops.ts of cablate/ctx-handoff-mod v0.5.0 (MIT, commit 3a06bc8).

import { pick, type Lang } from './config'

export const TAG = '[self-check]'

// ---------- Repeated failure: one tool failing twice in a row for the same reason ----------

export type Streak = { sig: string; count: number; isNudged: boolean }

const MAX_SIG = 200
const MAX_STREAKS = 200
// Terminal color codes, built so no control character sits in the pattern source.
const ANSI = new RegExp(String.raw`${String.fromCharCode(27)}\[[0-9;]*[A-Za-z]`, 'g')
// The user interrupting or rejecting a call is not a failure of the tool.
const USER_STOP = /doesn't want to proceed|user rejected|interrupted by user|request interrupted|user denied/i

// Signature of an error: color codes, paths, numbers (lines, times, ids) and spacing removed, first 200 characters.
export function failureSignature(text: string | undefined): string {
  return (text ?? '')
    .replace(ANSI, '')
    .replace(/[A-Za-z]:[\\/][^\s'"`)>\]]*/g, '<p>')
    .replace(/(?:\.{0,2}\/)?(?:[\w.@~-]+\/)+[\w.@~-]*/g, '<p>')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SIG)
}

// The error as quoted to Claude: its first non-empty line, up to 80 characters.
function briefOf(text: string | undefined): string {
  const line =
    (text ?? '')
      .split('\n')
      .map(l => l.trim())
      .find(Boolean) ?? ''

  return line.length > 80 ? `${line.slice(0, 80)}…` : line
}

// Added to the tool result for Claude only, so always English.
export function retryNudgeText(tool: string, text: string | undefined): string {
  return `${TAG} This tool (${tool}) failed twice in a row for the same reason (${briefOf(text) || 'no error text'}). Find the cause and change your approach instead of retrying as is.`
}

// Records one tool result; the second failure with the same signature returns the nudge, once per streak.
// key: the caller (main thread or subagent) plus the tool; a success clears it.
export function trackFailure(
  streaks: Map<string, Streak>,
  key: string,
  tool: string,
  isError: boolean,
  text: string | undefined,
): string | undefined {
  if (!isError || USER_STOP.test(text ?? '')) {
    streaks.delete(key)

    return undefined
  }
  const sig = failureSignature(text)
  const prev = streaks.get(key)
  if (!prev || prev.sig !== sig) {
    // A new signature starts a new streak; the cap only bounds the map.
    if (!prev && streaks.size >= MAX_STREAKS) {
      streaks.clear()
    }
    streaks.set(key, { sig, count: 1, isNudged: false })

    return undefined
  }
  prev.count += 1
  if (prev.count < 2 || prev.isNudged) {
    return undefined
  }
  prev.isNudged = true

  return retryNudgeText(tool, text)
}

// ---------- Claimed done, with no check after the last edit ----------

// The turn's record: seq counts finished tool calls; lastEdit and lastCheck are the seq of the last edit and check (0: none).
export type Work = { seq: number; lastEdit: number; lastCheck: number; isReminded: boolean }

export function freshWork(): Work {
  return { seq: 0, lastEdit: 0, lastCheck: 0, isReminded: false }
}

// Edits made through Bash (sed -i, python3) do not count: the write detection waits on tool-guard's bash-edit-snapshot, deferred in ROADMAP.md.
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
// Editing docs needs no test run.
const DOC_FILE = /\.(md|mdx|txt|rst|adoc)$/i
// Commands that only read or move files are no check.
const NOT_RUNNING = new Set([
  'ls', 'cat', 'echo', 'grep', 'rg', 'find', 'head', 'tail', 'git', 'cd', 'mkdir', 'rm', 'cp', 'mv',
  'sed', 'awk', 'type', 'wc', 'diff', 'open', 'pwd', 'which', 'printf',
])
const CHECK_WORDS =
  /\b(tests?|pytest|unittest|jest|vitest|mocha|rspec|phpunit|tsc|typecheck|lint|eslint|biome|ruff|mypy|pyright|flake8|clippy|check|build|compile|verify|validate|vet)\b/i

// Whether a Bash or PowerShell command runs tests, a check or a build (any segment of it).
export function isCheckCommand(command: string | undefined): boolean {
  return (command ?? '').split(/&&|\|\||;|\||\n/).some(seg => {
    const first = (seg.trim().split(/\s+/)[0] ?? '').replace(/^.*[\\/]/, '').toLowerCase()

    return first !== '' && !NOT_RUNNING.has(first) && CHECK_WORDS.test(seg)
  })
}

// Records a finished tool call. A failed edit is no edit; a failed test run still counts as a check.
export function noteCall(work: Work, tool: string, input: Record<string, unknown>, isFailed: boolean): void {
  work.seq += 1
  if (EDIT_TOOLS.has(tool)) {
    if (isFailed) {
      return
    }
    const file = [input.file_path, input.notebook_path, input.path].find((p): p is string => typeof p === 'string')
    if (file && DOC_FILE.test(file)) {
      return
    }
    work.lastEdit = work.seq
  } else if ((tool === 'Bash' || tool === 'PowerShell') && typeof input.command === 'string' && isCheckCommand(input.command)) {
    work.lastCheck = work.seq
  }
}

// Wording that claims done, in the opening and the end only; negated (未 沒 不 尚) claims do not count.
// Matches Chinese and English whatever the language setting is: it reads Claude's words.
const CLAIM =
  /(?<![未沒不尚])(完成了|已完成|已經完成|做好了|做完了|改好了|都好了|已修好|修好了|已經修好|已修正|處理好了|搞定了?|全部完成)|\b(all done|all set|i(?:'ve| have) (?:finished|completed|fixed)|(?:is|are|now|it's) (?:done|fixed|complete(?:d)?|finished)|fixed it|everything (?:is )?(?:done|working|fixed))\b/i
// A reply that already says what went unverified is not nudged.
const HONEST =
  /沒有?(?:跑|執行|做)?(?:驗證|測試|檢查)|未(?:經)?(?:驗證|測試)|無法(?:驗證|測試)|沒辦法(?:驗證|測試)|not (?:been )?(?:tested|verified)|couldn't (?:run|verify|test)|could not (?:run|verify|test)|unable to (?:run|verify|test)|haven't (?:run|tested|verified)/i

export function claimsDone(message: string | undefined): boolean {
  const text = (message ?? '').trim()
  if (!text || /[?？]$/.test(text)) {
    return false
  }
  const ends = text.length <= 600 ? text : `${text.slice(0, 200)}\n${text.slice(-400)}`

  return CLAIM.test(ends) && !HONEST.test(ends)
}

// The Stop block reason: the person sees it too, so it follows the language.
export function doneCheckText(lang: Lang): string {
  return pick(lang, {
    en: `${TAG} You said it is done, but this turn edited code files and ran no tests, build or check afterwards. Run the relevant verification and report the result; if you cannot verify, say what was not verified.`,
    'zh-TW': `${TAG} 你說完成了，但這一輪改了程式檔之後沒有跑任何測試、建置或檢查。請跑相關的驗證並附上結果；如果沒辦法驗證，改口說明哪些沒驗證。`,
  })
}

// The reason to block the stop and ask for a check, at most once a turn; isStopHookActive: a Stop hook already blocked this stop.
export function doneCheck(work: Work, message: string | undefined, isStopHookActive: boolean, lang: Lang = 'en'): string | undefined {
  if (work.isReminded || isStopHookActive) {
    return undefined
  }
  if (work.lastEdit === 0 || work.lastCheck > work.lastEdit) {
    return undefined
  }
  if (!claimsDone(message)) {
    return undefined
  }
  work.isReminded = true

  return doneCheckText(lang)
}
