//! Custom, read-only asset history bridge for the Asset History plugin.
//! Business Source License 1.1, same terms as the surrounding Nosdesk code.
//!
//! The plugin owns rendering; authoritative recording stays in PostgreSQL.
//! No browser-event logger, collection copy, platform connection or write API.

use actix_web::{web, HttpRequest, HttpResponse};
use base64::Engine;
use chrono::{DateTime, Utc};
use diesel::prelude::*;
use diesel::result::Error as DieselError;
use diesel::sql_types::{BigInt, Bool, Integer, Jsonb, Nullable, Text, Timestamptz};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::db::DbConnection;
use crate::errors::ApiError;
use crate::extractors::TenantConn;
use crate::handlers::plugins::{authorize_plugin_data_request, PluginGate};
use crate::models::WorkspaceRole;
use crate::utils::rbac;

const HISTORY_SQL: &str = include_str!("asset_history_query.sql");
const PERMISSION: &str = "asset:history:read";

#[derive(Deserialize)]
pub struct HistoryPath {
    uuid: Uuid,
    asset_id: i32,
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HistoryQuery {
    cursor: Option<String>,
    limit: Option<i64>,
    since: Option<DateTime<Utc>>,
    until: Option<DateTime<Utc>>,
    /// Category configuration applies to all sublists, not just this asset.
    include_category_changes: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct Cursor {
    workspace_id: i32,
    asset_id: i32,
    sublists_plugin_id: Option<i32>,
    include_category_changes: bool,
    since: Option<DateTime<Utc>>,
    until: Option<DateTime<Utc>>,
    occurred_at: DateTime<Utc>,
    id: i64,
}

#[derive(QueryableByName)]
struct Record {
    #[diesel(sql_type = BigInt)]
    id: i64,
    #[diesel(sql_type = Text)]
    table_name: String,
    #[diesel(sql_type = Text)]
    pk_text: String,
    #[diesel(sql_type = Text)]
    op: String,
    #[diesel(sql_type = Nullable<Jsonb>)]
    before_jsonb: Option<Value>,
    #[diesel(sql_type = Nullable<Jsonb>)]
    after_jsonb: Option<Value>,
    #[diesel(sql_type = Nullable<diesel::sql_types::Uuid>)]
    actor_uuid: Option<Uuid>,
    #[diesel(sql_type = Nullable<diesel::sql_types::Uuid>)]
    correlation_id: Option<Uuid>,
    #[diesel(sql_type = Timestamptz)]
    occurred_at: DateTime<Utc>,
    #[diesel(sql_type = Nullable<Text>)]
    actor_name: Option<String>,
    #[diesel(sql_type = Nullable<Jsonb>)]
    assignment_taxonomy: Option<Value>,
}

#[derive(Debug, Serialize)]
pub struct DiffEntry {
    field: String,
    old: Option<Value>,
    new: Option<Value>,
    /// Distinguish an absent property from a property whose value is JSON null.
    old_present: bool,
    new_present: bool,
}

#[derive(Debug, Serialize)]
pub struct HistoryRow {
    /// String avoids loss of BIGINT precision in the JavaScript sandbox.
    id: String,
    table_name: String,
    pk_text: String,
    op: String,
    actor_uuid: Option<Uuid>,
    /// Current resolved name; the audit record stores only the stable UUID.
    actor_name: Option<String>,
    correlation_id: Option<Uuid>,
    occurred_at: DateTime<Utc>,
    source: &'static str,
    scope: &'static str,
    before: Option<Value>,
    after: Option<Value>,
    diff: Vec<DiffEntry>,
    assignment_labels: Option<AssignmentLabels>,
}

#[derive(Debug, Serialize)]
struct AssignmentLabel {
    category: Option<String>,
    subcategory: Option<String>,
}

#[derive(Debug, Serialize)]
struct AssignmentLabels {
    before: Option<AssignmentLabel>,
    after: Option<AssignmentLabel>,
}

#[derive(Serialize)]
pub struct HistoryResponse {
    rows: Vec<HistoryRow>,
    next_cursor: Option<String>,
    asset_id: i32,
    retention_days: u32,
    related_capture_since: DateTime<Utc>,
    category_changes_included: bool,
}

#[derive(QueryableByName)]
struct Found {
    #[diesel(sql_type = Bool)]
    found: bool,
}

#[derive(QueryableByName)]
struct PluginId {
    #[diesel(sql_type = Integer)]
    id: i32,
}

#[derive(QueryableByName)]
struct CaptureInfo {
    #[diesel(sql_type = Timestamptz)]
    started_at: DateTime<Utc>,
}

/// Current rows and retained deleted rows obey exactly the same workspace
/// boundary. The retained main-asset record is an ownership proof after delete.
fn asset_is_in_workspace(
    conn: &mut DbConnection,
    workspace_id: i32,
    asset_id: i32,
) -> Result<bool, DieselError> {
    diesel::sql_query(
        "SELECT (EXISTS (SELECT 1 FROM assets WHERE workspace_id = $1 AND id = $2)
         OR EXISTS (SELECT 1 FROM audit_log WHERE workspace_id = $1
                    AND table_name = 'assets' AND pk_text = $3
                    AND (before_jsonb ->> 'workspace_id' IS NULL OR before_jsonb ->> 'workspace_id' = $1::text)
                    AND (after_jsonb ->> 'workspace_id' IS NULL OR after_jsonb ->> 'workspace_id' = $1::text))) AS found",
    )
    .bind::<Integer, _>(workspace_id)
    .bind::<Integer, _>(asset_id)
    .bind::<Text, _>(asset_id.to_string())
    .get_result::<Found>(conn)
    .map(|v| v.found)
}

/// Match only the explicitly integrated, installed identity. Reinstallation
/// without uninstall preserves id; uninstall/recreation may hide older history.
fn sublists_plugin_id(
    conn: &mut DbConnection,
    workspace_id: i32,
) -> Result<Option<i32>, DieselError> {
    diesel::sql_query(
        "SELECT id FROM plugins WHERE workspace_id = $1 AND name = 'asset-categories'",
    )
    .bind::<Integer, _>(workspace_id)
    .get_result::<PluginId>(conn)
    .optional()
    .map(|p| p.map(|p| p.id))
}

fn read_records(
    conn: &mut DbConnection,
    workspace_id: i32,
    asset_id: i32,
    plugin_id: Option<i32>,
    query: &HistoryQuery,
    cursor: Option<&Cursor>,
    limit: i64,
) -> Result<Vec<Record>, DieselError> {
    diesel::sql_query(HISTORY_SQL)
        .bind::<Integer, _>(workspace_id)
        .bind::<Text, _>(asset_id.to_string())
        .bind::<Nullable<Timestamptz>, _>(query.since)
        .bind::<Nullable<Timestamptz>, _>(query.until)
        .bind::<Nullable<Timestamptz>, _>(cursor.map(|c| c.occurred_at))
        .bind::<Nullable<BigInt>, _>(cursor.map(|c| c.id))
        .bind::<Nullable<Text>, _>(plugin_id.map(|id| id.to_string()))
        .bind::<Text, _>(format!("asset-{asset_id}-category-v1"))
        .bind::<Bool, _>(query.include_category_changes.unwrap_or(false))
        .bind::<BigInt, _>(limit + 1)
        .load(conn)
}

fn encode_cursor(cursor: &Cursor) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .encode(serde_json::to_vec(cursor).expect("Cursor serializes"))
}

