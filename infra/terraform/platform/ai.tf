# The AI gateway: LiteLLM, the platform's one door to models, as Keycloak is its one
# door to identity — kanzo-ui's module, deployed on this platform's overlay. Instances
# reach it as `ai-gateway:4000`; each holds a key infra/ai mints (a team and budget per
# tenant). The profile — which upstream answers which alias — is keasy's.
module "ai_gateway" {
  source = "git::https://github.com/Kanzo-Tech/ui.git//services/ai/modules/gateway?ref=v0.28.0"

  network       = docker_network.edge.name
  alias         = "ai-gateway"
  profile       = file("${path.module}/../../ai/litellm.prod.yaml")
  upstream_keys = var.ai_upstream_keys

  # The admin console and the management API infra/ai drives, on an internal host
  # reachable only from `ai_admin_allow`. Instances never use this route.
  admin_hostname     = var.ai_admin_hostname
  admin_allow        = var.ai_admin_allow
  admin_entrypoint   = "websecure"
  admin_certresolver = "le"
}
