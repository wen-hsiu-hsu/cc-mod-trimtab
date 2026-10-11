import type { EngineInterface, Register } from 'claude-code'

import { configCommand, LANGUAGE, loadConfig, pick, resolve, type ConfigIO, type Resolved, type Specs } from './config'
import { asLog, LIMITS, shouldTrim, trim } from './trim'

const MOD = 'output-trimmer'

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

export const SPECS: Specs = {
  max_lines: {
    category: 'plain',
    type: 'number',
    default: LIMITS.maxLines,
    repo: 'any',
    min: 50,
    max: 5000,
    description: {
      en: 'When Bash output has more lines than this, the model gets only the head, the tail and the error lines',
      'zh-TW': 'Bash 輸出超過這麼多行時只給模型開頭、結尾與錯誤行',
    },
  },
  max_chars: {
    category: 'plain',
    type: 'number',
    default: LIMITS.maxChars,
    repo: 'any',
    min: 2000,
    max: 200000,
    description: { en: 'The same when Bash output has more characters than this', 'zh-TW': 'Bash 輸出超過這麼多字元時同樣處理' },
  },
  language: LANGUAGE,
}

type Block = { type: string; [key: string]: unknown }

async function saveDir($: EngineInterface): Promise<string> {
  const tmp = ((await $.env.get('TMPDIR')) ?? '/tmp').replace(/\/$/, '')

  return `${tmp}/claude-output-trimmer/${await $.session.id()}`
}

function textOf(content: unknown): string | undefined {
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content) || !content.every(part => (part as Block).type === 'text')) {
    // Images or other blocks: leave the result alone.
    return undefined
  }

  return content.map(part => String((part as Block).text ?? '')).join('\n')
}

export const register: Register = (on, options) => {
  // tool_use_id of each Bash call whose output may be shortened, until its result row lands.
  const watched = new Set<string>()
  // Re-read at session start and after `/output-trimmer set`; `/config` changes reload the module.
  let config: Resolved = resolve(SPECS, { options, user: {}, repo: {}, local: {}, session: {} })
  const limits = () => ({ maxLines: config.values.max_lines as number, maxChars: config.values.max_chars as number })

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
        description: pick(lang, { en: 'View or change output-trimmer settings', 'zh-TW': '看或改 output-trimmer 的設定' }),
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

  on('tool.call', { tool: 'Bash' }, ($, e, next) => {
    if (e.tool_use_id && !e.run_in_background && shouldTrim(e.command)) {
      watched.add(e.tool_use_id)
    }

    return next(e)
  })

  on('session.append', { door: 'tool-result' }, async ($, e, next) => {
    if (watched.size === 0) {
      return next(e)
    }

    let saved = 0
    const content = await Promise.all(
      e.message.content.map(async block => {
        const id =
          block.type === 'tool_result' && typeof block.tool_use_id === 'string' ? block.tool_use_id : undefined
        if (id === undefined || !watched.has(id)) {
          return block
        }
        watched.delete(id)
        const text = textOf(block.type === 'tool_result' ? block.content : undefined)
        if (text === undefined) {
          return block
        }
        const path = `${await saveDir($)}/${id}.log`
        const trimmed = trim(text, path, limits(), config.lang)
        if (!trimmed) {
          return block
        }
        await $.fs.write(path, asLog(text))
        saved += trimmed.dropped

        return { ...block, content: trimmed.text }
      }),
    )

    if (saved === 0) {
      return next(e)
    }
    $.ui.toast(pick(config.lang, { en: `output-trimmer: ${saved} lines of output left out, the whole is saved`, 'zh-TW': `output-trimmer：省略 ${saved} 行輸出，完整內容已存檔` }))

    return next({ ...e, message: { ...e.message, content } })
  }).catch(($, e, next) => next(e))
}
