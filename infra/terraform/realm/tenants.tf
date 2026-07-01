# The tenant fleet — defined ONCE. Topology (slug/displayName/image) lives in git
# under infra/k8s/tenants/<slug>.yaml (the Argo ApplicationSet source); this module
# reads the SAME files, so identity (Keycloak) and topology never drift. Membership
# (owner/member emails = PII) and the optional dev client_secret stay operator-local
# in terraform.tfvars, joined to the topology by slug — never committed.
#
# Dev (tenants_from_git=false) keeps its single static workspace inline in dev.tfvars:
# it runs on compose with no cluster and no git ApplicationSet, so there is nothing to
# read from and no fleet to drift against.

locals {
  _tenants_dir = "${path.module}/../../k8s/tenants"

  # Prod: git topology (displayName/image) joined with operator-local membership by slug.
  _git_tenants = {
    for f in fileset(local._tenants_dir, "*.yaml") :
    yamldecode(file("${local._tenants_dir}/${f}")).slug => yamldecode(file("${local._tenants_dir}/${f}"))
  }
  _prod_tenants = {
    for slug, top in local._git_tenants : slug => {
      displayName   = top.displayName
      owners        = try(var.tenant_membership[slug].owners, [])
      members       = try(var.tenant_membership[slug].members, [])
      client_secret = try(var.tenant_membership[slug].client_secret, null)
    }
  }

  # The fleet the rest of the module consumes. Prod reads git; dev uses the inline map.
  tenants = var.tenants_from_git ? local._prod_tenants : var.tenants
}
