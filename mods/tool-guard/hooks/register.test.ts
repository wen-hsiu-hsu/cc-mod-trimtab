import type { On } from 'claude-code'
import { describe, expect, mock, test, type Engine } from 'claude-code/testing'

import { lostChanges, parseRm } from './preview'
import {
  badSubject,
  cleanDryRun,
  commitSubject,
  discardScope,
  discardsWorktree,
  gitCalls,
  isForcePush,
  pushTargets,
  shellRisks,
  stripAttribution,
} from './rules'

const HEREDOC_COMMIT = `git add a.ts && git commit -m "$(cat <<'EOF'
✨ feat(claude): 新增 tool-guard

刪掉 rm -rf build 的步驟

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"`

describe('git rules', () => {
  test('finds git calls after cd, -C and &&', () => {
    const calls = gitCalls('cd /repo && git -C sub status && git push --force origin main')
    expect(calls.map(call => call.sub)).toEqual(['status', 'push'])
    expect(calls[0]?.dir).toBe('sub')
    expect(calls[1]?.dir).toBe('/repo')
  })

  test('ignores git inside words and log greps', () => {
    expect(gitCalls('echo digit commit').length).toBe(0)
    expect(gitCalls('git log --oneline | grep commit').map(call => call.sub)).toEqual(['log'])
  })

  test('tells force pushes apart', () => {
    expect(isForcePush(' origin main --force')).toBe(true)
    expect(isForcePush(' -fu origin main')).toBe(true)
    expect(isForcePush(' origin +feature')).toBe(true)
    expect(isForcePush(' --follow-tags origin main')).toBe(false)
    expect(isForcePush(' origin v1')).toBe(false)
  })

  test('reads the branches a push overwrites', () => {
    expect(pushTargets(' --force')).toEqual([{ remote: 'origin', source: 'HEAD' }])
    expect(pushTargets(' -f upstream main')).toEqual([{ remote: 'upstream', source: 'main', branch: 'main' }])
    expect(pushTargets(' origin +feat:refs/heads/main')).toEqual([{ remote: 'origin', source: 'feat', branch: 'main' }])
    expect(pushTargets(' origin HEAD --force')).toEqual([{ remote: 'origin', source: 'HEAD' }])
  })

  test('flags worktree-discarding commands only', () => {
    const one = (command: string) => discardsWorktree(gitCalls(command)[0]!)
    expect(one('git reset --hard HEAD~1')).toBeDefined()
    expect(one('git checkout -- src/a.ts')).toBeDefined()
    expect(one('git restore src/a.ts')).toBeDefined()
    expect(one('git restore --staged src/a.ts')).toBeUndefined()
    expect(one('git clean -fd')).toBeDefined()
    expect(one('git checkout -b feature')).toBeUndefined()
    expect(one('git reset HEAD~1')).toBeUndefined()
  })

  test('knows which changes a discard overwrites', () => {
    const scope = (command: string) => discardScope(gitCalls(command)[0]!)
    expect(scope('git reset --hard')).toEqual({ paths: [], isStagedLost: true })
    expect(scope('git checkout -- a.ts b.ts')).toEqual({ paths: ['a.ts', 'b.ts'], isStagedLost: false })
    expect(scope('git checkout HEAD -- a.ts')).toEqual({ paths: ['a.ts'], isStagedLost: true })
    expect(scope('git checkout .')).toEqual({ paths: ['.'], isStagedLost: false })
    expect(scope('git restore --source HEAD~1 a.ts')).toEqual({ paths: ['a.ts'], isStagedLost: false })
    expect(scope('git restore -SW a.ts')).toEqual({ paths: ['a.ts'], isStagedLost: true })
  })

  test('counts staged rows only when they are lost', () => {
    const porcelain = 'M  staged.ts\n M unstaged.ts\nMM both.ts\n?? new.ts\n'
    expect(lostChanges(porcelain, false)).toEqual([' M unstaged.ts', 'MM both.ts'])
    expect(lostChanges(porcelain, true)).toEqual(['M  staged.ts', ' M unstaged.ts', 'MM both.ts'])
  })

  test('turns git clean into its dry run', () => {
    expect(cleanDryRun(' -fdx')).toEqual(['clean', '-n', '-dx', '--'])
    expect(cleanDryRun(' -f -e keep build')).toEqual(['clean', '-n', '-e', 'keep', '--', 'build'])
  })

  test('reads commit subjects from -m and heredocs', () => {
    expect(commitSubject('git commit -m "fix: x"', ' -m "fix: x"')).toBe('fix: x')
    expect(commitSubject(HEREDOC_COMMIT, ' -m "$(cat <<\'EOF\'')).toBe('✨ feat(claude): 新增 tool-guard')
    expect(commitSubject('git commit --amend --no-edit', ' --amend --no-edit')).toBeUndefined()
  })

  test('reads the message of the commit, not a heredoc or -m before it', () => {
    const subject = (command: string) => commitSubject(command, gitCalls(command).find(call => call.sub === 'commit')?.args ?? '')
    const script = `cat > fix.py <<'EOF'\np = 'a.md'\nEOF\npython3 fix.py && git commit -q -m "📝 docs(mods): x"`
    expect(subject(script)).toBe('📝 docs(mods): x')
    expect(subject(`python3 - <<'EOF'\nprint(1)\nEOF\ngit commit -m "fix: y"`)).toBe('fix: y')
    expect(subject('python3 -m pytest && git commit -m "fix: z"')).toBe('fix: z')
    expect(subject(`cat > a <<'EOF'\nhello\nEOF\n${HEREDOC_COMMIT}`)).toBe('✨ feat(claude): 新增 tool-guard')
    expect(subject('git commit -m "fix: a & b"')).toBe('fix: a & b')
    expect(subject('git commit -qam "docs: x" -m "body"')).toBe('docs: x')
    expect(subject('git commit -am "docs: y"')).toBe('docs: y')
    expect(subject('git commit --amend -m "docs: z"')).toBe('docs: z')
  })

  test('accepts conventional subjects with or without emoji', () => {
    expect(badSubject('✨ feat(claude): 新增 git-guard')).toBe(false)
    expect(badSubject('chore(test): 新增 npm run test:brief')).toBe(false)
    expect(badSubject('fix!: 改 API')).toBe(false)
    expect(badSubject('Merge branch main')).toBe(false)
    expect(badSubject('更新 README')).toBe(true)
    expect(badSubject('Update stuff')).toBe(true)
  })

  test('strips Claude attribution and the blank line it leaves', () => {
    const { command, isChanged } = stripAttribution(HEREDOC_COMMIT)
    expect(isChanged).toBe(true)
    expect(command).not.toContain('Co-Authored-By')
    expect(command).toContain('步驟\nEOF')
  })
})

