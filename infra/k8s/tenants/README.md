# Tenant registry (single source of truth)

One file per workspace: `infra/k8s/tenants/<slug>.yaml`. This is read by **both**:
- Argo's `tenants` ApplicationSet → renders one Application per file (the workloads);
- the realm Terraform (`infra/terraform/realm/`) → mints the Keycloak client/roles/users.

So topology never drifts between the two — there is one file, two readers.

This holds **topology only** (no PII, no secrets). Membership (owner/member emails) and the
rare fixed client_secret are keyed by the same `slug` in the realm Terraform's operator-local
`terraform.tfvars` (`tenant_membership`) — PII stays out of git.

## File format

```yaml
slug: acme            # DNS-safe; served at <slug>.<baseDomain>
displayName: "Acme Inc"
# Optional per-tenant image override (else the fleet digest from the ApplicationSet applies):
# image:
#   server: ghcr.io/kanzo-tech/keasy-server@sha256:...
#   web:    ghcr.io/kanzo-tech/keasy-web@sha256:...
```

## Adding a workspace

1. Create `infra/k8s/tenants/<slug>.yaml` (above).
2. Add the same `<slug>` to `infra/terraform/realm/terraform.tfvars` under `tenant_membership`
   (owner/member emails) and `terraform -chdir=realm apply` — this mints the Keycloak client
   and (interim) writes the `keasy-ws-<slug>` Secret + namespace.
3. Commit + push. Argo syncs the new Application; the workspace comes up at
   `https://<slug>.<baseDomain>`.

## Removing a workspace

Delete the file (Argo prunes the workloads) and remove the slug from `tenant_membership` +
apply (drops the Keycloak client, namespace, and Secret).
