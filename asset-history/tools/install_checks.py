#!/usr/bin/env python3
"""Read-only deployment checks. Configuration secrets are never written or printed."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import urllib.error
import urllib.request

HISTORY_IMAGE = "nosdesk-local:1.1.0-history"
MIGRATION_VERSION = "20261013000000"
BASE_FILES = ("compose.yaml", "compose.override.yaml", "compose.assets.yaml")
IMAGE_ID = re.compile(r"sha256:[0-9a-f]{64}\Z")
CONTAINER_ID = re.compile(r"[0-9a-f]{12,64}\Z")


class CheckError(Exception):
    """A safe diagnostic that cannot contain configuration or command output."""


def regular_file(file, label):
    if file.is_symlink() or not file.is_file():
        raise CheckError(label + " must exist as a regular file, without a symlink.")


def check_history_file(file):
    regular_file(file, "compose.history.yaml")
    try:
        text = file.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        raise CheckError("Cannot read compose.history.yaml.") from None
    # This intentionally supports only our one-service image override. All
    # other configuration belongs in the operator's existing Compose files.
    lines = [line.split("#", 1)[0].rstrip() for line in text.splitlines()]
    text = "\n".join(line for line in lines if line.strip())
    pattern = r"services:\n  nosdesk:\n    image: *([\"']?)" + re.escape(HISTORY_IMAGE) + r"\1"
    if re.fullmatch(pattern, text) is None:
        raise CheckError("compose.history.yaml contains custom configuration; retain it and stop.")


def project_files(project):
    project = Path(project).expanduser().resolve()
    if not project.is_dir():
        raise CheckError("The Nosdesk project directory does not exist.")
    try:
        fd, probe = tempfile.mkstemp(prefix=".history-write-check-", dir=project)
        os.close(fd)
        os.unlink(probe)
    except OSError:
        raise CheckError("The Nosdesk project directory must be writable by this user.") from None
    files = []
    for name in BASE_FILES:
        file = project / name
        regular_file(file, name)
        files.append(file)
    history = project / "compose.history.yaml"
    existed = history.exists() or history.is_symlink()
    if existed:
        check_history_file(history)
        files.append(history)
    return project, files, existed


class DockerChecks:
    def __init__(self, project):
        self.project, files, self.history_existed = project_files(project)
        self.compose = ["docker", "compose", "--project-directory", str(self.project)]
        for file in files:
            self.compose.extend(["-f", str(file)])

    def run(self, arguments):
        try:
            result = subprocess.run(arguments, cwd=self.project, stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, text=True, timeout=30, check=False)
        except (OSError, subprocess.TimeoutExpired):
            raise CheckError("Docker is unavailable or did not respond in time.") from None
        if result.returncode:
            # Compose config and inspect errors can include expanded secrets.
            raise CheckError("A Docker configuration or inspection check failed; no private output was displayed.")
        return result.stdout

    def json(self, arguments):
        try:
            return json.loads(self.run(arguments))
        except (ValueError, TypeError):
            raise CheckError("Docker returned an unexpected response.") from None

    def container(self, service):
        ids = self.run(self.compose + ["ps", "--all", "-q", service]).strip().splitlines()
        if len(ids) != 1 or not CONTAINER_ID.fullmatch(ids[0]):
            raise CheckError("Exactly one existing " + service + " container is required.")
        data = self.json(["docker", "inspect", "--type", "container", ids[0]])
        if not isinstance(data, list) or len(data) != 1 or not isinstance(data[0], dict):
            raise CheckError("Cannot inspect the " + service + " container.")
        container = data[0]
        if not isinstance(container.get("State"), dict) or container["State"].get("Running") is not True:
            raise CheckError("The existing " + service + " container must be running.")
        return ids[0], container

    def sql(self, config, statement):
        env = config["services"]["postgres"].get("environment", {})
        if not isinstance(env, dict):
            raise CheckError("PostgreSQL environment is not a resolved Compose mapping.")
        user = env.get("POSTGRES_USER", "postgres")
        database = env.get("POSTGRES_DB", user)
        identifier = re.compile(r"[A-Za-z_][A-Za-z0-9_$-]{0,62}\Z")
        if not isinstance(user, str) or not isinstance(database, str) or not identifier.fullmatch(user) or not identifier.fullmatch(database):
            raise CheckError("PostgreSQL user/database names need a manual deployment review.")
        return self.run(self.compose + ["exec", "-T", "postgres", "psql", "-X", "-A", "-t",
                                       "-v", "ON_ERROR_STOP=1", "-U", user, "-d", database,
                                       "-c", statement]).strip()

    def collect(self):
        config = self.json(self.compose + ["config", "--format", "json"])
        if not isinstance(config, dict) or not isinstance(config.get("services"), dict):
            raise CheckError("Compose did not return a valid service configuration.")
        services = config["services"]
        if not isinstance(services.get("nosdesk"), dict) or not isinstance(services.get("postgres"), dict):
            raise CheckError("Compose must contain the existing nosdesk and postgres services.")
        postgres_image = services["postgres"].get("image", "")
        if not isinstance(postgres_image, str) or re.fullmatch(r"(?:[A-Za-z0-9._:/-]+/)?postgres:18(?:[.-][A-Za-z0-9._-]+)?(?:@sha256:[0-9a-f]{64})?", postgres_image) is None:
            raise CheckError("The effective PostgreSQL image must remain PostgreSQL 18.")
        app_id, app = self.container("nosdesk")
        _, postgres = self.container("postgres")
        pg_volume = matching_volume(config, services["postgres"], postgres, "/var/lib/postgresql", "PostgreSQL")
        uploads_volume = matching_volume(config, services["nosdesk"], app, "/app/uploads", "uploads")
        image_id = app.get("Image", "")
        app_config = app.get("Config")
        image_ref = app_config.get("Image", "") if isinstance(app_config, dict) else ""
        if not isinstance(image_id, str) or IMAGE_ID.fullmatch(image_id) is None:
            raise CheckError("Cannot identify the exact current Nosdesk image.")
        if not isinstance(image_ref, str) or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/@-]{0,399}", image_ref) is None:
            raise CheckError("Cannot identify the current Nosdesk image reference.")
        images = self.json(["docker", "image", "inspect", image_id])
        if not isinstance(images, list) or len(images) != 1 or not isinstance(images[0], dict) or images[0].get("Id") != image_id:
            raise CheckError("The exact current Nosdesk image is unavailable for rollback.")
        version = self.sql(config, "SHOW server_version_num;")
        if not version.isdecimal() or not 180000 <= int(version) < 190000:
            raise CheckError("The running database must be PostgreSQL 18.")
        migration = self.sql(config, "SELECT EXISTS (SELECT 1 FROM public.__diesel_schema_migrations WHERE version = '" + MIGRATION_VERSION + "');")
        if migration not in ("t", "f"):
            raise CheckError("Cannot determine whether the history migration is installed.")
        return {
            "old_container_id": app_id,
            "old_image_id": image_id,
            "old_image_ref": image_ref,
            "history_file_existed": self.history_existed,
            "migration_present": migration == "t",
            "postgres_volume": pg_volume,
            "uploads_volume": uploads_volume,
        }


def matching_volume(config, service, container, target, label):
    mounts = service.get("volumes", [])
    actual_mounts = container.get("Mounts", [])
    if not isinstance(mounts, list) or not isinstance(actual_mounts, list):
        raise CheckError("Cannot inspect the " + label + " volume configuration.")
    desired = [m for m in mounts if isinstance(m, dict) and m.get("target") == target]
    actual = [m for m in actual_mounts if isinstance(m, dict) and m.get("Destination") == target]
    if len(desired) != 1 or desired[0].get("type") != "volume" or len(actual) != 1 or actual[0].get("Type") != "volume":
        raise CheckError("The " + label + " data must remain a named volume at " + target + ".")
    definitions = config.get("volumes", {})
    if not isinstance(definitions, dict) or not isinstance(desired[0].get("source"), str):
        raise CheckError("Cannot determine the existing " + label + " named volume.")
    volume = definitions.get(desired[0]["source"], {})
    name = volume.get("name") if isinstance(volume, dict) else None
    if not isinstance(name, str) or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,254}", name) is None or actual[0].get("Name") != name:
        raise CheckError("The effective " + label + " volume does not match the existing container; no changes made.")
    return name


def package_check(package):
    for name in ("apply.py", "patch-manifest.json", "Dockerfile.history", "verify-server.sh", "tools/install_progress.py", "tools/install_progress.sh", "plugin/payload/manifest.json", "plugin/payload/bundle.js"):
        regular_file(package / name, "Package file " + name)


def ready_check(state, expected_image_id=None):
    if state["old_image_ref"] != HISTORY_IMAGE or not state["history_file_existed"]:
        raise CheckError("The running application must use the history image and history Compose override.")
    if expected_image_id is not None:
        if IMAGE_ID.fullmatch(expected_image_id) is None or state["old_image_id"] != expected_image_id:
            raise CheckError("The running application does not match the newly built image.")
    if not state["migration_present"]:
        raise CheckError("The history migration has not completed.")
    try:
        with urllib.request.urlopen("http://127.0.0.1:8080/readiness", timeout=5) as response:
            if response.status != 200:
                raise CheckError("Nosdesk is not ready.")
            content = response.read(65537)
        if len(content) > 65536:
            raise CheckError("Nosdesk returned an unexpected readiness response.")
        result = json.loads(content)
    except (OSError, ValueError, UnicodeError, urllib.error.URLError):
        raise CheckError("Nosdesk readiness check has not succeeded.") from None
    if not isinstance(result, dict) or result.get("status") != "ready" or not isinstance(result.get("checks"), dict) or result["checks"].get("db") != "ok" or result["checks"].get("redis") != "ok":
        raise CheckError("Nosdesk database and Redis readiness checks must both succeed.")


def write_state(file, state):
    file = Path(file).expanduser()
    if file.is_symlink() or (file.exists() and not file.is_file()):
        raise CheckError("The installer state path must be a regular file without a symlink.")
    if not file.parent.is_dir():
        raise CheckError("The installer state directory must already exist.")
    temporary = None
    try:
        descriptor, temporary = tempfile.mkstemp(prefix=".history-state-", dir=file.parent)
        os.fchmod(descriptor, 0o600) if hasattr(os, "fchmod") else os.chmod(temporary, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(state, output, indent=2)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, file)
        temporary = None
        os.chmod(file, 0o600)
    except OSError:
        raise CheckError("Cannot write the private installer state file.") from None
    finally:
        if temporary is not None:
            try:
                os.unlink(temporary)
            except OSError:
                pass


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True, type=Path)
    parser.add_argument("--state", type=Path)
    parser.add_argument("--plugin-only", action="store_true")
    parser.add_argument("--check-ready", action="store_true")
    parser.add_argument("--image-id")
    args = parser.parse_args(argv)
    if not args.check_ready and args.state is None:
        parser.error("--state is required for installation preflight")
    if args.image_id and not args.check_ready:
        parser.error("--image-id is used with --check-ready")
    try:
        if not args.check_ready:
            package_check(Path(__file__).resolve().parents[1])
        checks = DockerChecks(args.project)
        state = checks.collect()
        if args.check_ready or args.plugin_only:
            ready_check(state, args.image_id)
        if args.state:
            write_state(args.state, state)
    except CheckError as error:
        raise SystemExit("STOP: " + str(error)) from None
    print("History server and database are ready." if args.check_ready else "Installation preflight passed; existing data volumes are preserved.")


if __name__ == "__main__":
    main()
