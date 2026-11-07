-- MIRA HFM constrained retrieval runtime role.
-- SOURCE-ONLY DRAFT. Do not execute on production or staging without separate approval.
-- The role may consume one-time authorities and read eligible project Memory.
-- It cannot issue authorities, create memberships, write Memory, or delete data.
-- No application data is inserted, updated, or deleted.

BEGIN;

DO $$
BEGIN
  IF to_regclass('mira_hfm.project_owners') IS NULL
     OR to_regclass('mira_hfm.project_memberships') IS NULL
     OR to_regclass('mira_hfm.operation_authorities') IS NULL
     OR to_regclass('mira_hfm.authority_audit_events') IS NULL
     OR to_regclass('mira_hfm.memory_records') IS NULL THEN
    RAISE EXCEPTION 'HFM_RETRIEVAL_SCHEMA_REQUIRED';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mira_hfm_memory_reader') THEN
    CREATE ROLE mira_hfm_memory_reader
      NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'mira_hfm_memory_reader'
      AND (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole
           OR rolreplication OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'HFM_MEMORY_READER_ROLE_ATTRIBUTES_MUST_BE_LEAST_PRIVILEGE';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_auth_members
    WHERE member = (SELECT oid FROM pg_roles WHERE rolname = 'mira_hfm_memory_reader')
  ) THEN
    RAISE EXCEPTION 'HFM_MEMORY_READER_GROUP_MUST_NOT_INHERIT_OTHER_ROLES';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_shdepend
    WHERE refclassid = 'pg_authid'::regclass
      AND refobjid = (SELECT oid FROM pg_roles WHERE rolname = 'mira_hfm_memory_reader')
      AND deptype = 'o'
  ) THEN
    RAISE EXCEPTION 'HFM_MEMORY_READER_GROUP_MUST_NOT_OWN_DATABASE_OBJECTS';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'mira_hfm'
      AND policyname IN (
        'hfm_memory_reader_owner_select',
        'hfm_memory_reader_membership_select',
        'hfm_memory_reader_authority_consume',
        'hfm_memory_reader_authority_consume_update',
        'hfm_memory_reader_authority_audit_insert',
        'hfm_memory_reader_memory_select'
      )
  ) THEN
    RAISE EXCEPTION 'HFM_MEMORY_READER_POLICY_NAME_COLLISION';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'mira_hfm'
      AND c.relname IN (
        'project_owners','project_memberships','operation_authorities',
        'authority_audit_events','memory_records'
      )
      AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'HFM_MEMORY_READER_FORCED_RLS_REQUIRED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'mira_hfm'
      AND tablename IN (
        'project_owners','project_memberships','operation_authorities',
        'authority_audit_events','memory_records'
      )
      AND 'public' = ANY(roles)
  ) THEN
    RAISE EXCEPTION 'HFM_MEMORY_READER_PUBLIC_POLICY_CONFLICT';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'mira_hfm'
      AND (SELECT oid FROM pg_roles WHERE rolname = 'mira_hfm_memory_reader') = ANY(roles)
  ) THEN
    RAISE EXCEPTION 'HFM_MEMORY_READER_PREEXISTING_POLICY_CONFLICT';
  END IF;
END;
$$;

REVOKE ALL ON SCHEMA mira_hfm FROM mira_hfm_memory_reader;
REVOKE ALL ON ALL TABLES IN SCHEMA mira_hfm FROM mira_hfm_memory_reader;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA mira_hfm FROM mira_hfm_memory_reader;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA mira_hfm FROM mira_hfm_memory_reader;

GRANT USAGE ON SCHEMA mira_hfm TO mira_hfm_memory_reader;
GRANT SELECT ON TABLE
  mira_hfm.project_owners,
  mira_hfm.project_memberships
TO mira_hfm_memory_reader;
GRANT SELECT ON TABLE mira_hfm.operation_authorities
TO mira_hfm_memory_reader;
GRANT UPDATE (status, consumed_at) ON TABLE mira_hfm.operation_authorities
TO mira_hfm_memory_reader;
GRANT INSERT ON TABLE mira_hfm.authority_audit_events
TO mira_hfm_memory_reader;
GRANT SELECT ON TABLE mira_hfm.memory_records
TO mira_hfm_memory_reader;
GRANT USAGE ON SEQUENCE mira_hfm.authority_audit_events_event_sequence_seq
TO mira_hfm_memory_reader;

CREATE POLICY hfm_memory_reader_owner_select
  ON mira_hfm.project_owners
  FOR SELECT TO mira_hfm_memory_reader
  USING (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND status = 'ACTIVE'
  );

CREATE POLICY hfm_memory_reader_membership_select
  ON mira_hfm.project_memberships
  FOR SELECT TO mira_hfm_memory_reader
  USING (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND status = 'ACTIVE'
    AND valid_from <= clock_timestamp()
    AND (expires_at IS NULL OR expires_at > clock_timestamp())
  );

CREATE POLICY hfm_memory_reader_authority_consume
  ON mira_hfm.operation_authorities
  FOR SELECT TO mira_hfm_memory_reader
  USING (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND status = 'ISSUED'
  );

CREATE POLICY hfm_memory_reader_authority_consume_update
  ON mira_hfm.operation_authorities
  FOR UPDATE TO mira_hfm_memory_reader
  USING (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND status = 'ISSUED'
  )
  WITH CHECK (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND status = 'CONSUMED'
  );

CREATE POLICY hfm_memory_reader_authority_audit_insert
  ON mira_hfm.authority_audit_events
  FOR INSERT TO mira_hfm_memory_reader
  WITH CHECK (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND event_type = 'AUTHORITY_CONSUMED'
  );

CREATE POLICY hfm_memory_reader_memory_select
  ON mira_hfm.memory_records
  FOR SELECT TO mira_hfm_memory_reader
  USING (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND lifecycle = 'ACTIVE'
    AND classification IN ('PUBLIC', 'PROJECT_PRIVATE')
  );

COMMENT ON ROLE mira_hfm_memory_reader IS
  'NOLOGIN HFM constrained retrieval role: consumes a pre-issued one-time authority, appends authority audit, and reads active non-restricted project Memory only.';

COMMIT;
