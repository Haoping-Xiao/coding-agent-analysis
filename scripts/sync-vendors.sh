#!/usr/bin/env bash
# Sync vendor submodules from upstream and slim working trees for source analysis.
#
# Usage:
#   ./scripts/sync-vendors.sh              # setup sparse + fetch latest + prune + report
#   ./scripts/sync-vendors.sh --no-remote  # prune only, keep pinned submodule commits
#   ./scripts/sync-vendors.sh --setup-only # configure sparse-checkout, no fetch
#   ./scripts/sync-vendors.sh --prune-only # delete bloat from current trees
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

REMOTE=1
SETUP=1
PRUNE=1

for arg in "$@"; do
  case "$arg" in
    --no-remote) REMOTE=0 ;;
    --setup-only) REMOTE=0; PRUNE=0 ;;
    --prune-only) REMOTE=0; SETUP=0 ;;
    -h|--help)
      sed -n '2,8p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

if [[ "$SETUP" -eq 1 ]]; then
  echo "==> Configuring sparse-checkout from scripts/vendor-prune.yaml"
  python3 "$ROOT/scripts/prune_vendors.py" --setup-sparse
fi

if [[ "$REMOTE" -eq 1 ]]; then
  echo "==> Syncing submodule remotes"
  git submodule sync --recursive

  echo "==> Fetching latest vendor commits (shallow)"
  git submodule update --init --recursive --depth 1 --remote
fi

if [[ "$PRUNE" -eq 1 ]]; then
  echo "==> Pruning vendor bloat"
  python3 "$ROOT/scripts/prune_vendors.py" --prune
fi

echo "==> Vendor sizes after sync"
python3 "$ROOT/scripts/prune_vendors.py" --report