fn decode_cursor(encoded: &str) -> Result<Cursor, ApiError> {
    let invalid = || ApiError::BadRequest("Invalid history cursor".into());
    if encoded.len() > 2048 {
        return Err(invalid());
    }
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(encoded.as_bytes())
        .map_err(|_| invalid())?;
    serde_json::from_slice(&bytes).map_err(|_| invalid())
}

fn validate_query(asset_id: i32, query: &HistoryQuery) -> Result<i64, ApiError> {
    if asset_id <= 0 {
        return Err(ApiError::BadRequest("Asset ID must be positive".into()));
    }
    let limit = query.limit.unwrap_or(50);
    if !(1..=200).contains(&limit) {
        return Err(ApiError::BadRequest("History limit must be between 1 and 200".into()));
    }
    if matches!((query.since, query.until), (Some(since), Some(until)) if since >= until) {
        return Err(ApiError::BadRequest("History since must precede until".into()));
    }
    Ok(limit)
}

fn cursor_matches(
    cursor: &Cursor,
    workspace_id: i32,
    asset_id: i32,
    plugin_id: Option<i32>,
    query: &HistoryQuery,
) -> bool {
    cursor.workspace_id == workspace_id
        && cursor.asset_id == asset_id
        && cursor.sublists_plugin_id == plugin_id
        && cursor.include_category_changes == query.include_category_changes.unwrap_or(false)
        && cursor.since == query.since
        && cursor.until == query.until
}

