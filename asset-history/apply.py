#!/usr/bin/env python3
"""Guarded installer for the exact Nosdesk 1.1.0 source extension."""
import argparse, hashlib, json, subprocess
from pathlib import Path
EXPECTED='b4d3f2162972ba6e420ea10d16ca0fdcafeb8ac2'
def digest(data): return hashlib.sha256(data.replace(b'\r\n',b'\n')).hexdigest()
def plan(source,here):
 source=source.resolve()
 head=subprocess.check_output(['git','-c','safe.directory='+str(source),'-C',str(source),'rev-parse','HEAD'],text=True).strip()
 if head!=EXPECTED: raise ValueError('Source must be the exact official v1.1.0 commit.')
 manifest=json.loads((here/'patch-manifest.json').read_text())
 upgrade_file=here/'patch-upgrade-hashes.json'
 if upgrade_file.is_symlink(): raise ValueError('Symlinks are not accepted: patch-upgrade-hashes.json')
 upgrades=json.loads(upgrade_file.read_text()) if upgrade_file.exists() else {}
 if not isinstance(upgrades,dict) or any(relative not in manifest or not isinstance(hashes,list) or any(not isinstance(value,str) or len(value)!=64 or any(c not in '0123456789abcdef' for c in value) for value in hashes) for relative,hashes in upgrades.items()):
  raise ValueError('Invalid prior-extension hash inventory.')
 pending=[]
 for relative,expected in manifest.items():
  origin=here/'core-extension'/relative;target=source/relative
  try: target.resolve().relative_to(source)
  except ValueError: raise ValueError('Target escapes source directory: '+relative)
  if origin.is_symlink() or target.is_symlink(): raise ValueError('Symlinks are not accepted: '+relative)
  delivered=origin.read_bytes()
  if target.exists():
   actual=digest(target.read_bytes())
   if actual not in {expected,digest(delivered),*upgrades.get(relative,[])}: raise ValueError('Local edits detected; no files changed: '+relative)
  elif expected is not None: raise ValueError('Expected source file is missing: '+relative)
  pending.append((target,delivered))
 return pending
def main():
 parser=argparse.ArgumentParser();parser.add_argument('source',type=Path);parser.add_argument('--check',action='store_true');args=parser.parse_args();here=Path(__file__).resolve().parent
 try: pending=plan(args.source,here)
 except (ValueError,subprocess.CalledProcessError) as error: raise SystemExit('STOP: '+str(error))
 if args.check: print('Verified exact source and '+str(len(pending))+' guarded files; no changes made.');return
 for target,data in pending:
  target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
 print('Applied '+str(len(pending))+' history extension files. Existing Assets sidebar files were retained.')
if __name__=='__main__':main()
