# Each tenant's access to the platform's AI gateway (kanzo-ui services/ai): a team
# with its budget, and the key that tenant's server presents.
terraform {
  required_version = ">= 1.6.0"
  # The state's path is the caller's: `terraform init -backend-config=path=…`.
  backend "local" {}
  required_providers {
    litellm = {
      source  = "ncecere/litellm"
      version = "~> 2.1"
    }
  }
}

provider "litellm" {
  api_base = var.ai_url
  api_key  = var.ai_master_key
}
