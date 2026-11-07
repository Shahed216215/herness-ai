-- MIRA HFM v0.2 365-day standing read authority.
-- SOURCE-ONLY DRAFT. Do not apply to staging or production without separate approval.
-- This is deliberately separate from one-time operation_authorities: standing grants
-- are read-only, project-bound, auditable, revocable, and expire after at most 365 days.

BEGIN;

DO $$
BEGIN
  IF to_regclass('mira_hfm.project_owners') IS NULL
     OR to_regclass('mira_hfm.project_memberships') IS NULL
     OR to_regclass('mira_hfm.authority_audit_events') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mira_hfm_memory_reader')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mira_hfm_authority_issuer') THEN
    RAISE EXCEPTION 'HFM_STANDING_READ_AUTHORITY_PREREQUISITES_REQUIRED';
  END IF;
  IF to_regclass('mira_hfm.standing_read_authorities') IS NOT NULL THEN
    RAISE EXCEPTION 'HFM_STANDING_READ_AUTHORITY_TABLE_ALREADY_EXISTS';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'mira_hfm'
      AND policyname IN (
        'hfm_standing_reader_select',
        'hfm_standing_issuer_select',
        'hfm_standing_issuer_insert',
        'hfm_standing_issuer_update'
      )
  ) THEN
    RAISE EXCEPTION 'HFM_STANDING_READ_AUTHORITY_POLICY_NAME_COLLISION';
  END IF;
END;
$$;

CREATE TABLE mira_hfm.standing_read_authorities (
  standing_authority_id TEXT PRIMARY KEY
    CHECK (length(btrim(standing_authority_id)) BETWEEN 1 AND 256),
  project_id TEXT NOT NULL
    CHECK (length(btrim(project_id)) BETWEEN 1 AND 256),
  actor_id TEXT NOT NULL
    CHECK (actor_id LIKE 'mira:%' AND length(actor_id) <= 512),
  operation TEXT NOT NULL DEFAULT 'memory.read'
    CHECK (operation = 'memory.read'),
  resource TEXT NOT NULL
    CHECK (length(btrim(resource)) BETWEEN 1 AND 512),
  purpose TEXT NOT NULL
    CHECK (length(btrim(purpose)) BETWEEN 1 AND 512),
  owner_revision BIGINT NOT NULL CHECK (owner_revision > 0),
  membership_revision BIGINT NOT NULL CHECK (membership_revision > 0),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','PAUSED','REVOKED','EXPIRED')),
  approval_ref TEXT NOT NULL CHECK (length(btrim(approval_ref)) BETWEEN 1 AND 256),
  approved_by_actor_id TEXT NOT NULL
    CHECK (approved_by_actor_id LIKE 'mira:%' AND length(approved_by_actor_id) <= 512),
  valid_from TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  paused_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CHECK (actor_id = approved_by_actor_id),
  CHECK (resource = 'memory:project:' || project_id),
  CHECK (expires_at > valid_from AND expires_at <= valid_from + interval '365 days'),
  CHECK ((status = 'PAUSED' AND paused_at IS NOT NULL AND revoked_at IS NULL)
      OR (status = 'REVOKED' AND revoked_at IS NOT NULL)
      OR (status IN ('ACTIVE','EXPIRED') AND paused_at IS NULL AND revoked_at IS NULL))
);

CREATE UNIQUE INDEX standing_read_authorities_one_live_per_actor_project
  ON mira_hfm.standing_read_authorities(project_id, actor_id)
  WHERE status IN ('ACTIVE','PAUSED');

CREATE INDEX standing_read_authorities_expiry_idx
  ON mira_hfm.standing_read_authorities(project_id, actor_id, expires_at);

REVOKE ALL ON TABLE mira_hfm.standing_read_authorities FROM PUBLIC;
REVOKE ALL ON TABLE mira_hfm.standing_read_authorities
  FROM mira_hfm_memory_reader, mira_hfm_authority_issuer;
