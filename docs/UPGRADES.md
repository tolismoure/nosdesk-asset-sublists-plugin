# Upgrades, backups and rollback

## Supported update boundaries

Do not apply these replacements to a different Nosdesk tag. Version checks and source hashes are deliberate safeguards. Rebase/review the extension against a future release, refresh the pinned inventories and run the full verification path before deploying.

Known previous deliveries are accepted only by exact hashes. Keep those hashes as an append-only compatibility inventory with an explanation of the change. Never make the installer accept arbitrary local edits to work around a conflict. Existing unrelated customizations such as a differently edited Navbar require manual reconciliation.

## Retain data and keys

- Preserve plugin identity asset-categories and the taxonomy/assignment key names.
- Update through the verified plugin installer; do not uninstall/recreate merely to change the version.
- Preserve .env secrets, PostgreSQL 18 mount/volume and uploads volume.
- Preserve the local signing key held by the instance; server-local signing is not portable trust for a different instance.
- Keep private database/configuration backups outside the repository.

The uninstall lifecycle requests storage preservation, but that is not a replacement for backups. Recreating a plugin identity may make earlier history linkage unresolved.

## History installation rollback

The installer tags the exact prior image before building. If backup/deployment fails after the app stops, it restores the prior history override and attempts to restart that exact binary. Completed additive database changes can remain. It does not automatically restore a database or run down migrations.

If the new server has become ready and only plugin signing/install fails, it remains running. Retry the plugin-only step. The private install log, captured state, configuration and custom-format dump identify the attempt. Treat them as private operator data.

## Frontend-only update rollback

The display updater stores the original source page, history override and exact image ID under ~/nosdesk-ui-backups/<run>. A deployment failure restores that override and starts the prior image through a rollback override. It does not change database schema or native asset values.

An explicit manual rollback should use the recorded configuration and image from the intended run, with all Compose overrides. Do not use an unqualified docker compose up that silently selects another image or drops the PostgreSQL 18 override.

Plugin 2.1.0 and the prior sidebar share storage contracts. Rolling the frontend back does not require deleting category storage. The plugin can remain on 2.1.0 (standalone assignments) while the host frontend supplies the right-hand assignment card.

## Migration removal

The history down migration removes added capture/index/metadata support; it does not erase retained audit records or remove upstream main-assets capture. Removing that support while the new reader is still running can break requests. Review dependency order and backups before manual migration changes. A full database restore replaces data and belongs to an explicit recovery operation, not an automatic frontend rollback.
