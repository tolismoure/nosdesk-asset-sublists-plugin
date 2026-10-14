-- Custom Asset History extension for Nosdesk 1.1.0.
-- Reuse the transactional upstream trigger; never duplicate assets capture.
-- Every snapshot retains asset_id, including ON DELETE CASCADE removals.
-- Context is deliberately not bypassed: an unscoped write must fail rather
-- than silently record history against the wrong workspace.
CREATE TRIGGER tr_audit_asset_disposals
AFTER INSERT OR UPDATE OR DELETE ON public.asset_disposals
FOR EACH ROW EXECUTE FUNCTION public.audit_log_trigger('asset_id');

CREATE TRIGGER tr_audit_asset_group_assignments
AFTER INSERT OR UPDATE OR DELETE ON public.asset_group_assignments
FOR EACH ROW EXECUTE FUNCTION public.audit_log_trigger('asset_id');

CREATE TRIGGER tr_audit_asset_directory_memberships
AFTER INSERT OR UPDATE OR DELETE ON public.asset_directory_memberships
FOR EACH ROW EXECUTE FUNCTION public.audit_log_trigger('asset_id');

CREATE TRIGGER tr_audit_ticket_assets
AFTER INSERT OR UPDATE OR DELETE ON public.ticket_assets
FOR EACH ROW EXECUTE FUNCTION public.audit_log_trigger('asset_id');

-- Deployment-wide metadata only: no asset values, identities or tenant data.
CREATE TABLE public.asset_history_capture_info (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    started_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE public.asset_history_capture_info OWNER TO nosdesk_admin;
INSERT INTO public.asset_history_capture_info (singleton) VALUES (true);
GRANT SELECT ON public.asset_history_capture_info TO nosdesk_app;

-- Child history otherwise requires scanning every retained row in a table.
-- These expressions support matching either snapshot after a relationship
-- removal/deletion and do not cast administrator-controlled JSON to integer.
CREATE INDEX asset_history_before_asset_idx ON public.audit_log
    (workspace_id, (before_jsonb ->> 'asset_id'), occurred_at DESC, id DESC)
    WHERE table_name IN ('asset_loans', 'asset_lifecycle_events', 'asset_usage_log',
      'asset_audits', 'asset_media', 'asset_disposals', 'asset_group_assignments',
      'asset_directory_memberships', 'ticket_assets');
CREATE INDEX asset_history_after_asset_idx ON public.audit_log
    (workspace_id, (after_jsonb ->> 'asset_id'), occurred_at DESC, id DESC)
    WHERE table_name IN ('asset_loans', 'asset_lifecycle_events', 'asset_usage_log',
      'asset_audits', 'asset_media', 'asset_disposals', 'asset_group_assignments',
      'asset_directory_memberships', 'ticket_assets');

CREATE INDEX asset_history_plugin_before_idx ON public.audit_log
    (workspace_id, (before_jsonb ->> 'plugin_id'), (before_jsonb ->> 'key'), occurred_at DESC, id DESC)
    WHERE table_name = 'plugin_data';
CREATE INDEX asset_history_plugin_after_idx ON public.audit_log
    (workspace_id, (after_jsonb ->> 'plugin_id'), (after_jsonb ->> 'key'), occurred_at DESC, id DESC)
    WHERE table_name = 'plugin_data';
