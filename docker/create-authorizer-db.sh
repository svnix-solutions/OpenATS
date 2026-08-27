#!/bin/sh
# Gives the identity provider its own database on the same Postgres.
#
# Separate database, not a schema: it runs its own migrations and owns its
# tables, and nothing in OpenATS reads them. Sharing the server keeps the
# stack to one Postgres; sharing the database would entangle two migration
# histories that know nothing about each other.
#
# Runs once, on a container with an empty data directory, like the others.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
SELECT 'CREATE DATABASE authorizer'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'authorizer')\gexec
SQL

echo "[init] authorizer database ready."
