import { SiAnthropic, SiOpenai } from "react-icons/si";
import type { ComponentType } from "react";
import type { Schemas } from "@keasy/api";

type AiProvider = Schemas["AiProvider"];

export interface AiProviderOption {
  id: AiProvider;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

/**
 * How each provider is drawn, and nothing else: the model each runs by default
 * comes from `GET /v1/ai/providers`. A `Record`, so a provider added to the spec
 * does not compile until it has a face.
 */
const presentation: Record<AiProvider, Omit<AiProviderOption, "id">> = {
  anthropic: { label: "Anthropic", icon: SiAnthropic },
  openai: { label: "OpenAI", icon: SiOpenai },
};

export const AI_PROVIDERS: AiProviderOption[] = Object.entries(presentation).map(
  ([id, face]) => ({ id: id as AiProvider, ...face }),
);
