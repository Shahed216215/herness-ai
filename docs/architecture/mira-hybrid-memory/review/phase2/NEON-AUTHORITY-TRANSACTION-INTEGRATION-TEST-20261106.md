# HFM Neon Authority Integration Test

**Status:** manual disposable-branch test; not a production migration or runtime feature.

## Scope

`tests/mira-hfm-authority-neon-integration.test.js` executes the existing
`executeWithConsumedAuthority` implementation against a real PostgreSQL
transaction on the dedicated Neon branch `mira-hfm-test`.

It checks:

- the expected database, host, and least-privilege test role;
- the four HFM authority-registry tables;
- successful one-time authority consumption and append-only audit insertion;
- replay rejection without a second audit event;
- rollback of authority consumption and audit insertion when the protected callback fails;
- concurrent attempts against one authority result in exactly one commit.

The callback uses only the supplied PostgreSQL client. Its probe table is a
session-local temporary table and is dropped on commit/session close.

## Credential boundary

The test requires the repository Actions secret
`MIRA_HFM_AUTHORITY_TEST_DATABASE_URL`, using the dedicated role
`mira_hfm_it_runner`. That role must be scoped to database `neondb` and
schema `mira_hfm` with read/write table permissions only. It is not the
application runtime role and must never be configured in Render.

The test refuses any host other than the exact `mira-hfm-test` endpoint,
database other than `neondb`, role other than `mira_hfm_it_runner`, or
connection without SSL.

## Data handling

All fixture IDs are random synthetic values. Fixture owner, membership, and
authority rows are removed after the run. Successful audit events remain in
`authority_audit_events` because that table is append-only; these events
contain only synthetic test identifiers and are intentionally retained on
the disposable branch. No production branch is used.

## Run

After the manual-only workflow is merged to the default branch and the
repository secret is configured, run **Mira HFM Neon authority integration**
manually from the `main` branch.

This test performs database writes only on the exact disposable test branch.
It does not apply migrations, access Memory/Knowledge records, modify Render,
or deploy the application.
