-- MIRA HFM v0.2: retain sanitized source/provenance separately from post payload.
-- SOURCE-ONLY. Do not execute in production without a separate approved migration gate.
-- Depends on migrations 004, 005 and 006. Existing rows remain NULL; no payload backfill/decryption.
BEGIN;

DO $$
BEGIN
  IF to_regclass('mira_hfm.memory_social_post_state') IS NULL THEN
    RAISE EXCEPTION 'HFM_SOCIAL_POST_STATE_TABLE_REQUIRED';
  END IF;
END;
$$;

ALTER TABLE mira_hfm.memory_social_post_state
  ADD COLUMN IF NOT EXISTS source_metadata JSONB,
  ADD COLUMN IF NOT EXISTS provenance_metadata JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'mira_hfm.memory_social_post_state'::regclass
      AND conname = 'memory_social_post_source_metadata_check'
  ) THEN
    ALTER TABLE mira_hfm.memory_social_post_state
      ADD CONSTRAINT memory_social_post_source_metadata_check CHECK (
        source_metadata IS NULL OR (
          jsonb_typeof(source_metadata) = 'object'
          AND source_metadata - ARRAY['sourceType','sourceId','observedAt'] = '{}'::jsonb
          AND jsonb_typeof(source_metadata->'sourceType') = 'string'
          AND jsonb_typeof(source_metadata->'sourceId') = 'string'
          AND jsonb_typeof(source_metadata->'observedAt') = 'string'
        )
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'mira_hfm.memory_social_post_state'::regclass
      AND conname = 'memory_social_post_provenance_metadata_check'
  ) THEN
    ALTER TABLE mira_hfm.memory_social_post_state
      ADD CONSTRAINT memory_social_post_provenance_metadata_check CHECK (
        provenance_metadata IS NULL OR (
          jsonb_typeof(provenance_metadata) = 'object'
          AND provenance_metadata - ARRAY[
            'collectionMethod','capturedAt','originalPublishedAt',
            'verificationStatus','redactionApplied'
          ] = '{}'::jsonb
          AND jsonb_typeof(provenance_metadata->'collectionMethod') = 'string'
          AND jsonb_typeof(provenance_metadata->'capturedAt') = 'string'
          AND jsonb_typeof(provenance_metadata->'verificationStatus') = 'string'
          AND jsonb_typeof(provenance_metadata->'redactionApplied') = 'boolean'
        )
      );
  END IF;
END;
$$;

COMMENT ON COLUMN mira_hfm.memory_social_post_state.source_metadata IS
  'Allowlisted source identity/date only; excludes source URL, post body, tokens and credentials. Retained after payload erasure.';
COMMENT ON COLUMN mira_hfm.memory_social_post_state.provenance_metadata IS
  'Allowlisted collection/verification metadata only; retained after payload erasure.';

COMMIT;
