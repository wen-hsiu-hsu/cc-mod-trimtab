#!/usr/bin/env bash
# Mods cannot import outside their own folder, so shared code is copied into each mod.
# Checks that every copy matches its first one:
# - hooks/config.ts (layered settings), in every mod
# - the configIO block of each register file
# - hooks/scrub.ts of secret-scrub and project-memory
# - hooks/ui.tsx (the screens' shared parts, DESIGN.md), in every mod that has one
set -euo pipefail
cd "$(dirname "$0")/../mods"
status=0

compare() { # label, then the files to compare
  local label=$1 first=$2
  shift 2
  for file in "$@"; do
    if ! cmp -s "$first" "$file"; then
      echo "不同：${label}：${file#"${tmp:-}/"} 與 ${first#"${tmp:-}/"}" >&2
      status=1
    fi
  done
}

configs=(*/hooks/config.ts)
compare config.ts "${configs[@]}"
if [ "${#configs[@]}" -ne "$(ls -d */ | wc -l | tr -d ' ')" ]; then
  echo "缺少：有 mod 沒有 hooks/config.ts" >&2
  status=1
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
blocks=()
for mod in */; do
  mod=${mod%/}
  register=$mod/hooks/register.ts
  [ -f "$register" ] || register=$mod/hooks/register.tsx
  sed -n '/^\/\/ --- configIO:/,/^\/\/ --- end configIO ---/p' "$register" > "$tmp/$mod"
  if [ ! -s "$tmp/$mod" ]; then
    echo "缺少：${register} 沒有 configIO 區塊" >&2
    status=1
  fi
  blocks+=("$tmp/$mod")
done
compare configIO "${blocks[@]}"

compare scrub.ts secret-scrub/hooks/scrub.ts project-memory/hooks/scrub.ts

uis=(*/hooks/ui.tsx)
compare ui.tsx "${uis[@]}"

[ $status -eq 0 ] && echo "複本一致"
exit $status
