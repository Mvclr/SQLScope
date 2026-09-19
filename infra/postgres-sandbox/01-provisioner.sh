#!/bin/sh
# T1 cluster bootstrap (ADR 0001).
#
# The API never connects as superuser. It uses a provisioner role that can create the
# per-session databases and roles, and — since PostgreSQL 16 — can only administer the
# roles it created itself.
set -eu

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v provisioner_password="$SANDBOX_PROVISIONER_PASSWORD" <<'SQL'
create role sqlscope_provisioner login createdb createrole password :'provisioner_password';

-- No role connects anywhere by default; each session role is granted its own database.
revoke connect on database postgres from public;
revoke connect on database template1 from public;
grant connect on database postgres to sqlscope_provisioner;
SQL
