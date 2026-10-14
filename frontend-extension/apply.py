#!/usr/bin/env python3
"""Apply the sidebar only to the pinned Nosdesk source or known prior deliveries.

Build a complete write plan first. A conflict in the last file must not leave
an earlier file modified. Normalizing line endings accepts Windows checkouts
without treating unrelated source changes as compatible.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

EXPECTED = "b4d3f2162972ba6e420ea10d16ca0fdcafeb8ac2"


def digest(data):
    return hashlib.sha256(data.replace(b"\r\n", b"\n")).hexdigest()


def plan(source, here):
    source = source.resolve()
    head = subprocess.check_output(
        ["git", "-c", "safe.directory=" + str(source), "-C", str(source), "rev-parse", "HEAD"],
        text=True,
    ).strip()
    if head != EXPECTED:
        raise ValueError("source must be the exact official v1.1.0 commit")
    baseline = json.loads((here / "baseline.json").read_text())
    aliases_file = here / "previous-delivery-hashes.json"
    if aliases_file.is_symlink():
        raise ValueError("prior-delivery inventory must not be a symlink")
    aliases = json.loads(aliases_file.read_text()) if aliases_file.exists() else {}
    if not isinstance(aliases, dict) or any(key not in baseline or not isinstance(hashes, list) or any(not isinstance(value, str) or len(value) != 64 or any(c not in "0123456789abcdef" for c in value) for value in hashes) for key, hashes in aliases.items()):
        raise ValueError("prior-delivery inventory contains unmanaged files")
    pending = []
    for origin in sorted((here / "frontend").rglob("*")):
        if not origin.is_file():
            continue
        relative = origin.relative_to(here).as_posix()
        target = source / relative
        if relative not in baseline:
            raise ValueError("file missing from pinned inventory: " + relative)
        if origin.is_symlink() or target.is_symlink() or not target.resolve().is_relative_to(source):
            raise ValueError("unsafe source path: " + relative)
        delivered = origin.read_bytes()
        if target.exists():
            known = {baseline[relative], digest(delivered), *aliases.get(relative, [])}
            if digest(target.read_bytes()) not in known:
                raise ValueError("local edits detected; no files changed: " + relative)
        elif baseline[relative] is not None:
            raise ValueError("expected source file is missing: " + relative)
        pending.append((target, delivered))
    return pending


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        pending = plan(args.source, Path(__file__).resolve().parent)
    except (ValueError, subprocess.CalledProcessError) as error:
        raise SystemExit("STOP: " + str(error))
    if args.check:
        print(f"Verified {len(pending)} sidebar files; no changes made.")
        return
    for target, data in pending:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    print("Applied guarded Assets sidebar extension.")


if __name__ == "__main__":
    main()
