# Secret-storage test fixture correction

The failed server test was a fixture error. Official Nosdesk 1.1.0 set_plugin_data updates only value on conflict and intentionally preserves is_secret. Passing true for a pre-existing public assignment therefore left it public, and the history reader correctly showed its saved value.

The corrected Rust test first asserts that upsert contract, then uses direct fixture SQL to mark the row secret and checks the resulting flag. The original assertion that secret content must not appear in history remains. An additional PostgreSQL/PGlite regression tests that real secret insertions, deletions and public-to-secret transitions are excluded.

Production handler, history query, permission gates and migrations are unchanged. The guarded installer accepts only the exact previous delivered handler hash or the new file; arbitrary local edits still stop installation. Progress reporting and test-fixture Docker image fixes are retained.

Local SQL tests: 8 passed. Guarded installer tests: 5 passed. The corrected full Rust suite still needs server verification. Recompilation may take time. The installer runs verification before stopping the application or changing its live database.
