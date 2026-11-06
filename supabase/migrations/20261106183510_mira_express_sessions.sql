-- Mira Express session persistence (zero-additional-resource design)
-- Uses the existing Supabase project through its HTTPS Data API.
-- Only the server-side service_role may access this table; it is not client-readable.

BEGIN;

CREATE TABLE IF NOT EXISTS public.mira_express_sessions (
  sid varchar NOT NULL,
  sess json NOT NULL,
  expire timestamp(6) with time zone NOT NULL,
  CONSTRAINT mira_express_sessions_pkey PRIMARY KEY (sid)
);

CREATE INDEX IF NOT EXISTS mira_express_sessions_expire_idx
  ON public.mira_express_sessions (expire);

ALTER TABLE public.mira_express_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.mira_express_sessions
  FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.mira_express_sessions TO service_role;

COMMENT ON TABLE public.mira_express_sessions IS
  'Private Express session persistence for Mira; service_role only; never expose session payloads to browser clients.';

COMMIT;
