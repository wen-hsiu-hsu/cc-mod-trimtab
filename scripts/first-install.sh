#!/usr/bin/env bash
# Opens Claude Code as a first-time user would: an empty config folder (no settings,
# plugins, marketplaces or stores of yours) and an empty working folder. Add the
# marketplace and install mods as the README says; the command to add it is printed
# first. Name mods here to have both done before Claude Code opens. Your ~/.claude is
# not touched.
#
#   scripts/first-install.sh [--local] [--keep] [<mod>...]
#
#   --local  use this clone's committed HEAD instead of GitHub (the pushed version)
#   --keep   keep the sandbox folder when Claude Code exits
#
# The empty config folder has no login: run /login, or set ANTHROPIC_API_KEY.
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
source=wen-hsiu-hsu/cc-mod-trimtab
keep=0
mods=()
for arg in "$@"; do
  case $arg in
    --local) source=local ;;
    --keep) keep=1 ;;
    -h | --help) sed -n '2,14s/^# \{0,1\}//p' "$0"; exit 0 ;;
    -*) echo "不認得的選項：$arg" >&2; exit 2 ;;
    *) mods+=("$arg") ;;
  esac
done

tmp=${TMPDIR:-/tmp}
sandbox=$(mktemp -d "${tmp%/}/cc-mod-first-install.XXXXXX")
if [ "$keep" = 1 ]; then
  trap 'echo "沙箱保留在 $sandbox"' EXIT
else
  trap 'rm -rf "$sandbox"' EXIT
fi
mkdir "$sandbox/config" "$sandbox/work"

if [ "$source" = local ]; then
  # A fresh clone, so uncommitted changes and this clone's own .claude stay out.
  git clone --quiet "$repo" "$sandbox/repo"
  source=$sandbox/repo
fi

# Drop the variables a running session sets, so a run from `!` starts a new session.
unset CLAUDECODE
for name in $(env | sed -n 's/^\(CLAUDE_CODE_[A-Za-z0-9_]*\)=.*/\1/p'); do
  unset "$name"
done
export CLAUDE_CONFIG_DIR=$sandbox/config
cd "$sandbox/work"

if [ "${#mods[@]}" -gt 0 ]; then
  claude plugin marketplace add "$source"
  for mod in "${mods[@]}"; do
    claude plugin install "$mod@cc-mod-trimtab"
  done
else
  echo "在 Claude Code 裡先加 marketplace：/plugin marketplace add $source"
  # Claude Code clears the screen when it opens, so wait until the command is noted.
  [ -t 0 ] && read -r -p "按 Enter 開啟 Claude Code" _
fi
claude
