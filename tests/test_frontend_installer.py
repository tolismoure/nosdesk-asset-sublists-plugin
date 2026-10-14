"""Validate source-upgrade boundaries without modifying a real checkout."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("frontend_apply", ROOT / "frontend-extension/apply.py")
apply = importlib.util.module_from_spec(spec)
spec.loader.exec_module(apply)


class FrontendGuardTests(unittest.TestCase):
    def fixture(self, folder):
        source, package = Path(folder) / "source", Path(folder) / "package"
        (source / "frontend").mkdir(parents=True)
        (package / "frontend").mkdir(parents=True)
        (source / "frontend/first.txt").write_bytes(b"previous\r\n")
        (package / "frontend/first.txt").write_bytes(b"updated\n")
        (package / "baseline.json").write_text(json.dumps({"frontend/first.txt": None}))
        (package / "previous-delivery-hashes.json").write_text(json.dumps({"frontend/first.txt": [apply.digest(b"previous\n")]}))
        return source, package

    def test_known_delivery_and_windows_line_endings_are_accepted(self):
        with tempfile.TemporaryDirectory() as temp:
            source, package = self.fixture(temp)
            with patch.object(apply.subprocess, "check_output", return_value=apply.EXPECTED):
                pending = apply.plan(source, package)
                self.assertEqual(pending[0][1], b"updated\n")
                self.assertEqual((source / "frontend/first.txt").read_bytes(), b"previous\r\n")

    def test_late_conflict_prevents_every_write(self):
        with tempfile.TemporaryDirectory() as temp:
            source, package = self.fixture(temp)
            (source / "frontend/last.txt").write_text("custom")
            (package / "frontend/last.txt").write_text("new")
            (package / "baseline.json").write_text(json.dumps({"frontend/first.txt": None, "frontend/last.txt": None}))
            with patch.object(apply.subprocess, "check_output", return_value=apply.EXPECTED):
                with self.assertRaisesRegex(ValueError, "local edits"):
                    apply.plan(source, package)
            self.assertEqual((source / "frontend/first.txt").read_bytes(), b"previous\r\n")
            self.assertEqual((source / "frontend/last.txt").read_text(), "custom")

    def test_another_tag_and_unmanaged_alias_are_refused(self):
        with tempfile.TemporaryDirectory() as temp:
            source, package = self.fixture(temp)
            with patch.object(apply.subprocess, "check_output", return_value="wrong"):
                with self.assertRaisesRegex(ValueError, "official"):
                    apply.plan(source, package)
            (package / "previous-delivery-hashes.json").write_text('{"unmanaged": []}')
            with patch.object(apply.subprocess, "check_output", return_value=apply.EXPECTED):
                with self.assertRaisesRegex(ValueError, "unmanaged"):
                    apply.plan(source, package)


if __name__ == "__main__":
    unittest.main()
