-- SOURCE-ONLY: allow the least-privilege Memory reader to persist denied/failed
-- standing memory.read attempts after the protected transaction is rolled back.
-- No role grants, data writes, or live database operations are performed here.

DO $$
BEGIN
  IF to_regclass('mira_hfm.authority_audit_events') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_roles WHERE rolname = 'mira_hfm_memory_reader'
     ) THEN
    RAISE EXCEPTION 'HFM_STANDING_READ_FAILURE_AUDIT_PREREQUISITES_MISSING';
  END IF;
END;
$$;

DROP POLICY IF EXISTS hfm_memory_reader_authority_audit_insert
  ON mira_hfm.authority_audit_events;
CREATE POLICY hfm_memory_reader_authority_audit_insert
  ON mira_hfm.authority_audit_events
  FOR INSERT TO mira_hfm_memory_reader
  WITH CHECK (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND event_type IN (
      'AUTHORITY_CONSUMED',
      'STANDING_READ_AUTHORITY_USED',
      'STANDING_READ_AUTHORITY_DENIED',
      'STANDING_READ_AUTHORITY_FAILED'
    )
  );

DROP POLICY IF EXISTS hfm_reader_authority_audit_request_scope
  ON mira_hfm.authority_audit_events;
CREATE POLICY hfm_reader_authority_audit_request_scope
  ON mira_hfm.authority_audit_events
  AS RESTRICTIVE
  FOR INSERT TO mira_hfm_memory_reader
  WITH CHECK (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND request_id = NULLIF(current_setting('mira.request_id', true), '')
    AND event_type IN (
      'AUTHORITY_CONSUMED',
      'STANDING_READ_AUTHORITY_USED',
      'STANDING_READ_AUTHORITY_DENIED',
      'STANDING_READ_AUTHORITY_FAILED'
    )
  );

COMMENT ON POLICY hfm_reader_authority_audit_request_scope
  ON mira_hfm.authority_audit_events IS
  'Restricts reader audit inserts to the exact project, actor, request and enumerated read outcome events.';
