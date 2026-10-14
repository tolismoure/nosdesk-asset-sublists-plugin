"""Progress UI checks using the real helpers; no Docker or server access."""
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

PACKAGE = Path(__file__).resolve().parents[1]
PROGRESS_PYTHON = PACKAGE / "tools/install_progress.py"
PROGRESS_SHELL = PACKAGE / "tools/install_progress.sh"
spec = importlib.util.spec_from_file_location("install_progress", PROGRESS_PYTHON)
progress = importlib.util.module_from_spec(spec)
spec.loader.exec_module(progress)


class ProgressRenderingTests(unittest.TestCase):
    def test_duration_remains_clear_across_hour_boundary(self):
        self.assertEqual(progress.format_duration(0), "00:00:00")
        self.assertEqual(progress.format_duration(65), "00:01:05")
        self.assertEqual(progress.format_duration(3661), "01:01:01")

    def test_percent_reports_completed_stages_not_elapsed_build_time(self):
        initial = progress.render_progress(0, 6, "Server tests", 1, 1)
        lengthy = progress.render_progress(0, 6, "Server tests", 7200, 7200)
        self.assertIn("0%", initial)
        self.assertIn("0%", lengthy)
        self.assertNotIn("100%", lengthy)
        halfway = progress.render_progress(3, 6, "Backup", 65, 3661)
        self.assertIn("50%", halfway)
        self.assertIn("Backup", halfway)
        self.assertIn("00:01:05", halfway)
        self.assertIn("01:01:01", halfway)

    def test_final_completed_stage_reports_100_percent(self):
        result = progress.render_progress(6, 6, "Installation complete", 9, 100, active=False)
        self.assertIn("100%", result)
        self.assertIn("Installation complete", result)

    def test_noninteractive_cli_prints_a_plain_bar_and_duration(self):
        result = subprocess.run([sys.executable, str(PROGRESS_PYTHON), "--completed", "3", "--total", "6", "--label", "Database backup", "--elapsed", "65", "--overall-elapsed", "3661"], capture_output=True, text=True, check=True, timeout=5)
        self.assertIn("50%", result.stdout)
        self.assertIn("Database backup", result.stdout)
        self.assertIn("00:01:05", result.stdout)
        self.assertNotIn("\x1b", result.stdout)
        self.assertEqual(result.stdout.count("\n"), 1)

    def test_watch_outputs_updates_and_terminates_during_long_sleep(self):
        process = subprocess.Popen([sys.executable, str(PROGRESS_PYTHON), "--completed", "2", "--total", "6", "--label", "Still building", "--elapsed", "0", "--overall-elapsed", "0", "--watch", "--parent", str(os.getpid()), "--interval", "0.1"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            time.sleep(0.45)
            process.terminate()
            output, error = process.communicate(timeout=3)
            self.assertGreaterEqual(output.count("Still building"), 2, error)
            self.assertNotIn("100%", output)
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate()
        process = subprocess.Popen([sys.executable, str(PROGRESS_PYTHON), "--completed", "2", "--total", "6", "--label", "Long interval", "--elapsed", "0", "--overall-elapsed", "0", "--watch", "--parent", str(os.getpid()), "--interval", "30"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            time.sleep(0.1)
            started = time.monotonic()
            process.terminate()
            process.communicate(timeout=3)
            self.assertLess(time.monotonic() - started, 3)
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate()


class ShellProgressTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bash = os.environ.get("HISTORY_TEST_BASH") or shutil.which("bash")
        if not cls.bash:
            raise unittest.SkipTest("Bash is not available; set HISTORY_TEST_BASH to test shell integration.")

    def shell(self, script, interval="0.1", timeout=8):
        env = os.environ.copy()
        env["HISTORY_PACKAGE_DIR"] = PACKAGE.as_posix()
        env["HISTORY_PROGRESS_PYTHON"] = Path(sys.executable).as_posix()
        env["HISTORY_PROGRESS_INTERVAL"] = interval
        if os.name == "nt":
            # This installer runs on Ubuntu. Native Windows Python launched
            # from MSYS Bash needs a short startup allowance before a stop
            # signal; POSIX still tests immediate start/stop unchanged.
            lines = []
            for line in script.splitlines():
                lines.append(line)
                if line.startswith("history_progress_start "):
                    lines.append('"$HISTORY_PROGRESS_PYTHON" -c \'import time; time.sleep(0.2)\'')
            script = "\n".join(lines) + "\n"
        # Test-created locks stay in the permitted workspace and are removed
        # when the Bash process has exited, including its EXIT cleanup.
        with tempfile.TemporaryDirectory(prefix="progress-check-", dir=PACKAGE / "tests") as folder:
            env["HISTORY_TEST_LOCK"] = (Path(folder) / "install.lock").as_posix()
            prefix = 'set -Eeuo pipefail\nsource "$HISTORY_PACKAGE_DIR/tools/install_progress.sh"\n'
            return subprocess.run([self.bash, "-c", prefix + script], env=env, capture_output=True, text=True, timeout=timeout)

    def test_noninteractive_shell_reports_active_updates_then_completion(self):
        result = self.shell('trap history_progress_stop EXIT\nhistory_progress_start 2 "Server compiling"\n"$HISTORY_PROGRESS_PYTHON" -c \'import time; time.sleep(0.5)\'\nhistory_progress_complete 3 "Server compiled"\n')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertGreaterEqual(result.stdout.count("Server compiling"), 2)
        self.assertIn("Server compiled", result.stdout)
        self.assertIn("50%", result.stdout)
        self.assertNotIn("\x1b", result.stdout)

    def test_original_err_status_stops_following_commands_and_heartbeat(self):
        script = '''exec 9> "$HISTORY_TEST_LOCK"
trap 'original_status=$?; history_progress_stop; printf "ERROR-STATUS:%s\\n" "$original_status"; exit "$original_status"' ERR
trap history_progress_stop EXIT
history_progress_start 1 "Tests in progress"
"$HISTORY_PROGRESS_PYTHON" -c 'raise SystemExit(37)'
printf 'UNREACHED\\n'
history_progress_complete 6 "Installation complete"
'''
        started = time.monotonic()
        result = self.shell(script, interval="30", timeout=5)
        self.assertEqual(result.returncode, 37, result.stdout + result.stderr)
        self.assertIn("ERROR-STATUS:37", result.stdout)
        self.assertNotIn("UNREACHED", result.stdout)
        self.assertNotIn("100%", result.stdout)
        self.assertLess(time.monotonic() - started, 5)

    def test_stop_is_repeatable_and_does_not_wait_for_long_interval(self):
        started = time.monotonic()
        result = self.shell('history_progress_start 0 "Long build"\nhistory_progress_stop\nhistory_progress_stop\nprintf "STOPPED\\n"\n', interval="30", timeout=5)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("STOPPED", result.stdout)
        self.assertLess(time.monotonic() - started, 5)

    def test_successful_final_stage_reports_completion_once(self):
        result = self.shell('trap history_progress_stop EXIT\nhistory_progress_start 5 "Plugin installation"\nhistory_progress_complete 6 "Installation complete"\n')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stdout.count("100%"), 1)
        self.assertIn("Installation complete", result.stdout)


if __name__ == "__main__":
    unittest.main()
