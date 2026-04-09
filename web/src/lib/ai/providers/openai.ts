import { OpenAiIcon } from "@/components/icons/brand-icons";
import { defineType } from "@/lib/schemas/field-def";

export const openaiProvider = defineType({
  id: "openai",
  name: "OpenAI",
  description: "GPT-4o and other OpenAI models",
  icon: OpenAiIcon,
  fields: {
    api_key:    { label: "API Key",    required: true, secret: true, placeholder: "sk-..." },
    model:      { label: "Model",      placeholder: "gpt-4o", description: "Defaults to gpt-4o if left empty" },
    max_tokens: { label: "Max Tokens", type: "number", placeholder: "1024", description: "Controls response length. Defaults to 1024." },
  },
});
