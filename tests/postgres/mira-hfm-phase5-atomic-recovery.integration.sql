-- Real PostgreSQL integration test for Mira HFM v0.2 Phase 5 Recovery Patch.
-- Applied only to an ephemeral GitHub Actions PostgreSQL service database.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END
$$;
ALTER ROLE service_role BYPASSRLS;

\echo '=== PRIVILEGE CONTRACT ==='
DO $$
DECLARE fn regprocedure := 'public.mira_stage_facebook_group_import_v1(jsonb,jsonb,text)'::regprocedure;
BEGIN
  IF has_function_privilege('anon', fn, 'EXECUTE') THEN RAISE EXCEPTION 'anon unexpectedly has RPC execute'; END IF;
  IF has_function_privilege('authenticated', fn, 'EXECUTE') THEN RAISE EXCEPTION 'authenticated unexpectedly has RPC execute'; END IF;
  IF NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN RAISE EXCEPTION 'service_role lacks RPC execute'; END IF;
END
$$;
\echo 'POSTGRES_RPC_ROLE_GRANTS=PASS'

-- Execute the RPC as the same least-privilege role used by the Supabase service key.
SET ROLE service_role;

DO $$
DECLARE
  b jsonb;
  e jsonb;
  retry_event jsonb;
  op text;
  r record;
  retry_result record;
  first_event_id uuid := '10000000-0000-4000-8000-000000000001';
  conflict_batch jsonb;
  conflict_event jsonb;
  conflict_op text;
  rollback_batch jsonb;
  rollback_event jsonb;
  rollback_op text;
  batch_count integer;
  audit_count integer;
BEGIN
  b := jsonb_build_object(
    'kind','MIRA_FACEBOOK_GROUP_MEMORY_IMPORT_BATCH',
    'batchId','pg-integration-batch-001',
    'projectId','pg-integration-project',
    'groupId','pg-integration-group',
    'exportId','pg-integration-export',
    'batchDigest',repeat('a',64),
    'canonicalMemoryWrite',false
  );
  e := jsonb_build_object(
    'schemaVersion','1.0.0',
    'eventType','FACEBOOK_GROUP_MEMORY_IMPORT_STAGED',
    'projectId','pg-integration-project',
    'groupId','pg-integration-group',
    'batchId','pg-integration-batch-001',
    'batchDigest',repeat('a',64),
    'actorId','integration-test-admin',
    'outcome','ATOMIC_STAGED',
    'canonicalMemoryWrite',false,
    'eventId',first_event_id,
    'eventDigest',repeat('b',64)
  );
  op := 'facebook-group-import:staged:v1:pg-integration-batch-001:' || repeat('a',64);

  SELECT * INTO r FROM public.mira_stage_facebook_group_import_v1(b,e,op);
  IF r.batch_status <> 'CREATED' OR r.audit_status <> 'CREATED'
     OR r.event_id <> first_event_id OR r.event_digest <> repeat('b',64) THEN
    RAISE EXCEPTION 'first atomic create returned unexpected result: %', row_to_json(r);
  END IF;

  retry_event := jsonb_set(e,'{eventId}',to_jsonb('10000000-0000-4000-8000-000000000002'::text));
  SELECT * INTO retry_result FROM public.mira_stage_facebook_group_import_v1(b,retry_event,op);
  IF retry_result.batch_status <> 'ALREADY_EXISTS'
     OR retry_result.audit_status <> 'ALREADY_EXISTS'
     OR retry_result.event_id <> first_event_id THEN
    RAISE EXCEPTION 'idempotent retry did not return original rows: %', row_to_json(retry_result);
  END IF;

  SELECT count(*) INTO batch_count FROM public.mira_facebook_group_import_batches
    WHERE batch_id = 'pg-integration-batch-001';
  SELECT count(*) INTO audit_count FROM public.mira_facebook_group_import_audit_events
    WHERE operation_key = op;
  IF batch_count <> 1 OR audit_count <> 1 THEN
    RAISE EXCEPTION 'idempotency count mismatch: batches %, audits %', batch_count, audit_count;
  END IF;

  -- Same batch identity with a different digest must be rejected.
  conflict_batch := jsonb_set(b,'{batchDigest}',to_jsonb(repeat('c',64)));
  conflict_batch := jsonb_set(conflict_batch,'{exportId}',to_jsonb('pg-integration-export-conflict'));
  conflict_batch := jsonb_set(conflict_batch,'{batchId}',to_jsonb('pg-integration-batch-001'));
  conflict_event := jsonb_set(e,'{batchDigest}',to_jsonb(repeat('c',64)));
  conflict_event := jsonb_set(conflict_event,'{eventDigest}',to_jsonb(repeat('d',64)));
  conflict_op := 'facebook-group-import:staged:v1:pg-integration-batch-001:' || repeat('c',64);
  BEGIN
    PERFORM * FROM public.mira_stage_facebook_group_import_v1(conflict_batch,conflict_event,conflict_op);
    RAISE EXCEPTION 'expected immutable batch identity conflict was not raised';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  -- Force an audit primary-key collision after a new Batch insert. The RPC
  -- must roll back that Batch together with the failed Audit insert.
  rollback_batch := jsonb_build_object(
    'kind','MIRA_FACEBOOK_GROUP_MEMORY_IMPORT_BATCH',
    'batchId','pg-integration-rollback-batch',
    'projectId','pg-integration-project',
    'groupId','pg-integration-group',
    'exportId','pg-integration-rollback-export',
    'batchDigest',repeat('e',64),
    'canonicalMemoryWrite',false
  );
  rollback_event := jsonb_build_object(
    'schemaVersion','1.0.0',
    'eventType','FACEBOOK_GROUP_MEMORY_IMPORT_STAGED',
    'projectId','pg-integration-project',
    'groupId','pg-integration-group',
    'batchId','pg-integration-rollback-batch',
    'batchDigest',repeat('e',64),
    'actorId','integration-test-admin',
    'outcome','ATOMIC_STAGED',
    'canonicalMemoryWrite',false,
    'eventId',first_event_id,
    'eventDigest',repeat('f',64)
  );
  rollback_op := 'facebook-group-import:staged:v1:pg-integration-rollback-batch:' || repeat('e',64);
  BEGIN
    PERFORM * FROM public.mira_stage_facebook_group_import_v1(rollback_batch,rollback_event,rollback_op);
    RAISE EXCEPTION 'expected audit primary-key collision was not raised';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
  SELECT count(*) INTO batch_count FROM public.mira_facebook_group_import_batches
    WHERE batch_id = 'pg-integration-rollback-batch';
  SELECT count(*) INTO audit_count FROM public.mira_facebook_group_import_audit_events
    WHERE operation_key = rollback_op;
  IF batch_count <> 0 OR audit_count <> 0 THEN
    RAISE EXCEPTION 'atomic rollback failed: batch %, audit %', batch_count, audit_count;
  END IF;

  RAISE NOTICE 'POSTGRES_ATOMIC_BATCH_AUDIT_CREATE=PASS';
  RAISE NOTICE 'POSTGRES_IDEMPOTENT_RETRY_NO_DUPLICATE=PASS';
  RAISE NOTICE 'POSTGRES_IMMUTABLE_BATCH_CONFLICT=PASS';
  RAISE NOTICE 'POSTGRES_BATCH_ROLLBACK_ON_AUDIT_FAILURE=PASS';
END
$$;

RESET ROLE;
\echo 'POSTGRES_PHASE5_ATOMIC_RECOVERY_INTEGRATION=PASS'
