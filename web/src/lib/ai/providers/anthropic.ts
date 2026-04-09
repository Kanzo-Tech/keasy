import { AnthropicIcon } from "@/components/icons/brand-icons";
import { defineType } from "@/lib/schemas/field-def";

export const anthropicProvider = defineType({
  id: "anthropic",
  name: "Anthropic",
  description: "Claude and other Anthropic models",
  icon: AnthropicIcon,
  fields: {
    api_key:    { label: "API Key",    required: true, secret: true, placeholder: "sk-ant-..." },
    model:      { label: "Model",      placeholder: "claude-sonnet-4-20250514", description: "Defaults to claude-sonnet-4-20250514 if left empty" },
    max_tokens: { label: "Max Tokens", type: "number", placeholder: "1024", description: "Controls response length. Defaults to 1024." },
  },
});