GRANT SELECT ON TABLE mira_hfm.standing_read_authorities TO mira_hfm_memory_reader;
GRANT SELECT, INSERT ON TABLE mira_hfm.standing_read_authorities TO mira_hfm_authority_issuer;
GRANT UPDATE (status, updated_at, paused_at, revoked_at)
  ON TABLE mira_hfm.standing_read_authorities TO mira_hfm_authority_issuer;

ALTER TABLE mira_hfm.standing_read_authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE mira_hfm.standing_read_authorities FORCE ROW LEVEL SECURITY;

CREATE POLICY hfm_standing_reader_select
  ON mira_hfm.standing_read_authorities
  FOR SELECT TO mira_hfm_memory_reader
  USING (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND operation = 'memory.read'
    AND resource = 'memory:project:' || NULLIF(current_setting('mira.project_id', true), '')
    AND status = 'ACTIVE'
    AND valid_from <= clock_timestamp()
    AND expires_at > clock_timestamp()
  );

CREATE POLICY hfm_standing_issuer_select
  ON mira_hfm.standing_read_authorities
  FOR SELECT TO mira_hfm_authority_issuer
  USING (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
  );

CREATE POLICY hfm_standing_issuer_insert
  ON mira_hfm.standing_read_authorities
  FOR INSERT TO mira_hfm_authority_issuer
  WITH CHECK (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND approved_by_actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND operation = 'memory.read'
    AND resource = 'memory:project:' || NULLIF(current_setting('mira.project_id', true), '')
    AND status = 'ACTIVE'
    AND valid_from <= clock_timestamp()
    AND expires_at > clock_timestamp()
    AND expires_at <= valid_from + interval '365 days'
  );

CREATE POLICY hfm_standing_issuer_update
  ON mira_hfm.standing_read_authorities
  FOR UPDATE TO mira_hfm_authority_issuer
  USING (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND status IN ('ACTIVE','PAUSED')
  )
  WITH CHECK (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND status IN ('ACTIVE','PAUSED','REVOKED','EXPIRED')
  );

DROP POLICY IF EXISTS hfm_memory_reader_authority_audit_insert ON mira_hfm.authority_audit_events;
CREATE POLICY hfm_memory_reader_authority_audit_insert
  ON mira_hfm.authority_audit_events
  FOR INSERT TO mira_hfm_memory_reader
  WITH CHECK (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND event_type IN ('AUTHORITY_CONSUMED','STANDING_READ_AUTHORITY_USED')
  );

DROP POLICY IF EXISTS hfm_authority_issuer_audit_insert ON mira_hfm.authority_audit_events;
CREATE POLICY hfm_authority_issuer_audit_insert
  ON mira_hfm.authority_audit_events
  FOR INSERT TO mira_hfm_authority_issuer
  WITH CHECK (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND event_type IN (
      'AUTHORITY_ISSUED','APPROVAL_TOKEN_ISSUED','APPROVAL_TOKEN_CONSUMED',
      'STANDING_READ_AUTHORITY_ISSUED','STANDING_READ_AUTHORITY_PAUSED',
      'STANDING_READ_AUTHORITY_RESUMED','STANDING_READ_AUTHORITY_REVOKED',
      'STANDING_READ_AUTHORITY_USED','STANDING_READ_AUTHORITY_EXPIRED'
    )
  );

