-- Run only AFTER 001_project_authority_registry.sql has been reviewed and
-- applied to a disposable Neon branch. Do not run this against production
-- until the separate deployment approval gate passes.
--
-- Create the mira_hfm_runtime login role in Neon first and set its password
-- in the Neon dashboard. Never commit a password or connection string.
--
-- Execute these grants as the schema/database owner.

GRANT CONNECT ON DATABASE neondb TO mira_hfm_runtime;
GRANT USAGE ON SCHEMA mira_hfm TO mira_hfm_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA mira_hfm TO mira_hfm_runtime;

-- Future HFM tables created by the current migration owner remain read-only
-- for the runtime role unless a separately reviewed grant is added.
ALTER DEFAULT PRIVILEGES IN SCHEMA mira_hfm
  GRANT SELECT ON TABLES TO mira_hfm_runtime;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA mira_hfm FROM mira_hfm_runtime;

REVOKE CREATE ON SCHEMA mira_hfm FROM mira_hfm_runtime;
