#!/bin/sh
# Control cluster bootstrap for the sandbox manager (ADR 0002).
#
# The manager gets a database and a role of its own on the control cluster: the only
# process with Docker access can read the sandbox records and nothing else — not the
# accounts, not the sessions. Idempotent, so it also upgrades a volume created before the
# manager existed:
#
#   docker compose exec postgres-control sh /docker-entrypoint-initdb.d/01-sandbox-manager.sh
set -eu

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" --dbname postgres \
  -v manager_password="$SANDBOX_MANAGER_DB_PASSWORD" \
  -v app_db="$POSTGRES_DB" <<'SQL'
select 'create role sqlscope_sandbox_manager login'
 where not exists (select from pg_roles where rolname = 'sqlscope_sandbox_manager') \gexec
-- Also on reruns, so rotating the password is a matter of running this again.
select format('alter role sqlscope_sandbox_manager password %L', :'manager_password') \gexec

select 'create database sqlscope_sandboxes owner sqlscope_sandbox_manager'
 where not exists (select from pg_database where datname = 'sqlscope_sandboxes') \gexec

-- Nobody connects where they were not granted to: the manager only to its own database,
-- and the API's role is the cluster owner.
revoke connect on database sqlscope_sandboxes from public;
revoke connect on database :"app_db" from public;
revoke connect on database postgres from public;
revoke connect on database template1 from public;
grant connect on database sqlscope_sandboxes to sqlscope_sandbox_manager;
SQL
