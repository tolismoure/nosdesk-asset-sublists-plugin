-- Run only with the application stopped immediately before an upstream upgrade.
-- A transaction ensures an unexpected definition leaves the database unchanged.
BEGIN;
DO $handover$
DECLARE definition record;
BEGIN
 SELECT t.tgargs,t.tgtype,p.proname,n.nspname INTO definition
 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
 JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE t.tgrelid='public.asset_disposals'::regclass
 AND t.tgname='tr_audit_asset_disposals' AND NOT t.tgisinternal;
 IF NOT FOUND THEN
  RAISE NOTICE 'Disposal trigger is absent; no changes made.';
 ELSIF definition.proname='audit_log_trigger' AND definition.nspname='public'
       AND definition.tgtype=29 AND definition.tgargs=decode('61737365745f696400','hex') THEN
  DROP TRIGGER tr_audit_asset_disposals ON public.asset_disposals;
  RAISE NOTICE 'Removed custom asset_id disposal trigger; upstream migration must replace it.';
 ELSIF definition.proname='audit_log_trigger' AND definition.nspname='public'
       AND definition.tgtype=29 AND definition.tgargs=decode('696400','hex') THEN
  RAISE NOTICE 'Upstream id disposal trigger already installed; retained.';
 ELSE
  RAISE EXCEPTION 'Unexpected disposal trigger definition. Nothing removed; review manually.';
 END IF;
END
$handover$;
COMMIT;
