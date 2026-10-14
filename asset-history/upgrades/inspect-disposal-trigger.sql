SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = 'public.asset_disposals'::regclass AND tgname = 'tr_audit_asset_disposals';
