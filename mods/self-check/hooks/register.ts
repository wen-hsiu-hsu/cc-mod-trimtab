import type { EngineInterface, Register } from 'claude-code'

import { configCommand, LANGUAGE, loadConfig, pick, resolve, type ConfigIO, type Resolved, type Specs } from './config'
import { doneCheck, freshWork, noteCall, trackFailure } from './loops'
import type { Streak, Work } from './loops'

const MOD = 'self-check'

export const SPECS: Specs = {
  retry_nudge: {
    category: 'plain',
    type: 'boolean',
    default: true,
    repo: 'any',
    description: {
      en: 'When the same tool fails twice in a row for the same reason, ask Claude to find the cause first',
      'zh-TW': '同一個工具連續兩次因同樣原因失敗時，請 Claude 先找出原因',
    },
  },
  done_check: {
    category: 'plain',
    type: 'boolean',
    default: true,
    repo: 'any',
    description: {
      en: 'When Claude says it is done after editing code with no check run, block the stop once and ask it to verify',
      'zh-TW': '改過程式檔、沒跑檢查就說完成時，擋下停止一次請 Claude 驗證',
    },
  },
  language: LANGUAGE,
}

// --- configIO: the same block in every mod (scripts/check-copies.sh) ---
function configIO($: EngineInterface): ConfigIO {
  return {
    read: async path => {
      try {
        return await $.fs.read(path)
      } catch {
        return ''
      }
    },
    write: (path, text) => $.fs.write(path, text),
    isDir: async path => (await $.fs.stat(path).catch(() => undefined))?.kind === 'dir',
    configDir: async () => (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${(await $.env.get('HOME')) ?? ''}/.claude`,
    root: () => $.session.root(),
    repoRoot: async () => (await $.session.repo())?.root,
    sessionId: () => $.session.id(),
    now: () => $.clock.now(),
    storeGet: key => $.store.get(key),
    storeSet: (key, value) => $.store.set(key, value),
  }
}
// --- end configIO ---

// Both nudges speak to Claude, never block the user, and are skipped when they fail.
// Their records live in the module: a reload loses at most one nudge.
export const register: Register = (on, options) => {
  // Re-read at session start and after `/self-check set`; `/config` changes reload the module.
  let config: Resolved = resolve(SPECS, { options, user: {}, repo: {}, local: {}, session: {} })
  const isRetryNudgeOn = () => config.values.retry_nudge === true
  const isDoneCheckOn = () => config.values.done_check === true
  const streaks = new Map<string, Streak>()
  let work: Work = freshWork()

  on('session.start', async ($, e, next) => {
    try {
      config = await loadConfig(configIO($), MOD, SPECS, options)
    } catch (error) {
      $.ui.log(`session.start: settings not read: ${String(error)}`, { to: 'debug' })
    }
    const lang = config.lang
    try {
      await $.command.register({
        name: MOD,
        description: pick(lang, { en: 'View or change self-check settings', 'zh-TW': '看或改 self-check 的設定' }),
        argumentHint: 'status | set <key> <value> | unset <key>',
      })
    } catch (error) {
      $.ui.log(`session.start: /${MOD} not registered: ${String(error)}`, { to: 'debug' })
      $.ui.toast(pick(lang, { en: `${MOD}: /${MOD} was not registered (${String(error)})`, 'zh-TW': `${MOD}：/${MOD} 指令沒有註冊成功（${String(error)}）` }))
    }

    return next(e)
  })

  on('command.run', { command: MOD }, async ($, e) => {
    const text = await configCommand(configIO($), MOD, SPECS, options, e.args, resolved => {
      config = resolved
    })

    const usage = pick(config.lang, {
      en: `Usage: /${MOD} status, /${MOD} set <key> <value> [--session|--local|--repo], /${MOD} unset <key>`,
      'zh-TW': `用法：/${MOD} status、/${MOD} set <key> <value> [--session|--local|--repo]、/${MOD} unset <key>`,
    })

    return { text: text ?? usage }
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    try {
      if (result.deny !== undefined) {
        return result
      }
      const isFailed = result.isError === true
      // Only the main thread's own calls make up its turn: a subagent's edits and checks are not counted.
      if (isDoneCheckOn() && e.agentId === undefined) {
        noteCall(work, e.tool, e as unknown as Record<string, unknown>, isFailed)
      }
      if (!isRetryNudgeOn()) {
        return result
      }
      const text = result.text ?? (typeof result.result === 'string' ? result.result : undefined)
      const nudge = trackFailure(streaks, `${e.agentId ?? ''}|${e.tool}`, e.tool, isFailed, text)

      return nudge === undefined ? result : { ...result, context: [...(result.context ?? []), nudge] }
    } catch {
      return result
    }
  }).catch(($, e, next) => next(e))

  // An interrupted turn raises no Stop: drop its record so the next turn starts clean.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    try {
      if (e.agentId === undefined && e.reason !== 'answer') {
        work = freshWork()
      }
    } catch {
      // Keep the record; the turn's result goes on unchanged.
    }

    return result
  }).catch(($, e, next) => next(e))

  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    try {
      if (!isDoneCheckOn() || e.agent_id !== undefined) {
        return result
      }
      // Another Stop hook asked to go on: the turn has not ended, so judge the stop that does end it.
      if (result.block !== undefined) {
        return result
      }
      const reason = doneCheck(work, e.last_assistant_message, e.stop_hook_active === true, config.lang)
      if (reason !== undefined) {
        $.ui.log(pick(config.lang, { en: 'self-check: code was edited and not verified before saying done; asking Claude to verify first', 'zh-TW': 'self-check：改了程式檔卻沒驗證就說完成，請 Claude 先驗證' }))

        return { ...result, block: reason }
      }
      work = freshWork()
    } catch {
      // Skip the nudge; the stop goes through.
    }

    return result
  }).catch(($, e, next) => next(e))
}
