# Render Deployment Readiness — Herness AI

Status: PREPARATION ONLY. No Render service, environment variable, secret, deployment, or production data was changed.

## Scope
Target repository: `Shahed216215/herness-ai`
Target branch: `work/render-host-binding-env-compat-audit`
Base branch: `main`

## Patch
- Render-specific host binding uses `0.0.0.0`.
- Non-Render local default remains `127.0.0.1`.
- Explicit `HOST` override remains supported.
- No provider selection, credentials, worker behavior, storage, or data paths changed.

## Existing Render environment variable compatibility

| Variable | Code evidence / status |
|---|---|
| AI_PROVIDER | Read by provider router; set to `groq` only after confirming provider config precedence |
| GROQ_API_KEY | Read by Groq provider |
| GROQ_MODEL | Read by Groq provider |
| MIRA_ACCESS_TOKEN | Read by admin API auth |
| MIRA_ADMIN_TOKEN | Read by admin API auth |
| MIRA_ADMIN_USERNAME | Read by session auth |
| MIRA_ADMIN_PASSWORD | Read by session auth |
| MIRA_SESSION_SECRET | Required in production; minimum 32 characters |
| TAVILY_API_KEY | Read by web search |
| GOOGLE_CLIENT_ID | Not read by current Google Drive adapter |
| GOOGLE_CLIENT_SECRET | Not read by current Google Drive adapter |
| SUPABASE_URL | No use confirmed in inspected source |
| SUPABASE_SERVICE_ROLE_KEY | No use confirmed in inspected source |
| MIRA_FACEBOOK_RESEARCH_MEMORY_BACKEND | No use confirmed in inspected source |

## Additional deployment blockers / review items
1. Gemini adapter reads `GEMINI_API_KEY`; the supplied environment-name list does not include it. Groq is the suitable configured provider candidate, but the effective provider selection must be verified against `provider-runtime-config.json`.
2. Google Drive adapter requires both `client_secret.json` and `google-token.json` (or equivalents under `/etc/secrets`). The two Google OAuth environment variables alone are not sufficient in the current implementation.
3. Supabase and Facebook Research Memory backend integrations are not established by the inspected source. Do not claim these features are live/persistent until implementation and tests prove it.
4. The autonomous worker starts from the server listen callback only when `MIRA_AUTONOMOUS_WORKER_ENABLED=true`; keep it disabled during initial deployment validation unless separately approved.
5. Render persistent disk / storage strategy must be decided before relying on local JSON or generated report files. Free instance ephemeral storage must not be treated as durable memory.

## Offline validation plan
Run in a clean checkout of this branch:
- `node tests/render-host-binding-contract.test.js`
- `npm test`
- `npm start` with production-like env and no real provider credentials; confirm startup and health endpoint without sending provider requests.
- Verify no worker starts unless explicitly enabled.
- Confirm no secret values are printed in logs.

## Deployment gate
Do not switch the existing Render service repository until:
- branch tests pass;
- `MIRA_SESSION_SECRET` length is confirmed in Render UI without disclosing its value;
- effective `AI_PROVIDER` is confirmed as `groq` and Groq credentials remain untouched;
- Google Drive file-based OAuth dependency is either deliberately provisioned as secret files or explicitly accepted as unavailable;
- Supabase/Facebook integration gaps are accepted or separately implemented;
- a rollback path to `Shahed216215/ai-agent@main` is recorded.

No secrets are copied, revealed, rotated, or modified by this patch.
