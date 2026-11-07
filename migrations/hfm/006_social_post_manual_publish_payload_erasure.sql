-- MIRA HFM v0.2 social-post manual publish and payload-erasure workflow.
-- SOURCE-ONLY. Do not execute in production. Disposable-branch execution requires
-- a separate approval, a recovery checkpoint, and a review of Neon history retention.
-- Depends on migrations 004 and 005 having been reviewed and applied to the target test branch.
-- Keeps record metadata and sanitized audit while erasing every live payload revision.

BEGIN;

DO $$
BEGIN
  IF to_regclass('mira_hfm.memory_records') IS NULL
     OR to_regclass('mira_hfm.memory_record_versions') IS NULL
     OR to_regclass('mira_hfm.memory_operation_registry') IS NULL
     OR to_regclass('mira_hfm.memory_audit_events') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mira_hfm_memory_writer') THEN
    RAISE EXCEPTION 'HFM_SOCIAL_POST_PREREQUISITES_MISSING';
  END IF;
END;
$$;

ALTER TABLE mira_hfm.memory_records
  ADD COLUMN IF NOT EXISTS payload_erased_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payload_erased_by_actor_id TEXT;

ALTER TABLE mira_hfm.memory_record_versions
  ADD COLUMN IF NOT EXISTS payload_erased_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payload_erased_by_actor_id TEXT;

ALTER TABLE mira_hfm.memory_records DROP CONSTRAINT IF EXISTS memory_records_check2;
ALTER TABLE mira_hfm.memory_records
  ADD CONSTRAINT memory_records_payload_representation_check CHECK (
    (
      payload_erased_at IS NOT NULL
      AND payload_erased_by_actor_id IS NOT NULL
      AND payload_erased_by_actor_id LIKE 'mira:%'
      AND public_payload IS NULL AND encrypted_envelope IS NULL
      AND record_type = 'social_post_draft'
      AND classification = 'PROJECT_PRIVATE'
    )
    OR
    (
      payload_erased_at IS NULL AND payload_erased_by_actor_id IS NULL
      AND (
        (classification = 'PUBLIC' AND public_payload IS NOT NULL
          AND jsonb_typeof(public_payload) = 'object'
          AND jsonb_typeof(public_payload -> 'content') = 'string'
          AND encrypted_envelope IS NULL)
        OR
        (classification IN ('PROJECT_PRIVATE','RESTRICTED')
          AND public_payload IS NULL AND encrypted_envelope IS NOT NULL
          AND jsonb_typeof(encrypted_envelope) = 'object')
      )
    )
  );

ALTER TABLE mira_hfm.memory_record_versions DROP CONSTRAINT IF EXISTS memory_record_versions_check1;
ALTER TABLE mira_hfm.memory_record_versions
  ADD CONSTRAINT memory_versions_payload_representation_check CHECK (
    (
      payload_erased_at IS NOT NULL
      AND payload_erased_by_actor_id LIKE 'mira:%'
      AND public_payload IS NULL AND encrypted_envelope IS NULL
      AND record_type = 'social_post_draft'
      AND classification = 'PROJECT_PRIVATE'
    )
    OR
    (
      payload_erased_at IS NULL AND payload_erased_by_actor_id IS NULL
      AND (
        (classification = 'PUBLIC' AND public_payload IS NOT NULL
          AND jsonb_typeof(public_payload) = 'object'
          AND jsonb_typeof(public_payload -> 'content') = 'string'
          AND encrypted_envelope IS NULL)
        OR
        (classification IN ('PROJECT_PRIVATE','RESTRICTED')
          AND public_payload IS NULL AND encrypted_envelope IS NOT NULL
          AND jsonb_typeof(encrypted_envelope) = 'object')
      )
    )
  );

ALTER TABLE mira_hfm.memory_records
  ADD CONSTRAINT memory_records_payload_erasure_actor_check
  CHECK (
    (payload_erased_at IS NULL AND payload_erased_by_actor_id IS NULL)
    OR
    (payload_erased_at IS NOT NULL AND payload_erased_by_actor_id IS NOT NULL
      AND payload_erased_by_actor_id LIKE 'mira:%')
  );
ALTER TABLE mira_hfm.memory_record_versions
  ADD CONSTRAINT memory_versions_payload_erasure_actor_check
  CHECK (payload_erased_by_actor_id IS NULL OR
    (payload_erased_at IS NOT NULL AND payload_erased_by_actor_id LIKE 'mira:%'));

