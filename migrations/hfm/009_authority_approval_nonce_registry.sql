-- MIRA HFM v0.2 persistent one-time approval nonce registry.
-- SOURCE-ONLY DRAFT. Do not execute without explicit staging approval.
-- The authority issuer can create and atomically consume scoped, short-lived
-- approval nonces. The raw HMAC token is never stored in this table.

BEGIN;

DO $$
BEGIN
  IF to_regclass('mira_hfm.operation_authorities') IS NULL
     OR to_regclass('mira_hfm.authority_audit_events') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mira_hfm_authority_issuer') THEN
    RAISE EXCEPTION 'HFM_APPROVAL_NONCE_PREREQUISITES_REQUIRED';
  END IF;

  IF to_regclass('mira_hfm.authority_approval_nonces') IS NOT NULL THEN
    RAISE EXCEPTION 'HFM_APPROVAL_NONCE_TABLE_ALREADY_EXISTS';
  END IF;
END;
$$;

CREATE TABLE mira_hfm.authority_approval_nonces (
  nonce_hash text PRIMARY KEY
    CHECK (nonce_hash ~ '^[a-f0-9]{64}$'),
  approval_ref text NOT NULL UNIQUE
    CHECK (length(btrim(approval_ref)) BETWEEN 1 AND 256),
  project_id text NOT NULL
    CHECK (length(btrim(project_id)) BETWEEN 1 AND 256),
  actor_id text NOT NULL
    CHECK (actor_id LIKE 'mira:%' AND length(actor_id) <= 512),
  approver_actor_id text NOT NULL
    CHECK (approver_actor_id LIKE 'mira:%' AND length(approver_actor_id) <= 512),
  operation text NOT NULL CHECK (operation IN ('memory.read','memory.write','memory.trash','memory.restore')),
  resource text NOT NULL CHECK (length(btrim(resource)) BETWEEN 1 AND 512),
  purpose text NOT NULL CHECK (length(btrim(purpose)) BETWEEN 1 AND 512),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT authority_approval_nonces_actor_is_approver
    CHECK (actor_id = approver_actor_id),
  CONSTRAINT authority_approval_nonces_time_bounds
    CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '5 minutes')
);

CREATE INDEX authority_approval_nonces_project_actor_expiry_idx
  ON mira_hfm.authority_approval_nonces (project_id, actor_id, expires_at)
  WHERE consumed_at IS NULL;

REVOKE ALL ON TABLE mira_hfm.authority_approval_nonces FROM PUBLIC;
REVOKE ALL ON TABLE mira_hfm.authority_approval_nonces FROM mira_hfm_authority_issuer;
GRANT SELECT, INSERT ON TABLE mira_hfm.authority_approval_nonces
  TO mira_hfm_authority_issuer;
GRANT UPDATE (consumed_at) ON TABLE mira_hfm.authority_approval_nonces
  TO mira_hfm_authority_issuer;

ALTER TABLE mira_hfm.authority_approval_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE mira_hfm.authority_approval_nonces FORCE ROW LEVEL SECURITY;

CREATE POLICY hfm_authority_issuer_approval_nonce_select
  ON mira_hfm.authority_approval_nonces
  FOR SELECT TO mira_hfm_authority_issuer
  USING (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND approver_actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND expires_at > clock_timestamp()
  );

CREATE POLICY hfm_authority_issuer_approval_nonce_insert
  ON mira_hfm.authority_approval_nonces
  FOR INSERT TO mira_hfm_authority_issuer
  WITH CHECK (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND approver_actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND (
      (operation = 'memory.read' AND resource = 'memory:project:' || NULLIF(current_setting('mira.project_id', true), ''))
      OR (operation IN ('memory.write','memory.trash','memory.restore') AND resource ~ '^memory:[A-Za-z0-9][A-Za-z0-9._:-]{2,127}
    AND consumed_at IS NULL
    AND issued_at <= clock_timestamp()
    AND expires_at > clock_timestamp()
    AND expires_at <= clock_timestamp() + interval '5 minutes'
  );

CREATE POLICY hfm_authority_issuer_approval_nonce_consume
  ON mira_hfm.authority_approval_nonces
  FOR UPDATE TO mira_hfm_authority_issuer
  USING (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND approver_actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND consumed_at IS NULL
    AND expires_at > clock_timestamp()
  )
  -- The column-level GRANT permits changing only consumed_at. The USING
  -- clause scopes the existing row; this CHECK validates the sole mutable field.
  WITH CHECK (consumed_at IS NOT NULL AND consumed_at <= clock_timestamp());

COMMENT ON TABLE mira_hfm.authority_approval_nonces IS
  'HFM v0.2 hashed nonce ledger for signed, single-use, short-lived human approval tokens.';

COMMIT;
)
    )
    AND consumed_at IS NULL
    AND issued_at <= clock_timestamp()
    AND expires_at > clock_timestamp()
    AND expires_at <= clock_timestamp() + interval '5 minutes'
  );

CREATE POLICY hfm_authority_issuer_approval_nonce_consume
  ON mira_hfm.authority_approval_nonces
  FOR UPDATE TO mira_hfm_authority_issuer
  USING (
    project_id = NULLIF(current_setting('mira.project_id', true), '')
    AND actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND approver_actor_id = NULLIF(current_setting('mira.actor_id', true), '')
    AND consumed_at IS NULL
    AND expires_at > clock_timestamp()
  )
  -- The column-level GRANT permits changing only consumed_at. The USING
  -- clause scopes the existing row; this CHECK validates the sole mutable field.
  WITH CHECK (consumed_at IS NOT NULL);

COMMENT ON TABLE mira_hfm.authority_approval_nonces IS
  'HFM v0.2 hashed nonce ledger for signed, single-use, short-lived human approval tokens.';

COMMIT;
