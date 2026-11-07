-- SOURCE-ONLY DRAFT: HFM v0.2 migration 015.
-- Do not execute on production without separate explicit approval.
-- Adds database-enforced active owner/member, operation, resource, and authority
-- scope to the existing least-privilege writer and reader roles. No data or grants
-- are changed. This migration depends on 010 and 014 and is additive/reversible
-- only by a separately reviewed policy replacement.

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
     OR to_regclass('mira_hfm.authority_audit_events') IS NULL
     OR to_regclass('mira_hfm.standing_read_authorities') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mira_hfm_memory_writer')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mira_hfm_memory_reader') THEN
    RAISE EXCEPTION 'HFM_RLS_OPERATION_SCOPE_PREREQUISITES_MISSING';
  END IF;
END;
$$;

-- The transaction executor sets these transaction-local values only after
-- resolving the verified host actor and exact operation authority.
-- A caller-provided project/actor GUC alone is insufficient for Memory access.

DROP POLICY IF EXISTS hfm_writer_owner_active ON mira_hfm.project_owners;
CREATE POLICY hfm_writer_owner_active
  ON mira_hfm.project_owners
  AS RESTRICTIVE
  FOR SELECT TO mira_hfm_memory_writer
  USING (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND status = 'ACTIVE'
  );

DROP POLICY IF EXISTS hfm_writer_membership_permission ON mira_hfm.project_memberships;
CREATE POLICY hfm_writer_membership_permission
  ON mira_hfm.project_memberships
  AS RESTRICTIVE
  FOR SELECT TO mira_hfm_memory_writer
  USING (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND status = 'ACTIVE'
    AND valid_from <= clock_timestamp()
    AND (expires_at IS NULL OR expires_at > clock_timestamp())
    AND permissions -> 'operations' ? NULLIF(current_setting('mira.operation', true), '')
  );

DROP POLICY IF EXISTS hfm_writer_consumed_authority_scope ON mira_hfm.operation_authorities;
CREATE POLICY hfm_writer_consumed_authority_scope
  ON mira_hfm.operation_authorities
  AS RESTRICTIVE
  FOR SELECT TO mira_hfm_memory_writer
  USING (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND operation = NULLIF(current_setting('mira.operation', true), '')
    AND resource = NULLIF(current_setting('mira.resource', true), '')
    AND request_id = NULLIF(current_setting('mira.request_id', true), '')
    AND status IN ('ISSUED', 'CONSUMED')
    AND valid_from <= clock_timestamp()
    AND expires_at > clock_timestamp()
    AND ((status = 'ISSUED' AND consumed_at IS NULL) OR (status = 'CONSUMED' AND consumed_at IS NOT NULL))
  );

DROP POLICY IF EXISTS hfm_writer_consume_exact_authority ON mira_hfm.operation_authorities;
CREATE POLICY hfm_writer_consume_exact_authority
  ON mira_hfm.operation_authorities
  AS RESTRICTIVE
  FOR UPDATE TO mira_hfm_memory_writer
  USING (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND operation = NULLIF(current_setting('mira.operation', true), '')
    AND resource = NULLIF(current_setting('mira.resource', true), '')
    AND request_id = NULLIF(current_setting('mira.request_id', true), '')
    AND status = 'ISSUED'
    AND consumed_at IS NULL
    AND valid_from <= clock_timestamp()
    AND expires_at > clock_timestamp()
  )
  WITH CHECK (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND operation = NULLIF(current_setting('mira.operation', true), '')
    AND resource = NULLIF(current_setting('mira.resource', true), '')
    AND request_id = NULLIF(current_setting('mira.request_id', true), '')
    AND status = 'CONSUMED'
        AND consumed_at IS NOT NULL
        AND valid_from <= clock_timestamp()
        AND expires_at > clock_timestamp()
  );

