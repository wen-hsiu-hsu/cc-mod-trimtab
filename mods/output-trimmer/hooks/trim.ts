// Decides which Bash outputs to shorten and how: the head, the tail, and the lines in between
// that look like failures, so a long test or build log costs a few hundred lines at most.

import { pick, type Lang } from './config'

export const LIMITS = {
  maxLines: 150,
  maxChars: 15000,
  head: 30,
  tail: 60,
  signals: 40,
  lineChars: 400,
}

// Commands whose output Claude asked for on purpose (reading a file, a diff, a search):
// shortening them would only make it read again.
const READERS = new Set([
  'cat', 'sed', 'head', 'tail', 'nl', 'less', 'more', 'awk', 'jq', 'yq', 'grep', 'egrep', 'rg',
  'ugrep', 'find', 'fd', 'ls', 'tree', 'wc', 'diff', 'stat', 'file', 'xxd', 'od',
])
const GIT_READERS = new Set(['show', 'diff', 'log', 'blame', 'grep', 'ls-files'])

// A comment Claude can add to a command to get its output whole.
export const OPT_OUT = /#\s*notrim\b/

const SIGNAL =
  /\b(?:error|errors|failed|failure|fail|fatal|panic|exception|traceback|assert(?:ion)?|expected|received|warn(?:ing)?|denied|not found|undefined|cannot|TS\d{4})\b|[✗✘×]|FAIL|ERR!/i

export function shouldTrim(command: string): boolean {
  if (OPT_OUT.test(command)) {
    return false
  }
  const words = command.replace(/^\s*cd\s+\S+\s*&&\s*/, '').trim().split(/\s+/)
  const first = (words[0] ?? '').replace(/^.*\//, '')
  if (READERS.has(first)) {
    return false
  }
  if (first === 'git') {
    // Skip global options, and the value `-C <dir>` / `-c <key=value>` take.
    const sub = words
      .slice(1)
      .find((word, i, rest) => !word.startsWith('-') && rest[i - 1] !== '-C' && rest[i - 1] !== '-c')

    return !GIT_READERS.has(sub ?? '')
  }

  return true
}

function clip(line: string): string {
  return line.length > LIMITS.lineChars ? `${line.slice(0, LIMITS.lineChars)}…(+${line.length - LIMITS.lineChars})` : line
}

export type Trimmed = { text: string; lines: number; dropped: number }

// The shortened text, or undefined when the output is short enough to pass whole.
// `limits`: the thresholds past which an output is shortened (the settings `max_lines`, `max_chars`).
export function trim(output: string, savedAt: string, limits: { maxLines: number; maxChars: number } = LIMITS, lang: Lang = 'en'): Trimmed | undefined {
  const lines = output.split('\n')
  if (lines.length <= limits.maxLines && output.length <= limits.maxChars) {
    return undefined
  }

  const head = lines.slice(0, LIMITS.head)
  const tailStart = Math.max(LIMITS.head, lines.length - LIMITS.tail)
  const tail = lines.slice(tailStart)
  const middle: string[] = []
  for (let i = LIMITS.head; i < tailStart && middle.length < LIMITS.signals; i++) {
    const line = lines[i] ?? ''
    if (SIGNAL.test(line)) {
      middle.push(`L${i + 1}: ${clip(line)}`)
    }
  }
  const dropped = tailStart - LIMITS.head - middle.length

  const note = pick(lang, {
    en:
      `[output-trimmer] The output was ${lines.length} lines, ${output.length} characters; ${dropped} lines in the middle are left out. ` +
      `Whole output: ${savedAt} (read it with Read or sed -n when needed; add # notrim to the command to get it whole)`,
    'zh-TW':
      `[output-trimmer] 原輸出 ${lines.length} 行、${output.length} 字元，省略中間 ${dropped} 行。` +
      `完整輸出：${savedAt}（需要時用 Read 或 sed -n 讀；指令加上 # notrim 可取得完整輸出）`,
  })

  const text = [
    note,
    ...head.map(clip),
    middle.length > 0
      ? pick(lang, { en: `… ${middle.length} lines in the middle that match error keywords …`, 'zh-TW': `… 中間符合錯誤關鍵字的 ${middle.length} 行 …` })
      : '…',
    ...middle,
    '…',
    ...tail.map(clip),
  ].join('\n')

  return { text, lines: lines.length, dropped }
}

// Tool results come without the trailing newline; the saved log gets it back.
export function asLog(output: string): string {
  return output.endsWith('\n') ? output : `${output}\n`
}
