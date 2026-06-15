#!/usr/bin/env bash
# 把「线上 AI 问答」用到的 vendor fork 仓库同步到各自上游最新。
#
# 线上问答（Vercel + Cursor cloud）会 clone 这些 fork 来读源码（见 site/api/_lib.js 的 REPOS），
# 所以部署前跑一遍这个脚本，就能让回答基于最新代码。
#
# 依赖：gh CLI，且已登录【对这些 fork 有写权限】的账号（gh auth login）。
# 注意：这些 fork 当作上游的镜像用（你不在 fork 上提交），所以用 --force 硬同步，避免分叉导致的同步失败。
set -uo pipefail

# 每行：<fork>|<upstream>|<branch>
FORKS=(
  "Haoping-Xiao/codex|openai/codex|main"
  "Haoping-Xiao/opencode|anomalyco/opencode|dev"
  "Haoping-Xiao/kimi-code|MoonshotAI/kimi-code|main"
  "Haoping-Xiao/claude-code-sourcemap|ChinaSiro/claude-code-sourcemap|main"
  "Haoping-Xiao/gemini-cli|google-gemini/gemini-cli|main"
)

if ! command -v gh >/dev/null 2>&1; then
  echo "[sync-forks] 需要 gh CLI：https://cli.github.com/ ，并先 gh auth login" >&2
  exit 1
fi

fail=0
for entry in "${FORKS[@]}"; do
  IFS='|' read -r fork src branch <<< "$entry"
  echo "==> 同步 $fork  (<= $src @ $branch)"
  if ! gh repo sync "$fork" --source "$src" --branch "$branch" --force; then
    echo "    [warn] $fork 同步失败，跳过" >&2
    fail=1
  fi
done

[ "$fail" -eq 0 ] && echo "[sync-forks] 全部完成。" || echo "[sync-forks] 部分失败，见上面 warn。"
exit 0
