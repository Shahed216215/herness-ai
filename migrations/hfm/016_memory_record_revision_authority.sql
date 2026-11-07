-- SOURCE-ONLY DRAFT: HFM v0.2 authorized canonical Memory revision support.
-- Do not execute on production. Review and approve the complete migration chain first.
-- This migration adds exact-resource memory.update authority for PROJECT_PRIVATE/PUBLIC
-- canonical records while preserving trust immutability and append-only version history.

BEGIN;

-- The issuer may mint a memory.update grant only for one exact memory resource.
DROP POLICY IF EXISTS hfm_authority_issuer_authority_insert ON mira_hfm.operation_authorities;
CREATE POLICY hfm_authority_issuer_authority_insert
  ON mira_hfm.operation_authorities
  FOR INSERT TO mira_hfm_authority_issuer
  WITH CHECK (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND issued_by_actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND status = 'ISSUED'
    AND (
      (operation = 'memory.read'
        AND resource = 'memory:project:' || NULLIF(current_setting('mira.project_id', true), ''))
      OR
      (operation IN ('memory.write','memory.update','memory.trash','memory.restore')
        AND resource ~ '^memory:[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'
        AND resource <> 'memory:project:' || NULLIF(current_setting('mira.project_id', true), ''))
    )
    AND valid_from <= clock_timestamp()
    AND expires_at > clock_timestamp()
    AND expires_at <= clock_timestamp() + interval '5 minutes'
  );

-- The existing update policy is replaced, not broadened to table-wide access.
DROP POLICY IF EXISTS hfm_writer_memory_record_update_scope ON mira_hfm.memory_records;
CREATE POLICY hfm_writer_memory_record_update_scope
  ON mira_hfm.memory_records
  AS RESTRICTIVE
  FOR UPDATE TO mira_hfm_memory_writer
  USING (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND current_setting('mira.resource', true) = 'memory:' || memory_id
    AND classification IN ('PUBLIC', 'PROJECT_PRIVATE')
    AND (
      (current_setting('mira.operation', true) = 'memory.update' AND lifecycle = 'ACTIVE')
      OR
      (current_setting('mira.operation', true) = 'memory.trash' AND lifecycle = 'ACTIVE')
      OR
      (current_setting('mira.operation', true) = 'memory.restore' AND lifecycle = 'TRASHED')
    )
    AND EXISTS (
      SELECT 1 FROM mira_hfm.project_owners owner_row
      WHERE owner_row.project_id = memory_records.project_id
        AND owner_row.status = 'ACTIVE'
    )
    AND EXISTS (
      SELECT 1 FROM mira_hfm.project_memberships member_row
      WHERE member_row.project_id = memory_records.project_id
        AND member_row.actor_id = NULLIF(current_setting('mira.actor_id', true), '')
        AND member_row.status = 'ACTIVE'
        AND member_row.valid_from <= clock_timestamp()
        AND (member_row.expires_at IS NULL OR member_row.expires_at > clock_timestamp())
        AND member_row.permissions -> 'operations' ? NULLIF(current_setting('mira.operation', true), '')
    )
    AND EXISTS (
      SELECT 1 FROM mira_hfm.operation_authorities authority_row
      WHERE authority_row.project_id = memory_records.project_id
        AND authority_row.actor_id = NULLIF(current_setting('mira.actor_id', true), '')
        AND authority_row.operation = NULLIF(current_setting('mira.operation', true), '')
        AND authority_row.resource = 'memory:' || memory_records.memory_id
        AND authority_row.request_id = NULLIF(current_setting('mira.request_id', true), '')
        AND authority_row.status = 'CONSUMED'
        AND authority_row.consumed_at IS NOT NULL
        AND authority_row.valid_from <= clock_timestamp()
        AND authority_row.expires_at > clock_timestamp()
    )
  )
  WITH CHECK (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND current_setting('mira.resource', true) = 'memory:' || memory_id
    AND classification IN ('PUBLIC', 'PROJECT_PRIVATE')
    AND (
      (current_setting('mira.operation', true) = 'memory.update'
        AND lifecycle = 'ACTIVE'
        AND trashed_at IS NULL
        AND trashed_by_actor_id IS NULL)
      OR
      (current_setting('mira.operation', true) = 'memory.trash'
        AND lifecycle = 'TRASHED'
        AND trashed_by_actor_id = NULLIF(current_setting('mira.actor_id', true), ''))
      OR
      (current_setting('mira.operation', true) = 'memory.restore'
        AND lifecycle = 'ACTIVE'
        AND trashed_at IS NULL
        AND trashed_by_actor_id IS NULL)
    )
    AND EXISTS (
      SELECT 1 FROM mira_hfm.project_owners owner_row
      WHERE owner_row.project_id = memory_records.project_id
        AND owner_row.status = 'ACTIVE'
    )
    AND EXISTS (
      SELECT 1 FROM mira_hfm.project_memberships member_row
      WHERE member_row.project_id = memory_records.project_id
        AND member_row.actor_id = NULLIF(current_setting('mira.actor_id', true), '')
        AND member_row.status = 'ACTIVE'
        AND member_row.valid_from <= clock_timestamp()
        AND (member_row.expires_at IS NULL OR member_row.expires_at > clock_timestamp())
        AND member_row.permissions -> 'operations' ? NULLIF(current_setting('mira.operation', true), '')
    )
    AND EXISTS (
      SELECT 1 FROM mira_hfm.operation_authorities authority_row
      WHERE authority_row.project_id = memory_records.project_id
        AND authority_row.actor_id = NULLIF(current_setting('mira.actor_id', true), '')
        AND authority_row.operation = NULLIF(current_setting('mira.operation', true), '')
        AND authority_row.resource = 'memory:' || memory_records.memory_id
        AND authority_row.request_id = NULLIF(current_setting('mira.request_id', true), '')
        AND authority_row.status = 'CONSUMED'
        AND authority_row.consumed_at IS NOT NULL
        AND authority_row.valid_from <= clock_timestamp()
        AND authority_row.expires_at > clock_timestamp()
    )
  );