CREATE FUNCTION mira_hfm.guard_standing_read_authority_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.standing_authority_id IS DISTINCT FROM OLD.standing_authority_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
     OR NEW.operation IS DISTINCT FROM OLD.operation
     OR NEW.resource IS DISTINCT FROM OLD.resource
     OR NEW.purpose IS DISTINCT FROM OLD.purpose
     OR NEW.owner_revision IS DISTINCT FROM OLD.owner_revision
     OR NEW.membership_revision IS DISTINCT FROM OLD.membership_revision
     OR NEW.approval_ref IS DISTINCT FROM OLD.approval_ref
     OR NEW.approved_by_actor_id IS DISTINCT FROM OLD.approved_by_actor_id
     OR NEW.valid_from IS DISTINCT FROM OLD.valid_from
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'HFM_STANDING_READ_AUTHORITY_SCOPE_IMMUTABLE';
  END IF;
  IF OLD.status = 'REVOKED' OR
     (OLD.status = 'PAUSED' AND NEW.status NOT IN ('PAUSED','ACTIVE','REVOKED','EXPIRED')) OR
     (OLD.status = 'ACTIVE' AND NEW.status NOT IN ('ACTIVE','PAUSED','REVOKED','EXPIRED')) OR
     (NEW.status = 'EXPIRED' AND OLD.expires_at > clock_timestamp()) OR
     (NEW.status = 'ACTIVE' AND NEW.expires_at <= clock_timestamp()) OR
     (NEW.status = 'REVOKED' AND NEW.revoked_at IS NULL) OR
     (NEW.status = 'PAUSED' AND NEW.paused_at IS NULL) OR
     (NEW.status IN ('ACTIVE','EXPIRED') AND (NEW.paused_at IS NOT NULL OR NEW.revoked_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'HFM_STANDING_READ_AUTHORITY_TRANSITION_INVALID';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER standing_read_authority_scope_immutable
  BEFORE UPDATE ON mira_hfm.standing_read_authorities
  FOR EACH ROW EXECUTE FUNCTION mira_hfm.guard_standing_read_authority_scope();

-- State changes and grant creation are audited inside the same database transaction.
-- The issuer role cannot update/pause/revoke a grant without the append-only audit row.
CREATE FUNCTION mira_hfm.audit_standing_read_authority_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $
DECLARE
  audit_event_id TEXT;
  audit_event_type TEXT;
BEGIN
  audit_event_id := gen_random_uuid()::text;
  IF TG_OP = 'INSERT' THEN
    audit_event_type := 'STANDING_READ_AUTHORITY_ISSUED';
  ELSE
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
      RETURN NEW;
    END IF;
    CASE NEW.status
      WHEN 'PAUSED' THEN audit_event_type := 'STANDING_READ_AUTHORITY_PAUSED';
      WHEN 'ACTIVE' THEN audit_event_type := 'STANDING_READ_AUTHORITY_RESUMED';
      WHEN 'REVOKED' THEN audit_event_type := 'STANDING_READ_AUTHORITY_REVOKED';
      WHEN 'EXPIRED' THEN audit_event_type := 'STANDING_READ_AUTHORITY_EXPIRED';
      ELSE RAISE EXCEPTION 'HFM_STANDING_READ_AUTHORITY_AUDIT_TRANSITION_INVALID';
    END CASE;
  END IF;

  INSERT INTO mira_hfm.authority_audit_events
    (event_id, project_id, actor_id, event_type, request_id, occurred_at, approval_ref, details)
  VALUES (
    audit_event_id, NEW.project_id, NEW.actor_id, audit_event_type,
    audit_event_id, clock_timestamp(), NEW.approval_ref,
    jsonb_build_object(
      'standingAuthorityId', NEW.standing_authority_id,
      'operation', NEW.operation,
      'resource', NEW.resource,
      'purpose', NEW.purpose,
      'status', NEW.status,
      'priorStatus', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END,
      'expiresAt', NEW.expires_at,
      'durationDays', floor(extract(epoch FROM (NEW.expires_at - NEW.valid_from)) / 86400)
    )
  );
  RETURN NEW;
END;
$;

CREATE TRIGGER standing_read_authority_audit
  AFTER INSERT OR UPDATE ON mira_hfm.standing_read_authorities
  FOR EACH ROW EXECUTE FUNCTION mira_hfm.audit_standing_read_authority_change();

COMMENT ON TABLE mira_hfm.standing_read_authorities IS
  'HFM v0.2 human-approved project-scoped memory.read standing grants; max 365 days; pause/revoke supported; no write permissions.';

COMMIT;
