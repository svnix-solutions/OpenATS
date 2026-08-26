# Running a different identity provider

OpenATS is developed against a self-hosted authorizer.dev, but the backend only needs an
OIDC provider — see [ARCHITECTURE.md](./ARCHITECTURE.md#identity-is-a-seam-not-a-dependency).
This is the verified recipe for one alternative, and what to check for any
other.

## What a provider must give you

| Requirement | Why |
| --- | --- |
| **RS256** (or another asymmetric algorithm) | the backend verifies through a JWKS URL; a shared secret has no public key to publish |
| `email` **and** `roles` in the **same** token | the backend reads both from the bearer token it is given |
| A stable `sub` | it becomes `users.provider_user_id` |
| `org_id`, or a single organization | multi-tenant installs map this to an `organizations` row; single-tenant installs attach to the only one |

The second row is the one that bites. OIDC usually puts identity in the id
token and roles wherever the vendor likes; needing both in one token is an
assumption OpenATS inherited from its first provider.

## authorizer.dev — verified

Self-hosted, one container. Run it against the same Postgres:

```bash
docker exec openats-postgres psql -U openats -d openats -c "CREATE DATABASE authorizer;"

# RS256 keypair — the backend verifies via JWKS, so this cannot be a secret.
openssl genrsa -out authz-private.pem 2048
openssl rsa -in authz-private.pem -pubout -out authz-public.pem

docker run -d --name openats-authorizer \
  --network openats_default -p 8090:8080 \
  lakhansamani/authorizer:latest \
    --url=http://localhost:8090 --http-port=8080 \
    --database-type=postgres \
    --database-url="postgresql://openats:openats@postgres:5432/authorizer?sslmode=disable" \
    --admin-secret=CHANGE_ME \
    --encryption-key="$(openssl rand -hex 32)" \
    --client-id="$(uuidgen)" --client-secret="$(openssl rand -hex 24)" \
    --jwt-type=RS256 \
    --jwt-private-key="$(cat authz-private.pem)" \
    --jwt-public-key="$(cat authz-public.pem)" \
    --roles=super_admin,hiring_manager,interviewer,client_admin,client_reviewer \
    --default-roles=super_admin \
    --disable-mfa --disable-totp-login --disable-email-otp \
    --custom-access-token-script='function(user, tokenPayload){ var d = tokenPayload; d.email = user.email; d.given_name = user.given_name; d.family_name = user.family_name; return d; }' \
    --allowed-origins=http://localhost:3000,http://localhost:8080 \
    --redirect-uris=http://localhost:3000/api/auth/callback \
    --app-cookie-secure=false --admin-cookie-secure=false --app-cookie-same-site=lax
```

Then point the backend at it:

```
OIDC_JWKS_URL=http://localhost:8090/.well-known/jwks.json
OIDC_ISSUER=http://localhost:8090
```

**That is the whole backend change.** With those two variables repointed, the
authenticated API — reads and writes — works against authorizer.dev tokens
with no code modified.

### Five things that cost time, so you do not repeat them

- **It reads flags, not environment variables.** `DATABASE_TYPE=…` in the
  environment is ignored once you pass any flag; everything above is a flag for
  that reason.
- **`--url` is mandatory.** It refuses to start without a canonical URL rather
  than deriving one from request headers, which would be host-header injection.
  A good default, but not an optional one.
- **`--encryption-key` is mandatory** for RS256, because there is no
  `--jwt-secret` to fall back on.
- **MFA is on by default.** Login returns `"Proceed to mfa setup"` and no
  token until `--disable-mfa` is set. Correct for production; blocks a headless
  demo.
- **Cookies default to `Secure`**, so sign-in over plain `http://localhost`
  needs `--app-cookie-secure=false`.

### The claim-shape problem, concretely

Without the custom script, neither token satisfies the backend:

```
access_token → { roles: ["super_admin"], email: null }   → 403 missing email claim
id_token     → { email: "…",  roles: null }              → 403 no role assigned
```

`--custom-access-token-script` copies the identity claims onto the access
token, after which `/api/users/me` returns 200 and provisions the user.

### The admin API, for user management

Creating and changing users uses the admin GraphQL API with the
`x-authorizer-admin-secret` header — `_users`, `_update_user`, `_delete_user`,
and `signup` for creation, since there is no admin-side create.

`Origin` must be set explicitly on those calls. Authorizer refuses
state-changing requests carrying neither `Origin` nor `Referer`, and a
server-to-server fetch sends neither — the same rule that stops its own SDK
logging in from Node.

Roles live in two places and mean different things. The provider's copy seeds a
membership at first sign-in; `organization_members.role` is what governs
access afterwards. Changing a role writes both: the provider for an account
that has not signed in yet, the membership for everyone who has.

### What this does not cover

- Authorizer's own multi-tenancy was not evaluated. It has the pieces —
  `_organizations`, `_org_members`, `_user_organizations`, even a
  `_scim_endpoint` — but OpenATS keeps organizations in its own tables and only
  needs a stable claim to map them, so none of it was required here. For a
  single-agency install it does not matter at all: sign-in attaches to the only
  organization.

## Other candidates, not yet verified

- **Zitadel** — organizations are first-class, which maps closely onto
  agency-as-tenant. Self-hosted.
- **Keycloak** — the mature default; OIDC, roles in tokens, full admin API.
- **Logto** — lighter, has organizations.
- **WorkOS** — hosted, built for this B2B shape, SCIM included.

Each would need the same two checks: asymmetric signing, and whether email and
roles can be made to arrive in one token.
