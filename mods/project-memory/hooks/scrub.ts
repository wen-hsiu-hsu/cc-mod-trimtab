// Finds secrets in free text and replaces their values with a placeholder, keeping the
// surrounding name (`token=`, `Authorization: Bearer`, `API_KEY=`) so the text still reads.

export const MASK = '‹redacted›'

// A prompt containing the marker is sent as typed (the marker itself removed), for the rare
// case where Claude really needs the secret. The marker is the setting `bypass_marker`.
export function bypassPattern(marker: string): RegExp {
  return new RegExp(`(^|\\s)${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\w)`)
}

export const BYPASS = bypassPattern('#noscrub')

// The settings `custom_rules` (masked whole) and `allow` (left as typed) compiled.
export type ScrubOptions = { rules?: readonly RegExp[]; allow?: readonly RegExp[] }

// Compiles each pattern, global for masking or not for testing; `bad` lists the ones that do not compile.
export function compilePatterns(patterns: readonly string[], flags: string): { patterns: RegExp[]; bad: string[] } {
  const compiled: RegExp[] = []
  const bad: string[] = []
  for (const pattern of patterns) {
    try {
      compiled.push(new RegExp(pattern, flags))
    } catch {
      bad.push(pattern)
    }
  }

  return { patterns: compiled, bad }
}

type Rule = {
  label: string
  pattern: RegExp
  // Index of the capture group holding the secret; 0 replaces the whole match.
  group: number
}

// Values shorter than this in name=value forms are treated as examples (`token=xxx`).
const MIN_VALUE = 8

const RULES: Rule[] = [
  {
    label: 'private key',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    group: 0,
  },
  { label: 'Anthropic key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g, group: 0 },
  { label: 'API key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g, group: 0 },
  { label: 'GitHub token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g, group: 0 },
  { label: 'Slack token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, group: 0 },
  { label: 'AWS key', pattern: /\bAKIA[0-9A-Z]{16}\b/g, group: 0 },
  { label: 'Google key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g, group: 0 },
  {
    label: 'JWT',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    group: 0,
  },
  {
    label: 'Bearer token',
    pattern: /\b(?:Bearer|Basic)\s+([A-Za-z0-9._~+\/=-]{8,})/g,
    group: 1,
  },
  {
    label: 'URL credential',
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@\/]+:([^\s@\/]{4,})@/gi,
    group: 1,
  },
  {
    label: 'query token',
    pattern:
      /[?&](?:access_token|refresh_token|id_token|token|api_?key|apikey|key|secret|client_secret|password|passwd|pwd|auth|sig|signature)=([^&#\s"'`<>]+)/gi,
    group: 1,
  },
  {
    // `token=…` typed in prose. Only unmistakable names: `key=`, `auth=` and the like are common in
    // code, and `${VAR}` / `{var}` placeholders are no secret.
    label: 'token',
    pattern:
      /(?<![\w.\/-])(?:access_token|refresh_token|id_token|token|api_?key|secret|client_secret|password|passwd)=(?![{$<])([^&#\s"'`<>()]+)/gi,
    group: 1,
  },
  {
    label: 'env secret',
    pattern:
      /^\s*(?:export\s+)?[A-Z0-9_]*(?:SECRET|TOKEN|API_?KEY|ACCESS_KEY|PASSWORD|PASSWD|PRIVATE_KEY|CREDENTIALS?)[A-Z0-9_]*\s*[=:]\s*["']?([^\s"'#]+)/gm,
    group: 1,
  },
]

export type Scrubbed = { text: string; labels: string[] }

export function scrub(input: string, options: ScrubOptions = {}): Scrubbed {
  const labels: string[] = []
  let text = input
  const allow = options.allow ?? []
  const custom = (options.rules ?? []).map(pattern => ({ label: 'custom rule', pattern, group: 0 }))

  for (const rule of [...RULES, ...custom]) {
    text = text.replace(rule.pattern, (match: string, ...rest: unknown[]) => {
      if (match.includes(MASK)) {
        return match
      }
      if (rule.group === 0) {
        if (allow.some(pattern => pattern.test(match))) {
          return match
        }
        labels.push(rule.label)

        return MASK
      }
      const value = rest[rule.group - 1]
      if (typeof value !== 'string' || value.length < MIN_VALUE || value.includes(MASK) || allow.some(pattern => pattern.test(value))) {
        return match
      }
      labels.push(rule.label)
      const at = match.lastIndexOf(value)

      return match.slice(0, at) + MASK + match.slice(at + value.length)
    })
  }

  return { text, labels }
}

// Counts each label once with its number: "query token ×2, JWT".
export function summarize(labels: string[]): string {
  const counts = new Map<string, number>()
  for (const label of labels) {
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }

  return [...counts].map(([label, n]) => (n > 1 ? `${label} ×${n}` : label)).join(', ')
}
