#!/usr/bin/env python3
"""Create portable, unsigned source/installer archives from canonical files.

No signing keys, instance installers, runtime dependencies or private operator
state are included. The display updater's duplicated inputs are assembled here
rather than edited in several checked-in places.
"""
import argparse
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SKIP = {".git", "node_modules", "__pycache__"}


def files(folder):
    for file in sorted(folder.rglob("*")):
        relative = file.relative_to(folder)
        if file.is_file() and not any(part in SKIP for part in relative.parts):
            if file.name.startswith(".env") or file.suffix in {".log", ".dump", ".zip", ".sk", ".key"}:
                continue
            yield file, relative


def archive(destination, prefix, entries):
    seen = set()
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as output:
        for file, relative in entries:
            name = prefix + "/" + Path(relative).as_posix()
            if name in seen:
                raise ValueError("duplicate archive input: " + name)
            seen.add(name)
            output.write(file, name)
    with zipfile.ZipFile(destination) as output:
        if output.testzip() is not None:
            raise ValueError("archive integrity failed")
    print(f"Verified {destination.name}: {len(seen)} files")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=ROOT / "dist")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    sublists = []
    for folder in ("plugin", "frontend-extension", "scripts", "docs"):
        sublists.extend((file, Path(folder) / relative) for file, relative in files(ROOT / folder))
    sublists.extend((ROOT / file, Path(file)) for file in ("README.md", "Dockerfile.assets", "SECURITY.md", "CHANGELOG.md"))
    archive(args.out / "nosdesk-asset-sublists.zip", "nosdesk-asset-sublists", sublists)
    archive(args.out / "nosdesk-asset-history.zip", "nosdesk-asset-history", files(ROOT / "asset-history"))
    update = list(files(ROOT / "updates/sublist-display"))
    update.extend((file, Path('frontend-extension') / relative) for file, relative in files(ROOT / 'frontend-extension'))
    update.extend((file, Path("payload") / relative) for file, relative in files(ROOT / "plugin/payload"))
    update.extend((file, Path("plugin-source") / relative) for file, relative in files(ROOT / "plugin"))
    archive(args.out / "nosdesk-sublist-display-update.zip", "nosdesk-sublist-display-update", update)


if __name__ == "__main__":
    main()
