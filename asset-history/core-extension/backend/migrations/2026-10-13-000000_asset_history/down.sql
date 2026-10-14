-- Turning capture off does not delete any recorded history.
DROP TRIGGER tr_audit_asset_disposals ON public.asset_disposals;
DROP TRIGGER tr_audit_asset_group_assignments ON public.asset_group_assignments;
DROP TRIGGER tr_audit_asset_directory_memberships ON public.asset_directory_memberships;
DROP TRIGGER tr_audit_ticket_assets ON public.ticket_assets;
DROP INDEX public.asset_history_before_asset_idx;
DROP INDEX public.asset_history_after_asset_idx;
DROP INDEX public.asset_history_plugin_before_idx;
DROP INDEX public.asset_history_plugin_after_idx;
DROP TABLE public.asset_history_capture_info;