DROP POLICY IF EXISTS hfm_writer_consumed_authority_audit ON mira_hfm.authority_audit_events;
CREATE POLICY hfm_writer_consumed_authority_audit
  ON mira_hfm.authority_audit_events
  AS RESTRICTIVE
  FOR INSERT TO mira_hfm_memory_writer
  WITH CHECK (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND request_id = NULLIF(current_setting('mira.request_id', true), '')
    AND event_type = 'AUTHORITY_CONSUMED'
  );

-- Memory writer: record reads/lifecycle changes must be for the exact resource
-- whose one-time authority was consumed. RESTRICTED vault payloads remain out
-- of this generic writer role.
DROP POLICY IF EXISTS hfm_writer_memory_record_select_scope ON mira_hfm.memory_records;
CREATE POLICY hfm_writer_memory_record_select_scope
  ON mira_hfm.memory_records
  AS RESTRICTIVE
  FOR SELECT TO mira_hfm_memory_writer
  USING (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND current_setting('mira.resource', true) = 'memory:' || memory_id
    AND classification IN ('PUBLIC', 'PROJECT_PRIVATE')
    AND lifecycle IN ('ACTIVE', 'PENDING_REVIEW', 'TRASHED')
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

DROP POLICY IF EXISTS hfm_writer_memory_record_insert_scope ON mira_hfm.memory_records;
CREATE POLICY hfm_writer_memory_record_insert_scope
  ON mira_hfm.memory_records
  AS RESTRICTIVE
  FOR INSERT TO mira_hfm_memory_writer
  WITH CHECK (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND owner_actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND current_setting('mira.resource', true) = 'memory:' || memory_id
    AND classification IN ('PUBLIC', 'PROJECT_PRIVATE')
    AND lifecycle IN ('ACTIVE', 'PENDING_REVIEW')
    AND current_setting('mira.operation', true) = 'memory.write'
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
        AND member_row.permissions -> 'operations' ? 'memory.write'
    )
    AND EXISTS (
      SELECT 1 FROM mira_hfm.operation_authorities authority_row
      WHERE authority_row.project_id = memory_records.project_id
        AND authority_row.actor_id = NULLIF(current_setting('mira.actor_id', true), '')
        AND authority_row.operation = 'memory.write'
        AND authority_row.resource = 'memory:' || memory_records.memory_id
        AND authority_row.request_id = NULLIF(current_setting('mira.request_id', true), '')
        AND authority_row.status = 'CONSUMED'
        AND authority_row.consumed_at IS NOT NULL
        AND authority_row.valid_from <= clock_timestamp()
        AND authority_row.expires_at > clock_timestamp()
    )
  );

