# Contributing

Read docs/ARCHITECTURE.md, docs/DATA-MODEL.md and docs/DEVELOPMENT.md before changing storage or host APIs. Work against the pinned Nosdesk commit; preserve applicable upstream licensing notices.

Keep plugin identities and storage keys compatible unless you provide an explicit migration and verification. Preserve distinctions between missing, null, false and zero. Do not add permissive source-hash bypasses, client-side authoritative audit logging, unscoped audit readers or unsigned production installation paths.

Run relevant source tests, rebuild payloads, check generated-file reproducibility and validate the full frontend for host changes. Backend SQL/authorization/migration changes require isolated full-schema server tests as well as representative SQL checks. Never point the disposable test harness at a live database.

A pull request should state the trigger and resulting behavior, explain any permission/storage/upgrade effects, and report the checks actually run and remaining limits. Document operator changes alongside code; comments should explain contracts, ordering and failure boundaries rather than restating each line.
