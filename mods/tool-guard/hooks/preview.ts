// What a held command would change, as the pane and the denial show it. register.tsx runs
// the commands; this file holds their scripts and turns their output into a Preview.

import { pick, type Lang } from './config'
import type { MigrationTool, Rule } from './rules'

export const LIST_MAX = 10

export type Preview = {
  rule: Rule
  // The operation: `git reset --hard`, `rm -rf`.
  label: string
  // What it would do, in one line.
  summary: string
  lines: string[]
  // Items beyond `lines`.
  more: number
  note?: string
}

export function listed(items: string[]): { lines: string[]; more: number } {
  return { lines: items.slice(0, LIST_MAX), more: Math.max(0, items.length - LIST_MAX) }
}

// `git status --porcelain` rows a discard overwrites, as `XY path`. Untracked files are never
// touched; without staged loss only rows with an unstaged change (Y) count.
export function lostChanges(porcelain: string, isStagedLost: boolean): string[] {
  return porcelain
    .split('\n')
    .filter(row => row.length > 3 && !row.startsWith('??') && !row.startsWith('!!'))
    .filter(row => isStagedLost || row[1] !== ' ')
}

export function cleanRemovals(stdout: string): string[] {
  return stdout
    .split('\n')
    .filter(line => line.startsWith('Would remove '))
    .map(line => line.slice('Would remove '.length))
}

// Expands rm's targets the way the shell would and measures them, skipping paths under the
// temp folders and under the folders in $1 (one per line, the setting `rm_skip_paths`). The
// paths arrive as arguments, never as source, so nothing in them runs;
// compgen -G expands a glob without command substitution. Prints `files bytes paths`, then
// up to LIST_MAX of the files.
export const RM_SCRIPT = [
  'shopt -s nullglob dotglob',
  'tmp=$(cd "${TMPDIR:-/tmp}" 2>/dev/null && pwd -P)',
  'skips=()',
  'while IFS= read -r s; do',
  '  [[ -z "$s" ]] && continue',
  '  case "$s" in "~"|"~/"*) s="$HOME${s#\\~}";; esac',
  '  skips+=("$(cd "$s" 2>/dev/null && pwd -P || printf %s "${s%/}")")',
  'done <<< "$1"',
  'shift',
  'paths=()',
  'add() {',
  '  local abs',
  '  abs="$(cd "$(dirname -- "$1")" 2>/dev/null && pwd -P)/$(basename -- "$1")"',
  '  case "$abs" in /tmp/*|/private/tmp/*|/var/folders/*|/private/var/folders/*) return;; esac',
  '  [[ -n "$tmp" && "$abs" == "$tmp"/* ]] && return',
  '  for s in "${skips[@]}"; do [[ "$abs" == "$s" || "$abs" == "$s"/* ]] && return; done',
  '  case "$seen" in *"|$abs|"*) return;; esac', // a path two targets match counts once
  '  seen="$seen|$abs|"',
  '  paths+=("$1")',
  '}',
  'for p in "$@"; do',
  '  case "$p" in "~"|"~/"*) p="$HOME${p#\\~}";; esac',
  '  if [[ "$p" == *[*?[]* ]]; then',
  '    while IFS= read -r m; do add "$m"; done < <(compgen -G "$p")',
  '  elif [[ -e "$p" || -L "$p" ]]; then',
  '    add "$p"',
  '  fi',
  'done',
  'if (( ${#paths[@]} == 0 )); then echo "0 0 0"; exit 0; fi',
  '# A relative path gets ./ in front, so find never reads a name like -delete as an action.',
  'for i in "${!paths[@]}"; do case "${paths[$i]}" in /*) ;; *) paths[$i]="./${paths[$i]}";; esac; done',
  'files=$(find "${paths[@]}" \\( -type f -o -type l \\) 2>/dev/null | wc -l | tr -d " ")',
  'kb=$(du -skc "${paths[@]}" 2>/dev/null | tail -n1 | cut -f1)',
  'echo "$files $(( ${kb:-0} * 1024 )) ${#paths[@]}"',
  `find "\${paths[@]}" \\( -type f -o -type l \\) 2>/dev/null | head -n ${LIST_MAX}`,
].join('\n')

export type RmMeasure = { files: number; bytes: number; paths: number; listed: string[] }

export function parseRm(stdout: string): RmMeasure {
  const [head, ...rest] = stdout.split('\n').filter(line => line !== '')
  const [files = 0, bytes = 0, paths = 0] = (head ?? '0 0 0').split(' ').map(Number)

  return { files, bytes, paths, listed: rest.map(line => line.replace(/^\.\//, '')) }
}

// Resolves a `cd` target to an absolute folder; prints nothing when it does not exist.
export const CD_SCRIPT =
  'unset CDPATH; d="$1"; case "$d" in "~") d="$HOME";; "~/"*) d="$HOME/${d#\\~/}";; esac; cd -- "$d" 2>/dev/null && pwd -P'

type Lister = { argv: string[]; isPending: (line: string) => boolean; strip: (line: string) => string }

// Each tool's own status command, and how to read the pending migrations off it.
export const MIGRATION_LISTERS: Partial<Record<MigrationTool, Lister>> = {
  django: {
    argv: ['python3', 'manage.py', 'showmigrations', '--plan'],
    isPending: line => line.startsWith('[ ]'),
    strip: line => line.slice(4),
  },
  alembic: { argv: ['alembic', 'history', '-r', 'current:head'], isPending: line => line.includes('->'), strip: line => line },
  rails: { argv: ['bin/rails', 'db:migrate:status'], isPending: line => /^\s*down\b/.test(line), strip: line => line.trim() },
  prisma: {
    argv: ['npx', '--no-install', 'prisma', 'migrate', 'status'],
    isPending: line => /^\s{2}\S/.test(line),
    strip: line => line.trim(),
  },
}

export function size(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) {
    return `${bytes || 0} B`
  }
  const units = ['KB', 'MB', 'GB', 'TB']
  let n = bytes
  let i = -1
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i += 1
  }

  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`
}

// The previews as plain text, for a denial the model relays to the person.
export function describe(previews: Preview[], lang: Lang = 'en'): string {
  return previews
    .map(preview =>
      [
        `${preview.label}${lang === 'zh-TW' ? '：' : ': '}${preview.summary}`,
        ...preview.lines.map(line => `  - ${line}`),
        ...(preview.more > 0 ? [`  - ${pick(lang, { en: `${preview.more} more`, 'zh-TW': `另有 ${preview.more} 項` })}`] : []),
        ...(preview.note ? [`  ${preview.note}`] : []),
      ].join('\n'),
    )
    .join('\n')
}
