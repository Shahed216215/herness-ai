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
  )
  WITH CHECK (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND operation = NULLIF(current_setting('mira.operation', true), '')
    AND resource = NULLIF(current_setting('mira.resource', true), '')
    AND request_id = NULLIF(current_setting('mira.request_id', true), '')
    AND status = 'CONSUMED'
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
    )
  );

-- One-time, consumed memory.read may list only recoverable social drafts in Trash.
-- The restrictive actor/membership/authority policy below still applies; standing
-- reads are separately forced to ACTIVE Knowledge/Learning by Migration 014.
CREATE POLICY hfm_memory_reader_trashed_social_draft_select
  ON mira_hfm.memory_records
  FOR SELECT TO mira_hfm_memory_reader
  USING (
    lifecycle = 'TRASHED'
    AND record_type = 'social_post_draft'
    AND classification IN ('PUBLIC', 'PROJECT_PRIVATE')
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

-- A permissive SELECT policy is also required: PostgreSQL combines permissive
-- policies with OR before applying restrictive policies. Migration 010's
-- ISSUED-only policy cannot expose a successfully consumed row to the exact
-- one-time retrieval callback after the atomic status transition.
DROP POLICY IF EXISTS hfm_reader_consumed_authority_select ON mira_hfm.operation_authorities;
CREATE POLICY hfm_reader_consumed_authority_select
  ON mira_hfm.operation_authorities
  FOR SELECT TO mira_hfm_memory_reader
  USING (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND operation = 'memory.read'
    AND resource = NULLIF(current_setting('mira.resource', true), '')
    AND request_id = NULLIF(current_setting('mira.request_id', true), '')
    AND status = 'CONSUMED'
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
  )
  WITH CHECK (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND operation = 'memory.read'
    AND resource = NULLIF(current_setting('mira.resource', true), '')
    AND request_id = NULLIF(current_setting('mira.request_id', true), '')
    AND status = 'CONSUMED'
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
    AND (
      lifecycle = 'ACTIVE'
      OR (
        lifecycle = 'TRASHED'
        AND record_type = 'social_post_draft'
        AND current_setting('mira.standing_read_authority', true) IS DISTINCT FROM 'true'
      )
    )
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
        )
      )
    )
  );

COMMENT ON POLICY hfm_writer_memory_record_insert_scope ON mira_hfm.memory_records IS
  'Requires active owner, active actor membership with memory.write, consumed one-time authority, exact record resource, and non-RESTRICTED classification.';
COMMENT ON POLICY hfm_reader_memory_membership_authority_scope ON mira_hfm.memory_records IS
  'Requires active owner, active actor membership with memory.read, and a live standing or consumed one-time authority in addition to project RLS.';

COMMIT;
