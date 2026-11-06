-- MIRA HFM Project Authority Registry — PostgreSQL / Neon-compatible
-- DRAFT MIGRATION: reviewed and committed to source control only.
-- DO NOT execute against production until backend provisioning, backup, and approval gates pass.
-- This migration intentionally creates EMPTY tables; it does not assign owners or import projects.

BEGIN;

CREATE SCHEMA IF NOT EXISTS mira_hfm;
REVOKE ALL ON SCHEMA mira_hfm FROM PUBLIC;

CREATE TABLE IF NOT EXISTS mira_hfm.project_owners (
  project_id TEXT PRIMARY KEY CHECK (length(btrim(project_id)) BETWEEN 1 AND 256),
  owner_actor_id TEXT NOT NULL CHECK (owner_actor_id LIKE 'mira:%' AND length(owner_actor_id) <= 512),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  revision BIGINT NOT NULL CHECK (revision > 0),
  assignment_evidence_ref TEXT NOT NULL CHECK (length(btrim(assignment_evidence_ref)) > 0),
  approval_ref TEXT NOT NULL CHECK (length(btrim(approval_ref)) > 0),
  assigned_by_actor_id TEXT NOT NULL CHECK (assigned_by_actor_id LIKE 'mira:%'),
  assigned_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CHECK (updated_at >= assigned_at)
);

CREATE TABLE IF NOT EXISTS mira_hfm.project_memberships (
  membership_id TEXT PRIMARY KEY CHECK (length(btrim(membership_id)) BETWEEN 1 AND 256),
  project_id TEXT NOT NULL CHECK (length(btrim(project_id)) BETWEEN 1 AND 256),
  actor_id TEXT NOT NULL CHECK (actor_id LIKE 'mira:%' AND length(actor_id) <= 512),
  membership_role TEXT NOT NULL CHECK (membership_role IN ('ADMIN', 'MEMBER', 'VIEWER')),
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(permissions) = 'object'),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
  revision BIGINT NOT NULL CHECK (revision > 0),
  valid_from TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  granted_by_actor_id TEXT NOT NULL CHECK (granted_by_actor_id LIKE 'mira:%'),
  approval_ref TEXT NOT NULL CHECK (length(btrim(approval_ref)) > 0),
  revoked_by_actor_id TEXT,
  revoked_at TIMESTAMPTZ,
  CHECK (expires_at IS NULL OR expires_at > valid_from),
  CHECK (
    (status = 'REVOKED' AND revoked_by_actor_id IS NOT NULL AND revoked_by_actor_id LIKE 'mira:%' AND revoked_at IS NOT NULL)
    OR
    (status <> 'REVOKED' AND revoked_by_actor_id IS NULL AND revoked_at IS NULL)
  ),
  UNIQUE (project_id, actor_id, revision)
);

CREATE UNIQUE INDEX IF NOT EXISTS project_memberships_one_active_actor
  ON mira_hfm.project_memberships (project_id, actor_id)
  WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS mira_hfm.operation_authorities (
  authority_id TEXT PRIMARY KEY CHECK (length(btrim(authority_id)) BETWEEN 1 AND 256),
  project_id TEXT NOT NULL CHECK (length(btrim(project_id)) BETWEEN 1 AND 256),
  actor_id TEXT NOT NULL CHECK (actor_id LIKE 'mira:%' AND length(actor_id) <= 512),
  operation TEXT NOT NULL CHECK (length(btrim(operation)) BETWEEN 1 AND 128),
  resource TEXT NOT NULL CHECK (length(btrim(resource)) BETWEEN 1 AND 512),
  purpose TEXT NOT NULL CHECK (length(btrim(purpose)) BETWEEN 1 AND 512),
  request_id TEXT NOT NULL UNIQUE CHECK (length(btrim(request_id)) BETWEEN 1 AND 256),
  membership_revision BIGINT NOT NULL CHECK (membership_revision > 0),
  owner_revision BIGINT NOT NULL CHECK (owner_revision > 0),
  status TEXT NOT NULL CHECK (status IN ('ISSUED', 'CONSUMED', 'REVOKED', 'EXPIRED')),
  issued_by_actor_id TEXT NOT NULL CHECK (issued_by_actor_id LIKE 'mira:%'),
  approval_ref TEXT NOT NULL CHECK (length(btrim(approval_ref)) > 0),
  valid_from TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CHECK (expires_at > valid_from),
  CHECK ((status = 'CONSUMED' AND consumed_at IS NOT NULL) OR (status <> 'CONSUMED' AND consumed_at IS NULL)),
  CHECK ((status = 'REVOKED' AND revoked_at IS NOT NULL) OR (status <> 'REVOKED' AND revoked_at IS NULL))
);

CREATE INDEX IF NOT EXISTS operation_authorities_project_actor_status
  ON mira_hfm.operation_authorities (project_id, actor_id, status, expires_at);

CREATE TABLE IF NOT EXISTS mira_hfm.authority_audit_events (
  event_sequence BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE CHECK (length(btrim(event_id)) BETWEEN 1 AND 256),
  project_id TEXT NOT NULL CHECK (length(btrim(project_id)) BETWEEN 1 AND 256),
  actor_id TEXT NOT NULL CHECK (actor_id LIKE 'mira:%' AND length(actor_id) <= 512),
  event_type TEXT NOT NULL CHECK (length(btrim(event_type)) BETWEEN 1 AND 128),
  request_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  prior_revision BIGINT,
  new_revision BIGINT,
  approval_ref TEXT,
  evidence_ref TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object')
);

CREATE OR REPLACE FUNCTION mira_hfm.reject_audit_row_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'HFM_AUDIT_LOG_IS_APPEND_ONLY';
END;
$$;

DROP TRIGGER IF EXISTS authority_audit_no_update_delete ON mira_hfm.authority_audit_events;
CREATE TRIGGER authority_audit_no_update_delete
  BEFORE UPDATE OR DELETE ON mira_hfm.authority_audit_events
  FOR EACH ROW EXECUTE FUNCTION mira_hfm.reject_audit_row_mutation();

DROP TRIGGER IF EXISTS authority_audit_no_truncate ON mira_hfm.authority_audit_events;
CREATE TRIGGER authority_audit_no_truncate
  BEFORE TRUNCATE ON mira_hfm.authority_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION mira_hfm.reject_audit_row_mutation();

REVOKE ALL ON ALL TABLES IN SCHEMA mira_hfm FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA mira_hfm FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA mira_hfm FROM PUBLIC;

COMMENT ON SCHEMA mira_hfm IS 'Server-only Mira HFM project ownership, membership, operation authority, and append-only audit records.';

COMMIT;
