# The realm module (phase 2) authenticates to Keycloak with this. Feed it into the realm
# module's tfvars:  terraform -chdir=platform output -raw kc_admin_password
output "kc_admin_password" {
  value     = random_password.kc_admin.result
  sensitive = true
}

output "network_name" {
  value = docker_network.edge.name
}
