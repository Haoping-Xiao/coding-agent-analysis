#!/usr/bin/env bash
# CI / 本地发布前校验：站点数据、依赖、FAQ 自检（无需外部 token）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> 校验 site/data.js 结构"
node "$ROOT/scripts/validate-site-data.mjs"

echo "==> 安装 server 依赖"
(cd server && npm ci)

echo "==> server selftest（FAQ + vendors/）"
if [ "${CI_SKIP_VENDORS:-0}" = "1" ]; then
  echo "  跳过 vendors 检查（CI_SKIP_VENDORS=1）"
else
  (cd server && npm run selftest)
fi

echo "==> 安装 site 依赖（Vercel serverless）"
(cd site && npm ci)

echo "[validate-site] 全部通过"
