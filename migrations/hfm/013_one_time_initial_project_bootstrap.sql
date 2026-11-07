-- MIRA HFM v0.2 one-time initial project bootstrap role.
-- SOURCE-ONLY DRAFT. Do not execute on staging or production without explicit approval.
-- This adds a single-use, least-privilege bootstrap path for the first HFM project.
-- It does not seed any project, owner, membership, authority or Memory data.

BEGIN;

DO $$
BEGIN
  IF to_regclass('mira_hfm.project_owners') IS NULL
     OR to_regclass('mira_hfm.project_memberships') IS NULL
     OR to_regclass('mira_hfm.authority_audit_events') IS NULL THEN
    RAISE EXCEPTION 'HFM_BOOTSTRAP_BASE_SCHEMA_REQUIRED';
  END IF;

  IF to_regclass('mira_hfm.bootstrap_registry') IS NOT NULL THEN
    RAISE EXCEPTION 'HFM_BOOTSTRAP_REGISTRY_ALREADY_EXISTS';
  END IF;

  IF EXISTS (SELECT 1 FROM mira_hfm.project_owners)
     OR EXISTS (SELECT 1 FROM mira_hfm.project_memberships)
     OR EXISTS (SELECT 1 FROM mira_hfm.operation_authorities)
     OR EXISTS (SELECT 1 FROM mira_hfm.memory_records) THEN
    RAISE EXCEPTION 'HFM_BOOTSTRAP_REQUIRES_EMPTY_PROJECT_AND_MEMORY_REGISTRIES';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mira_hfm_bootstrap_operator') THEN
    CREATE ROLE mira_hfm_bootstrap_operator
      NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'mira_hfm_bootstrap_operator'
      AND (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole
           OR rolreplication OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'HFM_BOOTSTRAP_ROLE_ATTRIBUTES_MUST_BE_LEAST_PRIVILEGE';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_auth_members
    WHERE member = (SELECT oid FROM pg_roles WHERE rolname = 'mira_hfm_bootstrap_operator')
  ) THEN
    RAISE EXCEPTION 'HFM_BOOTSTRAP_GROUP_MUST_NOT_INHERIT_OTHER_ROLES';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_shdepend
    WHERE refclassid = 'pg_authid'::regclass
      AND refobjid = (SELECT oid FROM pg_roles WHERE rolname = 'mira_hfm_bootstrap_operator')
      AND deptype = 'o'
  ) THEN
    RAISE EXCEPTION 'HFM_BOOTSTRAP_GROUP_MUST_NOT_OWN_OBJECTS';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'mira_hfm'
      AND policyname IN (
        'hfm_bootstrap_registry_insert',
        'hfm_bootstrap_owner_insert',
        'hfm_bootstrap_membership_insert',
        'hfm_bootstrap_audit_insert'
      )
  ) THEN
    RAISE EXCEPTION 'HFM_BOOTSTRAP_POLICY_NAME_COLLISION';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'mira_hfm'
      AND tablename IN ('project_owners','project_memberships','authority_audit_events')
      AND 'public' = ANY(roles)
  ) THEN
    RAISE EXCEPTION 'HFM_BOOTSTRAP_PUBLIC_POLICY_CONFLICT';
  END IF;
END;
$$;

