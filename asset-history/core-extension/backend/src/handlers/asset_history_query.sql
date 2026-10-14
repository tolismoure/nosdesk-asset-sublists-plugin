-- Values are bound by asset_history.rs; none is interpolated into this SQL.
-- Explicit workspace equality supplements TenantConn's RLS pin, including
-- when a self-hosted operator runs the backend as a database superuser.
-- Materialize only the bounded page before resolving labels. This guarantees
-- at most limit + 1 lateral taxonomy lookups, regardless of planner choices.
WITH history_page AS MATERIALIZED (
  SELECT a.* FROM audit_log AS a
  WHERE a.workspace_id = $1
    AND (a.before_jsonb ->> 'workspace_id' IS NULL OR a.before_jsonb ->> 'workspace_id' = $1::text)
    AND (a.after_jsonb ->> 'workspace_id' IS NULL OR a.after_jsonb ->> 'workspace_id' = $1::text)
    AND ($3::timestamptz IS NULL OR a.occurred_at >= $3)
    AND ($4::timestamptz IS NULL OR a.occurred_at < $4)
    AND ($5::timestamptz IS NULL OR (a.occurred_at, a.id) < ($5, $6))
    AND (
      (a.table_name = 'assets' AND a.pk_text = $2)
      OR (
        a.table_name IN (
          'asset_loans', 'asset_lifecycle_events', 'asset_usage_log',
          'asset_audits', 'asset_media', 'asset_disposals',
          'asset_group_assignments', 'asset_directory_memberships', 'ticket_assets'
        )
        AND (a.before_jsonb ->> 'asset_id' = $2 OR a.after_jsonb ->> 'asset_id' = $2)
      )
      OR (
        a.table_name = 'plugin_data' AND $7::text IS NOT NULL
        AND (
          (
            a.before_jsonb ->> 'plugin_id' = $7
            AND a.before_jsonb ->> 'data_type' = 'storage'
            AND a.before_jsonb ->> 'is_secret' = 'false'
            AND (a.before_jsonb ->> 'key' = $8 OR ($9 AND a.before_jsonb ->> 'key' = 'taxonomy-v1'))
          )
          OR (
            a.after_jsonb ->> 'plugin_id' = $7
            AND a.after_jsonb ->> 'data_type' = 'storage'
            AND a.after_jsonb ->> 'is_secret' = 'false'
            AND (a.after_jsonb ->> 'key' = $8 OR ($9 AND a.after_jsonb ->> 'key' = 'taxonomy-v1'))
          )
        )
        -- Both non-null snapshots must describe the same allowed data entry.
        -- This also fails closed on administrator SQL that converts a storage
        -- row to a secret/setting or changes it to another plugin/key.
        AND (a.before_jsonb IS NULL OR (
          a.before_jsonb ->> 'plugin_id' = $7
          AND a.before_jsonb ->> 'data_type' = 'storage'
          AND a.before_jsonb ->> 'is_secret' = 'false'
          AND (a.before_jsonb ->> 'key' = $8 OR ($9 AND a.before_jsonb ->> 'key' = 'taxonomy-v1'))
        ))
        AND (a.after_jsonb IS NULL OR (
          a.after_jsonb ->> 'plugin_id' = $7
          AND a.after_jsonb ->> 'data_type' = 'storage'
          AND a.after_jsonb ->> 'is_secret' = 'false'
          AND (a.after_jsonb ->> 'key' = $8 OR ($9 AND a.after_jsonb ->> 'key' = 'taxonomy-v1'))
        ))
        AND (a.before_jsonb IS NULL OR a.after_jsonb IS NULL
          OR a.before_jsonb ->> 'key' = a.after_jsonb ->> 'key')
      )
    )
  ORDER BY a.occurred_at DESC, a.id DESC
  LIMIT $10
)
SELECT a.id, a.table_name, a.pk_text, a.op::text AS op,
       a.before_jsonb, a.after_jsonb, a.changed_cols,
       a.actor_uuid, a.correlation_id, a.occurred_at,
       u.name::text AS actor_name,
       taxonomy.value AS assignment_taxonomy
FROM history_page AS a
LEFT JOIN users AS u ON u.uuid = a.actor_uuid
-- Historical labels come only from the most recent retained taxonomy state
-- at this assignment event. Never substitute today's names for old ones.
-- LIMIT 1 bounds the lookup per displayed row; the migration indexes these
-- plugin/key/time predicates. Missing/pruned snapshots give unresolved IDs.
LEFT JOIN LATERAL (
  SELECT CASE WHEN t.op = 'D' THEN NULL::jsonb
              ELSE t.after_jsonb -> 'value' END AS value
  FROM audit_log AS t
  WHERE a.table_name = 'plugin_data'
    AND t.workspace_id = $1 AND t.table_name = 'plugin_data'
    AND (t.before_jsonb ->> 'workspace_id' IS NULL OR t.before_jsonb ->> 'workspace_id' = $1::text)
    AND (t.after_jsonb ->> 'workspace_id' IS NULL OR t.after_jsonb ->> 'workspace_id' = $1::text)
    AND (t.occurred_at, t.id) <= (a.occurred_at, a.id)
    AND (
      (t.before_jsonb ->> 'plugin_id' = $7 AND t.before_jsonb ->> 'data_type' = 'storage'
       AND t.before_jsonb ->> 'is_secret' = 'false' AND t.before_jsonb ->> 'key' = 'taxonomy-v1')
      OR
      (t.after_jsonb ->> 'plugin_id' = $7 AND t.after_jsonb ->> 'data_type' = 'storage'
       AND t.after_jsonb ->> 'is_secret' = 'false' AND t.after_jsonb ->> 'key' = 'taxonomy-v1')
    )
    AND (t.before_jsonb IS NULL OR
      (t.before_jsonb ->> 'plugin_id' = $7 AND t.before_jsonb ->> 'data_type' = 'storage'
       AND t.before_jsonb ->> 'is_secret' = 'false' AND t.before_jsonb ->> 'key' = 'taxonomy-v1'))
    AND (t.after_jsonb IS NULL OR
      (t.after_jsonb ->> 'plugin_id' = $7 AND t.after_jsonb ->> 'data_type' = 'storage'
       AND t.after_jsonb ->> 'is_secret' = 'false' AND t.after_jsonb ->> 'key' = 'taxonomy-v1'))
  ORDER BY t.occurred_at DESC, t.id DESC LIMIT 1
) AS taxonomy ON a.table_name = 'plugin_data'
ORDER BY a.occurred_at DESC, a.id DESC;
