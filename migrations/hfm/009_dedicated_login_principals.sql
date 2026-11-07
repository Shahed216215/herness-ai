-- HFM v0.2 dedicated LOGIN principals for the isolated Memory writer and authority issuer.
-- SOURCE-ONLY DRAFT. Do not apply to production without explicit approval.
-- Creates no passwords and returns no secrets. Set each password out-of-band in Neon Console.
-- Each LOGIN role inherits exactly one NOLOGIN capability group.

BEGIN;

DO $$
DECLARE
  writer_oid oid;
  issuer_oid oid;
  writer_group_oid oid;
  issuer_group_oid oid;
BEGIN
  SELECT oid INTO writer_group_oid FROM pg_roles WHERE rolname='mira_hfm_memory_writer';
  SELECT oid INTO issuer_group_oid FROM pg_roles WHERE rolname='mira_hfm_authority_issuer';
  IF writer_group_oid IS NULL OR issuer_group_oid IS NULL THEN
    RAISE EXCEPTION 'HFM_CAPABILITY_GROUPS_REQUIRED';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mira_hfm_memory_writer_login') THEN
    CREATE ROLE mira_hfm_memory_writer_login
      LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mira_hfm_authority_issuer_login') THEN
    CREATE ROLE mira_hfm_authority_issuer_login
      LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;

  SELECT oid INTO writer_oid FROM pg_roles WHERE rolname='mira_hfm_memory_writer_login';
  SELECT oid INTO issuer_oid FROM pg_roles WHERE rolname='mira_hfm_authority_issuer_login';

  IF EXISTS (
    SELECT 1 FROM pg_roles WHERE oid IN (writer_oid, issuer_oid)
      AND (NOT rolcanlogin OR NOT rolinherit OR rolsuper OR rolcreatedb OR
           rolcreaterole OR rolreplication OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'HFM_LOGIN_ROLE_ATTRIBUTES_NOT_LEAST_PRIVILEGE';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_auth_members
    WHERE member=writer_oid AND roleid <> writer_group_oid
  ) OR EXISTS (
    SELECT 1 FROM pg_auth_members
    WHERE member=issuer_oid AND roleid <> issuer_group_oid
  ) THEN
    RAISE EXCEPTION 'HFM_LOGIN_ROLE_HAS_UNEXPECTED_ROLE_MEMBERSHIP';
  END IF;
END;
$$;

GRANT mira_hfm_memory_writer TO mira_hfm_memory_writer_login;
GRANT mira_hfm_authority_issuer TO mira_hfm_authority_issuer_login;

COMMENT ON ROLE mira_hfm_memory_writer_login IS
  'HFM dedicated LOGIN principal; inherits only mira_hfm_memory_writer. Password must be configured out-of-band.';
COMMENT ON ROLE mira_hfm_authority_issuer_login IS
  'HFM dedicated LOGIN principal; inherits only mira_hfm_authority_issuer. Password must be configured out-of-band.';

COMMIT;