DROP POLICY IF EXISTS hfm_writer_memory_record_update_scope ON mira_hfm.memory_records;
CREATE POLICY hfm_writer_memory_record_update_scope
  ON mira_hfm.memory_records
  AS RESTRICTIVE
  FOR UPDATE TO mira_hfm_memory_writer
  USING (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND current_setting('mira.resource', true) = 'memory:' || memory_id
    AND classification IN ('PUBLIC', 'PROJECT_PRIVATE')
    AND lifecycle IN ('ACTIVE', 'TRASHED')
    AND current_setting('mira.operation', true) IN ('memory.trash', 'memory.restore')
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
    AND lifecycle IN ('ACTIVE', 'TRASHED')
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

DROP POLICY IF EXISTS hfm_writer_memory_version_insert_scope ON mira_hfm.memory_record_versions;
CREATE POLICY hfm_writer_memory_version_insert_scope
  ON mira_hfm.memory_record_versions
  AS RESTRICTIVE
  FOR INSERT TO mira_hfm_memory_writer
  WITH CHECK (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND current_setting('mira.resource', true) = 'memory:' || memory_id
    AND classification IN ('PUBLIC', 'PROJECT_PRIVATE')
    AND EXISTS (
      SELECT 1 FROM mira_hfm.memory_records parent_record
      WHERE parent_record.memory_id = memory_record_versions.memory_id
        AND parent_record.project_id = memory_record_versions.project_id
        AND parent_record.owner_actor_id = memory_record_versions.owner_actor_id
    )
    AND EXISTS (
      SELECT 1 FROM mira_hfm.operation_authorities authority_row
      WHERE authority_row.project_id = memory_record_versions.project_id
        AND authority_row.actor_id = NULLIF(current_setting('mira.actor_id', true), '')
        AND authority_row.operation = NULLIF(current_setting('mira.operation', true), '')
        AND authority_row.resource = 'memory:' || memory_record_versions.memory_id
        AND authority_row.request_id = NULLIF(current_setting('mira.request_id', true), '')
        AND authority_row.status = 'CONSUMED'
        AND authority_row.consumed_at IS NOT NULL
        AND authority_row.valid_from <= clock_timestamp()
        AND authority_row.expires_at > clock_timestamp()
    )
  );

DROP POLICY IF EXISTS hfm_writer_operation_registry_scope ON mira_hfm.memory_operation_registry;
CREATE POLICY hfm_writer_operation_registry_scope
  ON mira_hfm.memory_operation_registry
  AS RESTRICTIVE
  FOR ALL TO mira_hfm_memory_writer
  USING (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND operation = NULLIF(current_setting('mira.operation', true), '')
    AND resource = NULLIF(current_setting('mira.resource', true), '')
    AND EXISTS (
      SELECT 1 FROM mira_hfm.operation_authorities authority_row
      WHERE authority_row.project_id = memory_operation_registry.project_id
        AND authority_row.actor_id = NULLIF(current_setting('mira.actor_id', true), '')
        AND authority_row.operation = NULLIF(current_setting('mira.operation', true), '')
        AND authority_row.resource = NULLIF(current_setting('mira.resource', true), '')
        AND authority_row.request_id = NULLIF(current_setting('mira.request_id', true), '')
        AND authority_row.status = 'CONSUMED'
        AND authority_row.consumed_at IS NOT NULL
        AND authority_row.valid_from <= clock_timestamp()
        AND authority_row.expires_at > clock_timestamp()
    )
  )
  WITH CHECK (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND operation = NULLIF(current_setting('mira.operation', true), '')
    AND resource = NULLIF(current_setting('mira.resource', true), '')
    AND EXISTS (
      SELECT 1 FROM mira_hfm.operation_authorities authority_row
      WHERE authority_row.project_id = memory_operation_registry.project_id
        AND authority_row.actor_id = NULLIF(current_setting('mira.actor_id', true), '')
        AND authority_row.operation = NULLIF(current_setting('mira.operation', true), '')
        AND authority_row.resource = NULLIF(current_setting('mira.resource', true), '')
        AND authority_row.request_id = NULLIF(current_setting('mira.request_id', true), '')
        AND authority_row.status = 'CONSUMED'
        AND authority_row.consumed_at IS NOT NULL
        AND authority_row.valid_from <= clock_timestamp()
        AND authority_row.expires_at > clock_timestamp()
    )
  );

DROP POLICY IF EXISTS hfm_writer_memory_audit_select_scope ON mira_hfm.memory_audit_events;
CREATE POLICY hfm_writer_memory_audit_select_scope
  ON mira_hfm.memory_audit_events
  AS RESTRICTIVE
  FOR SELECT TO mira_hfm_memory_writer
  USING (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND EXISTS (
      SELECT 1 FROM mira_hfm.project_memberships member_row
      WHERE member_row.project_id = memory_audit_events.project_id
        AND member_row.actor_id = NULLIF(current_setting('mira.actor_id', true), '')
        AND member_row.status = 'ACTIVE'
        AND member_row.valid_from <= clock_timestamp()
        AND (member_row.expires_at IS NULL OR member_row.expires_at > clock_timestamp())
        AND member_row.permissions -> 'operations' ? NULLIF(current_setting('mira.operation', true), '')
    )
    AND EXISTS (
      SELECT 1 FROM mira_hfm.operation_authorities authority_row
      WHERE authority_row.project_id = memory_audit_events.project_id
        AND authority_row.actor_id = NULLIF(current_setting('mira.actor_id', true), '')
        AND authority_row.operation = NULLIF(current_setting('mira.operation', true), '')
        AND authority_row.resource = NULLIF(current_setting('mira.resource', true), '')
        AND authority_row.request_id = NULLIF(current_setting('mira.request_id', true), '')
        AND authority_row.status = 'CONSUMED'
        AND authority_row.consumed_at IS NOT NULL
        AND authority_row.valid_from <= clock_timestamp()
        AND authority_row.expires_at > clock_timestamp()
    )
  );

DROP POLICY IF EXISTS hfm_writer_memory_audit_insert_scope ON mira_hfm.memory_audit_events;
CREATE POLICY hfm_writer_memory_audit_insert_scope
  ON mira_hfm.memory_audit_events
  AS RESTRICTIVE
  FOR INSERT TO mira_hfm_memory_writer
  WITH CHECK (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND EXISTS (
      SELECT 1 FROM mira_hfm.memory_operation_registry operation_row
      WHERE operation_row.operation_id = memory_audit_events.operation_id
        AND operation_row.project_id = memory_audit_events.project_id
        AND operation_row.actor_id = memory_audit_events.actor_id
        AND operation_row.operation = NULLIF(current_setting('mira.operation', true), '')
        AND operation_row.resource = NULLIF(current_setting('mira.resource', true), '')
    )
    AND EXISTS (
      SELECT 1 FROM mira_hfm.operation_authorities authority_row
      WHERE authority_row.project_id = memory_audit_events.project_id
        AND authority_row.actor_id = NULLIF(current_setting('mira.actor_id', true), '')
        AND authority_row.operation = NULLIF(current_setting('mira.operation', true), '')
        AND authority_row.resource = NULLIF(current_setting('mira.resource', true), '')
        AND authority_row.request_id = NULLIF(current_setting('mira.request_id', true), '')
        AND authority_row.status = 'CONSUMED'
        AND authority_row.consumed_at IS NOT NULL
        AND authority_row.valid_from <= clock_timestamp()
        AND authority_row.expires_at > clock_timestamp()
    )
  );

-- Memory reader: an active membership with memory.read and a live authority
-- are required even if a caller manually sets the transaction-local project ID.
DROP POLICY IF EXISTS hfm_reader_membership_permission ON mira_hfm.project_memberships;
CREATE POLICY hfm_reader_membership_permission
  ON mira_hfm.project_memberships
  AS RESTRICTIVE
  FOR SELECT TO mira_hfm_memory_reader
  USING (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND status = 'ACTIVE'
    AND valid_from <= clock_timestamp()
    AND (expires_at IS NULL OR expires_at > clock_timestamp())
    AND permissions -> 'operations' ? 'memory.read'
  );

DROP POLICY IF EXISTS hfm_reader_consumed_authority_scope ON mira_hfm.operation_authorities;
CREATE POLICY hfm_reader_consumed_authority_scope
  ON mira_hfm.operation_authorities
  AS RESTRICTIVE
  FOR SELECT TO mira_hfm_memory_reader
  USING (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND operation = 'memory.read'
    AND resource = NULLIF(current_setting('mira.resource', true), '')
    AND request_id = NULLIF(current_setting('mira.request_id', true), '')
    AND status IN ('ISSUED', 'CONSUMED')
    AND valid_from <= clock_timestamp()
    AND expires_at > clock_timestamp()
    AND ((status = 'ISSUED' AND consumed_at IS NULL) OR (status = 'CONSUMED' AND consumed_at IS NOT NULL))
  );

DROP POLICY IF EXISTS hfm_reader_consume_exact_authority ON mira_hfm.operation_authorities;
CREATE POLICY hfm_reader_consume_exact_authority
  ON mira_hfm.operation_authorities
  AS RESTRICTIVE
  FOR UPDATE TO mira_hfm_memory_reader
  USING (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND operation = 'memory.read'
    AND resource = NULLIF(current_setting('mira.resource', true), '')
    AND request_id = NULLIF(current_setting('mira.request_id', true), '')
    AND status = 'ISSUED'
    AND consumed_at IS NULL
    AND valid_from <= clock_timestamp()
    AND expires_at > clock_timestamp()
  )
  WITH CHECK (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND operation = 'memory.read'
    AND resource = NULLIF(current_setting('mira.resource', true), '')
    AND request_id = NULLIF(current_setting('mira.request_id', true), '')
    AND status = 'CONSUMED'
        AND consumed_at IS NOT NULL
        AND valid_from <= clock_timestamp()
        AND expires_at > clock_timestamp()
  );

DROP POLICY IF EXISTS hfm_reader_authority_audit_request_scope ON mira_hfm.authority_audit_events;
CREATE POLICY hfm_reader_authority_audit_request_scope
  ON mira_hfm.authority_audit_events
  AS RESTRICTIVE
  FOR INSERT TO mira_hfm_memory_reader
  WITH CHECK (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND request_id = NULLIF(current_setting('mira.request_id', true), '')
    AND event_type IN ('AUTHORITY_CONSUMED', 'STANDING_READ_AUTHORITY_USED')
  );

DROP POLICY IF EXISTS hfm_reader_memory_membership_authority_scope ON mira_hfm.memory_records;
CREATE POLICY hfm_reader_memory_membership_authority_scope
  ON mira_hfm.memory_records
  AS RESTRICTIVE
  FOR SELECT TO mira_hfm_memory_reader
  USING (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND lifecycle = 'ACTIVE'
    AND classification IN ('PUBLIC', 'PROJECT_PRIVATE')
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
        AND member_row.permissions -> 'operations' ? 'memory.read'
    )
    AND (
      (
        current_setting('mira.standing_read_authority', true) = 'true'
        AND EXISTS (
          SELECT 1 FROM mira_hfm.standing_read_authorities standing_row
          WHERE standing_row.project_id = memory_records.project_id
            AND standing_row.actor_id = NULLIF(current_setting('mira.actor_id', true), '')
            AND standing_row.operation = 'memory.read'
            AND standing_row.resource = 'memory:project:' || memory_records.project_id
            AND standing_row.resource = NULLIF(current_setting('mira.resource', true), '')
            AND standing_row.status = 'ACTIVE'
            AND standing_row.valid_from <= clock_timestamp()
            AND standing_row.expires_at > clock_timestamp()
        )
      )
      OR
      (
        current_setting('mira.standing_read_authority', true) IS DISTINCT FROM 'true'
        AND EXISTS (
          SELECT 1 FROM mira_hfm.operation_authorities authority_row
          WHERE authority_row.project_id = memory_records.project_id
            AND authority_row.actor_id = NULLIF(current_setting('mira.actor_id', true), '')
            AND authority_row.operation = 'memory.read'
            AND authority_row.resource = NULLIF(current_setting('mira.resource', true), '')
            AND authority_row.request_id = NULLIF(current_setting('mira.request_id', true), '')
            AND authority_row.status = 'CONSUMED'
        AND authority_row.consumed_at IS NOT NULL
        AND authority_row.valid_from <= clock_timestamp()
        AND authority_row.expires_at > clock_timestamp()
        )
      )
    )
  );

