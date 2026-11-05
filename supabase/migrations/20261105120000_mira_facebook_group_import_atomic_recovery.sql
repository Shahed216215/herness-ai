-- Mira HFM v0.2 Phase 5 Recovery Patch.
-- Additive only. Apply manually only during an explicitly approved migration window.
-- This migration is NOT applied by this commit.

alter table public.mira_facebook_group_import_audit_events
  add column if not exists operation_key text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'mira_fb_group_audit_operation_key_unique'
      and conrelid = 'public.mira_facebook_group_import_audit_events'::regclass
  ) then
    alter table public.mira_facebook_group_import_audit_events
      add constraint mira_fb_group_audit_operation_key_unique unique (operation_key);
  end if;
end
$$;

create or replace function public.mira_stage_facebook_group_import_v1(
  p_batch jsonb,
  p_event jsonb,
  p_operation_key text
)
returns table (
  batch_status text,
  audit_status text,
  event_id uuid,
  event_digest text,
  batch_id text,
  batch_digest text,
  project_id text,
  group_id text
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  v_batch_id text;
  v_batch_digest text;
  v_project_id text;
  v_group_id text;
  v_export_id text;
  v_event_id uuid;
  v_event_digest text;
  v_inserted integer;
  v_batch public.mira_facebook_group_import_batches%rowtype;
  v_audit public.mira_facebook_group_import_audit_events%rowtype;
  v_batch_status text;
  v_audit_status text;
  v_payload jsonb;
begin
  if p_batch is null or p_event is null
     or jsonb_typeof(p_batch) <> 'object'
     or jsonb_typeof(p_event) <> 'object'
     or p_operation_key is null
     or length(p_operation_key) < 16
     or length(p_operation_key) > 512 then
    raise exception 'invalid atomic import arguments' using errcode = '22023';
  end if;

  v_batch_id := p_batch ->> 'batchId';
  v_batch_digest := p_batch ->> 'batchDigest';
  v_project_id := p_batch ->> 'projectId';
  v_group_id := p_batch ->> 'groupId';
  v_export_id := p_batch ->> 'exportId';
  v_event_id := (p_event ->> 'eventId')::uuid;
  v_event_digest := p_event ->> 'eventDigest';

  if v_batch_id is null or v_project_id is null or v_group_id is null
     or v_export_id is null or v_batch_digest is null
     or v_batch_digest !~ '^[a-f0-9]{64}$'
     or v_event_id is null or v_event_digest is null
     or v_event_digest !~ '^[a-f0-9]{64}$'
     or nullif(btrim(p_event ->> 'actorId'), '') is null
     or p_event ->> 'eventType' <> 'FACEBOOK_GROUP_MEMORY_IMPORT_STAGED'
     or p_event ->> 'projectId' <> v_project_id
     or p_event ->> 'groupId' <> v_group_id
     or p_event ->> 'batchId' <> v_batch_id
     or p_event ->> 'batchDigest' <> v_batch_digest
     or p_event ->> 'canonicalMemoryWrite' <> 'false'
     or p_operation_key <> 'facebook-group-import:staged:v1:' || v_batch_id || ':' || v_batch_digest
     or p_batch ->> 'kind' <> 'MIRA_FACEBOOK_GROUP_MEMORY_IMPORT_BATCH'
     or p_batch ->> 'canonicalMemoryWrite' <> 'false' then
    raise exception 'atomic import identity or policy validation failed' using errcode = '22023';
  end if;

  -- Transaction-scoped advisory locks serialize immutable identity checks without UPDATE grants.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('mira-fb-group-batch:' || v_batch_id, 0)
  );

  insert into public.mira_facebook_group_import_batches
    (batch_id, project_id, group_id, export_id, batch_digest, payload)
  values
    (v_batch_id, v_project_id, v_group_id, v_export_id, v_batch_digest, p_batch)
  on conflict on constraint mira_facebook_group_import_batches_pkey do nothing;
  get diagnostics v_inserted = row_count;
  v_batch_status := case when v_inserted = 1 then 'CREATED' else 'ALREADY_EXISTS' end;

  select * into v_batch
  from public.mira_facebook_group_import_batches
  where mira_facebook_group_import_batches.batch_id = v_batch_id;

  if not found or v_batch.project_id <> v_project_id
     or v_batch.group_id <> v_group_id
     or v_batch.export_id <> v_export_id
     or v_batch.batch_digest <> v_batch_digest then
    raise exception 'immutable batch identity conflict' using errcode = '23505';
  end if;

  v_payload := p_event - 'eventId' - 'eventDigest';
  v_payload := v_payload || jsonb_build_object('recordedAt', clock_timestamp());

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('mira-fb-group-audit:' || p_operation_key, 0)
  );

  insert into public.mira_facebook_group_import_audit_events
    (event_id, operation_key, project_id, group_id, batch_id, event_digest, payload)
  values
    (v_event_id, p_operation_key, v_project_id, v_group_id, v_batch_id, v_event_digest, v_payload)
  on conflict (operation_key) do nothing;
  get diagnostics v_inserted = row_count;
  v_audit_status := case when v_inserted = 1 then 'CREATED' else 'ALREADY_EXISTS' end;

  select * into v_audit
  from public.mira_facebook_group_import_audit_events
  where mira_facebook_group_import_audit_events.operation_key = p_operation_key;

  if not found or v_audit.project_id <> v_project_id
     or v_audit.group_id <> v_group_id
     or v_audit.batch_id <> v_batch_id
     or v_audit.event_digest <> v_event_digest
     or v_audit.payload ->> 'batchDigest' <> v_batch_digest
     or v_audit.payload ->> 'actorId' <> p_event ->> 'actorId' then
    raise exception 'immutable audit operation conflict' using errcode = '23505';
  end if;

  return query select v_batch_status, v_audit_status, v_audit.event_id,
    v_audit.event_digest, v_batch.batch_id, v_batch.batch_digest,
    v_batch.project_id, v_batch.group_id;
end;
$function$;

revoke all on function public.mira_stage_facebook_group_import_v1(jsonb, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.mira_stage_facebook_group_import_v1(jsonb, jsonb, text)
  to service_role;

comment on function public.mira_stage_facebook_group_import_v1(jsonb, jsonb, text) is
  'Mira HFM v0.2 Phase 5: atomically stage immutable Facebook Group batch and idempotent audit event in one transaction.';
