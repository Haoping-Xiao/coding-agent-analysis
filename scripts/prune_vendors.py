#!/usr/bin/env python3
"""Apply vendor sparse-checkout and prune rules from vendor-prune.yaml."""

from __future__ import annotations

import argparse
import fnmatch
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = Path(__file__).resolve().parent / "vendor-prune.yaml"
VENDORS_DIR = ROOT / "vendors"


def load_config(path: Path) -> dict:
    """Load vendor-prune.yaml (PyYAML if present, otherwise stdlib parser)."""
    text = path.read_text(encoding="utf-8")
    try:
        import yaml  # type: ignore

        data = yaml.safe_load(text)
        return data if isinstance(data, dict) else {}
    except ImportError:
        return _parse_yaml_subset(text)


def _parse_yaml_subset(text: str) -> dict:
    """Parse the constrained YAML shape used by vendor-prune.yaml."""

    def strip_quotes(value: str) -> str:
        value = value.strip()
        if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
            return value[1:-1]
        return value

    lines: list[tuple[int, str]] = []
    for raw in text.splitlines():
        if "#" in raw:
            raw = raw[: raw.index("#")]
        if not raw.strip():
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        lines.append((indent, raw.strip()))

    def parse_block(index: int, indent: int) -> tuple[dict, int]:
        result: dict = {}
        i = index
        current_key: str | None = None

        while i < len(lines):
            line_indent, content = lines[i]
            if line_indent < indent:
                break
            if line_indent > indent:
                i += 1
                continue

            if content.startswith("- "):
                if current_key is None:
                    raise ValueError(f"List item without key at line: {content}")
                value = strip_quotes(content[2:])
                bucket = result.setdefault(current_key, [])
                if not isinstance(bucket, list):
                    bucket = []
                    result[current_key] = bucket
                bucket.append(value)
                i += 1
                continue

            if content.endswith(":"):
                key = content[:-1]
                i += 1
                if i < len(lines) and lines[i][0] == line_indent + 2:
                    if lines[i][1].startswith("- "):
                        items: list[str] = []
                        while i < len(lines) and lines[i][0] == line_indent + 2 and lines[i][1].startswith("- "):
                            items.append(strip_quotes(lines[i][1][2:]))
                            i += 1
                        result[key] = items
                        current_key = key
                        continue
                    child, i = parse_block(i, line_indent + 2)
                    result[key] = child
                    current_key = key
                    continue
                result[key] = []
                current_key = key
                continue

            if ":" in content:
                key, value = content.split(":", 1)
                key = key.strip()
                value = strip_quotes(value)
                if value == "[]":
                    result[key] = []
                else:
                    result[key] = value
                current_key = key
                i += 1
                continue

            raise ValueError(f"Unsupported YAML line: {content}")

        return result, i

    parsed, _ = parse_block(0, 0)
    return parsed


def run_git(cwd: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=cwd,
        text=True,
        capture_output=True,
        check=check,
    )


def setup_sparse(vendor_path: Path, vendor_cfg: dict) -> None:
    mode = vendor_cfg.get("sparse_mode", "exclude")
    paths = vendor_cfg.get("sparse_paths") or []

    if mode == "only" and not paths:
        return

    run_git(vendor_path, "config", "core.sparseCheckout", "true")
    run_git(vendor_path, "config", "core.sparseCheckoutCone", "true")

    git_dir_raw = run_git(vendor_path, "rev-parse", "--git-dir").stdout.strip()
    git_dir = (vendor_path / git_dir_raw).resolve() if not Path(git_dir_raw).is_absolute() else Path(git_dir_raw)
    sparse_file = git_dir / "info" / "sparse-checkout"
    sparse_file.parent.mkdir(parents=True, exist_ok=True)

    lines: list[str]
    if mode == "only":
        lines = [f"/{p.strip('/')}" for p in paths]
    else:
        lines = ["/*"]
        for p in paths:
            p = p.strip("/")
            lines.append(f"!{p}")

    sparse_file.write_text("\n".join(lines) + "\n", encoding="utf-8")

    result = run_git(vendor_path, "sparse-checkout", "reapply", check=False)
    if result.returncode != 0:
        run_git(vendor_path, "read-tree", "-mu", "HEAD")


def _matches_glob(rel_posix: str, pattern: str) -> bool:
    pattern = pattern.replace("\\", "/")
    rel_posix = rel_posix.replace("\\", "/")
    if fnmatch.fnmatch(rel_posix, pattern):
        return True
    # Also allow patterns without ** prefix matching from repo root.
    return fnmatch.fnmatch(rel_posix, pattern.lstrip("/"))


