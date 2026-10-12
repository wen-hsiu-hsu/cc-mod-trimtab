#!/usr/bin/env bash
# Keeps the docs in step with the mods (docs/development.md, "改完之後").
#
# scripts/check-docs.sh            structure, run by CI:
#   - every mod has docs/mods/<mod>.md and .zh-TW.md, linked from README.md and README.zh-TW.md
#   - every relative link in the repo's Markdown points at a file that exists
#   - every ADR is listed in docs/adr/README.md
# scripts/check-docs.sh --commit   a Claude Code PreToolUse hook (.claude/settings.json):
#   reads the hook input on stdin and, for a `git commit`, checks what is staged:
#   - mod code without that mod's docs needs a `Docs: n/a <reason>` line in the message
#   - mod code without a new or changed ADR needs an `ADR: n/a <reason>` line
#   - a doc changed in one language only needs a `Docs: n/a <reason>` line
#   and, for a `git push`, checks what changed since the latest `v*` tag (docs/development.md, "發佈"):
#   - a mod changed without a higher `version` in its plugin.json
#   - a mod version missing from CHANGELOG.md
#   - mods changed without a new `v*` tag on HEAD
#   A `# Release: n/a <reason>` comment in the push command skips these.
set -euo pipefail

structure() {
  cd "$(dirname "$0")/.."
  local status=0 mod file link target dir
  for dir in mods/*/; do
    mod=$(basename "$dir")
    for file in "docs/mods/$mod.md" "docs/mods/$mod.zh-TW.md"; do
      [ -f "$file" ] || { echo "缺少：$file" >&2; status=1; }
    done
    grep -q "docs/mods/$mod.md" README.md || { echo "README.md 沒有連到 docs/mods/$mod.md" >&2; status=1; }
    grep -q "docs/mods/$mod.zh-TW.md" README.zh-TW.md || { echo "README.zh-TW.md 沒有連到 docs/mods/$mod.zh-TW.md" >&2; status=1; }
  done
  while IFS= read -r file; do
    dir=$(dirname "$file")
    # Inline links outside code spans: drop `code` first, then take each ](target).
    while IFS= read -r link; do
      target=${link#](}
      target=${target%)}
      target=${target%%#*}
      case $target in '' | http://* | https://* | mailto:*) continue ;; esac
      [ -e "$dir/$target" ] || { echo "連結不存在：$file → $target" >&2; status=1; }
    done < <(sed -E 's/`[^`]*`//g' "$file" | grep -oE '\]\([^) ]+\)' || true)
  done < <(git ls-files --cached --others --exclude-standard '*.md' | grep -v '^mods/.*/node_modules/')
  for file in docs/adr/[0-9][0-9][0-9][0-9]-*.md; do
    [ -e "$file" ] || continue
    grep -q "($(basename "$file"))" docs/adr/README.md || { echo "ADR 沒列在 docs/adr/README.md：$file" >&2; status=1; }
  done
  return $status
}

deny() {
  jq -n --arg reason "$1" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $reason}}'
  exit 0
}

# A git subcommand anywhere in the command, `git -C <dir> <sub>` included.
runs_git() {
  grep -qE "(^|[;&|[:space:]])git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+$1\b" <<<"$2"
}

hook() {
  local input command cwd
  input=$(cat)
  command=$(jq -r '.tool_input.command // ""' <<<"$input")
  cwd=$(jq -r '.cwd // "."' <<<"$input")
  if runs_git commit "$command"; then commit "$command" "$cwd"; fi
  if runs_git push "$command"; then push "$command" "$cwd"; fi
  exit 0
}

