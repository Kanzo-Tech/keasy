# A deployment

keasy runs on one server with Docker, from the same compose files as development: `compose.yaml`
with `compose.prod.yaml` and one file per organization in [`orgs/`](orgs). Everything a deployment
says is in this folder, and every change is a commit:

| File | What it holds |
|---|---|
| [`prod.env`](prod.env) | the release and the domain — nothing secret |
| [`orgs/`](orgs) | one file per organization: its name and domain, its server, its host |
| `secrets.sops.env` | passwords, keys and each organization's sealing key, encrypted |
| [`.sops.yaml`](.sops.yaml) | whose age keys can decrypt `secrets.sops.env` |

Every task below is the same: **edit a file here, commit, and on the server `git pull && make
deploy`.** `make deploy` changes only what the files changed, and returns when everything is up.

## The model

The model runs in each person's browser, on WebGPU; the server holds no key, runs no model and serves
no weights. Nothing here to deploy: `web/public/models/app-config.json` is a static file of the web
image, WebLLM's own `AppConfig`, and it lists where the browser fetches the model from — the MLC
weights from Hugging Face, the compiled library from GitHub, each at a pinned revision, with
WebLLM's `integrity` (SRI) on the config, the library and the tokenizer.

**The browser needs egress** — it, not the server — to `huggingface.co` and `us.aws.cdn.hf.co` (the
large weight files, which Hugging Face redirects to) and `raw.githubusercontent.com`, over HTTPS. A
network that blocks them has no model: Ask and the assistant say so, and the rest of keasy works the
same. Keasy's own Content-Security-Policy already allows them (`connect-src https:`).

**To point keasy at a different model or host**, edit that file and deploy as for any change; it is
one record per model, and the page asks the first. `model` is the weights' base URL (a
Hugging Face `.../resolve/<commit>/`, or any host that serves the same files), `model_lib` the compiled
library for the WebLLM release the web installs (`v0_2_86` in its path today), and `integrity` the
SRI of the files whose bytes you pinned — `openssl dgst -sha256 -binary <file> | base64`, prefixed
`sha256-`, for `mlc-chat-config.json`, the library and `tokenizer.json`. The weights are not covered
by `integrity`, so pin them by commit, never `main`. A host of your own must answer cross-origin
requests (`Access-Control-Allow-Origin`), range requests included.

## Add an organization

```sh
cp orgs/acme.yaml orgs/globex.yaml
```

In the new file, replace `acme` everywhere (the service, the volume, the secret, the route) with the
organization's alias — lowercase, the subdomain it is reached at — and set its name and domain on
the first line. Then `make deploy`: it generates the organization's sealing key, registers the
organization in Keycloak with its sign-in address, starts its server, and asks Let's Encrypt for
`globex.<KEASY_DOMAIN>`. Its people are invited into the organization from Keycloak's console, and
its admin maps keasy's roles (reader, editor, admin) onto the organization's groups there.

An organization's look: put the theme generator's YAML beside its file and add to its server

```yaml
    configs: [{ source: globex-branding, target: /etc/keasy/branding.yml }]
    environment: { KEASY_BRANDING_FILE: /etc/keasy/branding.yml }
```

with `configs: { globex-branding: { file: ./infra/prod/orgs/globex.branding.yml } }` at the end of
the file.

## Remove an organization

Delete its file, `make deploy`. Its server stops, and **its organization is deleted from Keycloak,
with its members and its groups** — the realm is what the files declare. Its data volume
(`keasy_<alias>-data`) and its sealing key stay: putting the file back brings its server back with
its data, in a new, empty organization whose people are invited again. `docker volume rm` is the step
that deletes its data for good.

## Move to a new release

`KEASY_VERSION` in `prod.env`. The web is replaced with no gap when the `docker rollout` plugin is
installed on the server ([docker-rollout](https://github.com/wowu/docker-rollout)); each
organization's server stops and starts — seconds — because it owns an SQLite file, which takes one
writer. The platform services (Keycloak) move with `KANZO_UI_REF` in
`compose.prod.yaml`. A release whose database schema differs is not migrated: its server refuses to
start on the old volume, which is deleted (`docker volume rm keasy_<alias>-data`) for the server to
create it again, empty ([`docs/design/permissions.md`](../../docs/design/permissions.md#the-schema)).

**From a release on kanzo-ui 0.45 or before**, delete each organization's saved dashboards once,
before its first page opens: they name fields `Type.column`, and kanzo-ui 0.46 names a field by its
path from the relation's root (`country`, `affiliation.name`), so a saved tile would read columns
that are not there. The schema is unchanged; only the rows go:

```sh
docker run --rm -v keasy_<alias>-data:/var/lib/keasy alpine:3.22 \
  sh -c 'apk add -q sqlite && sqlite3 /var/lib/keasy/keasy.db "DELETE FROM dashboards;"'
```

Each graph then draws its automatic dashboard until someone saves another.

## Who can deploy

The secrets are encrypted with [SOPS](https://getsops.io) to the [age](https://age-encryption.org)
key of each person who deploys, and of the server. Docker is the only requirement: `make` runs SOPS
and age from their images when they are not installed.

- **Your key**: `make key` creates it (in `~/.config/sops/age/keys.txt`) if you have none, and
  prints its public half.
- **Giving someone access**: add their public key to `.sops.yaml`, then
  `cd infra/prod && ./sops updatekeys secrets.sops.env`, and commit both.
- **Taking it away**: remove their key the same way, then rotate what they could read —
  `make secret NAME=…` for each value.

## The first time on a server

1. A server with Docker, ports 80 and 443 open, and DNS: `auth.<KEASY_DOMAIN>` and
   `<alias>.<KEASY_DOMAIN>` for each organization (or `*.<KEASY_DOMAIN>`) pointing at it.
2. Clone the repository there. `make key` on the server, and its public key into `.sops.yaml`
   beside the team's.
3. `prod.env`: the domain, the Let's Encrypt email, the release, where the model is served.
4. `make secrets`. Commit `secrets.sops.env` and `.sops.yaml`.
5. `make deploy`. Keycloak's console is `https://auth.<KEASY_DOMAIN>/admin`, as `admin` with
   `KC_ADMIN_PASSWORD` from the secrets
   (`infra/prod/sops -d --input-type dotenv --output-type dotenv /dev/stdin < infra/prod/secrets.sops.env`).

## What to back up

The Docker volumes: each organization's `keasy_<alias>-data` and Keycloak's `keasy_kanzo-auth-db`. The secrets are in git, encrypted, so a lost server does not
lose them — and with them, each organization's sealing key, without which its data cannot be read.
