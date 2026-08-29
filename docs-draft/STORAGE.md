# Object storage

CVs and logos go to an S3-compatible bucket. The variables are named `R2_*`
because Cloudflare R2 is what this was built against, but nothing in the code
is specific to it: `backend/src/shared/services/r2.service.ts` is
`@aws-sdk/client-s3` with `PutObject` and `DeleteObject`, pointed at whatever
`R2_ENDPOINT` says, and the URLs it hands back are `R2_PUBLIC_URL` plus a key.

Backblaze B2, MinIO, DigitalOcean Spaces and S3 itself all work. Five
variables, and a sixth away from R2:

| Variable | What it is |
| --- | --- |
| `R2_ENDPOINT` | The S3 API endpoint the backend **writes** to |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Application key with read/write on the bucket |
| `R2_BUCKET_NAME` | The bucket |
| `R2_PUBLIC_URL` | The base a **browser** fetches from — often not the endpoint |
| `R2_REGION` | Only away from R2; see below |

## The two that catch people out

**`R2_PUBLIC_URL` is not `R2_ENDPOINT`.** The API writes to one host and
browsers read from another. Get it wrong and uploads succeed while every
avatar and CV link 404s. It is also what `extractKeyFromUrl` matches on, so
deleting a file stops working too — silently, because a URL that does not
start with the configured base is treated as "not ours" and skipped.

**The region is part of the signature.** R2 ignores it and signs everything as
`us-east-1`, which is why it was hardcoded. B2 and MinIO check it against the
endpoint's region, and a mismatch surfaces as `SignatureDoesNotMatch` rather
than anything naming the region. Set `R2_REGION` to match the endpoint. Leave
it blank on R2.

## Backblaze B2

Create a bucket set to **Public** (the app stores public URLs; it does not
sign reads), then an Application Key scoped to it.

```
R2_ENDPOINT=https://s3.us-west-004.backblazeb2.com
R2_REGION=us-west-004
R2_ACCESS_KEY_ID=<keyID>
R2_SECRET_ACCESS_KEY=<applicationKey>
R2_BUCKET_NAME=openats-uploads
R2_PUBLIC_URL=https://f004.backblazeb2.com/file/openats-uploads
```

Both `004`s come from your account and must match each other — B2 hands you
the endpoint when the key is created, and the public host is the same number
with `f` in front. `R2_PUBLIC_URL` includes the bucket name; the S3-style
`https://<bucket>.s3.<region>.backblazeb2.com` works as a base too, without it.

## MinIO / DigitalOcean Spaces

Same shape. MinIO signs against whatever `MINIO_REGION` is set to, default
`us-east-1`. Spaces uses the datacentre as the region (`nyc3`, `fra1`).

```
R2_ENDPOINT=http://minio:9000
R2_REGION=us-east-1
R2_PUBLIC_URL=http://localhost:9000/openats-uploads
```

`forcePathStyle: true` is set unconditionally, which is what MinIO wants and
what B2 and R2 both accept.

## Check it before trusting it

Uploading a resume and a logo exercises the whole path, and the one thing
worth looking at afterwards is **how the URLs open in a browser**. The service
sets `Content-Disposition` deliberately: `inline` for png/jpeg/webp logos,
`attachment` for everything else, so an uploaded `.svg` or `.html` cannot
execute in your origin when its URL is opened directly. That header is stored
on the object, and a provider that drops it turns a stored file into stored
script. Open a CV link and confirm it downloads rather than renders.
