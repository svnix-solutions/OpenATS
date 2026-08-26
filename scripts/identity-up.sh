#!/usr/bin/env bash
# Starts a local authorizer.dev container for OpenATS sign-in and prints the
# environment it expects. Replaces the 861-line Asgardeo tenant script: the
# provider now runs locally, so there is no hosted tenant to walk anyone
# through.
#
# The backend only needs an OIDC issuer with a JWKS endpoint. Nothing below is
# special to authorizer.dev except the flag names — see
# docs-draft/IDENTITY_PROVIDERS.md for the reasoning behind each one.
set -euo pipefail

NAME=openats-authorizer
PORT=${AUTHORIZER_PORT:-8090}
URL="http://localhost:${PORT}"

if [ "$(docker ps -q -f "name=^${NAME}$")" ]; then
  echo "✅ ${NAME} already running on ${URL}"
  exit 0
fi
docker rm -f "$NAME" >/dev/null 2>&1 || true

# Its own database, on the Postgres that docker-compose already runs.
docker compose up -d postgres >/dev/null
until docker compose exec -T postgres pg_isready -U openats >/dev/null 2>&1; do sleep 1; done
docker compose exec -T postgres psql -U openats -d openats \
  -c "CREATE DATABASE authorizer" >/dev/null 2>&1 || true

# RS256, so the backend verifies through JWKS and never holds a shared secret.
# Regenerated on every fresh start: these are development keys and treating
# them as disposable is what stops one being committed by accident.
KEYDIR=$(mktemp -d)
trap 'rm -rf "$KEYDIR"' EXIT
openssl genrsa -out "$KEYDIR/private.pem" 2048 2>/dev/null
openssl rsa -in "$KEYDIR/private.pem" -pubout -out "$KEYDIR/public.pem" 2>/dev/null

ADMIN_SECRET=$(openssl rand -hex 16)
CLIENT_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')

docker run -d --name "$NAME" \
  --network openats_default -p "${PORT}:8080" \
  lakhansamani/authorizer:latest \
    --url="$URL" --http-port=8080 \
    --database-type=postgres \
    --database-url="postgresql://openats:openats@postgres:5432/authorizer?sslmode=disable" \
    --admin-secret="$ADMIN_SECRET" \
    --encryption-key="$(openssl rand -hex 32)" \
    --client-id="$CLIENT_ID" --client-secret="$(openssl rand -hex 24)" \
    --jwt-type=RS256 \
    --jwt-private-key="$(cat "$KEYDIR/private.pem")" \
    --jwt-public-key="$(cat "$KEYDIR/public.pem")" \
    --roles=super_admin,hiring_manager,interviewer,client_admin,client_reviewer \
    --default-roles=super_admin \
    --disable-mfa --disable-totp-login --disable-email-otp \
    --custom-access-token-script='function(user, tokenPayload){ var d = tokenPayload; d.email = user.email; d.given_name = user.given_name; d.family_name = user.family_name; return d; }' \
    --allowed-origins=http://localhost:3000,http://localhost:8080 \
    --redirect-uris=http://localhost:3000/api/auth/callback \
    --app-cookie-secure=false --admin-cookie-secure=false --app-cookie-same-site=lax >/dev/null

until curl -sf "${URL}/.well-known/jwks.json" >/dev/null; do sleep 1; done

cat <<EOF

✅ Identity provider running at ${URL}

Add to backend/.env:
  OIDC_JWKS_URL=${URL}/.well-known/jwks.json
  OIDC_ISSUER=${URL}

Add to frontend/.env:
  NEXT_PUBLIC_AUTHORIZER_URL=${URL}
  NEXT_PUBLIC_AUTHORIZER_CLIENT_ID=${CLIENT_ID}
  AUTHORIZER_ADMIN_SECRET=${ADMIN_SECRET}

Create your first user at ${URL}/app — it gets the super_admin role.
EOF