describe('shell rules', () => {
  test('finds rm -r and rm -f, not a plain rm', () => {
    expect(shellRisks('rm -rf build')).toEqual([{ rule: 'rm', label: 'rm -rf', targets: ['build'] }])
    expect(shellRisks('sudo rm -r -- -weird dist')[0]).toMatchObject({ targets: ['-weird', 'dist'] })
    expect(shellRisks('rm a.txt')).toEqual([])
    expect(shellRisks('echo rm -rf x')).toEqual([])
  })

  test('follows cd, and a cd inside ( ) ends with it', () => {
    expect(shellRisks('cd sub && rm -rf out')[0]).toMatchObject({ dir: 'sub' })
    const risks = shellRisks('(cd sub && rm -rf a) && rm -rf b')
    expect(risks.map(risk => ('dir' in risk ? risk.dir : undefined))).toEqual(['sub', undefined])
  })

  test('does not read rm in quotes or heredocs as a command', () => {
    expect(shellRisks(HEREDOC_COMMIT)).toEqual([])
    expect(shellRisks('git commit -m "x; rm -rf y"')).toEqual([])
  })

  test('finds migrations but not their status commands', () => {
    expect(shellRisks('python3 manage.py migrate')[0]).toMatchObject({ rule: 'migrate', tool: 'django' })
    expect(shellRisks('npx prisma migrate deploy')[0]).toMatchObject({ tool: 'prisma' })
    expect(shellRisks('npx prisma migrate status')).toEqual([])
    expect(shellRisks('npm run migrate')[0]).toMatchObject({ tool: 'unknown' })
    expect(shellRisks('grep migrate README.md')).toEqual([])
  })

  test('parses the rm measurement', () => {
    expect(parseRm('3 4096 1\n./build/a.js\n./build/b.js\n')).toEqual({
      files: 3,
      bytes: 4096,
      paths: 1,
      listed: ['build/a.js', 'build/b.js'],
    })
  })
})

