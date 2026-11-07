-- HFM v0.2 initial project bootstrap capability for the authenticated human owner.
-- SOURCE-ONLY. Apply to a disposable branch first; production requires separate approval.
-- The authority issuer can INSERT owner/membership rows only within the project id
-- set by the authenticated route. It cannot UPDATE or DELETE project governance rows.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mira_hfm_authority_issuer') THEN
    RAISE EXCEPTION 'HFM_AUTHORITY_ISSUER_ROLE_REQUIRED';
  END IF;
END;
$$;

GRANT INSERT ON TABLE mira_hfm.project_owners, mira_hfm.project_memberships
  TO mira_hfm_authority_issuer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='mira_hfm' AND tablename='project_owners' AND policyname='authority_issuer_owner_insert') THEN
    CREATE POLICY authority_issuer_owner_insert ON mira_hfm.project_owners
      FOR INSERT TO mira_hfm_authority_issuer
      WITH CHECK (project_id = NULLIF(current_setting('mira.project_id', true), ''));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='mira_hfm' AND tablename='project_memberships' AND policyname='authority_issuer_membership_insert') THEN
    CREATE POLICY authority_issuer_membership_insert ON mira_hfm.project_memberships
      FOR INSERT TO mira_hfm_authority_issuer
      WITH CHECK (project_id = NULLIF(current_setting('mira.project_id', true), ''));
  END IF;
END;
$$;

COMMENT ON ROLE mira_hfm_authority_issuer IS
  'HFM authority and project bootstrap issuer: project-scoped owner/membership SELECT+INSERT, authority/audit INSERT only; no updates, deletes or Memory payload access.';

COMMIT;
