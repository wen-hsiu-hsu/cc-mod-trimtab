// Where the work stands, as `.claude/progress.md` in the repository: written by each distill that
// saw real progress, overwritten by session-keeper's handoff, read only by session-keeper. Kept out
// of git through `.git/info/exclude`. Pure functions, no `$`.
import { pick, type Lang, type Text } from './config'

export const PROGRESS_FILE = '.claude/progress.md'
export const PROGRESS_STATES = ['done', 'in_progress', 'blocked'] as const
export type ProgressState = (typeof PROGRESS_STATES)[number]
export const isProgressState = (v: unknown): v is ProgressState => typeof v === 'string' && (PROGRESS_STATES as readonly string[]).includes(v)
const STATE_LABEL: Record<ProgressState, Text> = {
  done: { en: 'done', 'zh-TW': '完成' },
  in_progress: { en: 'in progress', 'zh-TW': '進行中' },
  blocked: { en: 'blocked', 'zh-TW': '卡住' },
}

// Limits per field and in all (any character counts one).
export const PROGRESS_TASK_MAX = 80
export const PROGRESS_FIELD_MAX = 120
export const PROGRESS_FILES_MAX = 5
export const PROGRESS_FILE_MAX = 80
export const PROGRESS_TOTAL_MAX = 600

export type ProgressFields = { task: string; state: ProgressState; verified?: string; next?: string; files: string[] }
export type Progress = ProgressFields & { session: string; at: number }

export const progressSize = (p: ProgressFields) => [p.task, p.verified, p.next, ...p.files].reduce((n, s) => n + [...(s ?? '')].length, 0)

// at: written by the caller as local time, so the file reads like the rest of the notes.
export function renderProgress(p: Progress, stamp: string, lang: Lang = 'en') {
  return [
    '---',
    'source: project-memory',
    `session: ${p.session}`,
    `updated: ${new Date(p.at).toISOString()}`,
    `state: ${p.state}`,
    '---',
    '',
    pick(lang, { en: `# Progress (${stamp})`, 'zh-TW': `# 進度（${stamp}）` }),
    '',
    pick(lang, { en: `- Task: ${p.task}`, 'zh-TW': `- 任務：${p.task}` }),
    pick(lang, { en: `- State: ${pick(lang, STATE_LABEL[p.state])}`, 'zh-TW': `- 狀態：${pick(lang, STATE_LABEL[p.state])}` }),
    ...(p.verified ? [pick(lang, { en: `- Last passing check: ${p.verified}`, 'zh-TW': `- 最後通過的檢查：${p.verified}` })] : []),
    ...(p.next ? [pick(lang, { en: `- Next step: ${p.next}`, 'zh-TW': `- 下一步：${p.next}` })] : []),
    ...(p.files.length > 0 ? [pick(lang, { en: '- Key files:', 'zh-TW': '- 關鍵檔案：' }), ...p.files.map(f => `  - ${f}`)] : []),
    '',
  ].join('\n')
}

// The current progress for the distill prompt: the file's body, or none. A handoff summary written
// by session-keeper is passed the same way, so the model continues from it. For the model: English.
export function progressForPrompt(text: string) {
  const body = text.replace(/^---\n[\s\S]*?\n---\n?/, '').trim()

  return body === '' ? '(none)' : body.replace(/\n+/g, ' ／ ').slice(0, 1200)
}

// `.git/info/exclude` with the progress file listed once.
export function withExclude(text: string) {
  const line = `/${PROGRESS_FILE}`
  if (text.split('\n').some(l => l.trim() === line)) return undefined

  return `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}# project-memory\n${line}\n`
}
