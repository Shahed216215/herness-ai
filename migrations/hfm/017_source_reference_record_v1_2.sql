-- SOURCE-ONLY DRAFT: HFM v0.2 source_reference canonical record schema v1.2.0.
-- Do not execute on production. Review and approve the complete migration chain first.
-- v1.0.0 and v1.1.0 record-type compatibility is preserved; source_reference is v1.2.0 only.
-- CI validation uses disposable PostgreSQL only.

BEGIN;

DO $$
DECLARE
  constraint_row RECORD;
BEGIN
  FOR constraint_row IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'mira_hfm.memory_records'::regclass
      AND contype = 'c'
      AND (
        position('record_type' IN pg_get_constraintdef(oid)) > 0
        OR position('schema_version' IN pg_get_constraintdef(oid)) > 0
      )
  LOOP
    EXECUTE format('ALTER TABLE mira_hfm.memory_records DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;

  FOR constraint_row IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'mira_hfm.memory_record_versions'::regclass
      AND contype = 'c'
      AND (
        position('record_type' IN pg_get_constraintdef(oid)) > 0
        OR position('schema_version' IN pg_get_constraintdef(oid)) > 0
      )
  LOOP
    EXECUTE format('ALTER TABLE mira_hfm.memory_record_versions DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;
END;
$$;

ALTER TABLE mira_hfm.memory_records
  ADD CONSTRAINT memory_records_record_type_v12_check
  CHECK (record_type IN (
    'fact', 'decision', 'preference', 'procedure', 'lesson', 'experience',
    'strategy', 'project', 'conversation_reference', 'knowledge', 'research_reference',
    'daily_activity', 'learning_note', 'knowledge_item', 'social_post_draft',
    'client_vault_record', 'financial_vault_record', 'source_reference'
  )),
  ADD CONSTRAINT memory_records_schema_version_v12_check
  CHECK (schema_version IN ('1.0.0', '1.1.0', '1.2.0')),
  ADD CONSTRAINT memory_records_schema_compatibility_v12_check
  CHECK (
    (schema_version = '1.0.0' AND record_type IN (
      'fact', 'decision', 'preference', 'procedure', 'lesson', 'experience',
      'strategy', 'project', 'conversation_reference', 'knowledge', 'research_reference'
    ))
    OR
    (schema_version = '1.1.0' AND record_type IN (
      'fact', 'decision', 'preference', 'procedure', 'lesson', 'experience',
      'strategy', 'project', 'conversation_reference', 'knowledge', 'research_reference',
      'daily_activity', 'learning_note', 'knowledge_item', 'social_post_draft',
      'client_vault_record', 'financial_vault_record'
    ))
    OR
    (schema_version = '1.2.0' AND record_type IN (
      'fact', 'decision', 'preference', 'procedure', 'lesson', 'experience',
      'strategy', 'project', 'conversation_reference', 'knowledge', 'research_reference',
      'daily_activity', 'learning_note', 'knowledge_item', 'social_post_draft',
      'client_vault_record', 'financial_vault_record', 'source_reference'
    ))
  ),
  ADD CONSTRAINT memory_records_vault_classification_v12_check
  CHECK (
    record_type NOT IN ('client_vault_record', 'financial_vault_record')
    OR (schema_version IN ('1.1.0', '1.2.0') AND classification = 'RESTRICTED')
  ),
  ADD CONSTRAINT memory_records_private_record_classification_v12_check
  CHECK (
    (record_type NOT IN ('daily_activity', 'learning_note', 'social_post_draft')
      OR (schema_version IN ('1.1.0', '1.2.0') AND classification = 'PROJECT_PRIVATE'))
    AND
    (record_type <> 'source_reference'
      OR (schema_version = '1.2.0' AND classification = 'PROJECT_PRIVATE'))
  );

ALTER TABLE mira_hfm.memory_record_versions
  ADD CONSTRAINT memory_record_versions_record_type_v12_check
  CHECK (record_type IN (
    'fact', 'decision', 'preference', 'procedure', 'lesson', 'experience',
    'strategy', 'project', 'conversation_reference', 'knowledge', 'research_reference',
    'daily_activity', 'learning_note', 'knowledge_item', 'social_post_draft',
    'client_vault_record', 'financial_vault_record', 'source_reference'
  )),
  ADD CONSTRAINT memory_record_versions_schema_version_v12_check
  CHECK (schema_version IN ('1.0.0', '1.1.0', '1.2.0')),
  ADD CONSTRAINT memory_record_versions_schema_compatibility_v12_check
  CHECK (
    (schema_version = '1.0.0' AND record_type IN (
      'fact', 'decision', 'preference', 'procedure', 'lesson', 'experience',
      'strategy', 'project', 'conversation_reference', 'knowledge', 'research_reference'
    ))
    OR
    (schema_version = '1.1.0' AND record_type IN (
      'fact', 'decision', 'preference', 'procedure', 'lesson', 'experience',
      'strategy', 'project', 'conversation_reference', 'knowledge', 'research_reference',
      'daily_activity', 'learning_note', 'knowledge_item', 'social_post_draft',
      'client_vault_record', 'financial_vault_record'
    ))
    OR
    (schema_version = '1.2.0' AND record_type IN (
      'fact', 'decision', 'preference', 'procedure', 'lesson', 'experience',
      'strategy', 'project', 'conversation_reference', 'knowledge', 'research_reference',
      'daily_activity', 'learning_note', 'knowledge_item', 'social_post_draft',
      'client_vault_record', 'financial_vault_record', 'source_reference'
    ))
  ),
  ADD CONSTRAINT memory_record_versions_vault_classification_v12_check
  CHECK (
    record_type NOT IN ('client_vault_record', 'financial_vault_record')
    OR (schema_version IN ('1.1.0', '1.2.0') AND classification = 'RESTRICTED')
  ),
  ADD CONSTRAINT memory_record_versions_private_record_classification_v12_check
  CHECK (
    (record_type NOT IN ('daily_activity', 'learning_note', 'social_post_draft')
      OR (schema_version IN ('1.1.0', '1.2.0') AND classification = 'PROJECT_PRIVATE'))
    AND
    (record_type <> 'source_reference'
      OR (schema_version = '1.2.0' AND classification = 'PROJECT_PRIVATE'))
  );

COMMENT ON CONSTRAINT memory_records_schema_compatibility_v12_check
  ON mira_hfm.memory_records IS
  'HFM v0.2 schema compatibility: source_reference is accepted only under canonical schema 1.2.0; v1.0.0 and v1.1.0 remain unchanged.';

COMMIT;
