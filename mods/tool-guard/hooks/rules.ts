// Pure checks over a Bash command line: which operations in it can lose work, and what about
// them is risky. register.tsx measures what each one would actually change before asking.

export type GitCall = {
  sub: string
  args: string
  // The directory `git -C` or a leading `cd <dir> &&` points at, when the command names one.
  dir?: string
}

const GIT_CALL =
  /(?:^|[;&|(\n`]|\$\()\s*(?:[A-Z_][A-Z0-9_]*=\S*\s+)*git((?:\s+-[Cc]\s+(?:"[^"]*"|'[^']*'|\S+)|\s+--[a-z-]+(?:=\S+)?)*)\s+([a-z][a-z-]*)([^;&|\n]*)/g

const LEADING_CD = /^\s*cd\s+("[^"]*"|'[^']*'|[^\s;&|]+)\s*&&/

function unquote(text: string): string {
  return text.replace(/^["']|["']$/g, '')
}

export function gitCalls(command: string): GitCall[] {
  const cd = LEADING_CD.exec(command)?.[1]
  const calls: GitCall[] = []
  for (const match of command.matchAll(GIT_CALL)) {
    const globals = match[1] ?? ''
    const dashC = /-C\s+("[^"]*"|'[^']*'|\S+)/.exec(globals)?.[1]
    const dir = dashC ? unquote(dashC) : cd ? unquote(cd) : undefined
    calls.push({ sub: match[2] ?? '', args: match[3] ?? '', ...(dir ? { dir } : {}) })
  }

  return calls
}

// Splits text into words, honouring quotes. Good enough to read flags and paths.
export function tokenize(text: string): string[] {
  return [...text.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g)].map(m => m[1] ?? m[2] ?? m[3] ?? '')
}

// --- risks -------------------------------------------------------------------------------

export type Rule = 'force-push' | 'no-verify' | 'stash-drop' | 'discard' | 'rm' | 'migrate'

export type MigrationTool = 'django' | 'rails' | 'alembic' | 'prisma' | 'unknown'

export type Risk =
  | { rule: 'force-push' | 'no-verify' | 'stash-drop' | 'discard'; label: string; call: GitCall }
  | { rule: 'rm'; label: string; targets: string[]; dir?: string }
  | { rule: 'migrate'; label: string; tool: MigrationTool; dir?: string }

export function gitRisks(call: GitCall): Risk[] {
  const risks: Risk[] = []
  if (call.sub === 'push' && isForcePush(call.args)) {
    risks.push({ rule: 'force-push', label: 'git push --force', call })
  }
  if (skipsHooks(call)) {
    risks.push({ rule: 'no-verify', label: `git ${call.sub} --no-verify`, call })
  }
  const loses = alwaysLoses(call)
  if (loses) {
    risks.push({ rule: 'stash-drop', label: loses, call })
  }
  if (discardsWorktree(call)) {
    risks.push({ rule: 'discard', label: `git ${call.sub} ${call.args.trim()}`.trim().slice(0, 80), call })
  }

  return risks
}

// --- push -------------------------------------------------------------------------------

export const PROTECTED_BRANCHES = ['main', 'master']

export function isForcePush(args: string): boolean {
  return /(?:^|\s)(?:--force(?:-with-lease)?(?:=\S*)?|--force-if-includes|-[a-zA-Z]*f[a-zA-Z]*)(?=\s|$)/.test(args) ||
    /(?:^|\s)\+\S+/.test(args)
}

export type PushTarget = {
  remote: string
  source: string
  // The remote branch, or undefined when the push sends the current one.
  branch?: string
}

// The branches a push overwrites: one per refspec, or the current branch when it names none.
export function pushTargets(args: string): PushTarget[] {
  const words = tokenize(args).filter(word => !word.startsWith('-'))
  const remote = words[0] ?? 'origin'
  const specs = words.slice(1)
  if (specs.length === 0) {
    return [{ remote, source: 'HEAD' }]
  }

  return specs.map(spec => {
    // A refspec is src:dst; with no colon the local branch of the same name is pushed.
    const [source = '', target = source] = spec.replace(/^\+/, '').split(':')
    const branch = target.replace(/^refs\/heads\//, '')

    return branch === '' || branch === 'HEAD'
      ? { remote, source: 'HEAD' }
      : { remote, source: source === '' ? 'HEAD' : source, branch }
  })
}

// --- destructive local operations -----------------------------------------------------

// Operations that can throw away uncommitted work; register.tsx asks only when they would.
export function discardsWorktree(call: GitCall): string | undefined {
  const { sub, args } = call
  if (sub === 'reset' && /(?:^|\s)--hard\b/.test(args)) {
    return 'git reset --hard'
  }
  if (sub === 'checkout' && /(?:^|\s)(?:--\s|\.(?:\s|$))/.test(args)) {
    return 'git checkout -- <path>'
  }
  if (sub === 'restore' && (!/(?:^|\s)(?:--staged|-S)\b/.test(args) || /(?:^|\s)(?:--worktree|-W)\b/.test(args))) {
    return 'git restore <path>'
  }
  if (sub === 'clean' && /(?:^|\s)-[a-zA-Z]*f/.test(args)) {
    return 'git clean -f'
  }

  return undefined
}

export type DiscardScope = {
  // Pathspecs the command limits itself to; empty means the whole worktree.
  paths: string[]
  // Whether staged changes are lost too, not just unstaged ones.
  isStagedLost: boolean
}

// Which uncommitted changes a reset --hard, checkout or restore overwrites.
export function discardScope(call: GitCall): DiscardScope {
  const words = tokenize(call.args)
  if (call.sub === 'reset') {
    return { paths: [], isStagedLost: true }
  }
  if (call.sub === 'restore') {
    const paths: string[] = []
    for (let i = 0; i < words.length; i += 1) {
      const word = words[i] ?? ''
      if (word === '-s' || word === '--source') {
        i += 1
      } else if (word === '--') {
        paths.push(...words.slice(i + 1))
        break
      } else if (!word.startsWith('-')) {
        paths.push(word)
      }
    }
    const isStaged = words.some(word => word === '--staged' || /^-[a-zA-Z]*S/.test(word))

    return { paths, isStagedLost: isStaged }
  }
  // checkout [<tree-ish>] [--] <paths>: a tree-ish overwrites the index as well.
  const dashes = words.indexOf('--')
  const before = (dashes === -1 ? words : words.slice(0, dashes)).filter(word => !word.startsWith('-'))
  if (dashes !== -1) {
    return { paths: words.slice(dashes + 1), isStagedLost: before.length > 0 }
  }

  return before.length > 1 ? { paths: before.slice(1), isStagedLost: true } : { paths: before, isStagedLost: false }
}

// The flags and paths of a `git clean`, for the dry run that lists what it removes.
export function cleanDryRun(args: string): string[] {
  const words = tokenize(args)
  const flags: string[] = []
  const paths: string[] = []
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i] ?? ''
    if (word === '--') {
      paths.push(...words.slice(i + 1))
      break
    }
    if (word === '-e' || word === '--exclude') {
      flags.push(word, words[i + 1] ?? '')
      i += 1
    } else if (word.startsWith('--exclude=') || /^-e./.test(word)) {
      flags.push(word)
    } else if (/^-[a-zA-Z]+$/.test(word)) {
      // -n is added by the caller; -f, -i and -q would change the dry run.
      const kept = word.replace(/[finq]/g, '')
      if (kept !== '-') {
        flags.push(kept)
      }
    } else if (!word.startsWith('-')) {
      paths.push(word)
    }
  }

  return ['clean', '-n', ...flags, '--', ...paths]
}

// Operations that lose work whatever the worktree looks like.
export function alwaysLoses(call: GitCall): string | undefined {
  if (call.sub === 'stash' && /^\s*(?:drop|clear)\b/.test(call.args)) {
    return `git stash ${call.args.trim().split(/\s+/)[0]}`
  }

  return undefined
}

// The stash a `git stash drop` names, or undefined for `clear` (all of them).
export function droppedStash(call: GitCall): string | undefined {
  const [verb, ref] = tokenize(call.args)

  return verb === 'drop' ? (ref ?? 'stash@{0}') : undefined
}

export function skipsHooks(call: GitCall): boolean {
  if (call.sub === 'commit') {
    return /(?:^|\s)(?:--no-verify|-n)(?=\s|$)/.test(call.args)
  }
  // `git push -n` is --dry-run, so only the long form counts there.
  return call.sub === 'push' && /(?:^|\s)--no-verify(?=\s|$)/.test(call.args)
}

// --- rm and migrations ------------------------------------------------------------------

// Heredoc bodies are data (a commit message that mentions rm -rf), not commands.
function stripHeredocs(command: string): string {
  return command.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n[ \t]*\2(?=[ \t]*(?:\n|$|\)))/g, match =>
    match.slice(0, match.indexOf('\n')),
  )
}

// Splits a command line at ; && || | & and newlines outside quotes.
export function segments(command: string): string[] {
  const text = stripHeredocs(command)
  const out: string[] = []
  let current = ''
  let quote: string | undefined
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i] ?? ''
    if (quote) {
      current += c
      if (c === '\\' && quote === '"') {
        current += text[(i += 1)] ?? ''
      } else if (c === quote) {
        quote = undefined
      }
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      current += c
    } else if (c === '\\') {
      current += c + (text[(i += 1)] ?? '')
    } else if (c === '&' && (text[i - 1] === '>' || text[i + 1] === '>')) {
      current += c // 2>&1, &> file
    } else if (c === ';' || c === '\n' || c === '|' || c === '&') {
      out.push(current)
      current = ''
      if ((c === '|' || c === '&') && text[i + 1] === c) {
        i += 1
      }
    } else {
      current += c
    }
  }
  out.push(current)

  return out.filter(segment => segment.trim() !== '')
}

// Words that can come before the real command without changing what it does.
const PREFIXES = new Set(['command', 'exec', 'env', 'nohup', 'time', 'then', 'do', 'else', '!'])
// sudo options that take a value, so the value isn't read as the command.
const SUDO_VALUE_OPTIONS = new Set(['-u', '-g', '-C', '-D', '-h', '-p', '-r', '-t', '-T', '-U'])
// Commands that only read, so a bare word "migrate" in them isn't a migration.
const READ_ONLY = new Set(['ls', 'cat', 'echo', 'printf', 'grep', 'rg', 'find', 'less', 'head', 'tail', 'cd', 'git'])

// The folder a later `cd arg` moves to, given the folder so far (undefined: the session's).
function joinDir(dir: string | undefined, arg: string | undefined): string {
  if (arg === undefined || arg === '~' || arg.startsWith('/') || arg.startsWith('~/')) {
    return arg ?? '~'
  }

  return dir ? `${dir}/${arg}` : arg
}

// The command's own words: leading VAR=value, sudo and harmless prefixes dropped.
function commandWords(segment: string): string[] {
  const words = tokenize(segment.trim().replace(/^[({]+\s*/, '').replace(/\s*[)}]+$/, ''))
  const isAssignment = (word: string) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)
  while (words.length > 0 && isAssignment(words[0] ?? '')) {
    words.shift()
  }
  if (words[0] === 'sudo') {
    words.shift()
    while (words[0]?.startsWith('-')) {
      if (SUDO_VALUE_OPTIONS.has(words.shift() ?? '')) {
        words.shift()
      }
    }
  }
  while (words.length > 0 && (PREFIXES.has(words[0] ?? '') || isAssignment(words[0] ?? ''))) {
    words.shift()
  }
  if (words[0] === 'nice') {
    words.shift()
    const option = words.at(0) ?? ''
    if (option === '-n') {
      words.splice(0, 2)
    } else if (/^-\d+$/.test(option)) {
      words.shift()
    }
  }

  return words
}

function migration(cmd: string, args: string[], dir: string | undefined): Risk | undefined {
  const joined = [cmd, ...args].join(' ')
  const at = dir ? { dir } : {}
  if (/\bprisma\s+migrate\s+(?:status|diff)\b/.test(joined) || /\bdb:migrate:status\b/.test(joined)) {
    return undefined
  }
  if (/\balembic\s+upgrade\b/.test(joined)) {
    return { rule: 'migrate', label: 'alembic upgrade', tool: 'alembic', ...at }
  }
  if (/\bdb:migrate\b/.test(joined)) {
    return { rule: 'migrate', label: 'db:migrate', tool: 'rails', ...at }
  }
  if (/\bprisma\s+migrate\s+(?:dev|deploy)\b/.test(joined)) {
    return { rule: 'migrate', label: 'prisma migrate', tool: 'prisma', ...at }
  }
  if (/\bmanage\.py\s+migrate\b/.test(joined)) {
    return { rule: 'migrate', label: 'manage.py migrate', tool: 'django', ...at }
  }
  if (!READ_ONLY.has(cmd) && args.includes('migrate')) {
    return { rule: 'migrate', label: joined.slice(0, 60), tool: 'unknown', ...at }
  }

  return undefined
}

// The rm -r/-f calls and migrations in a command line, each with the folder it runs in as
// far as `cd`, `pushd` and `popd` earlier on the line move it.
export function shellRisks(command: string): Risk[] {
  const risks: Risk[] = []
  let dir: string | undefined
  const scopes: (string | undefined)[] = [] // dir to restore when a ( subshell ) closes
  const pushed: (string | undefined)[] = [] // pushd stack, for popd
  for (const raw of segments(command)) {
    const opens = /^\s*\(+/.exec(raw)?.[0].trim().length ?? 0
    // Trailing redirects and & don't hide a closing ) : `(cd sub && make) > log`.
    const tail = raw.replace(/(?:\s*(?:\d*>>?|&>>?|<)\s*\S+)+\s*$/, '')
    const closes = /\)+\s*$/.exec(tail)?.[0].trim().length ?? 0
    for (let k = 0; k < opens; k += 1) {
      scopes.push(dir)
    }

    const [first, ...args] = commandWords(raw)
    const cmd = (first ?? '').replace(/^\\/, '') // \rm skips aliases; it's still rm
    if (cmd === 'cd') {
      dir = args[0] === '-' ? '-' : joinDir(dir, args[0])
    } else if (cmd === 'pushd') {
      pushed.push(dir)
      dir = joinDir(dir, args[0])
    } else if (cmd === 'popd') {
      dir = pushed.length > 0 ? pushed.pop() : '-'
    } else if (cmd === 'rm' || cmd.endsWith('/rm')) {
      const dashes = args.indexOf('--')
      const options = (dashes === -1 ? args : args.slice(0, dashes)).filter(arg => arg.startsWith('-'))
      const isRecursive = options.some(flag => flag === '--recursive' || /^-[a-zA-Z]*[rR]/.test(flag))
      const isForced = options.some(flag => flag === '--force' || /^-[a-zA-Z]*f/.test(flag))
      if (isRecursive || isForced) {
        const targets = dashes === -1
          ? args.filter(arg => !arg.startsWith('-'))
          : [...args.slice(0, dashes).filter(arg => !arg.startsWith('-')), ...args.slice(dashes + 1)]
        risks.push({ rule: 'rm', label: `rm ${options.join(' ')}`, targets, ...(dir ? { dir } : {}) })
      }
    } else if (cmd !== '') {
      const risk = migration(cmd, args, dir)
      if (risk) {
        risks.push(risk)
      }
    }

    for (let k = 0; k < closes && scopes.length > 0; k += 1) {
      dir = scopes.pop() // a cd inside ( ... ) doesn't outlive it
    }
  }

  return risks
}

// --- commit messages ------------------------------------------------------------------

const ATTRIBUTION = [
  /^[ \t]*Co-Authored-By:[^\n]*(?:Claude|anthropic\.com)[^\n]*\n?/gim,
  /^[^\n]*Generated with \[?Claude Code[^\n]*\n?/gim,
]

// Removes Claude's co-author trailer and "Generated with Claude Code" line from a command.
export function stripAttribution(command: string): { command: string; isChanged: boolean } {
  let out = command
  for (const pattern of ATTRIBUTION) {
    out = out.replace(pattern, '')
  }
  // Lines removed at the end of a message leave blank lines before the closing quote or EOF.
  out = out.replace(/\n{2,}(\s*(?:EOF|["']))/g, '\n$1')

  return { command: out, isChanged: out !== command }
}

// The first line of the message a `git commit` gives inline, or undefined when it gives none
// this can read (an editor, -F, --no-edit, -C).
export function commitSubject(command: string, args: string): string | undefined {
  if (/(?:^|\s)(?:-F|--file|-C|-c|--reuse-message|--reedit-message|--no-edit|--fixup|--squash)\b/.test(args)) {
    return undefined
  }
  // Read from this commit on: a heredoc or a `-m` before it (a script, `python3 -m`) is not its message.
  const tail = commitTail(command, args)
  // `-m` may close a cluster of short flags (`-am`, `-qam`): the word after it is still the message.
  const heredoc = /(?:^|\s)(?:-[a-zA-Z]*m|--message)(?:=|\s+)["']?\$\(\s*cat\s+<<-?\s*['"]?(\w+)['"]?[^\n]*\n([\s\S]*?)\n\s*\1\b/.exec(tail)
  if (heredoc) {
    return firstLine(heredoc[2] ?? '')
  }
  const inline = /(?:^|\s)(?:-[a-zA-Z]*m|--message)(?:=|\s+)(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+))/.exec(tail)
  if (!inline) {
    return undefined
  }

  return firstLine(inline[1] ?? inline[2] ?? inline[3] ?? '')
}

const COMMIT_CALL =
  /(?:^|[;&|(\n`]|\$\()\s*(?:[A-Z_][A-Z0-9_]*=\S*\s+)*git(?:\s+-[Cc]\s+(?:"[^"]*"|'[^']*'|\S+)|\s+--[a-z-]+(?:=\S+)?)*\s+commit/g

// The command line from the `git commit` whose args are `args` on, past the `;&|` that end `args`.
function commitTail(command: string, args: string): string {
  for (const match of command.matchAll(COMMIT_CALL)) {
    const rest = command.slice(match.index + match[0].length)
    if (rest.startsWith(args)) {
      return rest
    }
  }

  return args
}

function firstLine(text: string): string | undefined {
  return text.split('\n').map(line => line.trim()).find(line => line !== '')
}

// `<emoji> type(scope)!: description`, emoji and scope optional, as the commit skill writes them.
const CONVENTIONAL = /^(?:\S+\s+)?[a-z]+(?:\([^)]+\))?!?: \S/

const EXEMPT_SUBJECT = /^(?:Merge |Revert "|fixup! |squash! |amend! |Initial commit)/

// `pattern`: the setting `commit_pattern`, in place of Conventional Commits.
export function badSubject(subject: string, pattern: RegExp = CONVENTIONAL): boolean {
  return !EXEMPT_SUBJECT.test(subject) && !pattern.test(subject)
}
