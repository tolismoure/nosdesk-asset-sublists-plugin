import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("install_checks", Path(__file__).parents[1] / "tools/install_checks.py")
checks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checks)


class CheckTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name) / "nosdesk"
        self.project.mkdir()
        for name in checks.BASE_FILES:
            (self.project / name).write_text("services: {}\n")
        self.config = {
            "services": {
                "postgres": {"image": "postgres:18-bookworm", "environment": {"POSTGRES_USER": "nosdesk", "POSTGRES_DB": "nosdesk", "POSTGRES_PASSWORD": "DO-NOT-LEAK"}, "volumes": [{"type": "volume", "source": "postgres18_data", "target": "/var/lib/postgresql"}]},
                "nosdesk": {"image": "nosdesk-local:1.1.0-assets", "environment": {"ENCRYPTION_KEY": "SECRET-ENCRYPTION-KEY"}, "volumes": [{"type": "volume", "source": "backend_uploads", "target": "/app/uploads"}]},
            },
            "volumes": {"postgres18_data": {"name": "nosdesk_postgres18_data"}, "backend_uploads": {"name": "nosdesk_backend_uploads"}},
        }
        self.image_id = "sha256:" + "c" * 64
        self.app = {"Image": self.image_id, "State": {"Running": True}, "Config": {"Image": "nosdesk-local:1.1.0-assets", "Env": ["SECRET=HIDDEN"]}, "Mounts": [{"Destination": "/app/uploads", "Type": "volume", "Name": "nosdesk_backend_uploads"}]}
        self.postgres = {"State": {"Running": True}, "Mounts": [{"Destination": "/var/lib/postgresql", "Type": "volume", "Name": "nosdesk_postgres18_data"}]}
        self.version = "180006"
        self.migration = "f"
        self.calls = []

    def docker(self, args, **kwargs):
        self.calls.append(args)
        if args[-3:] == ["config", "--format", "json"]:
            output = json.dumps(self.config)
        elif args[-4:-1] == ["ps", "--all", "-q"]:
            output = "a" * 64 if args[-1] == "nosdesk" else "b" * 64
        elif args[:4] == ["docker", "inspect", "--type", "container"]:
            output = json.dumps([self.app if args[-1] == "a" * 64 else self.postgres])
        elif args[:3] == ["docker", "image", "inspect"]:
            output = json.dumps([{"Id": self.image_id}])
        elif args[-1] == "SHOW server_version_num;":
            output = self.version
        elif args[-1].startswith("SELECT EXISTS"):
            output = self.migration
        else:
            self.fail("Unexpected Docker invocation: " + str(args))
        return subprocess.CompletedProcess(args, 0, output + "\n", "")

    def collect(self):
        with patch.object(checks.subprocess, "run", side_effect=self.docker):
            return checks.DockerChecks(self.project).collect()

    def history(self):
        (self.project / "compose.history.yaml").write_text("# installer override\nservices:\n  nosdesk:\n    image: nosdesk-local:1.1.0-history\n")
        self.app["Config"]["Image"] = checks.HISTORY_IMAGE
        self.migration = "t"

    def test_state_records_exact_image_and_volumes_without_secrets(self):
        state = self.collect()
        self.assertEqual(state["old_image_id"], self.image_id)
        self.assertEqual(state["postgres_volume"], "nosdesk_postgres18_data")
        self.assertFalse(state["history_file_existed"])
        self.assertEqual(set(state), {"old_container_id", "old_image_id", "old_image_ref", "history_file_existed", "migration_present", "postgres_volume", "uploads_volume"})
        state_file = Path(self.temp.name) / "state.json"
        checks.write_state(state_file, state)
        self.assertEqual(json.loads(state_file.read_text()), state)
        self.assertNotIn("SECRET", state_file.read_text())
        self.assertNotIn("DO-NOT-LEAK", state_file.read_text())
        if os.name != "nt":
            self.assertEqual(stat.S_IMODE(state_file.stat().st_mode), 0o600)

    def test_postgres17_config_and_running_database_are_rejected(self):
        self.config["services"]["postgres"]["image"] = "postgres:17-bookworm"
        with self.assertRaisesRegex(checks.CheckError, "PostgreSQL 18"):
            self.collect()
        self.config["services"]["postgres"]["image"] = "postgres:18-bookworm"
        self.version = "170005"
        with self.assertRaisesRegex(checks.CheckError, "PostgreSQL 18"):
            self.collect()

    def test_changed_pg_or_upload_volume_is_rejected(self):
        for config_key in ("postgres18_data", "backend_uploads"):
            with self.subTest(volume=config_key):
                original = self.config["volumes"][config_key]["name"]
                self.config["volumes"][config_key]["name"] = "fresh_empty_volume"
                with self.assertRaisesRegex(checks.CheckError, "does not match"):
                    self.collect()
                self.config["volumes"][config_key]["name"] = original

    def test_pg17_mount_path_and_bind_uploads_are_rejected(self):
        self.config["services"]["postgres"]["volumes"][0]["target"] = "/var/lib/postgresql/data"
        with self.assertRaisesRegex(checks.CheckError, "named volume"):
            self.collect()
        self.config["services"]["postgres"]["volumes"][0]["target"] = "/var/lib/postgresql"
        self.app["Mounts"][0]["Type"] = "bind"
        with self.assertRaisesRegex(checks.CheckError, "named volume"):
            self.collect()

    def test_custom_history_configuration_is_not_overwritten(self):
        file = self.project / "compose.history.yaml"
        for content in ("services:\n  nosdesk:\n    image: custom:latest\n", "services:\n  nosdesk:\n    image: nosdesk-local:1.1.0-history\n    environment:\n      PASSWORD: secret\n", "services:\n  postgres:\n    image: postgres:18\n"):
            file.write_text(content)
            with self.assertRaisesRegex(checks.CheckError, "custom configuration"):
                checks.DockerChecks(self.project)
            self.assertEqual(file.read_text(), content)

    def test_regular_history_override_is_loaded_last(self):
        self.history()
        state = self.collect()
        self.assertTrue(state["history_file_existed"])
        self.assertTrue(state["migration_present"])
        self.assertIn(str(self.project / "compose.history.yaml"), self.calls[0])
        self.assertEqual(self.calls[0][-4:], [str(self.project / "compose.history.yaml"), "config", "--format", "json"])

    def test_missing_compose_and_stopped_app_are_rejected(self):
        self.app["State"]["Running"] = False
        with self.assertRaisesRegex(checks.CheckError, "must be running"):
            self.collect()
        (self.project / "compose.override.yaml").unlink()
        with self.assertRaisesRegex(checks.CheckError, "compose.override.yaml"):
            checks.DockerChecks(self.project)

    def test_command_failure_does_not_print_expanded_config(self):
        result = subprocess.CompletedProcess([], 1, "SECRET-stdout", "SECRET-password-expanded")
        with patch.object(checks.subprocess, "run", return_value=result):
            with self.assertRaises(checks.CheckError) as raised:
                checks.DockerChecks(self.project).collect()
        self.assertNotIn("SECRET", str(raised.exception))

    def ready_response(self, payload):
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *args): return None
            def read(self, size): return json.dumps(payload).encode()
        return Response()

    def test_ready_requires_db_redis_migration_and_exact_new_image(self):
        self.history()
        state = self.collect()
        good = {"status": "ready", "checks": {"db": "ok", "redis": "ok"}}
        with patch.object(checks.urllib.request, "urlopen", return_value=self.ready_response(good)) as request:
            checks.ready_check(state, self.image_id)
            request.assert_called_once_with("http://127.0.0.1:8080/readiness", timeout=5)
        bad_payloads = [{"status": "ready"}, {"status": "ready", "checks": []}, {"status": "ready", "checks": {"db": "ok", "redis": "failed"}}, {"status": "not_ready", "checks": {"db": "ok", "redis": "ok"}}]
        for payload in bad_payloads:
            with patch.object(checks.urllib.request, "urlopen", return_value=self.ready_response(payload)):
                with self.assertRaisesRegex(checks.CheckError, "readiness"):
                    checks.ready_check(state)
        with self.assertRaisesRegex(checks.CheckError, "newly built image"):
            checks.ready_check(state, "sha256:" + "d" * 64)
        state["migration_present"] = False
        with self.assertRaisesRegex(checks.CheckError, "migration"):
            checks.ready_check(state)

    def test_plugin_only_refuses_stock_host_and_requires_ready(self):
        state_file = Path(self.temp.name) / "state.json"
        with patch.object(checks.subprocess, "run", side_effect=self.docker), patch.object(checks, "package_check"):
            with self.assertRaisesRegex(SystemExit, "history image"):
                checks.main(["--project", str(self.project), "--state", str(state_file), "--plugin-only"])
        self.assertFalse(state_file.exists())
        self.history()
        with patch.object(checks.subprocess, "run", side_effect=self.docker), patch.object(checks, "package_check"), patch.object(checks.urllib.request, "urlopen", return_value=self.ready_response({"status": "ready", "checks": {"db": "ok", "redis": "ok"}})):
            checks.main(["--project", str(self.project), "--state", str(state_file), "--plugin-only"])
        self.assertTrue(state_file.exists())

    def test_readiness_mode_does_not_require_source_or_state(self):
        self.history()
        with patch.object(checks.subprocess, "run", side_effect=self.docker), patch.object(checks, "package_check") as package, patch.object(checks.urllib.request, "urlopen", return_value=self.ready_response({"status": "ready", "checks": {"db": "ok", "redis": "ok"}})):
            checks.main(["--project", str(self.project), "--check-ready", "--image-id", self.image_id])
        package.assert_not_called()

    def test_symlink_compose_and_state_files_are_rejected(self):
        source = self.project / "compose.yaml"
        outside = Path(self.temp.name) / "outside.yaml"
        outside.write_text("services: {}\n")
        try:
            source.unlink()
            source.symlink_to(outside)
        except (OSError, NotImplementedError):
            self.skipTest("This platform does not permit symlink creation.")
        with self.assertRaisesRegex(checks.CheckError, "symlink"):
            checks.DockerChecks(self.project)
        state = Path(self.temp.name) / "state.json"
        state.symlink_to(outside)
        with self.assertRaisesRegex(checks.CheckError, "symlink"):
            checks.write_state(state, {})
        self.assertEqual(outside.read_text(), "services: {}\n")

    def test_malformed_inspection_is_rejected_without_traceback(self):
        self.app["Config"] = []
        with self.assertRaisesRegex(checks.CheckError, "image reference"):
            self.collect()
        self.app["Config"] = {"Image": "nosdesk-local:1.1.0-assets"}
        self.config["volumes"] = []
        with self.assertRaisesRegex(checks.CheckError, "named volume"):
            self.collect()


if __name__ == "__main__":
    unittest.main()
