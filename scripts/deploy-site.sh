#!/usr/bin/env bash
# 一键部署：先同步 fork 到上游最新，再把网站发布到 Vercel 生产，最后把好记域名指向新部署。
#
# 用法：
#   ./scripts/deploy-site.sh
# 可选环境变量：
#   VERCEL_TOKEN   Vercel 访问令牌（CI 里用；本地已 vercel login 可不填）
#   VERCEL_SCOPE   团队 scope（默认 haoping-xiaos-projects）
#   SITE_ALIAS     好记的生产域名（默认 coding-agents-101.vercel.app）
#   FORK_SYNC_TOKEN  同步 vendor fork 用的 PAT（可选；不配则 SKIP_SYNC=1）
#   SKIP_SYNC=1      跳过 fork 同步，只部署
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCOPE="${VERCEL_SCOPE:-haoping-xiaos-projects}"
ALIAS="${SITE_ALIAS:-coding-agents-101.vercel.app}"
TOKEN_ARG=()
[ -n "${VERCEL_TOKEN:-}" ] && TOKEN_ARG=(--token "$VERCEL_TOKEN")

# gh repo sync 需要对这些 fork 有写权限；CI 里用 FORK_SYNC_TOKEN（PAT），本地用 gh auth login
if [ -n "${FORK_SYNC_TOKEN:-}" ]; then
  export GH_TOKEN="$FORK_SYNC_TOKEN"
elif [ -n "${GITHUB_TOKEN:-}" ] && [ "${GITHUB_ACTIONS:-}" = "true" ]; then
  export GH_TOKEN="$GITHUB_TOKEN"
fi

# 1) 同步 fork（线上回答基于这些 fork 的最新代码）
if [ "${SKIP_SYNC:-0}" != "1" ]; then
  "$ROOT/scripts/sync-forks.sh"
fi

# 2) 预热单例 cloud agent（克隆好仓库，存 warm_agent_id 到 Turso）
if [ "${SKIP_WARM:-0}" != "1" ]; then
  if [ -n "${CURSOR_API_KEY:-}" ] && [ -n "${TURSO_DATABASE_URL:-}" ]; then
    echo "[deploy] 预热 cloud agent…"
    (cd "$ROOT/server" && [ -d node_modules ] || npm ci --omit=dev)
    node "$ROOT/server/warm-agent.mjs" || echo "[deploy] 预热失败（可忽略，首个提问会自动新建）"
  else
    echo "[deploy] 跳过预热（缺 CURSOR_API_KEY / TURSO_DATABASE_URL）"
  fi
fi

# 3) 部署到 Vercel 生产
cd "$ROOT/site"
URL="$(vercel deploy --prod --yes --scope "$SCOPE" "${TOKEN_ARG[@]}" | tail -1)"
echo "[deploy] 新生产部署：$URL"

# 3) 把好记域名指向这次部署（Vercel 默认生产别名会自动跟随；这步保证自定义好记域名也跟上）
if [ -n "$URL" ]; then
  vercel alias set "$URL" "$ALIAS" --scope "$SCOPE" "${TOKEN_ARG[@]}" || \
    echo "[deploy] 设置别名 $ALIAS 失败（可能未声明该域名），可忽略。"
fi

echo "[deploy] 完成 → https://$ALIAS"
