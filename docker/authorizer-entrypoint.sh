#!/bin/sh
# Starts the identity provider with the keypair from the volume.
#
# Authorizer v2 is configured entirely by command-line flags — environment
# variables are not read — and the JWT key is passed by value rather than by
# path. That makes a plain compose `command:` awkward: the key is multi-line,
# and the custom token script below is a JavaScript function full of the
# characters YAML and the shell both want to interpret. Keeping it in a script
# means the quoting is written once, here, where it can be read.
#
# Everything else comes from the environment this is started with, so nothing
# secret is in the file.
set -eu

: "${AUTHORIZER_URL:?the provider's own canonical URL}"
: "${AUTHORIZER_CLIENT_ID:?}"
: "${AUTHORIZER_CLIENT_SECRET:?}"
: "${AUTHORIZER_ADMIN_SECRET:?}"
: "${AUTHORIZER_ENCRYPTION_KEY:?}"
: "${AUTHORIZER_DATABASE_URL:?}"

# Identity and roles arrive on two different tokens by default: the access
# token carries `roles` but no `email`, the id token the reverse. OpenATS
# reads both from the access token, so this copies the identity claims onto
# it. Without it every sign-in fails — 403 for a missing email claim.
CLAIM_BRIDGE='function(user, tokenPayload){ var d = tokenPayload; d.email = user.email; d.given_name = user.given_name; d.family_name = user.family_name; return d; }'

exec ./authorizer \
  --url="$AUTHORIZER_URL" \
  --http-port=8080 \
  --database-type=postgres \
  --database-url="$AUTHORIZER_DATABASE_URL" \
  --client-id="$AUTHORIZER_CLIENT_ID" \
  --client-secret="$AUTHORIZER_CLIENT_SECRET" \
  --admin-secret="$AUTHORIZER_ADMIN_SECRET" \
  --encryption-key="$AUTHORIZER_ENCRYPTION_KEY" \
  --jwt-type=RS256 \
  --jwt-private-key="$(cat /keys/private.pem)" \
  --jwt-public-key="$(cat /keys/public.pem)" \
  --custom-access-token-script="$CLAIM_BRIDGE" \
  --roles="${AUTHORIZER_ROLES:-super_admin,hiring_manager,interviewer,client_admin,client_reviewer}" \
  --default-roles="${AUTHORIZER_DEFAULT_ROLES:-interviewer}" \
  --allowed-origins="${AUTHORIZER_ALLOWED_ORIGINS:?the app origins allowed to talk to it}" \
  --redirect-uris="${AUTHORIZER_REDIRECT_URIS:?}" \
  --app-cookie-same-site="${AUTHORIZER_COOKIE_SAME_SITE:-lax}" \
  --app-cookie-secure="${AUTHORIZER_COOKIE_SECURE:-true}" \
  --admin-cookie-secure="${AUTHORIZER_COOKIE_SECURE:-true}" \
  --disable-mfa \
  --disable-totp-login \
  --disable-email-otp
