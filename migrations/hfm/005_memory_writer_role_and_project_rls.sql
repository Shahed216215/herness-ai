-- MIRA HFM Memory writer role and forced project isolation.
-- SOURCE-ONLY DRAFT. Do not execute on production.
-- Apply only to a disposable Neon branch after role/grant review and explicit approval.
-- This migration creates a NOLOGIN group role; it does not create credentials or a login role.
-- A separate, dedicated login role must be created and granted membership manually.
-- No application data is inserted, updated, or deleted.

BEGIN;

DO $$
BEGIN
  IF to_regclass('mira_hfm.memory_records') IS NULL
     OR to_regclass('mira_hfm.memory_record_versions') IS NULL
     OR to_regclass('mira_hfm.memory_operation_registry') IS NULL
     OR to_regclass('mira_hfm.memory_audit_events') IS NULL
     OR to_regclass('mira_hfm.project_owners') IS NULL
     OR to_regclass('mira_hfm.project_memberships') IS NULL
     OR to_regclass('mira_hfm.operation_authorities') IS NULL
     OR to_regclass('mira_hfm.authority_audit_events') IS NULL THEN
    RAISE EXCEPTION 'HFM_MEMORY_AND_AUTHORITY_SCHEMA_REQUIRED';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mira_hfm_memory_writer') THEN
    CREATE ROLE mira_hfm_memory_writer
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
  END IF;
END;
$$;

ALTER ROLE mira_hfm_memory_writer
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;

REVOKE ALL ON TABLE
  mira_hfm.memory_records,
  mira_hfm.memory_record_versions,
  mira_hfm.memory_operation_registry,
  mira_hfm.memory_audit_events,
  mira_hfm.project_owners,
  mira_hfm.project_memberships,
  mira_hfm.operation_authorities,
  mira_hfm.authority_audit_events
FROM mira_hfm_memory_writer;

REVOKE ALL ON SEQUENCE mira_hfm.memory_audit_events_event_sequence_seq
FROM mira_hfm_memory_writer;

REVOKE ALL ON TABLE
  mira_hfm.memory_records,
  mira_hfm.memory_record_versions,
  mira_hfm.memory_operation_registry,
  mira_hfm.memory_audit_events
FROM PUBLIC;

REVOKE ALL ON SEQUENCE mira_hfm.memory_audit_events_event_sequence_seq FROM PUBLIC;

GRANT USAGE ON SCHEMA mira_hfm TO mira_hfm_memory_writer;

GRANT SELECT ON TABLE
  mira_hfm.project_owners,
  mira_hfm.project_memberships
TO mira_hfm_memory_writer;

GRANT SELECT, UPDATE ON TABLE mira_hfm.operation_authorities
TO mira_hfm_memory_writer;

GRANT INSERT ON TABLE mira_hfm.authority_audit_events
TO mira_hfm_memory_writer;

GRANT SELECT, INSERT, UPDATE ON TABLE mira_hfm.memory_records
TO mira_hfm_memory_writer;

GRANT INSERT ON TABLE mira_hfm.memory_record_versions
TO mira_hfm_memory_writer;

GRANT SELECT, INSERT, UPDATE ON TABLE mira_hfm.memory_operation_registry
TO mira_hfm_memory_writer;

GRANT SELECT, INSERT ON TABLE mira_hfm.memory_audit_events
TO mira_hfm_memory_writer;

GRANT USAGE ON SEQUENCE mira_hfm.memory_audit_events_event_sequence_seq
TO mira_hfm_memory_writer;

ALTER TABLE mira_hfm.project_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE mira_hfm.project_owners FORCE ROW LEVEL SECURITY;

ALTER TABLE mira_hfm.project_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE mira_hfm.project_memberships FORCE ROW LEVEL SECURITY;

ALTER TABLE mira_hfm.operation_authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE mira_hfm.operation_authorities FORCE ROW LEVEL SECURITY;

ALTER TABLE mira_hfm.authority_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE mira_hfm.authority_audit_events FORCE ROW LEVEL SECURITY;

ALTER TABLE mira_hfm.memory_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE mira_hfm.memory_records FORCE ROW LEVEL SECURITY;

