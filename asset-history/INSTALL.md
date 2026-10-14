# Simple installation

Download **nosdesk-asset-history.zip** into your Windows **Downloads** folder. In **Windows PowerShell**, upload it and sign in to the Ubuntu server:

```powershell
scp "$HOME\Downloads\nosdesk-asset-history.zip" nosdesk@YOUR_NOSDESK_HOST:/home/nosdesk/nosdesk-asset-history.zip
ssh nosdesk@YOUR_NOSDESK_HOST
```

At the Ubuntu prompt beginning with **nosdesk@YOUR_NOSDESK_HOST**, paste:

```bash
python3 -m zipfile -e "$HOME/nosdesk-asset-history.zip" "$HOME" && bash "$HOME/nosdesk-asset-history/install.sh"
```

The script checks your PostgreSQL 18 setup, preserves the existing Assets sidebar, runs isolated server tests, builds the image, backs up your database/configuration, starts the extension, and signs/installs the plugin. Nosdesk stays running during the build/tests. The first build can take a while. This update corrects the secret-storage test fixture; changing that Rust test can trigger recompilation, even when dependency layers are cached. The verification image now includes the upstream test fixtures and caches its compiled test binary. Existing Docker build layers are reused when available.

The progress bar counts completed installation steps. While a step is running, its activity indicator and elapsed timer update every **10 seconds**, even if the build has no new output. A long build can keep the same percentage while its timer advances; the percentage measures completed steps, not build time. Progress is also saved in the installation log.

Wait for **INSTALLATION COMPLETE**. Then refresh Nosdesk and enable **Asset History** in plugin administration if it is disabled. Open an asset to see its history; select the category configuration option to include shared sublist changes.

## If a step fails

The script stops and prints its log location. Share the final error and the relevant end of that log.

If deployment fails after the app was stopped, it attempts to restart the exact previous application image. Completed database additions may remain; it does not automatically restore the database.

If the new server is ready but plugin installation fails, the healthy server stays running. Retry the plugin step with:

```bash
bash "$HOME/nosdesk-asset-history/install.sh" --plugin-only
```

## Later maintenance

These shorter commands use all the required Compose overrides:

```bash
bash "$HOME/nosdesk-asset-history/manage.sh" ps
bash "$HOME/nosdesk-asset-history/manage.sh" logs --tail 80 nosdesk
```

Backups and logs are saved in ~/nosdesk-history-backups. The installer is for your existing Nosdesk 1.1.0 deployment and the source folder ~/nosdesk-source-assets-1.1.0 created earlier. It accepts the exact previous delivered test-file hash for this correction and refuses other conflicting edits or incompatible source.

For the manual steps, see [INSTALL-DETAILS.md](INSTALL-DETAILS.md).

The automatic installer has been checked locally with mocked Docker state and shell syntax validation. It has not been executed on your live server. Its server test step remains mandatory before deployment.
