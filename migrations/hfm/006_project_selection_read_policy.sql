-- MIRA HFM Project Selection Reader — narrow staging-only RLS policy.
-- SOURCE-ONLY DRAFT. Do not execute on production.
-- One-shot draft: apply only after staging schema/policy/grant inventory and explicit approval; do not reapply.
-- This migration creates a NOLOGIN group role and SELECT-only access.
-- A dedicated LOGIN role must be created separately and granted membership manually.
-- No owner, membership, authority, or memory data is inserted or modified.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mira_hfm_project_reader') THEN
    EXECUTE 'CREATE ROLE mira_hfm_project_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
  ELSE
    IF EXISTS (
      SELECT 1 FROM pg_roles
      WHERE rolname = 'mira_hfm_project_reader'
        AND (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
    ) THEN
      RAISE EXCEPTION 'HFM_PROJECT_READER_ROLE_EXISTS_WITH_UNSAFE_ATTRIBUTES';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_auth_members m
    WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = 'mira_hfm_project_reader')
  ) THEN
    RAISE EXCEPTION 'HFM_PROJECT_READER_ROLE_MUST_NOT_INHERIT_PARENT_ROLES';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_shdepend d
    WHERE d.refclassid = 'pg_authid'::regclass
      AND d.refobjid = (SELECT oid FROM pg_roles WHERE rolname = 'mira_hfm_project_reader')
      AND d.deptype = 'o'
  ) THEN
    RAISE EXCEPTION 'HFM_PROJECT_READER_ROLE_MUST_NOT_OWN_DATABASE_OBJECTS';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'mira_hfm'
      AND p.polname IN ('hfm_project_reader_owner_select', 'hfm_project_reader_own_membership_select')
  ) THEN
    RAISE EXCEPTION 'HFM_PROJECT_READER_POLICY_NAME_COLLISION';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'mira_hfm' AND c.relname = 'project_owners'
      AND c.relkind = 'r' AND c.relrowsecurity AND c.relforcerowsecurity
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'mira_hfm' AND c.relname = 'project_memberships'
      AND c.relkind = 'r' AND c.relrowsecurity AND c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'HFM_PROJECT_SELECTION_TABLES_OR_FORCED_RLS_NOT_READY';
  END IF;
END;
$$;

GRANT USAGE ON SCHEMA mira_hfm TO mira_hfm_project_reader;
GRANT SELECT ON TABLE mira_hfm.project_owners, mira_hfm.project_memberships
  TO mira_hfm_project_reader;

CREATE POLICY hfm_project_reader_owner_select
  ON mira_hfm.project_owners
  FOR SELECT TO mira_hfm_project_reader
  USING (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND status = 'ACTIVE'
  );

CREATE POLICY hfm_project_reader_own_membership_select
  ON mira_hfm.project_memberships
  FOR SELECT TO mira_hfm_project_reader
  USING (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND status = 'ACTIVE'
    AND valid_from <= clock_timestamp()
    AND (expires_at IS NULL OR expires_at > clock_timestamp())
  );

COMMENT ON POLICY hfm_project_reader_owner_select ON mira_hfm.project_owners
  IS 'Project-selection reader can see only the active owner row for the transaction-local selected project.';
COMMENT ON POLICY hfm_project_reader_own_membership_select ON mira_hfm.project_memberships
  IS 'Project-selection reader can see only the authenticated actor active membership for the transaction-local project.';

COMMIT;
