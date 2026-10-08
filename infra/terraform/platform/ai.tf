# The AI gateway: agentgateway, the platform's one door to models, as Keycloak is its one
# door to identity — kanzo-ui's module, deployed on this platform's overlay. The web reaches
# it as `ai-gateway:4000` with a token the realm exchanged for the gateway and one
# organization; no instance holds a key. The profile — which upstream answers which alias —
# is keasy's.
module "ai_gateway" {
  source = "git::https://github.com/Kanzo-Tech/ui.git//services/ai/modules/gateway?ref=v0.33.0"

  network       = docker_network.edge.name
  alias         = "ai-gateway"
  profile       = file("${path.module}/ai-profile.yaml")
  upstream_keys = var.ai_upstream_keys

  # The realm as its tokens say it, and its keys fetched from Keycloak on the overlay.
  issuer          = "https://${var.kc_hostname}/realms/kanzo"
  jwks_url        = "http://keycloak:8080/realms/kanzo/protocol/openid-connect/certs"
  tokens_per_hour = var.ai_tokens_per_hour
}
