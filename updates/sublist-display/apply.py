#!/usr/bin/env python3
"""Apply the complete guarded frontend extension, backing up each managed file."""
import argparse
import importlib.util
import json
from pathlib import Path
import shutil

parser = argparse.ArgumentParser()
parser.add_argument('source', type=Path)
parser.add_argument('--backup', type=Path)
args = parser.parse_args()
here = Path(__file__).resolve().parent
extension = here / 'frontend-extension'
if not extension.is_dir():
    extension = here.parents[1] / 'frontend-extension'
spec = importlib.util.spec_from_file_location('guarded_frontend', extension / 'apply.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
try:
    pending = module.plan(args.source, extension)
except Exception as error:
    raise SystemExit('STOP: ' + str(error))
# Nothing is written until every target has passed the source guard.
if args.backup:
    source = args.source.resolve()
    inventory = []
    for target, _ in pending:
        relative = target.relative_to(source)
        inventory.append({'path': relative.as_posix(), 'existed': target.exists()})
        if target.exists():
            destination = args.backup / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target, destination)
    args.backup.mkdir(parents=True, exist_ok=True)
    (args.backup / 'inventory.json').write_text(json.dumps(inventory, indent=2) + '\n')
for target, delivered in pending:
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(delivered)
print('Updated Assets sublists and per-asset assignment card; other source retained.')
