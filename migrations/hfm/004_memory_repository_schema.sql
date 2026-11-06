-- MIRA HFM Memory Repository — classification-aware persistence schema.
-- SOURCE-ONLY DRAFT. Do not execute on production.
-- Apply only to a disposable Neon branch after independent SQL/security review,
-- verified recovery point, and explicit approval.
-- This migration creates empty tables only; it does not import or mutate records.
-- It deliberately creates no writer role and grants no application DML privileges.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'mira_hfm') THEN
    RAISE EXCEPTION 'HFM_AUTHORITY_SCHEMA_REQUIRED';
  END IF;
  IF to_regclass('mira_hfm.project_owners') IS NULL THEN
    RAISE EXCEPTION 'HFM_PROJECT_OWNER_REGISTRY_REQUIRED';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS mira_hfm.memory_records (
  memory_id TEXT PRIMARY KEY
    CHECK (length(memory_id) BETWEEN 8 AND 128),
  project_id TEXT NOT NULL
    REFERENCES mira_hfm.project_owners (project_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  owner_actor_id TEXT NOT NULL
    CHECK (owner_actor_id LIKE 'mira:%' AND length(owner_actor_id) <= 512),
  record_type TEXT NOT NULL
    CHECK (record_type IN (
      'fact', 'decision', 'preference', 'procedure', 'lesson', 'experience',
      'strategy', 'project', 'conversation_reference', 'knowledge', 'research_reference',
      'daily_activity', 'learning_note', 'knowledge_item', 'social_post_draft',
      'client_vault_record', 'financial_vault_record'
    )),
  schema_version TEXT NOT NULL
    CHECK (schema_version IN ('1.0.0', '1.1.0')),
  classification TEXT NOT NULL
    CHECK (classification IN ('PUBLIC', 'PROJECT_PRIVATE', 'RESTRICTED')),
  lifecycle TEXT NOT NULL
    CHECK (lifecycle IN ('ACTIVE', 'SUPERSEDED', 'ARCHIVED', 'TRASHED', 'QUARANTINED', 'PENDING_REVIEW')),
  trashed_at TIMESTAMPTZ,
  trashed_by_actor_id TEXT CHECK (
    trashed_by_actor_id IS NULL OR
    (trashed_by_actor_id LIKE 'mira:%' AND length(trashed_by_actor_id) <= 512)
  ),
  CHECK (
    (lifecycle = 'TRASHED' AND trashed_at IS NOT NULL AND trashed_by_actor_id IS NOT NULL)
    OR
    (lifecycle <> 'TRASHED' AND trashed_at IS NULL AND trashed_by_actor_id IS NULL)
  ),
  revision BIGINT NOT NULL CHECK (revision > 0),
  integrity_status TEXT NOT NULL
    CHECK (integrity_status IN ('UNVERIFIED', 'VERIFIED', 'FAILED', 'QUARANTINED')),
  trust_status TEXT NOT NULL
    CHECK (trust_status IN (
      'UNVERIFIED', 'SOURCE_RECORDED', 'SOURCE_REACHABLE',
      'CONTENT_VERIFIED', 'HUMAN_VERIFIED', 'QUARANTINED'
    )),
  public_payload JSONB,
  encrypted_envelope JSONB,
  public_search_vector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector(
      'simple'::regconfig,
      CASE
        WHEN classification = 'PUBLIC'
          THEN COALESCE(public_payload ->> 'content', '')
        ELSE ''
      END
    )
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CHECK (updated_at >= created_at),
  CHECK (
    (classification = 'PUBLIC'
      AND public_payload IS NOT NULL
      AND jsonb_typeof(public_payload) = 'object'
      AND jsonb_typeof(public_payload -> 'content') = 'string'
      AND encrypted_envelope IS NULL)
    OR
    (classification IN ('PROJECT_PRIVATE', 'RESTRICTED')
      AND public_payload IS NULL
      AND encrypted_envelope IS NOT NULL
      AND jsonb_typeof(encrypted_envelope) = 'object')
  ),
  CHECK (
    (schema_version = '1.0.0' AND record_type IN (
      'fact', 'decision', 'preference', 'procedure', 'lesson', 'experience',
      'strategy', 'project', 'conversation_reference', 'knowledge', 'research_reference'
    ))
    OR
    (schema_version = '1.1.0')
  ),
  CHECK (
    record_type NOT IN ('client_vault_record', 'financial_vault_record')
    OR (schema_version = '1.1.0' AND classification = 'RESTRICTED')
  ),
  CHECK (
    record_type NOT IN ('daily_activity', 'learning_note', 'social_post_draft')
    OR (schema_version = '1.1.0' AND classification = 'PROJECT_PRIVATE')
  ),
  UNIQUE (memory_id, project_id)
);

CREATE TABLE IF NOT EXISTS mira_hfm.memory_record_versions (
  memory_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  owner_actor_id TEXT NOT NULL
    CHECK (owner_actor_id LIKE 'mira:%' AND length(owner_actor_id) <= 512),
  record_type TEXT NOT NULL
    CHECK (record_type IN (
      'fact', 'decision', 'preference', 'procedure', 'lesson', 'experience',
      'strategy', 'project', 'conversation_reference', 'knowledge', 'research_reference',
      'daily_activity', 'learning_note', 'knowledge_item', 'social_post_draft',
      'client_vault_record', 'financial_vault_record'
    )),
  schema_version TEXT NOT NULL
    CHECK (schema_version IN ('1.0.0', '1.1.0')),
  classification TEXT NOT NULL
    CHECK (classification IN ('PUBLIC', 'PROJECT_PRIVATE', 'RESTRICTED')),
  lifecycle TEXT NOT NULL
    CHECK (lifecycle IN ('ACTIVE', 'SUPERSEDED', 'ARCHIVED', 'TRASHED', 'QUARANTINED', 'PENDING_REVIEW')),
  trashed_at TIMESTAMPTZ,
  trashed_by_actor_id TEXT CHECK (
    trashed_by_actor_id IS NULL OR
    (trashed_by_actor_id LIKE 'mira:%' AND length(trashed_by_actor_id) <= 512)
  ),
  CHECK (
    (lifecycle = 'TRASHED' AND trashed_at IS NOT NULL AND trashed_by_actor_id IS NOT NULL)
    OR
    (lifecycle <> 'TRASHED' AND trashed_at IS NULL AND trashed_by_actor_id IS NULL)
  ),
  revision BIGINT NOT NULL CHECK (revision > 0),
  integrity_status TEXT NOT NULL
    CHECK (integrity_status IN ('UNVERIFIED', 'VERIFIED', 'FAILED', 'QUARANTINED')),
  trust_status TEXT NOT NULL
    CHECK (trust_status IN (
      'UNVERIFIED', 'SOURCE_RECORDED', 'SOURCE_REACHABLE',
      'CONTENT_VERIFIED', 'HUMAN_VERIFIED', 'QUARANTINED'
    )),
  public_payload JSONB,
  encrypted_envelope JSONB,
  recorded_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (memory_id, revision),
  FOREIGN KEY (memory_id, project_id)
    REFERENCES mira_hfm.memory_records (memory_id, project_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (
    (classification = 'PUBLIC'
      AND public_payload IS NOT NULL
      AND jsonb_typeof(public_payload) = 'object'
      AND jsonb_typeof(public_payload -> 'content') = 'string'
      AND encrypted_envelope IS NULL)
    OR
    (classification IN ('PROJECT_PRIVATE', 'RESTRICTED')
      AND public_payload IS NULL
      AND encrypted_envelope IS NOT NULL
      AND jsonb_typeof(encrypted_envelope) = 'object')
  ),
  CHECK (
    (schema_version = '1.0.0' AND record_type IN (
      'fact', 'decision', 'preference', 'procedure', 'lesson', 'experience',
      'strategy', 'project', 'conversation_reference', 'knowledge', 'research_reference'
    ))
    OR
    (schema_version = '1.1.0')
  ),
  CHECK (
    record_type NOT IN ('client_vault_record', 'financial_vault_record')
    OR (schema_version = '1.1.0' AND classification = 'RESTRICTED')
  ),
  CHECK (
    record_type NOT IN ('daily_activity', 'learning_note', 'social_post_draft')
    OR (schema_version = '1.1.0' AND classification = 'PROJECT_PRIVATE')
  )
);

CREATE TABLE IF NOT EXISTS mira_hfm.memory_operation_registry (
  operation_id TEXT PRIMARY KEY CHECK (length(btrim(operation_id)) BETWEEN 1 AND 256),
  project_id TEXT NOT NULL
    REFERENCES mira_hfm.project_owners (project_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  actor_id TEXT NOT NULL CHECK (actor_id LIKE 'mira:%' AND length(actor_id) <= 512),
  idempotency_key TEXT NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 256),
  operation TEXT NOT NULL CHECK (length(btrim(operation)) BETWEEN 1 AND 128),
  resource TEXT NOT NULL CHECK (length(btrim(resource)) BETWEEN 1 AND 512),
  purpose TEXT NOT NULL CHECK (length(btrim(purpose)) BETWEEN 1 AND 512),
  payload_digest TEXT NOT NULL CHECK (payload_digest ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL CHECK (status IN (
    'REQUESTED', 'AUDIT_INTENT_RECORDED', 'EXECUTING',
    'COMMITTED_AUDIT_PENDING', 'COMPLETED', 'FAILED', 'UNKNOWN'
  )),
  result_code TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CHECK (updated_at >= created_at),
  UNIQUE (project_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS mira_hfm.memory_audit_events (
  event_sequence BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE CHECK (length(btrim(event_id)) BETWEEN 1 AND 256),
  project_id TEXT NOT NULL CHECK (length(btrim(project_id)) BETWEEN 1 AND 256),
  actor_id TEXT NOT NULL CHECK (actor_id LIKE 'mira:%' AND length(actor_id) <= 512),
  operation_id TEXT NOT NULL CHECK (length(btrim(operation_id)) BETWEEN 1 AND 256),
  memory_id TEXT CHECK (memory_id IS NULL OR length(memory_id) BETWEEN 8 AND 128),
  event_type TEXT NOT NULL CHECK (length(btrim(event_type)) BETWEEN 1 AND 128),
  result_status TEXT NOT NULL CHECK (length(btrim(result_status)) BETWEEN 1 AND 64),
  policy_version TEXT NOT NULL CHECK (length(btrim(policy_version)) BETWEEN 1 AND 64),
  occurred_at TIMESTAMPTZ NOT NULL,
  previous_event_hash TEXT CHECK (previous_event_hash IS NULL OR previous_event_hash ~ '^[a-f0-9]{64}$'),
  event_hash TEXT NOT NULL CHECK (event_hash ~ '^[a-f0-9]{64}$'),
  details JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object')
);

CREATE INDEX IF NOT EXISTS memory_records_project_type_lifecycle_idx
  ON mira_hfm.memory_records (project_id, record_type, lifecycle, updated_at DESC);

CREATE INDEX IF NOT EXISTS memory_records_project_classification_idx
  ON mira_hfm.memory_records (project_id, classification, lifecycle);

CREATE INDEX IF NOT EXISTS memory_records_public_search_idx
  ON mira_hfm.memory_records USING GIN (public_search_vector)
  WHERE classification = 'PUBLIC';

CREATE INDEX IF NOT EXISTS memory_record_versions_project_record_idx
  ON mira_hfm.memory_record_versions (project_id, memory_id, revision DESC);

CREATE INDEX IF NOT EXISTS memory_operation_registry_project_status_idx
  ON mira_hfm.memory_operation_registry (project_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS memory_audit_events_project_sequence_idx
  ON mira_hfm.memory_audit_events (project_id, event_sequence);

CREATE OR REPLACE FUNCTION mira_hfm.reject_memory_append_only_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'HFM_MEMORY_HISTORY_IS_APPEND_ONLY';
END;
$$;

CREATE OR REPLACE FUNCTION mira_hfm.guard_memory_record_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'memory_versions_no_update_delete'
      AND tgrelid = 'mira_hfm.memory_record_versions'::regclass
  ) THEN
    CREATE TRIGGER memory_versions_no_update_delete
      BEFORE UPDATE OR DELETE ON mira_hfm.memory_record_versions
      FOR EACH ROW EXECUTE FUNCTION mira_hfm.reject_memory_append_only_mutation();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'memory_versions_no_truncate'
      AND tgrelid = 'mira_hfm.memory_record_versions'::regclass
  ) THEN
    CREATE TRIGGER memory_versions_no_truncate
      BEFORE TRUNCATE ON mira_hfm.memory_record_versions
      FOR EACH STATEMENT EXECUTE FUNCTION mira_hfm.reject_memory_append_only_mutation();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'memory_audit_no_update_delete'
      AND tgrelid = 'mira_hfm.memory_audit_events'::regclass
  ) THEN
    CREATE TRIGGER memory_audit_no_update_delete
      BEFORE UPDATE OR DELETE ON mira_hfm.memory_audit_events
      FOR EACH ROW EXECUTE FUNCTION mira_hfm.reject_memory_append_only_mutation();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'memory_records_identity_revision_guard'
      AND tgrelid = 'mira_hfm.memory_records'::regclass
  ) THEN
    CREATE TRIGGER memory_records_identity_revision_guard
      BEFORE UPDATE ON mira_hfm.memory_records
      FOR EACH ROW EXECUTE FUNCTION mira_hfm.guard_memory_record_update();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'memory_records_no_delete'
      AND tgrelid = 'mira_hfm.memory_records'::regclass
  ) THEN
    CREATE TRIGGER memory_records_no_delete
      BEFORE DELETE ON mira_hfm.memory_records
      FOR EACH ROW EXECUTE FUNCTION mira_hfm.reject_memory_append_only_mutation();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'memory_records_no_truncate'
      AND tgrelid = 'mira_hfm.memory_records'::regclass
  ) THEN
    CREATE TRIGGER memory_records_no_truncate
      BEFORE TRUNCATE ON mira_hfm.memory_records
      FOR EACH STATEMENT EXECUTE FUNCTION mira_hfm.reject_memory_append_only_mutation();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'memory_operations_no_delete'
      AND tgrelid = 'mira_hfm.memory_operation_registry'::regclass
  ) THEN
    CREATE TRIGGER memory_operations_no_delete
      BEFORE DELETE ON mira_hfm.memory_operation_registry
      FOR EACH ROW EXECUTE FUNCTION mira_hfm.reject_memory_append_only_mutation();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'memory_operations_no_truncate'
      AND tgrelid = 'mira_hfm.memory_operation_registry'::regclass
  ) THEN
    CREATE TRIGGER memory_operations_no_truncate
      BEFORE TRUNCATE ON mira_hfm.memory_operation_registry
      FOR EACH STATEMENT EXECUTE FUNCTION mira_hfm.reject_memory_append_only_mutation();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'memory_audit_no_truncate'
      AND tgrelid = 'mira_hfm.memory_audit_events'::regclass
  ) THEN
    CREATE TRIGGER memory_audit_no_truncate
      BEFORE TRUNCATE ON mira_hfm.memory_audit_events
      FOR EACH STATEMENT EXECUTE FUNCTION mira_hfm.reject_memory_append_only_mutation();
  END IF;
END;
$$;

REVOKE ALL ON TABLE
  mira_hfm.memory_records,
  mira_hfm.memory_record_versions,
  mira_hfm.memory_operation_registry,
  mira_hfm.memory_audit_events
FROM PUBLIC;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA mira_hfm FROM PUBLIC;
REVOKE ALL ON FUNCTION mira_hfm.reject_memory_append_only_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION mira_hfm.guard_memory_record_update() FROM PUBLIC;

COMMENT ON TABLE mira_hfm.memory_records IS
  'HFM canonical current records; PUBLIC payloads may be indexed, private/restricted payloads must be encrypted before persistence.';
COMMENT ON TABLE mira_hfm.memory_record_versions IS
  'HFM immutable revision history; PROJECT_PRIVATE and RESTRICTED payloads are encrypted envelopes.';
COMMENT ON TABLE mira_hfm.memory_operation_registry IS
  'HFM idempotency and uncertain-outcome reconciliation; contains no raw payloads.';
COMMENT ON TABLE mira_hfm.memory_audit_events IS
  'HFM append-only sanitized memory audit stream; never contains plaintext payloads or encryption keys.';

COMMIT;