def prune_vendor(vendor_path: Path, vendor_name: str, vendor_cfg: dict, global_cfg: dict) -> list[str]:
    removed: list[str] = []

    prune_paths = list(vendor_cfg.get("prune_paths") or [])
    prune_globs = list(global_cfg.get("prune_globs") or []) + list(vendor_cfg.get("prune_globs") or [])

    for rel in prune_paths:
        target = vendor_path / rel
        if target.exists():
            if target.is_dir():
                for root, dirs, files in os.walk(target, topdown=False):
                    for name in files:
                        p = Path(root) / name
                        removed.append(str(p.relative_to(vendor_path)))
                        p.unlink(missing_ok=True)
                    for name in dirs:
                        p = Path(root) / name
                        p.rmdir()
                target.rmdir()
            else:
                removed.append(rel)
                target.unlink(missing_ok=True)

    for path in sorted(vendor_path.rglob("*"), key=lambda p: len(p.parts), reverse=True):
        if not path.exists():
            continue
        if ".git" in path.parts:
            continue
        rel = path.relative_to(vendor_path).as_posix()
        if path.is_dir():
            rel_check = f"{rel}/"
        else:
            rel_check = rel
        for pattern in prune_globs:
            if _matches_glob(rel_check, pattern) or _matches_glob(rel, pattern):
                if path.is_dir():
                    # Remove files first; leave empty dirs for rmdir pass.
                    for child in sorted(path.rglob("*"), reverse=True):
                        if child.is_file() or child.is_symlink():
                            removed.append(str(child.relative_to(vendor_path)))
                            child.unlink(missing_ok=True)
                    if path.exists():
                        try:
                            path.rmdir()
                            removed.append(rel)
                        except OSError:
                            pass
                else:
                    removed.append(rel)
                    path.unlink(missing_ok=True)
                break

    return removed


def dir_size(path: Path) -> int:
    total = 0
    if not path.exists():
        return 0
    for root, _, files in os.walk(path):
        if "/.git" in root or root.endswith("/.git"):
            continue
        for f in files:
            try:
                total += (Path(root) / f).stat().st_size
            except OSError:
                pass
    return total


def human(n: int) -> str:
    units = ("B", "K", "M", "G")
    size = float(n)
    for unit in units:
        if size < 1024.0 or unit == "G":
            if unit == "B":
                return f"{int(size)}B"
            return f"{size:.1f}{unit}"
        size /= 1024.0
    return f"{size:.1f}G"


def report_sizes() -> None:
    print("Vendor sizes (working tree, excluding .git):")
    total = 0
    for vendor_path in sorted(VENDORS_DIR.iterdir()):
        if not vendor_path.is_dir():
            continue
        size = dir_size(vendor_path)
        total += size
        print(f"  {vendor_path.name:24} {human(size):>8}")
    print(f"  {'TOTAL':24} {human(total):>8}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--setup-sparse", action="store_true", help="Configure sparse-checkout for all vendors")
    parser.add_argument("--prune", action="store_true", help="Delete bloat paths from vendor working trees")
    parser.add_argument("--report", action="store_true", help="Print vendor directory sizes")
    parser.add_argument("--vendor", action="append", help="Limit to specific vendor name(s)")
    args = parser.parse_args()

    if not (args.setup_sparse or args.prune or args.report):
        parser.error("Specify at least one of --setup-sparse, --prune, --report")

    cfg = load_config(CONFIG_PATH)
    global_cfg = cfg.get("global") or {}
    vendors_cfg = cfg.get("vendors") or {}
    selected = set(args.vendor or [])

    if args.setup_sparse:
        for name, vendor_cfg in vendors_cfg.items():
            if selected and name not in selected:
                continue
            vendor_path = VENDORS_DIR / name
            if not (vendor_path / ".git").exists() and not run_git(vendor_path, "rev-parse", "--git-dir", check=False).returncode == 0:
                print(f"[skip] {name}: not a git checkout", file=sys.stderr)
                continue
            setup_sparse(vendor_path, vendor_cfg)
            print(f"[sparse] {name}: mode={vendor_cfg.get('sparse_mode', 'exclude')}")

    if args.prune:
        for name, vendor_cfg in vendors_cfg.items():
            if selected and name not in selected:
                continue
            vendor_path = VENDORS_DIR / name
            if not vendor_path.exists():
                continue
            removed = prune_vendor(vendor_path, name, vendor_cfg, global_cfg)
            print(f"[prune] {name}: removed {len(removed)} path(s)")

    if args.report:
        report_sizes()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
