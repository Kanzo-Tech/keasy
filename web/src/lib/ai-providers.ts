import { SiOpenai, SiAnthropic } from "react-icons/si";
import type { ComponentType } from "react";

export interface AiProviderOption {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  defaultModel: string;
}

export const AI_PROVIDERS: AiProviderOption[] = [
  { id: "anthropic", label: "Anthropic", icon: SiAnthropic, defaultModel: "claude-sonnet-4-20250514" },
  { id: "openai", label: "OpenAI", icon: SiOpenai, defaultModel: "gpt-4o" },
];
