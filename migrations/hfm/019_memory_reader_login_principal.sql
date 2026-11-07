-- MIRA HFM v0.2 dedicated LOGIN principal for the constrained Memory reader.
-- SOURCE-ONLY DRAFT. Do not execute on production or staging without separate approval.
-- Creates no password or credential. Configure the login secret out-of-band.
-- The LOGIN principal inherits exactly one NOLOGIN capability group.

BEGIN;

DO $$
DECLARE
  reader_oid oid;
  login_oid oid;
BEGIN
  SELECT oid INTO reader_oid
  FROM pg_roles
  WHERE rolname = 'mira_hfm_memory_reader';

  IF reader_oid IS NULL THEN
    RAISE EXCEPTION 'HFM_MEMORY_READER_CAPABILITY_GROUP_REQUIRED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE oid = reader_oid
      AND (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR
           rolcreaterole OR rolreplication OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'HFM_MEMORY_READER_GROUP_ATTRIBUTES_NOT_LEAST_PRIVILEGE';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_auth_members
    WHERE member = reader_oid
  ) THEN
    RAISE EXCEPTION 'HFM_MEMORY_READER_GROUP_MUST_NOT_INHERIT_OTHER_ROLES';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_shdepend
    WHERE refclassid = 'pg_authid'::regclass
      AND refobjid = reader_oid
      AND deptype = 'o'
  ) THEN
    RAISE EXCEPTION 'HFM_MEMORY_READER_GROUP_MUST_NOT_OWN_DATABASE_OBJECTS';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'mira_hfm_memory_reader_login'
  ) THEN
    CREATE ROLE mira_hfm_memory_reader_login
      LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;

  SELECT oid INTO login_oid
  FROM pg_roles
  WHERE rolname = 'mira_hfm_memory_reader_login';

  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE oid = login_oid
      AND (NOT rolcanlogin OR NOT rolinherit OR rolsuper OR rolcreatedb OR
           rolcreaterole OR rolreplication OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'HFM_MEMORY_READER_LOGIN_ATTRIBUTES_NOT_LEAST_PRIVILEGE';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_auth_members
    WHERE member = login_oid
      AND (roleid <> reader_oid OR admin_option OR NOT inherit_option)
  ) THEN
    RAISE EXCEPTION 'HFM_MEMORY_READER_LOGIN_HAS_UNEXPECTED_ROLE_MEMBERSHIP';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_shdepend
    WHERE refclassid = 'pg_authid'::regclass
      AND refobjid = login_oid
      AND deptype = 'o'
  ) THEN
    RAISE EXCEPTION 'HFM_MEMORY_READER_LOGIN_MUST_NOT_OWN_DATABASE_OBJECTS';
  END IF;
END;
$$;

GRANT mira_hfm_memory_reader TO mira_hfm_memory_reader_login;

COMMENT ON ROLE mira_hfm_memory_reader_login IS
  'HFM dedicated LOGIN principal; inherits only mira_hfm_memory_reader. Configure password out-of-band; never store credentials in migrations.';

COMMIT;
