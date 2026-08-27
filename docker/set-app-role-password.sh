#!/bin/sh
# Gives the application role the password the deployment chose.
#
# `init-app-role.sql` creates `openats_app` with a fixed password, which is
# right for a local container nobody can reach and wrong for anything else.
# This runs after it (initdb scripts execute in lexical order, and this is
# mounted as 20-) and replaces the password with APP_DATABASE_PASSWORD.
#
# The role itself is still defined in one place — the SQL — so the grants and
# the reasoning behind the least-privileged role do not get duplicated here.
# Only the secret is overridden.
#
# Like the SQL, this runs only for a container with an empty data directory.
# On an existing database, change it by hand:
#   ALTER ROLE openats_app PASSWORD '…';
set -eu

if [ -z "${APP_DATABASE_PASSWORD:-}" ]; then
  echo "[init] APP_DATABASE_PASSWORD is unset; leaving the default password."
  echo "[init] That is only safe if this database is unreachable from anywhere else."
  exit 0
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
ALTER ROLE openats_app PASSWORD '${APP_DATABASE_PASSWORD}';
SQL

echo "[init] openats_app password set from APP_DATABASE_PASSWORD."
