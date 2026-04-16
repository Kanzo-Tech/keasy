# keasy infra

Production deployment notes for keasy. This directory holds the Caddy
configuration, Keycloak realm import, and database seed scripts.

## Cloud storage requirements (CORS)

Keasy is cloud-centric: every connector points at S3, GCS, Azure Blob, or
an S3-compatible store like MinIO (used in dev). The participant's browser
runs DuckDB-WASM and reads parquet files **directly from the cloud bucket**
via short-lived presigned URLs (15 min TTL, issued by `GET
/v1/jobs/{id}/discover/urls`). For this to work, every bucket that hosts
job output must allow cross-origin range reads from the keasy frontend
origin.

This is the same pattern used by Hugging Face Datasets, GitHub LFS, Kaggle,
and is the recommended approach in the official DuckDB-WASM docs. CORS is
configured **once per bucket** at deployment time and does not need to be
touched per job or per user.

### Required CORS rule

For every bucket referenced by a keasy connector:

| Field | Value |
|---|---|
| `AllowedMethods` | `GET`, `HEAD` |
| `AllowedOrigins` | `https://<your-keasy-domain>` (e.g. `https://keasy.example.com`) |
| `AllowedHeaders` | `*` (or at minimum `Range`, `If-None-Match`) |
| `ExposeHeaders` | `Content-Length`, `Content-Range`, `Content-Type`, `ETag`, `Accept-Ranges` |
| `MaxAgeSeconds` | `3600` (or higher) |

The `ExposeHeaders` list is **load-bearing**: without `Content-Range` and
`Accept-Ranges`, DuckDB-WASM's httpfs cannot perform the range reads that
make lazy parquet access work. Symptoms of missing CORS or missing exposed
headers: the dashboard loads parquets in full instead of streaming row
groups, or the network panel shows blocked requests.

### Per-cloud setup commands

#### AWS S3

```bash
cat > /tmp/cors.json <<'EOF'
{
  "CORSRules": [{
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedOrigins": ["https://keasy.example.com"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["Content-Length", "Content-Range", "Content-Type", "ETag", "Accept-Ranges"],
    "MaxAgeSeconds": 3600
  }]
}
EOF
aws s3api put-bucket-cors --bucket my-bucket --cors-configuration file:///tmp/cors.json
```

#### Google Cloud Storage

```bash
cat > /tmp/cors.json <<'EOF'
[{
  "origin": ["https://keasy.example.com"],
  "method": ["GET", "HEAD"],
  "responseHeader": ["Content-Length", "Content-Range", "Content-Type", "ETag", "Accept-Ranges"],
  "maxAgeSeconds": 3600
}]
EOF
gcloud storage buckets update gs://my-bucket --cors-file=/tmp/cors.json
```

##### GCS dual credentials (why GCS connectors need two credential forms)

Unlike S3 and Azure, a GCS connector in keasy stores **two separate
credentials** because DuckDB and `object_store` speak different Google
protocols:

| Consumer | Credential | Used for |
|---|---|---|
| `object_store::GoogleCloudStorageBuilder` | `service_account_json` | Rust-side reads, browser URL signing (presigned URLs) |
| DuckDB `CREATE SECRET TYPE gcs` | `hmac_key_id` + `hmac_secret` (HMAC interop) | `read_parquet('gs://...')` / `COPY ... TO 'gs://...'` in the job runtime |

DuckDB's `httpfs` GCS extension does **not** accept service account JSON
— this is tracked in [DuckDB discussion #15381](https://github.com/duckdb/duckdb/discussions/15381).
The workaround, documented by Rill Data's own GCS driver
([`runtime/drivers/gcs/gcs.go`](https://github.com/rilldata/rill/blob/main/runtime/drivers/gcs/gcs.go)),
is exactly what keasy does: store both credential forms per connection
and route each to the consumer that accepts it.

**Which do you need?**

- Only `service_account_json` → server-side reads via `object_store` and
  browser presigned URLs work; server-side DuckDB reads from
  `@<connector>/file.parquet` **fail** because the job runtime's DuckDB
  cannot authenticate to GCS.
- Only `hmac_key_id` + `hmac_secret` → DuckDB job reads work; URL signing
  for the browser **fails** because `object_store::GoogleCloudStorageBuilder`
  has no HMAC setter.
- Both → full functionality.

Keasy's `GcsConnector::validate` requires **at least one** set but
recommends both. For production we recommend both.

**Generating HMAC keys for a service account** (GCP Console):

1. Go to **Cloud Storage → Settings → Interoperability** in the GCP
   console of the project that owns the bucket.
2. Under **Access keys for service accounts**, click *Create a key for a
   service account* and select the service account that already has
   bucket access (or create a new one and grant `roles/storage.objectUser`).
3. Copy the Access Key ID → keasy `hmac_key_id`, Secret → `hmac_secret`.
4. Paste the full service account JSON (from **IAM → Service Accounts →
   Keys → Create key → JSON**) into `service_account_json`.

Reference: <https://cloud.google.com/storage/docs/authentication/hmackeys>

#### Azure Blob Storage

```bash
az storage cors add \
  --services b \
  --methods GET HEAD \
  --origins https://keasy.example.com \
  --allowed-headers '*' \
  --exposed-headers 'Content-Length,Content-Range,Content-Type,ETag,Accept-Ranges' \
  --max-age 3600 \
  --account-name myaccount
```

#### MinIO (dev)

The dev `minio-init` sidecar configures CORS automatically from
`infra/seeds/minio-cors.json` on startup. No manual step needed.

## Dev story

`docker-compose -f docker-compose.yml -f docker-compose.dev.yml up`
launches keasy with MinIO as the S3-compatible cloud. The dev-seed creates
two S3 connectors (`dev-bucket` for the promotor org, `acme-bucket` for the
participant org) pointing at `http://minio:9000`. **All keasy code paths
(server-side DuckDB SECRETs, presigned URL generation, browser DuckDB-WASM
reads) work identically against MinIO and against real S3.** When you
deploy to prod, replace the connector config with real S3/GCS/Azure
credentials — no code changes.

The MinIO admin console is exposed at `http://localhost:9001` (login:
`keasy-dev` / `keasy-dev-password`).
