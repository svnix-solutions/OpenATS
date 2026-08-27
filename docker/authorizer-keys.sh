#!/bin/sh
# Generates the RSA keypair the identity provider signs tokens with.
#
# Authorizer takes the key as a flag value, not a path, and it does not
# generate one: started with --jwt-type=RS256 and no key it exits with
# "missing jwt private key". Asking an operator to paste a PEM into a
# deployment's environment is worse than doing it here — multi-line values do
# not survive an env file, and the key would then live in whatever stores it.
#
# RS256 rather than HS256 because OpenATS verifies through the provider's JWKS
# endpoint, which needs an asymmetric key. There is no public key to publish
# for a shared secret.
#
# Runs once. The keypair lives in a volume, so restarts and redeploys keep the
# same key and existing sessions stay valid. Deleting that volume invalidates
# every issued token, which is the fire drill if the key is ever exposed.
set -eu

if [ -s /keys/private.pem ] && [ -s /keys/public.pem ]; then
  echo "[authorizer-keys] keypair already present; leaving it alone."
  exit 0
fi

echo "[authorizer-keys] generating an RS256 keypair…"
openssl genrsa -out /keys/private.pem 2048
openssl rsa -in /keys/private.pem -pubout -out /keys/public.pem
# World-readable on purpose: authorizer runs as its own user and only needs to
# read them. The volume is the boundary, not the file mode.
chmod 0444 /keys/private.pem /keys/public.pem
echo "[authorizer-keys] done."