ALTER TABLE mira_hfm.memory_record_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mira_hfm.memory_record_versions FORCE ROW LEVEL SECURITY;

ALTER TABLE mira_hfm.memory_operation_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE mira_hfm.memory_operation_registry FORCE ROW LEVEL SECURITY;

ALTER TABLE mira_hfm.memory_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE mira_hfm.memory_audit_events FORCE ROW LEVEL SECURITY;

DO $
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'mira_hfm'
      AND tablename = 'project_owners'
      AND policyname = 'project_owners_project_scope'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY project_owners_project_scope
      ON mira_hfm.project_owners
      FOR ALL TO mira_hfm_memory_writer
      USING (project_id = NULLIF(current_setting('mira.project_id', true), ''))
      WITH CHECK (project_id = NULLIF(current_setting('mira.project_id', true), ''))
    $policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'mira_hfm'
      AND tablename = 'project_memberships'
      AND policyname = 'project_memberships_project_scope'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY project_memberships_project_scope
      ON mira_hfm.project_memberships
      FOR ALL TO mira_hfm_memory_writer
      USING (project_id = NULLIF(current_setting('mira.project_id', true), ''))
      WITH CHECK (project_id = NULLIF(current_setting('mira.project_id', true), ''))
    $policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'mira_hfm'
      AND tablename = 'operation_authorities'
      AND policyname = 'operation_authorities_project_scope'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY operation_authorities_project_scope
      ON mira_hfm.operation_authorities
      FOR ALL TO mira_hfm_memory_writer
      USING (project_id = NULLIF(current_setting('mira.project_id', true), ''))
      WITH CHECK (project_id = NULLIF(current_setting('mira.project_id', true), ''))
    $policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'mira_hfm'
      AND tablename = 'authority_audit_events'
      AND policyname = 'authority_audit_project_scope'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY authority_audit_project_scope
      ON mira_hfm.authority_audit_events
      FOR ALL TO mira_hfm_memory_writer
      USING (project_id = NULLIF(current_setting('mira.project_id', true), ''))
      WITH CHECK (project_id = NULLIF(current_setting('mira.project_id', true), ''))
    $policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'mira_hfm'
      AND tablename = 'memory_records'
      AND policyname = 'memory_records_project_scope'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY memory_records_project_scope
      ON mira_hfm.memory_records
      FOR ALL TO mira_hfm_memory_writer
      USING (project_id = NULLIF(current_setting('mira.project_id', true), ''))
      WITH CHECK (project_id = NULLIF(current_setting('mira.project_id', true), ''))
    $policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'mira_hfm'
      AND tablename = 'memory_record_versions'
      AND policyname = 'memory_versions_project_scope'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY memory_versions_project_scope
      ON mira_hfm.memory_record_versions
      FOR ALL TO mira_hfm_memory_writer
      USING (project_id = NULLIF(current_setting('mira.project_id', true), ''))
      WITH CHECK (project_id = NULLIF(current_setting('mira.project_id', true), ''))
    $policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'mira_hfm'
      AND tablename = 'memory_operation_registry'
      AND policyname = 'memory_operations_project_scope'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY memory_operations_project_scope
      ON mira_hfm.memory_operation_registry
      FOR ALL TO mira_hfm_memory_writer
      USING (project_id = NULLIF(current_setting('mira.project_id', true), ''))
      WITH CHECK (project_id = NULLIF(current_setting('mira.project_id', true), ''))
    $policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'mira_hfm'
      AND tablename = 'memory_audit_events'
      AND policyname = 'memory_audit_project_scope'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY memory_audit_project_scope
      ON mira_hfm.memory_audit_events
      FOR ALL TO mira_hfm_memory_writer
      USING (project_id = NULLIF(current_setting('mira.project_id', true), ''))
      WITH CHECK (project_id = NULLIF(current_setting('mira.project_id', true), ''))
    $policy$;
  END IF;
END;
$$;

COMMENT ON ROLE mira_hfm_memory_writer IS
  'NOLOGIN HFM group role. Dedicated login roles may inherit only after separate review and credential provisioning.';

COMMIT;
