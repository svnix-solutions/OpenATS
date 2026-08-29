# Object storage

CVs and logos go to an S3-compatible bucket. The variables are named `R2_*`
because Cloudflare R2 is what this was built against, but nothing in the code
is specific to it: `backend/src/shared/services/r2.service.ts` is
`@aws-sdk/client-s3` pointed at whatever `R2_ENDPOINT` says.

Backblaze B2, MinIO, DigitalOcean Spaces and S3 itself all work.

| Variable | What it is |
| --- | --- |
| `R2_ENDPOINT` | The S3 API endpoint the backend **writes** to |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Application key with read/write on the bucket |
| `R2_BUCKET_NAME` | The bucket |
| `R2_PUBLIC_URL` | The base a **browser** fetches from — see below, this is the important one |
| `R2_REGION` | Only where the provider checks it — not R2, not B2 |

## Keep the bucket private

`R2_PUBLIC_URL` is not a cosmetic setting. It decides whether every CV your
customers upload is readable by anyone who has ever seen its URL.

Set it to the application's own `/api/files`:

```
R2_PUBLIC_URL=https://app.example.com/api/files
```

Then the bucket needs no public access at all. A stored `resume_url` addresses
the app, reading one is authorized, and the answer is a redirect to a signed
URL that expires — fifteen minutes for a CV, an hour for a logo. The bytes
still travel from the bucket to the browser directly, so nothing is proxied and
byte-range requests, which every PDF viewer makes, stay the bucket's problem.

Three parts, and they are worth knowing apart:

| | |
| --- | --- |
| `frontend/app/api/files/[...key]/route.ts` | Where the browser asks. It exists because a CV is opened in an `<iframe src>` and a logo in an `<img src>`, and a browser attaches no `Authorization` header to either — but it does send this app's session cookie. Forwards the token; proxies no bytes. |
| `backend/src/modules/file/file.routes.ts` | Where it is decided. `logos/` is anonymous, `resumes/` is not. |
| `canReadResumeKey` in `shared/auth/job-access.ts` | The rule. Finds the candidate the key belongs to — through the tenancy policy, so another organization's key simply is not there — then follows that person's applications. |

**Logos are readable by anyone holding the key, across tenants.** They render on
`/careers/:slug` for visitors with no account and in the `/public/clients` feed
an agency points its own website at. That is what a brand mark on a public
careers page already is. CVs are the ones the authorization is for.

A world-readable bucket still works — point `R2_PUBLIC_URL` at the CDN host and
the app never sees the read. It is the wrong default for anything holding CVs.

### Moving an existing install to a private bucket

The rows hold whole URLs rather than keys, so the base in them is whatever it
was on the day each file was uploaded. Changing `R2_PUBLIC_URL` does not
retroactively change them, and they 403 the moment the bucket stops being
public. Repoint them:

```bash
cd backend
pnpm rewrite-file-urls          # report, change nothing
pnpm rewrite-file-urls --apply
```

It runs as the migration role, like the seed and provisioning, and for the same
reason: it has to see every organization's rows, and the application role
correctly sees none outside a request.

Then turn off public access on the bucket, and check a CV still opens.

## The two that catch people out

**`R2_PUBLIC_URL` is not `R2_ENDPOINT`.** The API writes to one host and
browsers read from another. Get it wrong and uploads succeed while every avatar
and CV 404s.

**The region is part of the signature — for some providers.** R2 ignores it and
signs everything as `us-east-1`, which is why it was hardcoded, and **Backblaze
B2 ignores it too**: verified against a live bucket, where `PutObject`,
`GetObject` and a presigned read all succeed with the region set to `us-east-1`
against a `eu-central-003` endpoint. AWS S3 does check it, and MinIO checks when
one is configured; there a mismatch surfaces as `SignatureDoesNotMatch` or
`AuthorizationHeaderMalformed`, neither of which names the region, so it reads
as bad credentials. Set `R2_REGION` to match the endpoint on those; leave it
blank on R2 and B2.

## Backblaze B2

Create a **private** bucket, then an Application Key scoped to it.

```
R2_ENDPOINT=https://s3.eu-central-003.backblazeb2.com
R2_ACCESS_KEY_ID=<keyID>
R2_SECRET_ACCESS_KEY=<applicationKey>
R2_BUCKET_NAME=openats-uploads
R2_PUBLIC_URL=https://app.example.com/api/files
```

The endpoint is whatever B2 shows when the key is created; the region in its
hostname is not something you have to repeat in `R2_REGION`, because B2 does not
check it. Setting it anyway is harmless.

Verified against a live B2 bucket: upload, download, presigned read, delete, and
`Content-Disposition` surviving the round trip both on `GetObject` and over HTTP
— so the inline/attachment split that stops an uploaded `.svg` executing in your
origin does hold on B2. An unsigned read of a private bucket returns `401`.

## MinIO / DigitalOcean Spaces

Same shape. MinIO signs against whatever `MINIO_REGION` is set to, default
`us-east-1`. Spaces uses the datacentre as the region (`nyc3`, `fra1`).

```
R2_ENDPOINT=http://minio:9000
R2_REGION=us-east-1
R2_PUBLIC_URL=http://localhost:3000/api/files
```

`forcePathStyle: true` is set unconditionally, which is what MinIO wants and
what B2 and R2 both accept.

## Check it before trusting it

Upload a CV and a logo, then **open the CV's URL in a private window**. It must
not load. If it does, the bucket is still public and `R2_PUBLIC_URL` is
pointing past the application.

Worth confirming too: signed out, a logo on `/careers/:slug` still renders. The
two are the whole design — one folder public, one not — and they fail in
opposite directions.

The service also sets `Content-Disposition` deliberately: `inline` for
png/jpeg/webp logos, `attachment` for everything else, so an uploaded `.svg`
cannot execute in your origin when its URL is opened. A provider that drops
that header turns a stored file into stored script.
