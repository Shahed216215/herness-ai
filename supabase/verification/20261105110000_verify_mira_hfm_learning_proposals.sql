-- Read-only post-migration verification for Mira HFM v0.2 Phase 8.
-- Run only after applying 20261105110000_mira_hfm_learning_proposals.sql.
-- This script performs catalog reads only; it does not change schema or data.

with expected(table_name) as (
  values
    ('mira_hfm_learning_proposals'),
    ('mira_hfm_learning_proposal_reviews'),
    ('mira_hfm_learning_proposal_audit_events')
)
select
  expected.table_name,
  to_regclass('public.' || expected.table_name) is not null as table_exists,
  coalesce((
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = expected.table_name
  ), false) as rls_enabled,
  has_table_privilege('service_role', 'public.' || expected.table_name, 'SELECT') as service_role_select,
  has_table_privilege('service_role', 'public.' || expected.table_name, 'INSERT') as service_role_insert,
  has_table_privilege('service_role', 'public.' || expected.table_name, 'UPDATE') as service_role_update,
  has_table_privilege('service_role', 'public.' || expected.table_name, 'DELETE') as service_role_delete,
  has_table_privilege('anon', 'public.' || expected.table_name, 'SELECT') as anon_select,
  has_table_privilege('authenticated', 'public.' || expected.table_name, 'SELECT') as authenticated_select
from expected
order by expected.table_name;

select
  conname,
  conrelid::regclass::text as table_name,
  contype
from pg_constraint
where connamespace = 'public'::regnamespace
  and conname in (
    'mira_hfm_learning_proposal_review_fk',
    'mira_hfm_learning_proposal_audit_fk'
  )
order by conname;
