# Authenticate as the dedicated, least-privilege `keasy-terraform` service-account
# client (minted once by bootstrap.sh via kcadm) — NOT the master admin user. It lives
# in the `master` realm (the provider's default realm) and authenticates via the
# client-credentials grant. base_path is /auth because KC_HTTP_RELATIVE_PATH=/auth.
provider "keycloak" {
  client_id     = var.tf_client_id
  client_secret = var.tf_client_secret
  url           = var.kc_url
  base_path     = "/auth"
}
