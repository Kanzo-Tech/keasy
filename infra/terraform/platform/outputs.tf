# The realm (kanzo-ui services/auth/realm) and infra/auth authenticate to Keycloak with this:
#   terraform -chdir=infra/terraform/platform output -raw kc_admin_password
output "kc_admin_password" {
  value     = random_password.kc_admin.result
  sensitive = true
}

output "network_name" {
  value = docker_network.edge.name
}
