#!/usr/bin/env python3
import argparse
import hashlib
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('source', type=Path)
args = parser.parse_args()
source = args.source.resolve()
here = Path(__file__).resolve().parent
head = subprocess.check_output(['git', '-c', 'safe.directory=' + str(source), '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
if head != 'b4d3f2162972ba6e420ea10d16ca0fdcafeb8ac2':
    raise SystemExit('STOP: expected official Nosdesk v1.1.0 source.')
target = source / 'frontend/src/views/AssetCategoriesView.vue'
if target.is_symlink() or not target.is_file() or not target.resolve().is_relative_to(source):
    raise SystemExit('STOP: expected an existing, regular AssetCategoriesView.vue inside source.')
def digest(data):
    return hashlib.sha256(data.replace(b'\r\n', b'\n')).hexdigest()
# Release archives carry the page locally; a Git checkout uses its canonical source.
page = here / 'AssetCategoriesView.vue'
if not page.exists():
    page = here.parents[1] / 'frontend-extension/frontend/src/views/AssetCategoriesView.vue'
delivered = page.read_bytes()
previous = (here / 'previous-source-sha256.txt').read_text().strip()
prior = set(__import__('json').loads((here / 'previous-delivery-hashes.json').read_text()))
if digest(target.read_bytes()) not in {previous, digest(delivered), *prior}:
    raise SystemExit('STOP: this sublist page contains other edits; no source changed.')
target.write_bytes(delivered)
print('Updated saved-sublist display; other source files retained.')
