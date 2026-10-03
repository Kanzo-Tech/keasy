variable "ai_url" {
  description = "The gateway's management URL."
  type        = string
}

variable "ai_master_key" {
  type      = string
  sensitive = true
}

variable "tenants" {
  description = "Organization alias => its display name, budget (USD per budget_duration; null: unlimited) and, in development only, a fixed key."
  type = map(object({
    display_name = string
    ai_budget    = optional(number)
    ai_key       = optional(string)
  }))
}

variable "budget_duration" {
  type    = string
  default = "30d"
}
