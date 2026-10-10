# A deployment

keasy runs on one server with Docker, from the same compose files as development: `compose.yaml`
with `compose.prod.yaml` and one file per organization in [`orgs/`](orgs). Everything a deployment
says is in this folder, and every change is a commit:

| File | What it holds |
|---|---|
| [`prod.env`](prod.env) | the release, the domain, which model answers each AI alias — nothing secret |
| [`orgs/`](orgs) | one file per organization: its name and domain, its server, its host |
| `secrets.sops.env` | passwords, keys and each organization's sealing key, encrypted |
| [`.sops.yaml`](.sops.yaml) | whose age keys can decrypt `secrets.sops.env` |

Every task below is the same: **edit a file here, commit, and on the server `git pull && make
deploy`.** `make deploy` changes only what the files changed, and returns when everything is up.

## Change a model

In `prod.env`, `provider/model` for the alias:

```sh
AI_CHAT=anthropic/claude-sonnet-5-5
AI_COMPLETE=openai/gpt-5-mini
```

`anthropic`, `openai`, `gemini`, `mistral`, `openrouter`. A provider used for the first time needs
its key: `make secret NAME=OPENAI_API_KEY`, and paste it when asked. Only the AI gateway restarts; nothing
else notices. If a model name is wrong, Ask says so — `The model is unavailable (404): …` — and the
gateway's log names the request.

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
writer. The platform services (Keycloak, the gateway) move with `KANZO_UI_REF` in
`compose.prod.yaml`.

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
3. `prod.env`: the domain, the Let's Encrypt email, the release, the models.
4. `make secrets`, then `make secret NAME=ANTHROPIC_API_KEY` (and each provider you use). Commit
   `secrets.sops.env` and `.sops.yaml`.
5. `make deploy`. Keycloak's console is `https://auth.<KEASY_DOMAIN>/admin`, as `admin` with
   `KC_ADMIN_PASSWORD` from the secrets
   (`infra/prod/sops -d --input-type dotenv --output-type dotenv /dev/stdin < infra/prod/secrets.sops.env`).

## What to back up

The Docker volumes: each organization's `keasy_<alias>-data`, Keycloak's `keasy_kanzo-auth-db`, and
the request log in `keasy_kanzo-ai-db`. The secrets are in git, encrypted, so a lost server does not
lose them — and with them, each organization's sealing key, without which its data cannot be read.
