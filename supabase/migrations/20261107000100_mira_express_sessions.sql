-- MIRA Express session persistence
-- Target: Supabase development branch only.
-- Runtime access is intended through the PostgreSQL "postgres" login over
-- the Supabase Session Pooler. This schema is not exposed through PostgREST.
-- Do not apply to production until staging persistence/auth tests pass.

BEGIN;

CREATE SCHEMA mira_auth AUTHORIZATION postgres;

REVOKE ALL ON SCHEMA mira_auth FROM PUBLIC;
REVOKE ALL ON SCHEMA mira_auth FROM anon, authenticated, service_role;

CREATE TABLE mira_auth.express_sessions (
  sid varchar NOT NULL COLLATE "default",
  sess json NOT NULL,
  expire timestamp(6) NOT NULL,
  CONSTRAINT express_sessions_pkey PRIMARY KEY (sid)
);

CREATE INDEX express_sessions_expire_idx
  ON mira_auth.express_sessions (expire);

ALTER TABLE mira_auth.express_sessions OWNER TO postgres;

REVOKE ALL ON TABLE mira_auth.express_sessions
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE mira_auth.express_sessions TO postgres;

COMMIT;
