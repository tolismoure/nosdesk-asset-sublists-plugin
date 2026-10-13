#!/usr/bin/env python3
import argparse, hashlib, json, shutil, subprocess
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('source',type=Path);a=p.parse_args();source=a.source.resolve();here=Path(__file__).resolve().parent
sha=subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip()
if sha!='b4d3f2162972ba6e420ea10d16ca0fdcafeb8ac2':raise SystemExit('STOP: source must be exact official v1.1.0 commit.')
baseline=json.loads((here/'baseline.json').read_text());files=list((here/'frontend').rglob('*'));files=[f for f in files if f.is_file()]
for f in files:
 relative=f.relative_to(here).as_posix();target=source/relative
 if target.exists():
  digest=hashlib.sha256(target.read_bytes()).hexdigest();delivered=hashlib.sha256(f.read_bytes()).hexdigest()
  if digest not in {baseline.get(relative),delivered}:raise SystemExit('STOP: local edits detected: '+relative)
for f in files:
 target=source/f.relative_to(here);target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(f,target)
print('Applied Assets sublists frontend extension to exact v1.1.0 source.')
