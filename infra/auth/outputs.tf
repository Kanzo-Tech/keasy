output "client_secret" {
  description = "KEASY_OIDC_CLIENT_SECRET for every instance's web."
  value       = module.keasy.client_secret
  sensitive   = true
}
