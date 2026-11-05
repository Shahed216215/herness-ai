-- Mira HFM v0.2 Phase 8: project-isolated, immutable learning proposals.
-- Apply manually only during an explicitly approved Supabase migration window.
-- No canonical Memory rows are read, written, transformed or migrated.

create table if not exists public.mira_hfm_learning_proposals (
  project_id text not null,
  proposal_id text not null,
  proposal_digest text not null check (proposal_digest ~ '^[a-f0-9]{64}$'),
  evidence_digest text not null check (evidence_digest ~ '^[a-f0-9]{64}$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  primary key (project_id, proposal_id),
  constraint mira_hfm_learning_proposal_payload_identity check (
    payload ->> 'projectId' = project_id
    and payload ->> 'proposalId' = proposal_id
    and payload ->> 'proposalDigest' = proposal_digest
    and payload ->> 'evidenceDigest' = evidence_digest
    and payload ->> 'trustState' = 'UNTRUSTED'
    and payload ->> 'status' = 'PENDING_HUMAN_REVIEW'
    and payload ->> 'automaticPromotion' = 'false'
    and payload ->> 'automaticExecution' = 'false'
    and payload ->> 'canonicalMemoryWrites' = '0'
    and payload ->> 'selfModificationAllowed' = 'false'
  )
);

create index if not exists mira_hfm_learning_proposals_project_created_idx
  on public.mira_hfm_learning_proposals (project_id, created_at desc);

alter table public.mira_hfm_learning_proposals enable row level security;
revoke all on table public.mira_hfm_learning_proposals from public, anon, authenticated, service_role;
grant select, insert on table public.mira_hfm_learning_proposals to service_role;

create table if not exists public.mira_hfm_learning_proposal_audit_events (
  event_id uuid primary key,
  project_id text not null,
  proposal_id text not null,
  event_digest text not null check (event_digest ~ '^[a-f0-9]{64}$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  constraint mira_hfm_learning_proposal_audit_fk
    foreign key (project_id, proposal_id)
    references public.mira_hfm_learning_proposals (project_id, proposal_id)
    on delete restrict,
  constraint mira_hfm_learning_proposal_audit_payload_identity check (
    payload ->> 'projectId' = project_id
    and payload ->> 'proposalId' = proposal_id
    and payload ->> 'canonicalMemoryWrites' = '0'
  )
);

create index if not exists mira_hfm_learning_proposal_audit_project_created_idx
  on public.mira_hfm_learning_proposal_audit_events (project_id, created_at desc);

alter table public.mira_hfm_learning_proposal_audit_events enable row level security;
revoke all on table public.mira_hfm_learning_proposal_audit_events from public, anon, authenticated, service_role;
grant select, insert on table public.mira_hfm_learning_proposal_audit_events to service_role;

comment on table public.mira_hfm_learning_proposals is
  'Mira HFM v0.2 Phase 8: immutable, project-isolated, untrusted learning proposals. Never canonical Memory.';
comment on table public.mira_hfm_learning_proposal_audit_events is
  'Mira HFM v0.2 Phase 8: append-only proposal staging audit events.';
