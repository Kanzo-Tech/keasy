# infra/terraform — identity as code

Terraform owns **Keycloak**: the keasy realm, the SSO IdP, and every per-tenant
client/roles/users/role-assignments — plus the per-tenant Kubernetes Secret that hands the
minted OIDC client secret to the Argo-managed workload. The cluster, ingress, TLS and the
tenant workloads live in `infra/k8s/` (GitOps); the keycloak provider is agnostic to the
orchestrator, so identity stays here.

```
realm/   the keasy realm, SSO IdP, per-tenant Keycloak clients/roles/users, and the
         per-tenant k8s Secret (oidc/session/api-key/secret-key) the keasy-tenant chart mounts
```

> The Swarm era (`platform/` + `spike/` + the per-tenant `docker_service`) is gone — see
> `infra/k8s/` for its GitOps replacement (k3s + Argo CD + cert-manager + CloudNativePG +
> the Keycloak Helm chart). Keycloak now runs in the cluster; this module configures it.

## Apply (after the platform is up — see `infra/k8s/bootstrap/README.md`)

```sh
cp realm/terraform.tfvars.example realm/terraform.tfvars   # edit: kc_url (public ingress),
                                                           # IdP creds, tenants (identity/PII)
terraform -chdir=realm init
terraform -chdir=realm apply \
  -var kc_admin_password="$(kubectl -n keycloak get secret keycloak-admin -o jsonpath='{.data.password}' | base64 -d)"
```

- **`realm/terraform.tfvars`** carries identity/membership only (owner/member emails are PII
  → operator-local, gitignored). Tenant **topology** (which workspaces exist, image refs)
  lives in git under `infra/k8s/tenants/*.yaml`, the Argo ApplicationSet source. Adding a
  tenant = a file there + an entry here, applied together.
- **`kc_url`** points at the public Keycloak ingress (`https://auth.<base_domain>`): the
  operator runs apply from a machine with kubeconfig + DNS, not from inside the cluster.
- **State** holds every secret (the minted client secrets + the randoms) → keep it
  operator-local and backed up; move it to an encrypted backend for multi-operator setups.

## SSO
Users log in through the IdP in `realm/` (`var.idp`). Keycloak links the IdP login to the
pre-declared `keycloak_user` by email (`trust_email`); the owner/member role is already
assigned, so the token carries `keasy:role` from the first login — the tenant server just
reads it (no app-side grant).
