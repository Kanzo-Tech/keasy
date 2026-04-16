import type { ComponentType } from "react";
import { Bot } from "lucide-react";

interface ProviderDef {
  id: string;
  name: string;
  icon: ComponentType<{ className?: string }>;
}

const anthropic: ProviderDef = { id: "anthropic", name: "Anthropic", icon: Bot };
const openai: ProviderDef = { id: "openai", name: "OpenAI", icon: Bot };

export const allProviders: ProviderDef[] = [anthropic, openai];

export const providerRegistry: Record<string, ProviderDef> = {
  anthropic,
  openai,
};

export function toProviderPayload(config: Record<string, string>) {
  return config;
}