CREATE TABLE mira_hfm.bootstrap_registry (
  bootstrap_key text PRIMARY KEY CHECK (bootstrap_key = 'initial'),
  project_id text NOT NULL CHECK (length(btrim(project_id)) BETWEEN 3 AND 128),
  actor_id text NOT NULL CHECK (actor_id LIKE 'mira:mira.admins:%' AND length(actor_id) <= 512),
  approval_ref text NOT NULL UNIQUE CHECK (length(btrim(approval_ref)) BETWEEN 1 AND 256),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

REVOKE ALL ON SCHEMA mira_hfm FROM mira_hfm_bootstrap_operator;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA mira_hfm FROM mira_hfm_bootstrap_operator;
REVOKE ALL ON TABLE mira_hfm.bootstrap_registry FROM PUBLIC;
REVOKE ALL ON TABLE mira_hfm.bootstrap_registry FROM mira_hfm_bootstrap_operator;
REVOKE ALL ON TABLE
  mira_hfm.project_owners,
  mira_hfm.project_memberships,
  mira_hfm.authority_audit_events
FROM mira_hfm_bootstrap_operator;
REVOKE ALL ON SEQUENCE mira_hfm.authority_audit_events_event_sequence_seq
FROM mira_hfm_bootstrap_operator;

GRANT USAGE ON SCHEMA mira_hfm TO mira_hfm_bootstrap_operator;
GRANT SELECT, INSERT ON TABLE mira_hfm.bootstrap_registry TO mira_hfm_bootstrap_operator;
GRANT INSERT ON TABLE
  mira_hfm.bootstrap_registry,
  mira_hfm.project_owners,
  mira_hfm.project_memberships,
  mira_hfm.authority_audit_events
TO mira_hfm_bootstrap_operator;
GRANT USAGE ON SEQUENCE mira_hfm.authority_audit_events_event_sequence_seq
TO mira_hfm_bootstrap_operator;

ALTER TABLE mira_hfm.bootstrap_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE mira_hfm.bootstrap_registry FORCE ROW LEVEL SECURITY;

CREATE POLICY hfm_bootstrap_registry_insert
  ON mira_hfm.bootstrap_registry
  FOR INSERT TO mira_hfm_bootstrap_operator
  WITH CHECK (
    bootstrap_key = 'initial'
    AND project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND approval_ref = NULLIF(current_setting('mira.bootstrap_approval_ref', true), '')
    AND created_at <= clock_timestamp()
  );

CREATE POLICY hfm_bootstrap_registry_select
  ON mira_hfm.bootstrap_registry
  FOR SELECT TO mira_hfm_bootstrap_operator
  USING (
    bootstrap_key = 'initial'
    AND project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND approval_ref = NULLIF(current_setting('mira.bootstrap_approval_ref', true), '')
  );

CREATE POLICY hfm_bootstrap_owner_insert
  ON mira_hfm.project_owners
  FOR INSERT TO mira_hfm_bootstrap_operator
  WITH CHECK (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND owner_actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND assigned_by_actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND status = 'ACTIVE'
    AND revision = 1
    AND assignment_evidence_ref = 'bootstrap:' || NULLIF(current_setting('mira.bootstrap_approval_ref', true), '')
    AND approval_ref = NULLIF(current_setting('mira.bootstrap_approval_ref', true), '')
    AND assigned_at <= clock_timestamp()
    AND updated_at >= assigned_at
    AND EXISTS (
      SELECT 1 FROM mira_hfm.bootstrap_registry b
      WHERE b.bootstrap_key = 'initial'
        AND b.project_id = NULLIF(current_setting('mira.project_id', true), '')
        AND b.actor_id = NULLIF(current_setting('mira.actor_id', true), '')
        AND b.approval_ref = NULLIF(current_setting('mira.bootstrap_approval_ref', true), '')
    )
  );

CREATE POLICY hfm_bootstrap_membership_insert
  ON mira_hfm.project_memberships
  FOR INSERT TO mira_hfm_bootstrap_operator
  WITH CHECK (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND granted_by_actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND membership_role = 'ADMIN'
    AND status = 'ACTIVE'
    AND revision = 1
    AND permissions -> 'operations' ?& ARRAY['memory.read','memory.write','memory.trash','memory.restore']
    AND valid_from <= clock_timestamp()
    AND expires_at IS NULL
    AND approval_ref = NULLIF(current_setting('mira.bootstrap_approval_ref', true), '')
    AND EXISTS (
      SELECT 1 FROM mira_hfm.bootstrap_registry b
      WHERE b.bootstrap_key = 'initial'
        AND b.project_id = NULLIF(current_setting('mira.project_id', true), '')
        AND b.actor_id = NULLIF(current_setting('mira.actor_id', true), '')
        AND b.approval_ref = NULLIF(current_setting('mira.bootstrap_approval_ref', true), '')
    )
  );

CREATE POLICY hfm_bootstrap_audit_insert
  ON mira_hfm.authority_audit_events
  FOR INSERT TO mira_hfm_bootstrap_operator
  WITH CHECK (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND event_type = 'PROJECT_BOOTSTRAPPED'
    AND approval_ref = NULLIF(current_setting('mira.bootstrap_approval_ref', true), '')
    AND EXISTS (
      SELECT 1 FROM mira_hfm.bootstrap_registry b
      WHERE b.bootstrap_key = 'initial'
        AND b.project_id = NULLIF(current_setting('mira.project_id', true), '')
        AND b.actor_id = NULLIF(current_setting('mira.actor_id', true), '')
        AND b.approval_ref = NULLIF(current_setting('mira.bootstrap_approval_ref', true), '')
    )
  );

COMMENT ON TABLE mira_hfm.bootstrap_registry IS
  'HFM v0.2 one-row latch: the bootstrap operator can claim the initial project only once; no update/delete path exists.';
COMMENT ON ROLE mira_hfm_bootstrap_operator IS
  'NOLOGIN one-time HFM bootstrap role: INSERT-only initial owner, matching ADMIN membership, bootstrap latch and audit event.';

COMMIT;
