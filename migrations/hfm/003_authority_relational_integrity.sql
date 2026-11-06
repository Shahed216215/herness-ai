-- MIRA HFM additive relational-integrity hardening.
-- SOURCE-ONLY DRAFT: do not execute on production. Apply to a disposable branch
-- only after schema-owner approval, backup verification, and preflight review.
-- No rows are inserted, updated, deleted, or migrated by this file.
-- Audit events intentionally have no FK to project_owners: append-only evidence
-- must remain retainable if a project registry row is later retired.

BEGIN;

-- Owner revisions are historical snapshots on authorities, not foreign-key
-- targets: a project owner must be able to advance its revision while older
-- authorities remain available for replay detection and audit.
CREATE INDEX IF NOT EXISTS project_memberships_project_id_idx
  ON mira_hfm.project_memberships (project_id);

CREATE INDEX IF NOT EXISTS operation_authorities_project_actor_membership_revision_idx
  ON mira_hfm.operation_authorities (project_id, actor_id, membership_revision);

-- Existing inconsistent rows cause VALIDATE to fail closed. Constraints are
-- added NOT VALID first so the preflight and validation stages are explicit.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_memberships_project_owner_fk'
      AND conrelid = 'mira_hfm.project_memberships'::regclass
  ) THEN
    ALTER TABLE mira_hfm.project_memberships
      ADD CONSTRAINT project_memberships_project_owner_fk
      FOREIGN KEY (project_id)
      REFERENCES mira_hfm.project_owners (project_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operation_authorities_project_owner_fk'
      AND conrelid = 'mira_hfm.operation_authorities'::regclass
  ) THEN
    ALTER TABLE mira_hfm.operation_authorities
      ADD CONSTRAINT operation_authorities_project_owner_fk
      FOREIGN KEY (project_id)
      REFERENCES mira_hfm.project_owners (project_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operation_authorities_membership_revision_fk'
      AND conrelid = 'mira_hfm.operation_authorities'::regclass
  ) THEN
    ALTER TABLE mira_hfm.operation_authorities
      ADD CONSTRAINT operation_authorities_membership_revision_fk
      FOREIGN KEY (project_id, actor_id, membership_revision)
      REFERENCES mira_hfm.project_memberships (project_id, actor_id, revision)
      ON UPDATE RESTRICT ON DELETE RESTRICT
      NOT VALID;
  END IF;
END;
$$;

ALTER TABLE mira_hfm.project_memberships
  VALIDATE CONSTRAINT project_memberships_project_owner_fk;

ALTER TABLE mira_hfm.operation_authorities
  VALIDATE CONSTRAINT operation_authorities_project_owner_fk;

ALTER TABLE mira_hfm.operation_authorities
  VALIDATE CONSTRAINT operation_authorities_membership_revision_fk;

COMMIT;
