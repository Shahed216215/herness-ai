-- MIRA HFM v0.2 one-time authority issuer role.
-- SOURCE-ONLY DRAFT. Do not execute without target mapping, backup, and explicit approval.
-- This role can inspect its own active project membership and issue one short-lived
-- allowlisted short-lived Memory authorities plus append-only audit events. It cannot alter projects,
-- memberships, Memory, or consume/revoke authorities.

BEGIN;

DO $$
BEGIN
  IF to_regclass('mira_hfm.project_owners') IS NULL
     OR to_regclass('mira_hfm.project_memberships') IS NULL
     OR to_regclass('mira_hfm.operation_authorities') IS NULL
     OR to_regclass('mira_hfm.authority_audit_events') IS NULL THEN
    RAISE EXCEPTION 'HFM_AUTHORITY_ISSUER_SCHEMA_REQUIRED';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mira_hfm_authority_issuer') THEN
    RAISE EXCEPTION 'HFM_AUTHORITY_ISSUER_BASELINE_ROLE_REQUIRED';
  END IF;

  -- The previously applied baseline created this NOLOGIN capability role with
  -- PostgreSQL's default INHERIT attribute. Harden the group role in-place;
  -- the dedicated LOGIN principal remains the sole inherited member.
  EXECUTE 'ALTER ROLE mira_hfm_authority_issuer NOINHERIT';

  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'mira_hfm_authority_issuer'
      AND (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole
           OR rolreplication OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'HFM_AUTHORITY_ISSUER_ROLE_ATTRIBUTES_MUST_BE_LEAST_PRIVILEGE';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_auth_members
    WHERE member = (SELECT oid FROM pg_roles WHERE rolname = 'mira_hfm_authority_issuer')
  ) THEN
    RAISE EXCEPTION 'HFM_AUTHORITY_ISSUER_GROUP_MUST_NOT_INHERIT_OTHER_ROLES';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_shdepend
    WHERE refclassid = 'pg_authid'::regclass
      AND refobjid = (SELECT oid FROM pg_roles WHERE rolname = 'mira_hfm_authority_issuer')
      AND deptype = 'o'
  ) THEN
    RAISE EXCEPTION 'HFM_AUTHORITY_ISSUER_GROUP_MUST_NOT_OWN_OBJECTS';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'mira_hfm'
      AND policyname IN (
        'hfm_authority_issuer_owner_select',
        'hfm_authority_issuer_membership_select',
        'hfm_authority_issuer_authority_insert',
        'hfm_authority_issuer_audit_insert'
      )
  ) THEN
    RAISE EXCEPTION 'HFM_AUTHORITY_ISSUER_POLICY_NAME_COLLISION';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'mira_hfm'
      AND tablename IN ('project_owners','project_memberships','operation_authorities','authority_audit_events')
      AND 'mira_hfm_authority_issuer' = ANY(roles)
  ) THEN
    RAISE EXCEPTION 'HFM_AUTHORITY_ISSUER_PREEXISTING_POLICY_CONFLICT';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'mira_hfm'
      AND c.relname IN ('project_owners','project_memberships','operation_authorities','authority_audit_events')
      AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'HFM_AUTHORITY_ISSUER_FORCED_RLS_REQUIRED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'mira_hfm'
      AND tablename IN ('project_owners','project_memberships','operation_authorities','authority_audit_events')
      AND 'public' = ANY(roles)
  ) THEN
    RAISE EXCEPTION 'HFM_AUTHORITY_ISSUER_PUBLIC_POLICY_CONFLICT';
  END IF;
END;
$$;

-- Remove the earlier project-only issuer policies. Permissive RLS policies
-- combine with OR; retaining them would bypass the actor-bound membership policy.
DROP POLICY IF EXISTS authority_issuer_owner_read ON mira_hfm.project_owners;
DROP POLICY IF EXISTS authority_issuer_membership_read ON mira_hfm.project_memberships;
DROP POLICY IF EXISTS authority_issuer_insert ON mira_hfm.operation_authorities;
DROP POLICY IF EXISTS authority_issuer_audit_insert ON mira_hfm.authority_audit_events;
DROP POLICY IF EXISTS authority_issuer_owner_insert ON mira_hfm.project_owners;
DROP POLICY IF EXISTS authority_issuer_membership_insert ON mira_hfm.project_memberships;

REVOKE ALL ON SCHEMA mira_hfm FROM mira_hfm_authority_issuer;
REVOKE ALL ON ALL TABLES IN SCHEMA mira_hfm FROM mira_hfm_authority_issuer;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA mira_hfm FROM mira_hfm_authority_issuer;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA mira_hfm FROM mira_hfm_authority_issuer;

GRANT USAGE ON SCHEMA mira_hfm TO mira_hfm_authority_issuer;
GRANT SELECT ON TABLE mira_hfm.project_owners, mira_hfm.project_memberships
TO mira_hfm_authority_issuer;
GRANT INSERT ON TABLE mira_hfm.operation_authorities, mira_hfm.authority_audit_events
TO mira_hfm_authority_issuer;
GRANT USAGE ON SEQUENCE mira_hfm.authority_audit_events_event_sequence_seq
TO mira_hfm_authority_issuer;

CREATE POLICY hfm_authority_issuer_owner_select
  ON mira_hfm.project_owners
  FOR SELECT TO mira_hfm_authority_issuer
  USING (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND status = 'ACTIVE'
  );

CREATE POLICY hfm_authority_issuer_membership_select
  ON mira_hfm.project_memberships
  FOR SELECT TO mira_hfm_authority_issuer
  USING (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND status = 'ACTIVE'
    AND valid_from <= clock_timestamp()
    AND (expires_at IS NULL OR expires_at > clock_timestamp())
  );

CREATE POLICY hfm_authority_issuer_authority_insert
  ON mira_hfm.operation_authorities
  FOR INSERT TO mira_hfm_authority_issuer
  WITH CHECK (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND issued_by_actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND status = 'ISSUED'
    AND (
      (operation = 'memory.read' AND resource = 'memory:project:' || NULLIF(current_setting('mira.project_id', true), ''))
      OR (operation IN ('memory.write','memory.trash','memory.restore')
          AND resource ~ '^memory:[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$')
    )
    AND valid_from <= clock_timestamp()
    AND expires_at > clock_timestamp()
    AND expires_at <= clock_timestamp() + interval '5 minutes'
  );

CREATE POLICY hfm_authority_issuer_audit_insert
  ON mira_hfm.authority_audit_events
  FOR INSERT TO mira_hfm_authority_issuer
  WITH CHECK (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND event_type IN ('AUTHORITY_ISSUED','APPROVAL_TOKEN_ISSUED','APPROVAL_TOKEN_CONSUMED')
  );

COMMENT ON ROLE mira_hfm_authority_issuer IS
  'NOLOGIN HFM v0.2 issuer: issues only short-lived, single-use allowlisted Memory authorities and append-only audit events.';

COMMIT;
