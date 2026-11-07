-- SOURCE-ONLY DRAFT: HFM v0.2 restricted Client/Financial Vault write authority.
-- Do not execute on production. Review and approve the complete migration chain first.
-- Restricted writes require a distinct memory.vault.write permission and one-time exact-resource authority.
-- CI validation uses disposable PostgreSQL only.

BEGIN;

ALTER TABLE mira_hfm.authority_approval_nonces
  DROP CONSTRAINT IF EXISTS authority_approval_nonces_operation_check;
ALTER TABLE mira_hfm.authority_approval_nonces
  ADD CONSTRAINT authority_approval_nonces_operation_check
  CHECK (operation IN (
    'memory.read', 'memory.write', 'memory.vault.write',
    'memory.update', 'memory.trash', 'memory.restore'
  ));

DROP POLICY IF EXISTS hfm_authority_issuer_authority_insert
  ON mira_hfm.operation_authorities;
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
      (operation IN ('memory.write', 'memory.vault.write', 'memory.update', 'memory.trash', 'memory.restore')
        AND resource ~ '^memory:[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'
        AND resource <> 'memory:project:' || NULLIF(current_setting('mira.project_id', true), ''))
    )
    AND valid_from <= clock_timestamp()
    AND expires_at > clock_timestamp()
    AND expires_at <= clock_timestamp() + interval '5 minutes'
  );

DROP POLICY IF EXISTS hfm_authority_issuer_approval_nonce_insert
  ON mira_hfm.authority_approval_nonces;
CREATE POLICY hfm_authority_issuer_approval_nonce_insert
  ON mira_hfm.authority_approval_nonces
  FOR INSERT TO mira_hfm_authority_issuer
  WITH CHECK (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND approver_actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND (
      (operation = 'memory.read'
        AND resource = 'memory:project:' || NULLIF(current_setting('mira.project_id', true), ''))
      OR
      (operation IN ('memory.write', 'memory.vault.write', 'memory.update', 'memory.trash', 'memory.restore')
        AND resource ~ '^memory:[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'
        AND resource <> 'memory:project:' || NULLIF(current_setting('mira.project_id', true), ''))
    )
    AND issued_at <= clock_timestamp()
    AND expires_at > clock_timestamp()
    AND expires_at <= clock_timestamp() + interval '5 minutes'
    AND consumed_at IS NULL
  );

DROP POLICY IF EXISTS hfm_writer_memory_record_insert_scope
  ON mira_hfm.memory_records;
CREATE POLICY hfm_writer_memory_record_insert_scope
  ON mira_hfm.memory_records
  AS RESTRICTIVE
  FOR INSERT TO mira_hfm_memory_writer
  WITH CHECK (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND owner_actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND current_setting('mira.resource', true) = 'memory:' || memory_id
    AND (
      (
        classification IN ('PUBLIC', 'PROJECT_PRIVATE')
        AND current_setting('mira.operation', true) = 'memory.write'
        AND lifecycle IN ('ACTIVE', 'PENDING_REVIEW')
      )
      OR
      (
        classification = 'RESTRICTED'
        AND record_type IN ('client_vault_record', 'financial_vault_record')
        AND schema_version = '1.1.0'
        AND lifecycle = 'PENDING_REVIEW'
        AND trust_status = 'SOURCE_RECORDED'
        AND integrity_status = 'VERIFIED'
        AND current_setting('mira.operation', true) = 'memory.vault.write'
      )
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
        AND (
          current_setting('mira.operation', true) <> 'memory.vault.write'
          OR authority_row.purpose LIKE 'hfm-vault:%'
        )
    )
  );

DROP POLICY IF EXISTS hfm_writer_memory_version_insert_scope
  ON mira_hfm.memory_record_versions;
CREATE POLICY hfm_writer_memory_version_insert_scope
  ON mira_hfm.memory_record_versions
  AS RESTRICTIVE
  FOR INSERT TO mira_hfm_memory_writer
  WITH CHECK (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND current_setting('mira.resource', true) = 'memory:' || memory_id
    AND (
      (
        classification IN ('PUBLIC', 'PROJECT_PRIVATE')
        AND current_setting('mira.operation', true) = 'memory.write'
      )
      OR
      (
        classification = 'RESTRICTED'
        AND record_type IN ('client_vault_record', 'financial_vault_record')
        AND schema_version = '1.1.0'
        AND lifecycle = 'PENDING_REVIEW'
        AND trust_status = 'SOURCE_RECORDED'
        AND integrity_status = 'VERIFIED'
        AND current_setting('mira.operation', true) = 'memory.vault.write'
      )
    )
    AND EXISTS (
      SELECT 1 FROM mira_hfm.memory_records parent_record
      WHERE parent_record.memory_id = memory_record_versions.memory_id
        AND parent_record.project_id = memory_record_versions.project_id
        AND parent_record.owner_actor_id = memory_record_versions.owner_actor_id
        AND parent_record.record_type = memory_record_versions.record_type
        AND parent_record.schema_version = memory_record_versions.schema_version
        AND parent_record.classification = memory_record_versions.classification
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
        AND (
          current_setting('mira.operation', true) <> 'memory.vault.write'
          OR authority_row.purpose LIKE 'hfm-vault:%'
        )
    )
  );

COMMENT ON POLICY hfm_writer_memory_record_insert_scope
  ON mira_hfm.memory_records IS
  'Normal writes require memory.write; RESTRICTED client/financial vault writes require memory.vault.write, PENDING_REVIEW, SOURCE_RECORDED, VERIFIED envelope metadata, active project owner/member, and consumed exact-resource authority.';

COMMENT ON POLICY hfm_writer_memory_version_insert_scope
  ON mira_hfm.memory_record_versions IS
  'Version inserts require a matching same-project parent record and consumed exact-resource authority; RESTRICTED vault versions require memory.vault.write.';

COMMIT;
