# Tenant registry (Argo ApplicationSet source)

One file per workspace: `infra/k8s/tenants/<slug>.yaml`. The `tenants` ApplicationSet
(see `../platform/tenants-appset.yaml`) renders one Argo Application per file, installing
the `keasy-tenant` chart into namespace `keasy-ws-<slug>`.

This holds **topology only** (no PII). The matching identity/membership (owners, members,
optional dev client_secret) goes into the realm Terraform's operator-local
`terraform.tfvars`, keyed by the same slug — committed here, applied there, in one change.

## File format

```yaml
slug: acme            # DNS-safe; served at <slug>.<baseDomain>
displayName: "Acme Inc"
# Optional image overrides (else the fleet image.tag from the ApplicationSet applies):
# image:
#   server: ghcr.io/kanzo-tech/keasy-server:0.0.6
#   web: ghcr.io/kanzo-tech/keasy-web:0.0.6
```

## Adding a workspace

1. Create `infra/k8s/tenants/<slug>.yaml` (above).
2. Add the same `<slug>` to `infra/terraform/realm/terraform.tfvars` under `tenants`
   (display_name + owner emails) and `terraform -chdir=realm apply` — this mints the
   Keycloak client and writes the `keasy-ws-<slug>` Secret + namespace.
3. Commit + push. Argo syncs the new Application; the workspace comes up at
   `https://<slug>.<baseDomain>`.

## Removing a workspace

Delete the file (Argo prunes the workloads) and remove the slug from the realm tfvars +
apply (drops the Keycloak client, namespace, and Secret).
