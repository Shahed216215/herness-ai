-- HFM v0.2 isolated authority issuer role for one-time operation grants.
-- SOURCE-ONLY. Never execute on production without a separate explicit approval.
-- This creates a NOLOGIN group only; no password, login, connection URL or secret is created.
-- The issuer is distinct from the Memory writer and cannot write Memory payloads.

BEGIN;

DO $$
BEGIN
  IF to_regclass('mira_hfm.project_owners') IS NULL
     OR to_regclass('mira_hfm.project_memberships') IS NULL
     OR to_regclass('mira_hfm.operation_authorities') IS NULL
     OR to_regclass('mira_hfm.authority_audit_events') IS NULL THEN
    RAISE EXCEPTION 'HFM_AUTHORITY_ISSUER_PREREQUISITES_MISSING';
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mira_hfm_authority_issuer') THEN
    CREATE ROLE mira_hfm_authority_issuer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END;
$$;

GRANT USAGE ON SCHEMA mira_hfm TO mira_hfm_authority_issuer;
GRANT SELECT ON TABLE mira_hfm.project_owners, mira_hfm.project_memberships
  TO mira_hfm_authority_issuer;
GRANT INSERT ON TABLE mira_hfm.operation_authorities, mira_hfm.authority_audit_events
  TO mira_hfm_authority_issuer;
GRANT USAGE ON SEQUENCE mira_hfm.authority_audit_events_event_sequence_seq
  TO mira_hfm_authority_issuer;

ALTER TABLE mira_hfm.project_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE mira_hfm.project_owners FORCE ROW LEVEL SECURITY;
ALTER TABLE mira_hfm.project_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE mira_hfm.project_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE mira_hfm.operation_authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE mira_hfm.operation_authorities FORCE ROW LEVEL SECURITY;
ALTER TABLE mira_hfm.authority_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE mira_hfm.authority_audit_events FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='mira_hfm' AND tablename='project_owners' AND policyname='authority_issuer_owner_read') THEN
    CREATE POLICY authority_issuer_owner_read ON mira_hfm.project_owners
      FOR SELECT TO mira_hfm_authority_issuer
      USING (project_id = NULLIF(current_setting('mira.project_id', true), ''));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='mira_hfm' AND tablename='project_memberships' AND policyname='authority_issuer_membership_read') THEN
    CREATE POLICY authority_issuer_membership_read ON mira_hfm.project_memberships
      FOR SELECT TO mira_hfm_authority_issuer
      USING (project_id = NULLIF(current_setting('mira.project_id', true), ''));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='mira_hfm' AND tablename='operation_authorities' AND policyname='authority_issuer_insert') THEN
    CREATE POLICY authority_issuer_insert ON mira_hfm.operation_authorities
      FOR INSERT TO mira_hfm_authority_issuer
      WITH CHECK (project_id = NULLIF(current_setting('mira.project_id', true), ''));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='mira_hfm' AND tablename='authority_audit_events' AND policyname='authority_issuer_audit_insert') THEN
    CREATE POLICY authority_issuer_audit_insert ON mira_hfm.authority_audit_events
      FOR INSERT TO mira_hfm_authority_issuer
      WITH CHECK (project_id = NULLIF(current_setting('mira.project_id', true), ''));
  END IF;
END;
$$;

REVOKE ALL ON TABLE mira_hfm.operation_authorities FROM PUBLIC;
REVOKE ALL ON TABLE mira_hfm.authority_audit_events FROM PUBLIC;
REVOKE ALL ON SEQUENCE mira_hfm.authority_audit_events_event_sequence_seq FROM PUBLIC;

COMMENT ON ROLE mira_hfm_authority_issuer IS
  'HFM authority-only issuer: project-scoped owner/membership reads and one-time authority/audit inserts; no Memory payload access.';

COMMIT;
