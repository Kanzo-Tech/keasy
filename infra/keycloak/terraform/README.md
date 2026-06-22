# infra/keycloak/terraform — the keasy realm as code

The keasy Keycloak realm (settings, SMTP, the static clients + their service-account
roles) is declared here and applied with the `keycloak/keycloak` Terraform provider.
This replaces the old hand-written `realm-import/keasy-realm.json` + `--import-realm`.

## Why
A realm **created** via the admin API auto-creates the built-in client scopes (`roles`,
`web-origins`, `profile`, `email`); we reference them and never redefine them. The old
import path required listing `clientScopes` by hand, and dropping `roles` silently
stripped `resource_access.realm-management.roles` from the service-account token → 403.
`terraform apply` also reconciles **in place** — a realm change no longer needs a
Postgres volume wipe (the old IGNORE_EXISTING gotcha).

## What Terraform owns vs not
- **Owns (static scaffold):** the `keasy` realm, `keasy-control-plane`, the dev/single-
  instance `keasy-server` (+ its owner/member roles + `keasy:role` mapper), and each
  service account's realm-management roles.
- **Does NOT own (runtime, per-tenant):** the `keasy-ws-{slug}` clients, their roles,
  their `keasy:role` mapper, and the Organizations — all created by the control-plane CLI
  via the admin API (`keycloak/src/admin.rs`). Terraform must never manage `keasy-ws-*`.

## How it runs
`infra/stack/tf.sh` runs `hashicorp/terraform` as a one-shot container on the
`keasy-edge` overlay against `http://keycloak:8080`, with vars from `TF_VAR_*`
(sourced from `.env` + `versions.env`). `infra/stack/bootstrap.sh` calls it after the
base stack is up. No terraform install on the manager.

## Auth (least privilege)
The provider authenticates as the dedicated `keasy-terraform` client (master realm,
client-credentials), minted once by `infra/stack/kc-mint-tf-client.sh` with only the
`create-realm` role — creating the realm auto-grants its creator admin on that realm.
The master admin user is used only to mint that client, never for routine applies.

## State
Local: `terraform.tfstate` in this dir (gitignored), persisted on the manager via the
repo checkout. Acceptable for a single manager — Terraform owns only the small static
scaffold; the tenant fleet lives in Keycloak, never in state. Loss → re-apply or
`terraform import`. Future multi-manager → an S3 backend (one `backend "s3"` block).

## Verify
`terraform apply` twice → the second is **"No changes"**. Confirm the provider version
exposes `organizations_enabled` on `keycloak_realm` (>= 5.1); if an apply errors on that
argument, bump the pin in `versions.tf`.