-- Narrow the writer's UPDATE surface to the exact columns used by
-- one-time authority consumption, lifecycle changes, and operation completion.
-- Table-wide UPDATE would let a valid trash/restore grant rewrite record content,
-- trust metadata, authority scope, or idempotency identity.
REVOKE UPDATE ON TABLE mira_hfm.operation_authorities FROM mira_hfm_memory_writer;
GRANT UPDATE (status, consumed_at)
  ON TABLE mira_hfm.operation_authorities TO mira_hfm_memory_writer;

REVOKE UPDATE ON TABLE mira_hfm.memory_records FROM mira_hfm_memory_writer;
GRANT UPDATE (lifecycle, trashed_at, trashed_by_actor_id, revision, updated_at)
  ON TABLE mira_hfm.memory_records TO mira_hfm_memory_writer;

REVOKE UPDATE ON TABLE mira_hfm.memory_operation_registry FROM mira_hfm_memory_writer;
GRANT UPDATE (status, result_code, updated_at)
  ON TABLE mira_hfm.memory_operation_registry TO mira_hfm_memory_writer;

CREATE OR REPLACE FUNCTION mira_hfm.guard_memory_lifecycle_only_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $
DECLARE
  operation_name TEXT := NULLIF(current_setting('mira.operation', true), '');
  actor_name TEXT := NULLIF(current_setting('mira.actor_id', true), '');
