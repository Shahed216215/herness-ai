#!/usr/bin/env bash
set -euo pipefail

PG="${1:?PostgreSQL service container id is required}"
ACTOR="${2:?Trusted CI actor is required}"

# A denied/failed standing read is persisted in a separate transaction after
# the protected read transaction rolls back.
docker exec "$PG" psql -v ON_ERROR_STOP=1 -U postgres -d neondb -c "BEGIN; SET LOCAL ROLE mira_hfm_memory_reader_login; SELECT set_config('mira.project_id', 'project-ci', true); SELECT set_config('mira.actor_id', '$ACTOR', true); SELECT set_config('mira.operation', 'memory.read', true); SELECT set_config('mira.resource', 'memory:project:project-ci', true); SELECT set_config('mira.request_id', 'ci-standing-denied-request', true); SELECT set_config('mira.standing_read_authority', 'true', true); INSERT INTO mira_hfm.authority_audit_events (event_id, project_id, actor_id, event_type, request_id, occurred_at, details) VALUES ('ci-standing-denied-read', 'project-ci', '$ACTOR', 'STANDING_READ_AUTHORITY_DENIED', 'ci-standing-denied-request', clock_timestamp(), jsonb_build_object('operation','memory.read','resource','memory:project:project-ci','decision','DENY')); COMMIT"
docker exec "$PG" psql -v ON_ERROR_STOP=1 -U postgres -d neondb -c "SELECT 1 / CASE WHEN (SELECT count(*) FROM mira_hfm.authority_audit_events WHERE event_id = 'ci-standing-denied-read' AND event_type = 'STANDING_READ_AUTHORITY_DENIED' AND request_id = 'ci-standing-denied-request') = 1 THEN 1 ELSE 0 END"

if docker exec "$PG" psql -v ON_ERROR_STOP=1 -U postgres -d neondb -c "BEGIN; SET LOCAL ROLE mira_hfm_memory_reader_login; SELECT set_config('mira.project_id', 'project-ci', true); SELECT set_config('mira.actor_id', '$ACTOR', true); SELECT set_config('mira.operation', 'memory.read', true); SELECT set_config('mira.resource', 'memory:project:project-ci', true); SELECT set_config('mira.request_id', 'ci-standing-denied-other-request', true); SELECT set_config('mira.standing_read_authority', 'true', true); INSERT INTO mira_hfm.authority_audit_events (event_id, project_id, actor_id, event_type, request_id, occurred_at, details) VALUES ('ci-standing-denied-wrong-request', 'project-ci', '$ACTOR', 'STANDING_READ_AUTHORITY_DENIED', 'ci-standing-denied-request', clock_timestamp(), jsonb_build_object('operation','memory.read','resource','memory:project:project-ci')); COMMIT" >/tmp/hfm-standing-denied-audit-scope.log 2>&1; then
  echo "HFM_CI_STANDING_READ_DENIAL_AUDIT_REQUEST_SCOPE_BYPASSED"
  exit 1
fi

if docker exec "$PG" psql -v ON_ERROR_STOP=1 -U postgres -d neondb -c "BEGIN; SET LOCAL ROLE mira_hfm_memory_reader_login; SELECT set_config('mira.project_id', 'project-ci', true); SELECT set_config('mira.actor_id', '$ACTOR', true); SELECT set_config('mira.operation', 'memory.read', true); SELECT set_config('mira.resource', 'memory:project:project-ci', true); SELECT set_config('mira.request_id', 'ci-standing-denied-no-flag', true); INSERT INTO mira_hfm.authority_audit_events (event_id, project_id, actor_id, event_type, request_id, occurred_at, details) VALUES ('ci-standing-denied-no-flag', 'project-ci', '$ACTOR', 'STANDING_READ_AUTHORITY_DENIED', 'ci-standing-denied-no-flag', clock_timestamp(), jsonb_build_object('operation','memory.read','resource','memory:project:project-ci')); COMMIT" >/tmp/hfm-standing-denied-no-flag.log 2>&1; then
  echo "HFM_CI_STANDING_READ_AUDIT_WITHOUT_STANDING_FLAG_WAS_ALLOWED"
  exit 1
fi