// The test environment has timers, which the hooks' own environment and its types do not.
declare const setTimeout: (callback: () => void, ms: number) => unknown

type Reply = { exitCode?: number; stdout?: string; stderr?: string }

// The suite asserts the zh-TW wording, so the user settings file says zh-TW unless a test gives another.
const ZH = '{"*":{"language":"zh-TW"}}'

// The engine beneath the plugin: `answer` replies to each process the guard runs, panes are
// placed or not, and Bash records the command it would have run.
function engine(on: On, answer: (argv: string[]) => Reply, isPlaced = false, userFile = ZH): { ran: string[]; opened: Promise<void> } {
  const ran: string[] = []
  mock.store(on)
  mock.env(on, { HOME: '/home' })
  on('session.id', () => ({ value: 's1' }))
  on('session.root', () => ({ value: '/repo' }))
  on('session.repo', () => ({ value: null }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => e as never)
  on('fs.read', ($, e) => {
    if (e.path === '/home/.claude/cc-mod-trimtab.json') {
      return { value: userFile }
    }
    throw new Error('ENOENT')
  })
  let markOpened = () => {}
  const opened = new Promise<void>(resolve => {
    markOpened = resolve
  })
  mock.clock(on)
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => {
    markOpened()

    return { value: isPlaced ? { isPlaced: true } : { isPlaced: false, reason: 'narrow' } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: '' }))
  on('process.run', async ($, e) => {
    if (e.argv[0] === 'sleep') {
      // Yield for real, so the hold's polling leaves room for the test to press a button.
      await new Promise<void>(resolve => setTimeout(resolve, 1))
    }
    const reply = e.argv[0] === 'sleep' ? {} : answer([...e.argv])

    return {
      value: {
        exitCode: reply.exitCode ?? 0,
        stdout: reply.stdout ?? '',
        stderr: reply.stderr ?? '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  on('tool.call', { tool: 'Bash' }, ($, e) => {
    ran.push(e.command)

    return { result: { stdout: '', stderr: '', interrupted: false } }
  })

  return { ran, opened }
}

// A repository on `branch` whose worktree holds `porcelain`, with `dropped` commits on the
// remote branch that HEAD lacks.
function repo(branch: string, porcelain = '', dropped = ''): (argv: string[]) => Reply {
  return argv => {
    const sub = argv.slice(1).join(' ')
    if (sub.startsWith('rev-parse --abbrev-ref')) {
      return { stdout: `${branch}\n` }
    }
    if (sub.startsWith('log --oneline')) {
      return { stdout: dropped }
    }
    if (sub.startsWith('status --porcelain')) {
      return { stdout: porcelain }
    }
    if (sub.startsWith('diff --shortstat')) {
      return { stdout: porcelain ? ' 1 file changed, 2 insertions(+)\n' : '' }
    }

    return {}
  }
}

// Starts the session; as a `-p` run (not interactive) there is no one to ask, so a risky command is denied outright.
async function begin($: Engine, isInteractive = true): Promise<void> {
  await $.session.start({ cwd: '/repo', surface: isInteractive ? 'terminal' : null, isInteractive } as never)
}

test('a force push that drops commits is denied with them listed, until /tool-guard allow', async ($, on) => {
  const { ran } = engine(on, repo('feature', '', 'abc123 同事的修正\n'))
  await begin($, false)
  const first = await $.tool.call({ tool: 'Bash', command: 'git push --force' })
  expect(first.deny).toContain('abc123 同事的修正')
  expect(first.deny).toContain('/tool-guard allow')
  expect(ran.length).toBe(0)

  await $.command.run({ command: 'tool-guard', args: 'allow' } as never)
  await $.tool.call({ tool: 'Bash', command: 'git push --force' })
  expect(ran).toEqual(['git push --force'])

  const third = await $.tool.call({ tool: 'Bash', command: 'git push --force' })
  expect(third.deny).toBeDefined()
})

test('a force push to a feature branch that drops nothing goes through', async ($, on) => {
  const { ran } = engine(on, repo('feature-x'))
  await begin($)
  await $.tool.call({ tool: 'Bash', command: 'git push --force-with-lease' })
  expect(ran.length).toBe(1)
})

test('a force push to main is always asked about', async ($, on) => {
  const { ran } = engine(on, repo('main'))
  await begin($)
  const blocked = await $.tool.call({ tool: 'Bash', command: 'git push -f origin main' })
  expect(blocked.deny).toContain('origin/main')
  expect(ran.length).toBe(0)
})

test('reset --hard over a clean worktree goes through', async ($, on) => {
  const clean = engine(on, repo('main'))
  await begin($)
  await $.tool.call({ tool: 'Bash', command: 'git reset --hard' })
  expect(clean.ran.length).toBe(1)
})

test('reset --hard over a dirty worktree is denied with the files', async ($, on) => {
  const { ran } = engine(on, repo('main', ' M src/a.ts\n?? new.ts\n'))
  await begin($)
  const blocked = await $.tool.call({ tool: 'Bash', command: 'git reset --hard' })
  expect(blocked.deny).toContain(' M src/a.ts')
  expect(blocked.deny).not.toContain('new.ts')
  expect(ran.length).toBe(0)
})

test('rm -rf asks with the files it deletes, and passes when nothing outside temp matches', async ($, on) => {
  let measured = '2 8192 1\n./build/a.js\n./build/b.js\n'
  const { ran } = engine(on, argv => (argv[0] === 'bash' ? { stdout: measured } : {}))
  await begin($)
  const blocked = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(blocked.deny).toContain('刪除 2 個檔案（約 8.0 KB）')
  expect(blocked.deny).toContain('build/a.js')

  measured = '0 0 0\n'
  await $.tool.call({ tool: 'Bash', command: 'rm -rf "$TMPDIR/x"' })
  expect(ran).toEqual(['rm -rf "$TMPDIR/x"'])
})

test('a migration with pending steps is asked about; one with none runs', async ($, on) => {
  let plan = '[X]  app.0001_initial\n[ ]  app.0002_add_field\n'
  const { ran } = engine(on, argv => (argv[0] === 'python3' ? { stdout: plan } : {}))
  await begin($)
  const blocked = await $.tool.call({ tool: 'Bash', command: 'python3 manage.py migrate' })
  expect(blocked.deny).toContain('app.0002_add_field')

  plan = '[X]  app.0001_initial\n'
  await $.tool.call({ tool: 'Bash', command: 'python3 manage.py migrate' })
  expect(ran.length).toBe(1)
})

const PANE = {
  plugin: 'tool-guard',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'tool-guard',
  props: { title: 'tool-guard', isFocused: true, bodyColumns: 100, placement: 'inline' },
} as const

test('with a pane, the command waits for the person: Proceed runs it', async ($, on) => {
  const { ran, opened } = engine(on, repo('main', ' M src/a.ts\n'), true)
  await begin($)
  const pane = await $.ui.mount(PANE as never)
  const pending = $.tool.call({ tool: 'Bash', command: 'git reset --hard' })
  await opened
  // find() and drawn() wait for the polling hold to settle, so the press is the check that
  // the pane drew this hold: the drawing beneath has no buttons.
  await pane.press({ key: 'proceed' })
  const result = await pending
  expect(result.deny).toBeUndefined()
  expect(ran).toEqual(['git reset --hard'])
})

test('with a pane, Cancel refuses the command without asking for /tool-guard allow', async ($, on) => {
  const { ran, opened } = engine(on, repo('main', ' M src/a.ts\n'), true)
  await begin($)
  const pane = await $.ui.mount(PANE as never)
  const pending = $.tool.call({ tool: 'Bash', command: 'git reset --hard' })
  await opened
  await pane.press({ key: 'cancel' })
  const result = await pending
  expect(result.deny).toContain('使用者按了取消')
  expect(result.deny).not.toContain('/tool-guard allow')
  expect(ran.length).toBe(0)
})

test('rewrites a commit to drop the co-author trailer', async ($, on) => {
  const { ran } = engine(on, repo('main'))
  await begin($)
  await $.tool.call({ tool: 'Bash', command: HEREDOC_COMMIT })
  expect(ran.length).toBe(1)
  expect(ran[0]).not.toContain('Co-Authored-By')
})

test('blocks a commit whose subject is not conventional', { options: { commit_format: true } }, async ($, on) => {
  const { ran } = engine(on, repo('main'))
  await begin($)
  const blocked = await $.tool.call({ tool: 'Bash', command: 'git commit -m "更新 README"' })
  expect(blocked.deny).toContain('Conventional Commits')
  expect(ran.length).toBe(0)
})

test('a failing check blocks guarded commands but not other ones, until /tool-guard allow', async ($, on) => {
  const ran: string[] = []
  mock.clock(on)
  on('ui.toast', () => ({ value: undefined }))
  on('process.run', () => {
    throw new Error('git not found')
  })
  on('tool.call', { tool: 'Bash' }, ($, e) => {
    ran.push(e.command)

    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  mock.store(on)
  mock.env(on, { HOME: '/home' })
  on('session.id', () => ({ value: 's1' }))
  on('session.root', () => ({ value: '/repo' }))
  on('session.repo', () => ({ value: null }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => e as never)
  on('fs.read', ($, e) => {
    if (e.path === '/home/.claude/cc-mod-trimtab.json') {
      return { value: ZH }
    }
    throw new Error('ENOENT')
  })
  await begin($)

  const blocked = await $.tool.call({ tool: 'Bash', command: 'git reset --hard' })
  expect(blocked.deny).toContain('檢查失敗')
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(ran).toEqual(['ls'])

  await $.command.run({ command: 'tool-guard', args: 'allow' } as never)
  await $.tool.call({ tool: 'Bash', command: 'git reset --hard' })
  expect(ran).toEqual(['ls', 'git reset --hard'])
})

// Answers the AskUserQuestion dialog the guard falls back to when its pane is not placed.
function dialog(on: On, answer: (question: string) => string): string[] {
  const asked: string[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, ($, e) => {
    const question = e.questions[0]?.question ?? ''
    asked.push(question)

    return { result: { questions: e.questions, answers: { [question]: answer(question) } } } as never
  })

  return asked
}

test('without room for the pane, the dialog asks instead and 執行 runs the command', async ($, on) => {
  const { ran } = engine(on, repo('main', ' M src/a.ts\n'))
  const asked = dialog(on, () => '執行')
  await begin($)
  const result = await $.tool.call({ tool: 'Bash', command: 'git reset --hard' })
  expect(result.deny).toBeUndefined()
  expect(asked[0]).toContain('丟掉 1 個檔案未 commit 的改動')
  expect(ran).toEqual(['git reset --hard'])
})

test('a reply typed into the dialog reaches Claude with the refusal', async ($, on) => {
  const { ran } = engine(on, repo('main', ' M src/a.ts\n'))
  dialog(on, () => '先 stash 再 reset')
  await begin($)
  const result = await $.tool.call({ tool: 'Bash', command: 'git reset --hard' })
  expect(result.deny).toContain('先 stash 再 reset')
  expect(ran.length).toBe(0)
})

test('a non-interactive run is denied without asking', async ($, on) => {
  const { ran } = engine(on, repo('main', ' M src/a.ts\n'))
  const asked = dialog(on, () => '執行')
  await begin($, false)
  const result = await $.tool.call({ tool: 'Bash', command: 'git reset --hard' })
  expect(result.deny).toContain('/tool-guard allow')
  expect(asked.length).toBe(0)
  expect(ran.length).toBe(0)
})

test('lets a commit subject through when commit_format is off (the default)', async ($, on) => {
  const { ran } = engine(on, repo('main'))
  await begin($)
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "更新 README"' })
  expect(ran).toEqual(['git commit -m "更新 README"'])
})

test('checks subjects against commit_pattern when one is set', { options: { commit_format: true, commit_pattern: '^\\[\\w+\\] ' } }, async ($, on) => {
  const { ran } = engine(on, repo('main'))
  await begin($)
  const blocked = await $.tool.call({ tool: 'Bash', command: 'git commit -m "fix: x"' })
  expect(blocked.deny).toContain('不符合這個 repo 設定的格式 `^\\[\\w+\\] `')
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "[core] x"' })
  expect(ran).toEqual(['git commit -m "[core] x"'])
})

test('keeps the co-author trailer when strip_attribution is off', { options: { strip_attribution: false } }, async ($, on) => {
  const { ran } = engine(on, repo('main'))
  await begin($)
  await $.tool.call({ tool: 'Bash', command: HEREDOC_COMMIT })
  expect(ran[0]).toContain('Co-Authored-By')
})

test('hands rm_skip_paths from the user settings file to the rm measurement', async ($, on) => {
  const argvs: string[][] = []
  engine(
    on,
    argv => (argvs.push(argv), argv[0] === 'bash' ? { stdout: '0 0 0\n' } : {}),
    false,
    '{"*":{"language":"zh-TW"},"tool-guard":{"rm_skip_paths":["~/scratch","/data/cache"]}}',
  )
  await begin($, false)
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  const bash = argvs.find(argv => argv[0] === 'bash')
  expect(bash?.slice(3)).toEqual(['tool-guard', '~/scratch\n/data/cache', 'build'])
  expect((await $.command.run({ command: 'tool-guard', args: 'status' } as never)).text).toMatch(/rm_skip_paths = ~\/scratch, \/data\/cache {2}\[使用者\]/)
})

test('the wording is English by default: the pane buttons, the denial and the toast', { options: { commit_format: true } }, async ($, on) => {
  const { ran } = engine(on, repo('main', ' M src/a.ts\n'), false, '')
  await begin($, false)
  const dirty = await $.tool.call({ tool: 'Bash', command: 'git reset --hard' })
  expect(dirty.deny).toContain('Discards uncommitted changes in 1 file(s)')
  expect(dirty.deny).toContain('ask them to type /tool-guard allow')
  const subject = await $.tool.call({ tool: 'Bash', command: 'git commit -m "update README"' })
  expect(subject.deny).toContain('does not follow Conventional Commits')
  expect(ran.length).toBe(0)
  expect((await $.command.run({ command: 'tool-guard', args: '' } as never)).text).toMatch(/^Usage: /)
})

test('a command waits in the pane with English buttons by default', async ($, on) => {
  const { opened } = engine(on, repo('main', ' M src/a.ts\n'), true, '')
  await begin($)
  const pane = await $.ui.mount(PANE as never)
  const pending = $.tool.call({ tool: 'Bash', command: 'git reset --hard' })
  await opened
  await pane.press({ key: 'cancel' })
  const result = await pending
  expect(result.deny).toContain('The user pressed Cancel')
})
