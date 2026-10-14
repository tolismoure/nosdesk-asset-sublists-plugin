# Disposal audit handover for upstream PR #752

Upstream https://github.com/Nosdesk/Nosdesk/pull/752 adds tr_audit_asset_disposals using audit_log_trigger('id') and makes disposal records append-only for the app role. Our 1.1.0 extension uses the same trigger name with audit_log_trigger('asset_id'). Remove only our version immediately before a reviewed upgrade installing the upstream migration; otherwise its CREATE TRIGGER conflicts.

Inspect without changes:

```bash
bash ~/nosdesk-asset-history/upgrades/handover-disposal-trigger.sh
```

Only when the upgrade is ready, run with --apply. This stops Nosdesk, saves a private database dump and checksum, then removes only the matching custom disposal trigger. It leaves the app stopped. An upstream id trigger is retained; unexpected definitions fail without removal. PostgreSQL and Redis remain running. The three custom group/directory/ticket association triggers and existing audit records remain unchanged. If a backup or database command fails, the app remains stopped; review the failure before proceeding.

```bash
bash ~/nosdesk-asset-history/upgrades/handover-disposal-trigger.sh --apply
```

Do not run the original extension down.sql as a substitute: it removes all four triggers and indexes. Do not re-run its original up.sql against the upgraded database. Keep existing applied migration history intact.

This is a trigger-handover tool, not a v1.1.1 upgrade installer. The extension is still pinned to official v1.1.0. A published v1.1.1 release was not found on 15 October 2026. Backend/SDK/frontend patch baselines, query compatibility, applied migrations and rollback ownership require review against that actual release before deployment. In particular, an uninstall must not drop an upstream-owned trigger. Do not restart stock 1.1.1 expecting the custom history endpoint to be present automatically.