if docker exec "$PG" psql -v ON_ERROR_STOP=1 -U postgres -d neondb -c "BEGIN; SET LOCAL ROLE mira_hfm_memory_reader_login; SELECT set_config('mira.project_id', 'project-ci', true); SELECT set_config('mira.actor_id', '$ACTOR', true); SELECT set_config('mira.operation', 'memory.write', true); SELECT set_config('mira.resource', 'memory:project:project-ci', true); SELECT set_config('mira.request_id', 'ci-standing-denied-wrong-operation', true); SELECT set_config('mira.standing_read_authority', 'true', true); INSERT INTO mira_hfm.authority_audit_events (event_id, project_id, actor_id, event_type, request_id, occurred_at, details) VALUES ('ci-standing-denied-wrong-operation', 'project-ci', '$ACTOR', 'STANDING_READ_AUTHORITY_DENIED', 'ci-standing-denied-wrong-operation', clock_timestamp(), jsonb_build_object('operation','memory.write','resource','memory:project:project-ci')); COMMIT" >/tmp/hfm-standing-denied-wrong-operation.log 2>&1; then
  echo "HFM_CI_STANDING_READ_AUDIT_WRONG_OPERATION_WAS_ALLOWED"
  exit 1
fi

if docker exec "$PG" psql -v ON_ERROR_STOP=1 -U postgres -d neondb -c "BEGIN; SET LOCAL ROLE mira_hfm_memory_reader_login; SELECT set_config('mira.project_id', 'project-ci', true); SELECT set_config('mira.actor_id', '$ACTOR', true); SELECT set_config('mira.operation', 'memory.read', true); SELECT set_config('mira.resource', 'memory:project:project-attacker', true); SELECT set_config('mira.request_id', 'ci-standing-denied-wrong-resource', true); SELECT set_config('mira.standing_read_authority', 'true', true); INSERT INTO mira_hfm.authority_audit_events (event_id, project_id, actor_id, event_type, request_id, occurred_at, details) VALUES ('ci-standing-denied-wrong-resource', 'project-ci', '$ACTOR', 'STANDING_READ_AUTHORITY_DENIED', 'ci-standing-denied-wrong-resource', clock_timestamp(), jsonb_build_object('operation','memory.read','resource','memory:project:project-ci')); COMMIT" >/tmp/hfm-standing-denied-wrong-resource.log 2>&1; then
  echo "HFM_CI_STANDING_READ_AUDIT_WRONG_RESOURCE_WAS_ALLOWED"
  exit 1
fi

echo "HFM_STANDING_READ_DENIED_AUDIT_OPERATION_FLAG_RESOURCE_AND_REQUEST_SCOPE=PASS"
echo "HFM_STANDING_READ_DENIED_ATTEMPT_AUDIT_AND_REQUEST_RLS=PASS"

# The same policy must admit valid successful and failed standing-read outcomes.
docker exec "$PG" psql -v ON_ERROR_STOP=1 -U postgres -d neondb -c "BEGIN; SET LOCAL ROLE mira_hfm_memory_reader_login; SELECT set_config('mira.project_id', 'project-ci', true); SELECT set_config('mira.actor_id', '$ACTOR', true); SELECT set_config('mira.operation', 'memory.read', true); SELECT set_config('mira.resource', 'memory:project:project-ci', true); SELECT set_config('mira.request_id', 'ci-standing-read-outcomes', true); SELECT set_config('mira.standing_read_authority', 'true', true); INSERT INTO mira_hfm.authority_audit_events (event_id, project_id, actor_id, event_type, request_id, occurred_at, details) VALUES ('ci-standing-used-read', 'project-ci', '$ACTOR', 'STANDING_READ_AUTHORITY_USED', 'ci-standing-read-outcomes', clock_timestamp(), jsonb_build_object('operation','memory.read','resource','memory:project:project-ci','decision','ALLOW')), ('ci-standing-failed-read', 'project-ci', '$ACTOR', 'STANDING_READ_AUTHORITY_FAILED', 'ci-standing-read-outcomes', clock_timestamp(), jsonb_build_object('operation','memory.read','resource','memory:project:project-ci','decision','FAILED')); COMMIT"
docker exec "$PG" psql -v ON_ERROR_STOP=1 -U postgres -d neondb -c "SELECT 1 / CASE WHEN (SELECT count(*) FROM mira_hfm.authority_audit_events WHERE request_id = 'ci-standing-read-outcomes' AND event_type IN ('STANDING_READ_AUTHORITY_USED','STANDING_READ_AUTHORITY_FAILED')) = 2 THEN 1 ELSE 0 END"
echo "HFM_STANDING_READ_USED_AND_FAILED_AUDIT_RLS=PASS"
