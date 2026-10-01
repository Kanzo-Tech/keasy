# The AI gateway

Every model call keasy makes goes through one service: [LiteLLM](https://docs.litellm.ai),
deployed by the platform module next to Keycloak. It is to models what Keycloak is
to identity: the apps speak one protocol to it (OpenAI chat completions) and name
an **alias**, never a provider or a model.

| Alias | Used for | Dev (`litellm.dev.yaml`) | Prod (`litellm.prod.yaml`) |
|-------|----------|--------------------------|----------------------------|
| `chat` | Discovery's Ask, the job assistant | Hermes 3 8B on Docker Model Runner | Claude Sonnet |
| `complete` | Assisted fields (ghost text, chips) | Hermes 3 3B on Docker Model Runner | Claude Haiku |

```
browser ──/api/v1/ai──▶ web (BFF) ──▶ server ──Bearer <tenant key>──▶ LiteLLM ──▶ upstream
```

The browser never holds a key. The server is the only thing that does: it checks
the alias, caps the tokens, names the caller (`user`), injects its workspace's key
and streams the answer back untouched.

## Who pays: a team per tenant

The realm module (`infra/terraform/realm/tenants_ai.tf`) gives every workspace a
LiteLLM **team**, carrying its budget (`ai_budget`, USD per `ai_budget_duration`),
and a **service-account key** in that team. The key reaches the workspace's server
as a Swarm secret (`KEASY_AI_KEY_FILE`). Spend, limits and logs are per workspace in
the admin console.

## Dev

`make dev` brings the whole thing up. The models are declared in `docker-compose.yml`
(`models:`) and served by **Docker Model Runner**, natively on the host — so on a Mac they
run on the GPU (a sentence in about a second) — and compose hands the gateway each one's
endpoint and name. The first `up` pulls them (~6.5 GB); after that the loop is offline and
free. Needs Docker Desktop 4.40+ with Model Runner on (`docker desktop enable model-runner`).
The admin console is at [http://localhost:4000/ui](http://localhost:4000/ui) (user `admin`,
password `sk-dev-master-key`). The dev tenant's key is fixed (`sk-keasy-dev-workspace`,
`dev.tfvars`) so compose can hand it to the server.

```bash
curl -N http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer sk-keasy-dev-workspace" -H "Content-Type: application/json" \
  -d '{"model":"chat","stream":true,"messages":[{"role":"user","content":"hi"}]}'
```

## Changing what answers an alias

Edit `litellm.prod.yaml` and `make deploy-platform`; the config is a Swarm config
named by its hash, so a change rolls the gateway. No app changes, ever: that is
what the aliases are for.

- **Another provider**: an entry under `model_list` with its key as
  `os.environ/<NAME>`, and `<NAME>` added to the platform's `ai_upstream_keys`.
  The file carries commented examples (OpenAI, Nous Portal).
- **A fallback**: `router_settings.fallbacks`, e.g. `[{ "chat": ["chat-fallback"] }]`.
- **A tenant's own key (BYOK)**: a team-scoped model in LiteLLM for that tenant's team.
  The workspace keeps calling the same alias.
- **Another gateway**: anything that speaks OpenAI chat completions. Point
  `KEASY_AI_URL` at it, and the key at one it issued.

## Caching

The cache (Valkey) is `default_off`. The server opts `complete` in, where the
same field value is often asked for twice. Chat turns are never cached, or Retry
would answer the same.

## Prod

`deploy-platform` takes `ai_upstream_keys` (env name → key), and optionally
`ai_admin_hostname` + `ai_admin_allow` for an IP-allowlisted route to the admin
console. `deploy-realm` reads the master key from the platform output and reaches the
management API at `ai_url` (the admin host), so the operator's address must be in
`ai_admin_allow`.

The image is pinned by digest. Two LiteLLM releases (1.82.7, 1.82.8) were published
compromised in March 2026; bump the pin deliberately, from a release that has been
out for a few days.
