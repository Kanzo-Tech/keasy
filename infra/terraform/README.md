# infra/terraform — the keasy fleet as code

Terraform owns the whole deployment on Docker Swarm: the platform (ingress + identity)
and every tenant (Keycloak client/roles/users + the server/web Swarm stack). This
replaces the old patchwork — `infra/stack/base.yml`, the `bootstrap`/`cp`/`tf` shell
scripts, and the Rust `control-plane` CLI.

```
platform/   phase 1 — keasy-edge overlay, base secrets, Traefik + Keycloak + Postgres
realm/      phase 2 — the keasy realm, SSO IdP, and per-tenant clients/roles/users/stacks
spike/      the docker_service gate (one tenant; runtime-validate before trusting the model)
```

## Two-phase apply (the keycloak provider can't create Keycloak and configure it at once)

On a Swarm manager, once (`docker swarm init` if not already a manager):

```sh
# Phase 1 — platform. Brings Keycloak up empty; mints the DB + admin passwords.
terraform -chdir=platform init
terraform -chdir=platform apply -var kc_hostname=auth.keasy.example.com -var acme_email=ops@kanzo.tech

# Wait for Keycloak health (it has no realm yet, but the admin API must answer):
until curl -fsS https://auth.keasy.example.com/auth/health/ready >/dev/null; do sleep 3; done

# Phase 2 — realm + tenants. Feed it phase 1's admin password.
cp realm/terraform.tfvars.example realm/terraform.tfvars   # then edit: IdP creds + tenants
terraform -chdir=realm init
terraform -chdir=realm apply \
  -var kc_admin_password="$(terraform -chdir=platform output -raw kc_admin_password)"
```

- **`realm/terraform.tfvars`** is the tenant **registry** — operator-local, gitignored
  (emails are PII). Adding a tenant = an entry under `tenants` + `terraform -chdir=realm apply`.
  No CLI, no shell.
- **State** holds every secret → it lives on the manager, gitignored. Back it up; a future
  multi-manager setup moves it to an encrypted S3 backend.

## SSO
Users log in through the IdP configured in `realm/` (`var.idp` — Google example in the
`.tfvars.example`). Keycloak links the IdP login to the pre-declared `keycloak_user` by
email (`trust_email`); the owner/member role is already assigned, so the token carries
`keasy:role` from the first login — the tenant server just reads it (no app-side grant).

## Status / gates
- All three modules pass `terraform validate` against the real provider schemas.
- **Runtime gates to confirm on a manager** (then the model is proven):
  1. `spike/` — `docker_service` does secret mounts + Traefik routing + start-first
     rolling update with rollback (plan risk #1).
  2. IdP **auto-link by email** without the "account exists" prompt may need a custom
     first-broker-login flow (see `realm/idp.tf`, plan risk #2).
