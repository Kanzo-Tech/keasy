# Per-tenant AI access: one LiteLLM team per workspace, carrying its budget, and one
# service-account key the workspace's server presents. The key never reaches a browser:
# the server is the BFF that injects it. Applied in dev too (unlike the stacks), so
# `make dev` runs the same budgets and keys prod does.

resource "litellm_team" "tenant" {
  for_each        = var.tenants
  team_id         = "keasy-ws-${each.key}"
  team_alias      = each.value.display_name
  models          = ["chat", "complete"]
  max_budget      = each.value.ai_budget
  budget_duration = each.value.ai_budget == null ? null : var.ai_budget_duration
}

resource "litellm_key" "tenant" {
  for_each           = var.tenants
  key                = each.value.ai_key
  key_alias          = "keasy-ws-${each.key}"
  service_account_id = "keasy-ws-${each.key}"
  team_id            = litellm_team.tenant[each.key].team_id
}

resource "docker_secret" "ai_key" {
  for_each = local.stack_tenants
  name     = "keasy-ws-${each.key}-ai-key"
  data     = base64encode(litellm_key.tenant[each.key].key)
}
