# Neon GitHub Actions Read-only Integration Setup

Date: 2026-11-06

## Scope

This workflow is manual-only and is restricted to `main`. It checks the Node.js
PostgreSQL adapter against the disposable Neon branch created for HFM validation.
It does not use Render, the production branch, or the production application URL.

The test accepts only this exact disposable endpoint host:

`ep-square-river-a1m3fhob.ap-southeast-1.aws.neon.tech`

It also requires database `neondb`, role `mira_hfm_runtime`, the four HFM
authority tables, a read-only inspection transaction, and PostgreSQL SQLSTATE
`25006` when attempting temporary DDL inside a read-only transaction.

## One-time GitHub secret setup

A repository secret cannot be created through the connected GitHub actions
available to this session. A repository owner must add it directly in GitHub:

1. Open the repository Settings.
2. Open Secrets and variables, then Actions.
3. Select New repository secret.
4. Name it exactly `MIRA_HFM_TEST_DATABASE_URL`.
5. In Neon Console, select the disposable branch `mira-hfm-test`, database
   `neondb`, and role `mira_hfm_runtime`. Copy its direct (non-pooled)
   PostgreSQL connection string with SSL required.
6. Paste that value directly into the GitHub secret value field. Do not paste it
   into a chat, issue, commit, workflow log, or repository file.

The test checks the exact disposable endpoint hostname before connecting, so a
production connection string is rejected before network access.

## Run

This workflow becomes manually runnable only after this workflow and the
adapter/test code are present on the repository default branch `main`.
Open Actions, select **Mira HFM Neon read-only integration**, select the
`main` branch, and choose Run workflow.

The secret is exposed only to the single integration-test step. Dependency
installation and offline unit tests do not receive it. Workflow permissions
are limited to repository contents read access.

## Expected evidence

- `HFM_NEON_NODE_ADAPTER_CONNECT=PASS`
- `HFM_NEON_NODE_ADAPTER_SCHEMA_INSPECTION=PASS`
- `HFM_NEON_NODE_ADAPTER_READ_ONLY_WRITE_BLOCK=PASS`

A missing secret, wrong endpoint, wrong role, or failed permission check must
fail the workflow. No connection string, password, or raw driver error is
printed.