-- Keep table-level UPDATE revoked. Grant only fields required for canonical revision
-- plus the existing lifecycle transition fields. Trust status remains immutable here.
REVOKE UPDATE ON TABLE mira_hfm.memory_records FROM mira_hfm_memory_writer;
GRANT UPDATE (
  lifecycle, trashed_at, trashed_by_actor_id, revision, updated_at,
  integrity_status, public_payload, encrypted_envelope
) ON TABLE mira_hfm.memory_records TO mira_hfm_memory_writer;

-- Allow memory.update to append a new immutable version without changing trust state,
-- identity, classification, lifecycle, ownership, or creation time.
CREATE OR REPLACE FUNCTION mira_hfm.guard_memory_lifecycle_only_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  operation_name TEXT := NULLIF(current_setting('mira.operation', true), '');
  actor_name TEXT := NULLIF(current_setting('mira.actor_id', true), '');
BEGIN
  IF operation_name = 'memory.update' THEN
    IF OLD.lifecycle <> 'ACTIVE'
       OR NEW.lifecycle IS DISTINCT FROM OLD.lifecycle
       OR NEW.trashed_at IS DISTINCT FROM OLD.trashed_at
       OR NEW.trashed_by_actor_id IS DISTINCT FROM OLD.trashed_by_actor_id
       OR NEW.trust_status IS DISTINCT FROM OLD.trust_status
       OR NEW.integrity_status NOT IN ('UNVERIFIED', 'VERIFIED') THEN
      RAISE EXCEPTION 'HFM_MEMORY_REVISION_TRANSITION_INVALID';
    END IF;
  ELSIF operation_name IN ('memory.trash', 'memory.restore') THEN
    IF NEW.integrity_status IS DISTINCT FROM OLD.integrity_status
       OR NEW.trust_status IS DISTINCT FROM OLD.trust_status
       OR NEW.public_payload IS DISTINCT FROM OLD.public_payload
       OR NEW.encrypted_envelope IS DISTINCT FROM OLD.encrypted_envelope THEN
      RAISE EXCEPTION 'HFM_MEMORY_LIFECYCLE_UPDATE_CONTENT_IMMUTABLE';
    END IF;

    IF operation_name = 'memory.trash' THEN
      IF OLD.lifecycle <> 'ACTIVE'
         OR NEW.lifecycle <> 'TRASHED'
         OR NEW.trashed_at IS NULL
         OR NEW.trashed_at IS DISTINCT FROM NEW.updated_at
         OR NEW.trashed_by_actor_id IS DISTINCT FROM actor_name THEN
        RAISE EXCEPTION 'HFM_MEMORY_TRASH_TRANSITION_INVALID';
      END IF;
    ELSE
      IF OLD.lifecycle <> 'TRASHED'
         OR NEW.lifecycle <> 'ACTIVE'
         OR NEW.trashed_at IS NOT NULL
         OR NEW.trashed_by_actor_id IS NOT NULL THEN
        RAISE EXCEPTION 'HFM_MEMORY_RESTORE_TRANSITION_INVALID';
      END IF;
    END IF;
  ELSE
    RAISE EXCEPTION 'HFM_MEMORY_UPDATE_OPERATION_NOT_ALLOWED';
  END IF;

  IF NEW.revision <> OLD.revision + 1 OR NEW.updated_at <= OLD.updated_at THEN
    RAISE EXCEPTION 'HFM_MEMORY_REVISION_ORDER_INVALID';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION mira_hfm.guard_memory_lifecycle_only_update() FROM PUBLIC;

COMMENT ON POLICY hfm_writer_memory_record_update_scope ON mira_hfm.memory_records IS
  'Requires active owner, active actor membership with exact memory.update/trash/restore permission, consumed one-time authority, exact record resource, and non-RESTRICTED classification. memory.update preserves trust and lifecycle identity.';

COMMIT;
