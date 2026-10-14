# Troubleshooting

## Assets says to install and enable Asset Categories

The display name is Asset Sublists; its internal name is asset-categories. Check Administration → Plugins in the intended workspace, enable it, then hard-refresh. The banner means the sidebar did not detect a loaded compatible plugin; it is not proof that the database row is absent. If active with the expected grants, inspect the plugin loader/storage request errors and current workspace before reinstalling.

## History says permission is required

Check all four gates in [Permissions](PERMISSIONS.md). An active plugin with approved grants does not give its caller platform audit authority. A common state is platform_role=user with workspace_role=admin: that account is still denied by the upstream audit gate. After a role change, sign out/in rather than relying on old session claims.

The viewer's generic 403 text does not name every gate. Inspect the failed history request's response body or compare the account roles and plugin consent record. Do not share request headers/cookies or tokens.

## A release build is quiet

A heartbeat confirms the installer process is alive; it does not prove the compiler is using CPU. The stage percentage stays fixed until that stage completes. In a second SSH session compare CPU TIME twice:

~~~bash
ps -C cargo,rustc,rust-lld,ld.lld,ld,cc,collect2 -o pid,stat,etime,time,pcpu,pmem,comm
sleep 10
ps -C cargo,rustc,rust-lld,ld.lld,ld,cc,collect2 -o pid,stat,etime,time,pcpu,pmem,comm
free -h
df -h /
~~~

Increasing CPU TIME indicates active work. Heavy swap use can slow it substantially. If no progress is evident, check memory pressure, disk availability and kernel OOM messages. Keep the current run and its logs until the cause is understood; a concurrent installer can interfere with image/source changes. The same-project installer lock prevents normal duplicate runs.

## Missing tests/fixtures errors

The verification image must use the history-tests target, including backend/tests/fixtures, rather than the stock production builder alone. Upstream unit tests embed those files at compile time even when only the history tests will run. The corrected Dockerfile retains the production builder and adds a separate fixture-bearing test stage.

## Secret-data test failed in an older package

Official set_plugin_data preserves is_secret on conflict; it updates only value. Passing true to an existing public key does not reclassify it. The corrected fixture explicitly creates a real secret using fixture SQL and asserts that flag, retaining the exclusion assertion. The SQL regression separately checks real secret insertions, deletions and public-to-secret transitions. See asset-history/TEST-FIX.md.

## Python EOF or Windows command errors

Commands labelled Ubuntu/Bash belong in the SSH session, not Windows PowerShell. Use the Windows terminal only for transfer/SSH commands. Installer inputs are arguments/files; do not put a Python input prompt inside a heredoc that already occupies stdin.

## Signing refuses an existing zip or cannot read files

Sign to a fresh temporary filename. Payload files copied by Docker can be root-owned and unreadable to UID 1001; the helpers change ownership of their newly created temporary directory before invoking the CLI. Never copy/export the instance private signing key to solve this.

## Readiness fails

/health is liveness text. The helpers wait for /readiness with database and Redis checks and verify the expected image. Review the displayed private log and app output. Preserve all Compose files and secrets. If deployment rollback was attempted, verify which exact image is running before another attempt.

## Empty lists, history or columns

An asset must have a saved classification to match a category. Assign it from Plugins → Asset sublists, then refresh. An explicitly empty column selection shows only the name. History can be empty because no captured matching event exists, the date range excludes it, global taxonomy changes were not included, or retention removed records. Absence of evidence is not proof no earlier change occurred.

## Source conflict

Guarded application stops before writes when an unknown edit is found. Compare the file to the pinned source and known prior delivery, preserve your customizations, and resolve deliberately. Do not remove the checks or rename your live source to hide a conflict.
