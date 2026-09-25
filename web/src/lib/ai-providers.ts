import { SiOpenai, SiAnthropic } from "react-icons/si";
import type { ComponentType } from "react";
import type { AiProvider } from "@/lib/types";

export interface AiProviderOption {
  id: AiProvider;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

export const AI_PROVIDERS: AiProviderOption[] = [
  { id: "anthropic", label: "Anthropic", icon: SiAnthropic },
  { id: "openai", label: "OpenAI", icon: SiOpenai },
];

/** The provider a route or form names, or an error for one keasy does not know. */
export function aiProvider(id: string): AiProvider {
  const known = AI_PROVIDERS.find((p) => p.id === id);
  if (!known) throw new Error(`Unknown AI provider: ${id}`);
  return known.id;
}