BEGIN
  IF operation_name IS NULL OR operation_name NOT IN ('memory.trash', 'memory.restore')
     OR NEW.integrity_status IS DISTINCT FROM OLD.integrity_status
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
  ELSIF operation_name = 'memory.restore' THEN
    IF OLD.lifecycle <> 'TRASHED'
       OR NEW.lifecycle <> 'ACTIVE'
       OR NEW.trashed_at IS NOT NULL
       OR NEW.trashed_by_actor_id IS NOT NULL THEN
      RAISE EXCEPTION 'HFM_MEMORY_RESTORE_TRANSITION_INVALID';
    END IF;
  END IF;

  IF NEW.revision <> OLD.revision + 1 OR NEW.updated_at <= OLD.updated_at THEN
    RAISE EXCEPTION 'HFM_MEMORY_LIFECYCLE_REVISION_INVALID';
  END IF;
  RETURN NEW;
END;
$;

DROP TRIGGER IF EXISTS memory_records_lifecycle_update_guard ON mira_hfm.memory_records;
CREATE TRIGGER memory_records_lifecycle_update_guard
  BEFORE UPDATE ON mira_hfm.memory_records
  FOR EACH ROW EXECUTE FUNCTION mira_hfm.guard_memory_lifecycle_only_update();

CREATE OR REPLACE FUNCTION mira_hfm.guard_memory_operation_registry_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $
BEGIN
  IF NEW.operation_id IS DISTINCT FROM OLD.operation_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.operation IS DISTINCT FROM OLD.operation
     OR NEW.resource IS DISTINCT FROM OLD.resource
     OR NEW.purpose IS DISTINCT FROM OLD.purpose
     OR NEW.payload_digest IS DISTINCT FROM OLD.payload_digest
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR OLD.result_code IS NOT NULL
     OR OLD.status <> 'REQUESTED'
     OR NEW.status <> 'COMPLETED'
     OR NEW.result_code IS NULL
     OR length(btrim(NEW.result_code)) = 0
     OR NEW.updated_at <= OLD.updated_at THEN
    RAISE EXCEPTION 'HFM_MEMORY_OPERATION_REGISTRY_TRANSITION_INVALID';
  END IF;
  RETURN NEW;
END;
$;

DROP TRIGGER IF EXISTS memory_operation_registry_update_guard ON mira_hfm.memory_operation_registry;
CREATE TRIGGER memory_operation_registry_update_guard
  BEFORE UPDATE ON mira_hfm.memory_operation_registry
  FOR EACH ROW EXECUTE FUNCTION mira_hfm.guard_memory_operation_registry_update();

REVOKE ALL ON FUNCTION mira_hfm.guard_memory_lifecycle_only_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION mira_hfm.guard_memory_operation_registry_update() FROM PUBLIC;

COMMENT ON POLICY hfm_writer_memory_record_insert_scope ON mira_hfm.memory_records IS
  'Requires active owner, active actor membership with memory.write, consumed one-time authority, exact record resource, and non-RESTRICTED classification.';
COMMENT ON POLICY hfm_reader_memory_membership_authority_scope ON mira_hfm.memory_records IS
  'Requires active owner, active actor membership with memory.read, and a live standing or consumed one-time authority in addition to project RLS.';

COMMIT;
