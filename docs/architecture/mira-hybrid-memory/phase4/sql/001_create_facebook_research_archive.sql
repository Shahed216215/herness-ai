-- Mira HFM v0.2 — isolated Facebook public-research archive
-- Operator-run Supabase SQL Editor migration.
-- Does not create projects, configure credentials, or write Canonical HFM Memory.
-- Apply only to a dedicated Supabase project after reviewing the v0.2 design.

begin;

create table if not exists public.mira_facebook_research_archive (
  archive_id text primary key
    check (archive_id ~ '^[a-f0-9]{64}$'),
  page_id text not null
    check (page_id ~ '^[0-9]{1,32}$'),
  payload jsonb not null
    check (jsonb_typeof(payload) = 'object'),
  record_digest text not null
    check (record_digest ~ '^[a-f0-9]{64}$'),
  archived_at timestamptz not null default now(),
  constraint mira_fb_research_archive_payload_identity
    check (
      payload->>'archiveId' = archive_id
      and payload->>'pageId' = page_id
      and payload->>'recordDigest' = record_digest
      and payload->>'archivePolicy' = 'UNTRUSTED_RESEARCH_ONLY'
      and payload->>'canonicalMemoryWrite' = 'false'
      and payload->>'trustStatus' = 'SOURCE_RECORDED'
      and payload->>'integrityStatus' = 'UNVERIFIED'
      and payload->>'lifecycle' = 'PENDING_REVIEW'
    )
);

create index if not exists mira_fb_research_page_archived_idx
  on public.mira_facebook_research_archive (page_id, archived_at desc);

alter table public.mira_facebook_research_archive enable row level security;

-- No browser/public/authenticated access. The server-side service role is the
-- only intended runtime principal. Never expose its key to clients or logs.
revoke all on table public.mira_facebook_research_archive from anon;
revoke all on table public.mira_facebook_research_archive from authenticated;
revoke all on table public.mira_facebook_research_archive from public;
grant select, insert on table public.mira_facebook_research_archive to service_role;

comment on table public.mira_facebook_research_archive is
  'Mira HFM v0.2 isolated untrusted public Facebook search evidence. Not Canonical Memory.';

commit;
