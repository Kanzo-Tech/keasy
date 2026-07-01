# keasy on Kubernetes — bootstrap

GitOps deployment: **Argo CD** pulls the platform and the tenant fleet from this repo;
**Terraform** (`infra/terraform/realm/`) still owns Keycloak (realm/IdP/clients/users) and
writes each tenant's Secret into the cluster. The app images and the Rust backend are
unchanged from the Swarm era.

```
infra/k8s/
  bootstrap/        you are here — one-time cluster + Argo install (operator-run on the VPS)
  platform/         Argo app-of-apps: cert-manager, CloudNativePG, Keycloak, tenant ApplicationSet
  tenant-chart/     the keasy-tenant Helm chart (server + web + Ingress + PVC)
  tenants/          one file per workspace → the ApplicationSet renders an Application each
```

Sync order is handled by `argocd.argoproj.io/sync-wave`: cert-manager + CNPG operators
(-3) → ClusterIssuer + keycloak-db (-1) → Keycloak (0) → tenants (1).

## Prerequisites
- A VPS with a public IP, ports 80/443 open.
- DNS: `auth.<base_domain>` and `*.<base_domain>` (or each `<slug>.<base_domain>`) → the VPS.
- A Cloudflare API token (Zone:DNS:Edit + Zone:Read on the zone) for cert-manager DNS-01.
- `EDIT` markers in `platform/*.yaml` and `platform/tenants-appset.yaml` set to your real
  repo URL + domain + ops email before the first sync.

## 1. Cluster — k3s single-node
k3s ships Traefik v3 (IngressClass `traefik`) and `local-path` as the default StorageClass.
```sh
curl -sfL https://get.k3s.io | sh -
sudo cat /etc/rancher/k3s/k3s.yaml   # copy to ~/.kube/config (rewrite server: to the VPS IP)
```

### Private repo & registry
- **Git**: if this repo is private, register it in Argo CD (`argocd repo add
  https://github.com/Kanzo-Tech/keasy.git --username … --password <PAT>`, or a repo-creds
  Secret) before applying the root app.
- **GHCR images**: either make the `keasy-server`/`keasy-web` packages public, or pass a
  `.dockerconfigjson` to the realm Terraform (`-var image_pull_dockerconfigjson=…`) — it
  creates a `ghcr-pull` Secret per tenant namespace — and set
  `image.pullSecrets: [{name: ghcr-pull}]` in the ApplicationSet's valuesObject.

## 2. Argo CD
```sh
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
kubectl -n argocd rollout status deploy/argocd-server
```

## 3. Operator secrets (never committed)
cert-manager's Cloudflare token, in the cert-manager namespace:
```sh
kubectl create namespace cert-manager
kubectl create secret generic cloudflare-api-token-secret \
  -n cert-manager --from-literal=api-token='<CF_TOKEN>'
```
Keycloak's bootstrap admin (the SAME value is fed to the realm Terraform below):
```sh
KC_ADMIN_PW=$(openssl rand -base64 36)
kubectl create namespace keycloak
kubectl create secret generic keycloak-admin -n keycloak \
  --from-literal=username=admin --from-literal=password="$KC_ADMIN_PW"
```

## 4. Sync the platform
```sh
kubectl apply -f infra/k8s/bootstrap/root-app.yaml
# watch it converge:
kubectl -n argocd get applications -w
# Keycloak is healthy when the public ingress answers:
until curl -fsS https://auth.<base_domain>/auth/health/ready >/dev/null; do sleep 5; done
```

## 5. Configure Keycloak (realm + IdP + tenants) with Terraform
The realm module connects through the public ingress and writes each tenant's k8s Secret.
```sh
cp infra/terraform/realm/terraform.tfvars.example infra/terraform/realm/terraform.tfvars
# edit: kc_url=https://auth.<base_domain>, the IdP creds, and the tenants map.
terraform -chdir=infra/terraform/realm init
terraform -chdir=infra/terraform/realm apply -var kc_admin_password="$KC_ADMIN_PW"
```

## 6. Add the tenant topology to git
For each tenant in the realm tfvars, commit `infra/k8s/tenants/<slug>.yaml` (see that
dir's README). Push — Argo's ApplicationSet brings up `https://<slug>.<base_domain>`.

## What lives where
| Concern | Owner |
|---|---|
| Cluster, ingress, TLS | k3s (Traefik) + cert-manager |
| Platform Postgres | CloudNativePG (`keycloak-db`) |
| Identity (realm/IdP/clients/users/roles) | Terraform `realm/` (unchanged from Swarm) |
| Per-tenant Secret (oidc/api-key/secret-key) | Terraform `realm/` → k8s Secret |
| Tenant topology (which workspaces, images) | git `tenants/*.yaml` → Argo ApplicationSet |
| Tenant workloads (server/web/Ingress/PVC) | `keasy-tenant` Helm chart, Argo-synced |
| Image builds | unchanged — `.github/workflows/images.yml` → GHCR |