fn fields_diff(before: Option<&Value>, after: Option<&Value>) -> Vec<DiffEntry> {
    if before.into_iter().chain(after).any(|v| !v.is_object()) {
        return if before != after { vec![DiffEntry {
            field: "value".into(), old: before.cloned(), new: after.cloned(),
            old_present: before.is_some(), new_present: after.is_some(),
        }] } else { vec![] };
    }
    let old = before.and_then(Value::as_object);
    let new = after.and_then(Value::as_object);
    let mut fields = std::collections::BTreeSet::new();
    if let Some(values) = old { fields.extend(values.keys().cloned()); }
    if let Some(values) = new { fields.extend(values.keys().cloned()); }
    // Sublists values are normally objects. Fail-safe rendering for a malformed
    // scalar storage value still shows the actual saved value and its presence.
    if fields.is_empty() && before != after && (before.is_some() || after.is_some()) {
        return vec![DiffEntry {
            field: "value".into(), old: before.cloned(), new: after.cloned(),
            old_present: before.is_some(), new_present: after.is_some(),
        }];
    }
    fields.into_iter().filter_map(|field| {
        let old = old.and_then(|v| v.get(&field));
        let new = new.and_then(|v| v.get(&field));
        if old == new { return None; }
        Some(DiffEntry {
            field, old: old.cloned(), new: new.cloned(),
            old_present: old.is_some(), new_present: new.is_some(),
        })
    }).collect()
}

fn assignment_label(value: Option<&Value>, taxonomy: Option<&Value>) -> Option<AssignmentLabel> {
    let value = value?;
    let category_id = value.get("category").and_then(Value::as_str);
    let child_id = value.get("subcategory").and_then(Value::as_str);
    let category = category_id.and_then(|id| taxonomy.and_then(|v| v.get("categories")).and_then(Value::as_array)
        .and_then(|categories| categories.iter().find(|v| v.get("id").and_then(Value::as_str) == Some(id))));
    let child = child_id.and_then(|id| category.and_then(|v| v.get("children")).and_then(Value::as_array)
        .and_then(|children| children.iter().find(|v| v.get("id").and_then(Value::as_str) == Some(id))));
    Some(AssignmentLabel {
        category: category.and_then(|v| v.get("name")).and_then(Value::as_str).map(str::to_string),
        subcategory: child.and_then(|v| v.get("name")).and_then(Value::as_str).map(str::to_string),
    })
}

fn into_row(row: Record) -> HistoryRow {
    let storage = row.table_name == "plugin_data";
    let taxonomy = storage && [row.before_jsonb.as_ref(), row.after_jsonb.as_ref()]
        .into_iter().flatten().any(|v| v.get("key").and_then(Value::as_str) == Some("taxonomy-v1"));
    // Expose only the allowed value of the two integrated storage keys. Avoid
    // confusing storage updated_at/UUID bookkeeping with category edits.
    let project = |v: Option<Value>| if storage { v.and_then(|v| v.get("value").cloned()) } else { v };
    let before = project(row.before_jsonb);
    let after = project(row.after_jsonb);
    let diff = fields_diff(before.as_ref(), after.as_ref());
    let source = if taxonomy { "category_configuration" } else if storage { "sublist_assignment" }
        else if row.table_name == "assets" { "asset" } else { "related" };
    let assignment_labels = if storage && !taxonomy { Some(AssignmentLabels {
        before: assignment_label(before.as_ref(), row.assignment_taxonomy.as_ref()),
        after: assignment_label(after.as_ref(), row.assignment_taxonomy.as_ref()),
    }) } else { None };
    HistoryRow {
        id: row.id.to_string(), table_name: row.table_name, pk_text: row.pk_text,
        op: row.op, actor_uuid: row.actor_uuid, actor_name: row.actor_name,
        correlation_id: row.correlation_id, occurred_at: row.occurred_at,
        source,
        scope: if taxonomy { "category_global" } else { "asset" },
        before, after, diff, assignment_labels,
    }
}

