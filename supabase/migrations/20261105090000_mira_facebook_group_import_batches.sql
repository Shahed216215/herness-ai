-- Mira HFM v0.2 Phase 5: immutable Facebook Group import batches.
-- Apply manually during the approved Supabase/Render deployment window.
-- No existing Memory or research-archive rows are modified or migrated.

create table if not exists public.mira_facebook_group_import_batches (
  batch_id text primary key,
  project_id text not null,
  group_id text not null,
  export_id text not null,
  batch_digest text not null
    check (batch_digest ~ '^[a-f0-9]{64}$'),
  payload jsonb not null
    check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  constraint mira_fb_group_batch_payload_identity check (
    payload ->> 'batchId' = batch_id
    and payload ->> 'projectId' = project_id
    and payload ->> 'groupId' = group_id
    and payload ->> 'exportId' = export_id
    and payload ->> 'batchDigest' = batch_digest
  )
);

create index if not exists mira_fb_group_import_project_group_created_idx
  on public.mira_facebook_group_import_batches
  (project_id, group_id, created_at);

alter table public.mira_facebook_group_import_batches enable row level security;

revoke all on table public.mira_facebook_group_import_batches
  from public, anon, authenticated, service_role;

grant select, insert on table public.mira_facebook_group_import_batches
  to service_role;

-- Deliberately no UPDATE or DELETE grant and no client-facing RLS policy.
-- Immutable batch identity is enforced by the primary key; a repeated key
-- with a different digest is detected by application readback and quarantined.
comment on table public.mira_facebook_group_import_batches is
  'Mira HFM v0.2 Phase 5: untrusted, user-supplied Facebook Group import batches; never canonical trusted Memory.';


create table if not exists public.mira_facebook_group_import_audit_events (
  event_id uuid primary key,
  project_id text not null,
  group_id text not null,
  batch_id text not null
    references public.mira_facebook_group_import_batches(batch_id)
    on delete restrict,
  event_digest text not null
    check (event_digest ~ '^[a-f0-9]{64}$'),
  payload jsonb not null
    check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  constraint mira_fb_group_audit_payload_identity check (
    payload ->> 'batchId' = batch_id
    and payload ->> 'projectId' = project_id
    and payload ->> 'groupId' = group_id
    and payload ->> 'canonicalMemoryWrite' = 'false'
  )
);

create index if not exists mira_fb_group_import_audit_project_group_created_idx
  on public.mira_facebook_group_import_audit_events
  (project_id, group_id, created_at);

alter table public.mira_facebook_group_import_audit_events enable row level security;

revoke all on table public.mira_facebook_group_import_audit_events
  from public, anon, authenticated, service_role;

grant select, insert on table public.mira_facebook_group_import_audit_events
  to service_role;

comment on table public.mira_facebook_group_import_audit_events is
  'Append-only audit events for Mira HFM v0.2 Phase 5 Facebook Group imports.';