CREATE TABLE IF NOT EXISTS mira_hfm.memory_social_post_state (
  memory_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  owner_actor_id TEXT NOT NULL CHECK (owner_actor_id LIKE 'mira:%'),
  status TEXT NOT NULL CHECK (status IN (
    'SAVED','COPIED','USER_CONFIRMED_PUBLISHED','DELETE_PENDING',
    'DELETED','DELETE_FAILED','DELETE_STATUS_UNKNOWN'
  )),
  copied_at TIMESTAMPTZ,
  published_confirmed_at TIMESTAMPTZ,
  payload_erased_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (project_id, memory_id),
  FOREIGN KEY (memory_id, project_id)
    REFERENCES mira_hfm.memory_records(memory_id, project_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (
    (status <> 'DELETED' AND payload_erased_at IS NULL)
    OR (status = 'DELETED' AND payload_erased_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS memory_social_post_state_project_status_idx
  ON mira_hfm.memory_social_post_state(project_id, status, updated_at DESC);

CREATE OR REPLACE FUNCTION mira_hfm.reject_memory_append_only_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  operation_id TEXT;
BEGIN
  operation_id := NULLIF(current_setting('mira.memory_payload_erasure_operation_id', true), '');
  IF TG_OP = 'UPDATE' AND TG_TABLE_SCHEMA = 'mira_hfm'
     AND TG_TABLE_NAME = 'memory_record_versions'
     AND operation_id IS NOT NULL
     AND OLD.record_type = 'social_post_draft'
     AND OLD.classification = 'PROJECT_PRIVATE'
     AND OLD.payload_erased_at IS NULL
     AND NEW.public_payload IS NULL
     AND NEW.encrypted_envelope IS NULL
     AND NEW.payload_erased_at IS NOT NULL
     AND NEW.payload_erased_by_actor_id LIKE 'mira:%'
     AND (to_jsonb(NEW) - ARRAY['public_payload','encrypted_envelope','payload_erased_at','payload_erased_by_actor_id'])
         = (to_jsonb(OLD) - ARRAY['public_payload','encrypted_envelope','payload_erased_at','payload_erased_by_actor_id']) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'HFM_MEMORY_HISTORY_IS_APPEND_ONLY';
END;
$$;

CREATE OR REPLACE FUNCTION mira_hfm.guard_memory_record_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  operation_id TEXT;
BEGIN
  operation_id := NULLIF(current_setting('mira.memory_payload_erasure_operation_id', true), '');
  IF operation_id IS NOT NULL
     AND OLD.record_type = 'social_post_draft'
     AND OLD.classification = 'PROJECT_PRIVATE'
     AND OLD.payload_erased_at IS NULL
     AND NEW.public_payload IS NULL
     AND NEW.encrypted_envelope IS NULL
     AND NEW.payload_erased_at IS NOT NULL
     AND NEW.payload_erased_by_actor_id LIKE 'mira:%'
     AND (to_jsonb(NEW) - ARRAY['public_payload','encrypted_envelope','payload_erased_at','payload_erased_by_actor_id'])
         = (to_jsonb(OLD) - ARRAY['public_payload','encrypted_envelope','payload_erased_at','payload_erased_by_actor_id']) THEN
    RETURN NEW;
  END IF;

  IF NEW.memory_id <> OLD.memory_id
     OR NEW.project_id <> OLD.project_id
     OR NEW.owner_actor_id <> OLD.owner_actor_id
     OR NEW.record_type <> OLD.record_type
     OR NEW.schema_version <> OLD.schema_version
     OR NEW.classification <> OLD.classification
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'HFM_MEMORY_RECORD_IDENTITY_IMMUTABLE';
  END IF;
  IF NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'HFM_MEMORY_REVISION_MUST_INCREMENT';
  END IF;
  IF NEW.updated_at <= OLD.updated_at THEN
    RAISE EXCEPTION 'HFM_MEMORY_UPDATED_AT_MUST_ADVANCE';
  END IF;
  RETURN NEW;
END;
$$;

GRANT UPDATE ON TABLE mira_hfm.memory_record_versions TO mira_hfm_memory_writer;
GRANT SELECT (project_id, memory_id, record_type, classification, payload_erased_at, revision)
  ON TABLE mira_hfm.memory_record_versions TO mira_hfm_memory_writer;
GRANT SELECT, INSERT, UPDATE ON TABLE mira_hfm.memory_social_post_state TO mira_hfm_memory_writer;

ALTER TABLE mira_hfm.memory_social_post_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE mira_hfm.memory_social_post_state FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'mira_hfm' AND tablename = 'memory_social_post_state'
      AND policyname = 'memory_social_post_state_project_scope'
  ) THEN
    CREATE POLICY memory_social_post_state_project_scope
      ON mira_hfm.memory_social_post_state
      FOR ALL TO mira_hfm_memory_writer
      USING (project_id = NULLIF(current_setting('mira.project_id', true), ''))
      WITH CHECK (project_id = NULLIF(current_setting('mira.project_id', true), ''));
  END IF;
END;
$$;

REVOKE ALL ON TABLE mira_hfm.memory_social_post_state FROM PUBLIC;
COMMENT ON TABLE mira_hfm.memory_social_post_state IS
  'Sanitized user-controlled Copy/manual-publish/payload-erasure status; no post body or Facebook credentials.';

COMMIT;