enum Outcome {
    Page(Vec<Record>, Option<i32>, DateTime<Utc>),
    Gate(PluginGate),
    MissingAsset,
    WrongCursor,
}

/// GET /api/plugins/{uuid}/assets/{asset_id}/history.
/// Admin policy is evaluated on the server for every page. Plugin grants alone
/// do not imply authority to read historical ownership/hidden values/deletions.
pub async fn list(
    req: HttpRequest,
    mut tc: TenantConn,
    path: web::Path<HistoryPath>,
    query: web::Query<HistoryQuery>,
) -> Result<HttpResponse, ApiError> {
    // These are independent gates: a workspace admin with platform_role=user
    // cannot read audit records. AuditReviewer + workspace Admin/Owner, or a
    // PlatformAdmin with workspace membership, must also carry audit:read/full.
    // Keep the upstream audit policy in addition to the plugin-specific grant.
    rbac::require_workspace_role(&req, WorkspaceRole::Admin)?;
    rbac::require_audit_read(&req)?;
    let path = path.into_inner();
    let query = query.into_inner();
    let limit = validate_query(path.asset_id, &query)?;
    let workspace_id = tc.workspace_id()
        .ok_or_else(|| ApiError::Internal("History workspace context missing".into()))?;
    let cursor = query.cursor.as_deref().map(decode_cursor).transpose()?;

    let outcome = tc.run(|conn| {
        match authorize_plugin_data_request(conn, path.uuid, PERMISSION,
            "Plugin has not been granted asset history access")? {
            Ok(_) => {}, Err(gate) => return Ok(Outcome::Gate(gate)),
        }
        if !asset_is_in_workspace(conn, workspace_id, path.asset_id)? {
            return Ok(Outcome::MissingAsset);
        }
        let plugin_id = sublists_plugin_id(conn, workspace_id)?;
        if cursor.as_ref().is_some_and(|c| !cursor_matches(c, workspace_id, path.asset_id, plugin_id, &query)) {
            return Ok(Outcome::WrongCursor);
        }
        let info = diesel::sql_query("SELECT started_at FROM asset_history_capture_info WHERE singleton = true")
            .get_result::<CaptureInfo>(conn)?;
        Ok(Outcome::Page(read_records(conn, workspace_id, path.asset_id, plugin_id, &query, cursor.as_ref(), limit)?,
            plugin_id, info.started_at))
    }).map_err(|e| {
        tracing::warn!(error = ?e, "Failed to read scoped asset history");
        ApiError::Internal("Failed to read asset history".into())
    })?;

    let (mut rows, plugin_id, capture_since) = match outcome {
        Outcome::Page(rows, plugin_id, capture_since) => (rows, plugin_id, capture_since),
        Outcome::Gate(gate) => return Ok(gate.into_response()),
        Outcome::MissingAsset => return Err(ApiError::NotFoundMsg("Asset history not found".into())),
        Outcome::WrongCursor => return Err(ApiError::BadRequest("Cursor belongs to a different history query".into())),
    };
    let next_cursor = if rows.len() > limit as usize {
        rows.pop();
        rows.last().map(|last| encode_cursor(&Cursor {
            workspace_id, asset_id: path.asset_id, sublists_plugin_id: plugin_id,
            include_category_changes: query.include_category_changes.unwrap_or(false),
            since: query.since, until: query.until, occurred_at: last.occurred_at, id: last.id,
        }))
    } else { None };
    // Mirror scheduled_jobs::retention_days: nonpositive/invalid values use
    // 540. Monthly partition pruning means this is policy, not an exact cutoff.
    let retention_days = std::env::var("AUDIT_LOG_RETENTION_DAYS").ok()
        .and_then(|v| v.parse::<i32>().ok()).filter(|v| *v > 0).unwrap_or(540) as u32;
    Ok(HttpResponse::Ok().insert_header(("Cache-Control", "no-store")).json(HistoryResponse {
        rows: rows.into_iter().map(into_row).collect(), next_cursor, asset_id: path.asset_id,
        retention_days, related_capture_since: capture_since,
        category_changes_included: query.include_category_changes.unwrap_or(false),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn difference_preserves_null_zero_false_and_absence() {
        let before = json!({"null":null,"zero":0,"flag":false,"gone":"x"});
        let after = json!({"null":"now","zero":1,"flag":true,"added":null});
        let diffs = fields_diff(Some(&before), Some(&after));
        let added = diffs.iter().find(|d| d.field == "added").unwrap();
        assert!(!added.old_present); assert!(added.new_present);
        assert_eq!(added.new, Some(Value::Null));
        let removed = diffs.iter().find(|d| d.field == "gone").unwrap();
        assert!(removed.old_present); assert!(!removed.new_present);
        assert_eq!(diffs.iter().find(|d| d.field == "zero").unwrap().old, Some(json!(0)));
        assert_eq!(diffs.iter().find(|d| d.field == "flag").unwrap().old, Some(json!(false)));
    }

    #[test]
    fn cursor_round_trips_and_is_scoped_to_query() {
        let query = HistoryQuery::default();
        let cursor = Cursor { workspace_id: 1, asset_id: 42, sublists_plugin_id: Some(7),
            include_category_changes: false, since: None, until: None, occurred_at: Utc::now(), id: 99 };
        assert_eq!(decode_cursor(&encode_cursor(&cursor)).unwrap(), cursor);
        assert!(cursor_matches(&cursor, 1, 42, Some(7), &query));
        assert!(!cursor_matches(&cursor, 2, 42, Some(7), &query));
        assert!(!cursor_matches(&cursor, 1, 43, Some(7), &query));
        assert!(!cursor_matches(&cursor, 1, 42, Some(8), &query));
        assert!(!cursor_matches(&cursor, 1, 42, Some(7), &HistoryQuery { include_category_changes:Some(true), ..query }));
        assert!(decode_cursor("bad!").is_err());
        assert!(decode_cursor(&"a".repeat(2049)).is_err());
    }

    #[test]
    fn rejects_unbounded_invalid_or_reversed_queries() {
        assert!(validate_query(0, &HistoryQuery::default()).is_err());
        assert!(validate_query(1, &HistoryQuery { limit:Some(201), ..Default::default() }).is_err());
        assert!(validate_query(1, &HistoryQuery { limit:Some(0), ..Default::default() }).is_err());
        assert!(validate_query(1, &HistoryQuery { since:Some(Utc::now()), until:Some(Utc::now()-chrono::Duration::days(1)), ..Default::default() }).is_err());
        assert_eq!(validate_query(1, &HistoryQuery::default()).unwrap(), 50);
    }

    // Database tests use the upstream isolated migration-hashed test database,
    // transaction rollback and non-superuser nosdesk_app role. They need an
    // explicitly configured disposable PostgreSQL 18 TEST_DATABASE_URL.
    #[derive(QueryableByName)]
    struct Id {
        #[diesel(sql_type = Integer)]
        id: i32,
    }

    fn create_asset(conn: &mut DbConnection, name: &str) -> i32 {
        diesel::sql_query("INSERT INTO assets (name) VALUES ($1) RETURNING id")
            .bind::<Text, _>(name).get_result::<Id>(conn).unwrap().id
    }

    fn create_plugin(conn: &mut DbConnection, name: &str, state: &str, grant: bool) -> crate::models::Plugin {
        use crate::models::{NewPlugin, PluginState};
        let manifest = json!({"permissions":["asset:history:read","storage:plugin"]});
        // Fixture seeding deliberately bypasses installer signing validation.
        diesel::insert_into(crate::schema::plugins::table).values(NewPlugin {
            name:name.into(), display_name:name.into(), version:"1.0.0".into(), description:None,
            manifest:manifest.clone(), state:PluginState::from_db_str(state).unwrap(),
            trust_level:"community".into(), installed_by:None, source:"sideload".into(),
            signer_pubkey:None, signer_source:None, signature_metadata:None, icon_svg:None,
            consented_permissions: if grant { Some(json!(["asset:history:read","storage:plugin"])) } else { Some(json!([])) },
            consented_at:None, consented_by:None,
        }).get_result(conn).unwrap()
    }

    #[test]
    fn database_history_survives_deletion_and_is_workspace_scoped() {
        use crate::test_helpers::setup_test_connection;
        let mut conn = setup_test_connection();
        let asset_id = create_asset(&mut conn, "history-delete-test");
        assert!(asset_is_in_workspace(&mut conn, 1, asset_id).unwrap());
        assert!(!asset_is_in_workspace(&mut conn, 2, asset_id).unwrap());
        diesel::sql_query("UPDATE assets SET location = 'new room' WHERE id = $1")
            .bind::<Integer, _>(asset_id).execute(&mut conn).unwrap();
        diesel::sql_query("DELETE FROM assets WHERE id = $1")
            .bind::<Integer, _>(asset_id).execute(&mut conn).unwrap();
        assert!(asset_is_in_workspace(&mut conn, 1, asset_id).unwrap());
        assert!(!asset_is_in_workspace(&mut conn, 1, i32::MAX).unwrap());
        let query = HistoryQuery::default();
        let records = read_records(&mut conn, 1, asset_id, None, &query, None, 200).unwrap();
        assert_eq!(records.iter().filter(|r| r.table_name == "assets").count(), 3);
        assert!(records.iter().any(|r| r.op == "D"));
        assert!(read_records(&mut conn, 2, asset_id, None, &query, None, 200).unwrap().is_empty());
        // Same-transaction timestamps are tied: id prevents skips/duplicates.
        let first = read_records(&mut conn, 1, asset_id, None, &query, None, 1).unwrap();
        let c = Cursor { workspace_id:1, asset_id, sublists_plugin_id:None,
            include_category_changes:false, since:None, until:None,
            occurred_at:first[0].occurred_at, id:first[0].id };
        let next = read_records(&mut conn, 1, asset_id, None, &query, Some(&c), 200).unwrap();
        assert_eq!(next.len(), records.len() - 1);
        assert!(!next.iter().any(|r| r.id == c.id));
    }

    #[test]
    fn database_added_triggers_capture_relations_and_cascades_with_actor() {
        use crate::test_helpers::{setup_test_connection, TestFixtures};
        use crate::sync::{actor::ActorContext, session::with_actor_context};
        let mut conn = setup_test_connection();
        let user = TestFixtures::create_user(&mut conn, "history-actor", "admin");
        let correlation_id = Uuid::now_v7();
        let actor = ActorContext::user(user.uuid, Some(correlation_id)).with_workspace(1);
        let asset_id = with_actor_context::<_, DieselError>(&mut conn, &actor, |conn| {
            let asset_id = create_asset(conn, "history-cascade-test");
            let group_id = diesel::sql_query("INSERT INTO asset_groups (name) VALUES ('History group') RETURNING id")
                .get_result::<Id>(conn)?.id;
            let directory_id = diesel::sql_query("INSERT INTO groups (name) VALUES ('History directory') RETURNING id")
                .get_result::<Id>(conn)?.id;
            diesel::sql_query("INSERT INTO asset_group_assignments (group_id, asset_id) VALUES ($1,$2)")
                .bind::<Integer, _>(group_id).bind::<Integer, _>(asset_id).execute(conn)?;
            diesel::sql_query("INSERT INTO asset_directory_memberships (group_id, asset_id) VALUES ($1,$2)")
                .bind::<Integer, _>(directory_id).bind::<Integer, _>(asset_id).execute(conn)?;
            let ticket = TestFixtures::create_ticket(conn, "History link", Some(user.uuid), None);
            diesel::sql_query("INSERT INTO ticket_assets (ticket_id, asset_id) VALUES ($1,$2)")
                .bind::<Integer, _>(ticket.id).bind::<Integer, _>(asset_id).execute(conn)?;
            diesel::sql_query("INSERT INTO asset_disposals (asset_id, sanitization_method, data_bearing) VALUES ($1,'none',false)")
                .bind::<Integer, _>(asset_id).execute(conn)?;
            diesel::sql_query("UPDATE asset_disposals SET notes = 'certificate requested' WHERE asset_id = $1")
                .bind::<Integer, _>(asset_id).execute(conn)?;
            diesel::sql_query("DELETE FROM assets WHERE id = $1")
                .bind::<Integer, _>(asset_id).execute(conn)?;
            Ok(asset_id)
        }).unwrap();
        let records = read_records(&mut conn, 1, asset_id, None, &HistoryQuery::default(), None, 200).unwrap();
        for table in ["asset_group_assignments", "asset_directory_memberships", "ticket_assets", "asset_disposals"] {
            for op in ["I", "D"] {
                assert!(records.iter().any(|r| r.table_name == table && r.op == op
                    && r.actor_uuid == Some(user.uuid) && r.correlation_id == Some(correlation_id)),
                    "missing {table} {op} capture/actor/cascade");
            }
        }
        assert!(records.iter().any(|r| r.table_name == "asset_disposals" && r.op == "U"));
    }

    #[test]
    fn database_cross_plugin_storage_is_narrow_and_global_categories_opt_in() {
        use crate::test_helpers::setup_test_connection;
        use crate::repository::plugins::set_plugin_data;
        let mut conn = setup_test_connection();
        let asset_id = create_asset(&mut conn, "history-sublists-test");
        let other_asset_id = create_asset(&mut conn, "history-other-asset");
        let plugin = create_plugin(&mut conn, "asset-categories", "installed", true);
        let unrelated = create_plugin(&mut conn, "history-unrelated", "installed", true);
        let key = format!("asset-{asset_id}-category-v1");
        let value = Some(json!({"category":"computers","subcategory":"desktops"}));
        set_plugin_data(&mut conn, plugin.id, "storage", "taxonomy-v1".into(), Some(json!({"version":1,"categories":[
            {"id":"computers","name":"Computers","children":[{"id":"desktops","name":"Desktops"}]}
        ]})), false).unwrap();
        set_plugin_data(&mut conn, plugin.id, "storage", key.clone(), value.clone(), false).unwrap();
        set_plugin_data(&mut conn, plugin.id, "storage", format!("asset-{other_asset_id}-category-v1"), value.clone(), false).unwrap();
        set_plugin_data(&mut conn, unrelated.id, "storage", key.clone(), value.clone(), false).unwrap();
        set_plugin_data(&mut conn, plugin.id, "setting", key.clone(), Some(json!("secret-setting")), true).unwrap();
        let query = HistoryQuery::default();
        let records = read_records(&mut conn, 1, asset_id, Some(plugin.id), &query, None, 200).unwrap();
        let storage:Vec<_> = records.into_iter().filter(|r| r.table_name == "plugin_data").map(into_row).collect();
        assert_eq!(storage.len(), 1);
        assert_eq!(storage[0].source, "sublist_assignment");
        assert_eq!(storage[0].after, value);
        assert_eq!(storage[0].assignment_labels.as_ref().unwrap().after.as_ref().unwrap().category.as_deref(), Some("Computers"));
        assert_eq!(storage[0].assignment_labels.as_ref().unwrap().after.as_ref().unwrap().subcategory.as_deref(), Some("Desktops"));
        // A later rename must not rewrite the names on the earlier assignment.
        set_plugin_data(&mut conn, plugin.id, "storage", "taxonomy-v1".into(), Some(json!({"version":1,"categories":[
            {"id":"computers","name":"Renamed computers","children":[{"id":"desktops","name":"Renamed desktops"}]}
        ]})), false).unwrap();
        let historical = read_records(&mut conn, 1, asset_id, Some(plugin.id), &query, None, 200).unwrap()
            .into_iter().map(into_row).find(|r| r.source == "sublist_assignment").unwrap();
        assert_eq!(historical.assignment_labels.as_ref().unwrap().after.as_ref().unwrap().category.as_deref(), Some("Computers"));
        let categories = HistoryQuery { include_category_changes:Some(true), ..Default::default() };
        let records = read_records(&mut conn, 1, asset_id, Some(plugin.id), &categories, None, 200).unwrap();
        assert_eq!(records.iter().filter(|r| r.table_name == "plugin_data").count(), 3);
        assert!(records.into_iter().map(into_row).any(|r| r.source == "category_configuration" && r.scope == "category_global"));
        // Repository upserts deliberately preserve the existing secret flag.
        // Prove that contract, then seed an actual secret via direct fixture SQL.
        let unchanged = set_plugin_data(&mut conn, plugin.id, "storage", key.clone(), value.clone(), true).unwrap();
        assert!(!unchanged.is_secret, "an upsert must not reclassify existing storage");
        let marked_secret = diesel::sql_query(
            "UPDATE plugin_data SET is_secret = true, value = $1
             WHERE plugin_id = $2 AND data_type = 'storage' AND key = $3
             RETURNING is_secret AS found",
        )
        .bind::<Jsonb, _>(json!("hidden"))
        .bind::<Integer, _>(plugin.id)
        .bind::<Text, _>(&key)
        .get_result::<Found>(&mut conn).unwrap();
        assert!(marked_secret.found, "the security fixture must actually be secret");
        // The transition's public before snapshot must not expose its secret after.
        let records = read_records(&mut conn, 1, asset_id, Some(plugin.id), &categories, None, 200).unwrap();
        assert!(!records.into_iter().map(into_row).any(|r| r.after == Some(json!("hidden"))));
    }

    #[test]
    fn database_gate_requires_active_consented_history_permission() {
        use crate::test_helpers::setup_test_connection;
        let mut conn = setup_test_connection();
        let allowed = create_plugin(&mut conn, "history-allowed", "installed", true);
        let unconsented = create_plugin(&mut conn, "history-no-grant", "installed", false);
        let disabled = create_plugin(&mut conn, "history-disabled", "disabled", true);
        assert!(authorize_plugin_data_request(&mut conn, allowed.uuid, PERMISSION, "denied").unwrap().is_ok());
        assert!(matches!(authorize_plugin_data_request(&mut conn, unconsented.uuid, PERMISSION, "denied").unwrap(), Err(PluginGate::Forbidden(_))));
        assert!(matches!(authorize_plugin_data_request(&mut conn, disabled.uuid, PERMISSION, "denied").unwrap(), Err(PluginGate::Inactive)));
        assert!(matches!(authorize_plugin_data_request(&mut conn, Uuid::now_v7(), PERMISSION, "denied").unwrap(), Err(PluginGate::NotFound)));
    }

    #[test]
    fn database_new_capture_fails_closed_without_workspace_context() {
        use crate::test_helpers::setup_test_connection;
        let mut conn = setup_test_connection();
        let asset_id = create_asset(&mut conn, "history-no-context");
        let result: Result<(), DieselError> = conn.transaction(|conn| {
            // The migration test principal can assume the admin role. Bypass
            // table RLS so the test specifically reaches the strict audit
            // context guard, then roll back the expected failure/savepoint.
            diesel::sql_query("SET LOCAL ROLE nosdesk_admin").execute(conn)?;
            diesel::sql_query("SELECT set_config('app.workspace_id', '', true)").execute(conn)?;
            diesel::sql_query("INSERT INTO asset_disposals (asset_id, workspace_id, sanitization_method) VALUES ($1,1,'none')")
                .bind::<Integer, _>(asset_id).execute(conn)?;
            Ok(())
        });
        assert!(result.unwrap_err().to_string().contains("audit context missing"));
    }

    #[test]
    fn malformed_storage_and_missing_taxonomy_never_invent_labels() {
        let object = json!({"category":"computers"});
        let diffs = fields_diff(Some(&object), Some(&json!("unexpected scalar")));
        assert_eq!(diffs.len(), 1);
        assert_eq!(diffs[0].field, "value");
        assert_eq!(diffs[0].new, Some(json!("unexpected scalar")));
        let labels = assignment_label(Some(&object), None).unwrap();
        assert_eq!(labels.category, None);
        let malformed = json!({"categories":[{"name":"Unidentified"}]});
        let labels = assignment_label(Some(&json!({})), Some(&malformed)).unwrap();
        assert_eq!(labels.category, None);
    }

    #[actix_web::test]
    async fn endpoint_requires_admin_and_audit_scope() {
        use crate::test_helpers::{claims_for, setup_test_pool};
        use actix_web::{test, App, HttpMessage, http::StatusCode};
        let pool = setup_test_pool();
        let member = claims_for(&pool, "user");
        let agent = claims_for(&pool, "technician");
        let reviewer = claims_for(&pool, "audit_reviewer");
        let mut admin_without_scope = claims_for(&pool, "admin");
        admin_without_scope.scope = "asset:read".into();
        let app = test::init_service(App::new().app_data(web::Data::new(pool))
            .route("/plugins/{uuid}/assets/{asset_id}/history", web::get().to(list))).await;
        let uri = format!("/plugins/{}/assets/1/history", Uuid::now_v7());
        let req = test::TestRequest::get().uri(&uri).to_request();
        assert_eq!(test::call_service(&app, req).await.status(), StatusCode::UNAUTHORIZED);
        for claims in [member, agent, reviewer, admin_without_scope] {
            let req = test::TestRequest::get().uri(&uri).to_request();
            req.extensions_mut().insert(claims);
            assert_eq!(test::call_service(&app, req).await.status(), StatusCode::FORBIDDEN);
        }
    }
}
