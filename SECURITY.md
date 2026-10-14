# Security and privacy

The plugins stay within their sandbox roots and use permission-gated SDK calls. Asset History exposes a narrow, authenticated, tenant-scoped reader; it is not a generic audit or cross-plugin data API. The upstream audit role/scope gate is retained alongside workspace administration and plugin consent.

Audit snapshots can contain sensitive business data. Keep permissions, retention and exported JSON appropriate for your organization. Displayed actor names are current lookups, not immutable historical identity labels. The system relies on upstream audit context/triggers and cannot prevent privileged database suppression or recreate pruned evidence.

Do not publish .env, database/configuration backups, credentials, MFA data, browser session headers, private signing keys or signed instance installer archives. Public source contains placeholders instead of private server addresses. Payload source is unsigned; local trust is established on the target instance by its supported CLI.

Before reporting a vulnerability publicly, remove sensitive data and use GitHub's private vulnerability reporting if available for this repository, or contact the maintainer privately. Include the supported version, affected component, reproduction steps and authorization context. Do not include live credentials or dump real audit records in an issue.

Shared taxonomy uses last-writer-wins storage and has no separate admin-only policy beyond host/runtime gates. These are documented limitations, not protections the plugin silently supplies. See docs/PERMISSIONS.md and docs/DATA-MODEL.md.