push() {
  local command=$1 cwd=$2 base mod file now old problems='' changed
  grep -qE '(^|[[:space:]#])Release: n/a' <<<"$command" && return 0
  cd "$cwd"
  base=$(git describe --tags --abbrev=0 --match 'v[0-9]*' HEAD 2>/dev/null) || return 0
  changed=$(git diff --name-only "$base" HEAD -- mods | grep -vE '\.test\.tsx?$' | cut -d/ -f2 | sort -u || true)
  [ -z "$changed" ] && return 0
  for mod in $changed; do
    file="mods/$mod/.claude-plugin/plugin.json"
    # A mod removed since the tag has nothing to bump.
    now=$(git show "HEAD:$file" 2>/dev/null | jq -r '.version // ""') || continue
    old=$(git show "$base:$file" 2>/dev/null | jq -r '.version // ""' || true)
    if [ "$now" = "$old" ]; then
      problems+="- $base 之後改了 mods/${mod}，plugin.json 的 version 仍是 ${now}。\n"
    # "`mod` 1.2.3:" under [Unreleased], or "| `mod` | 1.2.3 |" in a release's table.
    elif ! git show HEAD:CHANGELOG.md | grep -qE "\`$mod\`[ |]+${now//./\\.}([^0-9]|$)"; then
      problems+="- CHANGELOG.md 沒有 \`${mod}\` ${now}。\n"
    fi
  done
  git tag --points-at HEAD | grep -q '^v[0-9]' ||
    problems+="- $base 之後改了 mod（$(echo $changed | tr ' ' ',')），HEAD 還沒打新的 v* tag。\n"
  [ -z "$problems" ] && return 0
  deny "$(printf 'check-docs：這次 push 的發佈步驟可能沒做完（docs/development.md「發佈」）：\n%b\n調高 version、寫 CHANGELOG、打 tag 後再 push。確定這次不發佈新版時，在 push 指令後加註解 `# Release: n/a <理由>`。' "$problems")"
}

commit() {
  local command=$1 cwd=$2 staged mod problems='' docs_na=0 adr_na=0 base
  grep -qE '(^|[[:space:]"'\''])Docs: n/a' <<<"$command" && docs_na=1
  grep -qE '(^|[[:space:]"'\''])ADR: n/a' <<<"$command" && adr_na=1
  cd "$cwd"
  staged=$(git diff --cached --name-only)
  # `git commit -a` also takes every tracked change.
  if grep -qE '[[:space:]](-a|--all|-[a-zA-Z]*a[a-zA-Z]*)([[:space:]]|$)' <<<"$command"; then
    staged=$(printf '%s\n%s' "$staged" "$(git diff --name-only)")
  fi
  has() { grep -qxE "$1" <<<"$staged"; }

  local code_mods
  code_mods=$(grep -E '^mods/[^/]+/(hooks/|\.claude-plugin/plugin\.json$)' <<<"$staged" | grep -vE '\.test\.tsx?$' | cut -d/ -f2 | sort -u || true)
  if [ "$docs_na" -eq 0 ]; then
    for mod in $code_mods; do
      has "docs/mods/$mod(\.zh-TW)?\.md" || problems+="- 改了 mods/$mod 的程式，卻沒改 docs/mods/$mod.md 與 .zh-TW.md。\n"
    done
    for base in README docs/install docs/settings $(grep -oE '^docs/mods/[^/.]+' <<<"$staged" | sort -u || true); do
      if has "$base\.md" && ! has "$base\.zh-TW\.md"; then problems+="- 改了 $base.md，沒改 $base.zh-TW.md。\n"; fi
      if has "$base\.zh-TW\.md" && ! has "$base\.md"; then problems+="- 改了 $base.zh-TW.md，沒改 $base.md。\n"; fi
    done
  fi
  if [ "$adr_na" -eq 0 ] && [ -n "$code_mods" ] && ! has 'docs/adr/[0-9]{4}-.*\.md'; then
    problems+="- 改了 mod 的程式（$(echo $code_mods | tr ' ' ',')），沒有新增或修改 ADR。\n"
  fi
  [ -z "$problems" ] && return 0
  deny "$(printf 'check-docs：這次 commit 的文件可能沒跟上（docs/development.md「改完之後」）：\n%b\n補上文件後再 commit。行為沒變、或沒有在幾個做法之間取捨過的決定時，在 commit 訊息最後加一行 `Docs: n/a <理由>` 或 `ADR: n/a <理由>`。' "$problems")"
}

case ${1:-} in
  --commit) hook ;;
  '') structure ;;
  *) echo "用法：$0 [--commit]" >&2; exit 2 ;;
esac
