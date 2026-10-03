module "team" {
  source   = "git::https://github.com/Kanzo-Tech/ui.git//services/ai/modules/team?ref=v0.28.0"
  for_each = var.tenants

  team_id         = "keasy-${each.key}"
  alias           = each.value.display_name
  max_budget      = each.value.ai_budget
  budget_duration = var.budget_duration
  key             = each.value.ai_key
}

output "keys" {
  description = "Organization alias => KEASY_AI_KEY for that instance's server."
  value       = { for k, t in module.team : k => t.key }
  sensitive   = true
}
