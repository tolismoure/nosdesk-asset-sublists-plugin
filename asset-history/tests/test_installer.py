import importlib.util, json, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('history_apply',Path(__file__).parents[1]/'apply.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class InstallerTests(unittest.TestCase):
 def test_valid_source_and_repeat_apply(self):
  with tempfile.TemporaryDirectory() as folder:
   base=Path(folder);source=base/'source';package=base/'package';source.mkdir();(package/'core-extension').mkdir(parents=True)
   (source/'file.txt').write_bytes(b'original\r\n');(package/'core-extension/file.txt').write_bytes(b'changed\n');(package/'patch-manifest.json').write_text(json.dumps({'file.txt':module.digest(b'original\n')}))
   with patch.object(module.subprocess,'check_output',return_value=module.EXPECTED+'\n'):
    plan=module.plan(source,package);self.assertEqual(len(plan),1);plan[0][0].write_bytes(plan[0][1]);self.assertEqual(len(module.plan(source,package)),1)
 def test_custom_edits_stop_before_any_write(self):
  with tempfile.TemporaryDirectory() as folder:
   base=Path(folder);source=base/'source';package=base/'package';source.mkdir();(package/'core-extension').mkdir(parents=True)
   (source/'file.txt').write_text('custom');(package/'core-extension/file.txt').write_text('changed');(package/'patch-manifest.json').write_text(json.dumps({'file.txt':module.digest(b'original')}))
   with patch.object(module.subprocess,'check_output',return_value=module.EXPECTED):
    with self.assertRaisesRegex(ValueError,'Local edits'):module.plan(source,package)
   self.assertEqual((source/'file.txt').read_text(),'custom')
 def test_other_release_refused(self):
  with patch.object(module.subprocess,'check_output',return_value='other'):
   with self.assertRaisesRegex(ValueError,'exact official'):module.plan(Path('.'),Path('.'))
 def test_known_previous_extension_is_upgraded_but_arbitrary_edits_are_refused(self):
  with tempfile.TemporaryDirectory() as folder:
   base=Path(folder);source=base/'source';package=base/'package';source.mkdir();(package/'core-extension').mkdir(parents=True)
   previous=b'previous test fixture\n';updated=b'corrected test fixture\n'
   (source/'file.txt').write_bytes(previous);(package/'core-extension/file.txt').write_bytes(updated)
   (package/'patch-manifest.json').write_text(json.dumps({'file.txt':None}))
   (package/'patch-upgrade-hashes.json').write_text(json.dumps({'file.txt':[module.digest(previous)]}))
   with patch.object(module.subprocess,'check_output',return_value=module.EXPECTED):
    pending=module.plan(source,package);self.assertEqual(pending[0][1],updated)
    self.assertEqual((source/'file.txt').read_bytes(),previous)
    pending[0][0].write_bytes(pending[0][1]);self.assertEqual(len(module.plan(source,package)),1)
    (source/'file.txt').write_bytes(b'custom edits')
    with self.assertRaisesRegex(ValueError,'Local edits'):module.plan(source,package)
 def test_upgrade_inventory_cannot_whitelist_unmanaged_files(self):
  with tempfile.TemporaryDirectory() as folder:
   base=Path(folder);source=base/'source';package=base/'package';source.mkdir();package.mkdir()
   (package/'patch-manifest.json').write_text('{}')
   (package/'patch-upgrade-hashes.json').write_text(json.dumps({'unmanaged.txt':['a'*64]}))
   with patch.object(module.subprocess,'check_output',return_value=module.EXPECTED):
    with self.assertRaisesRegex(ValueError,'prior-extension hash inventory'):module.plan(source,package)
if __name__=='__main__':unittest.main()
