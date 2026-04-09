import type { TypeDef } from "@/lib/schemas/field-def";
import { anthropicProvider } from "./anthropic";
import { openaiProvider } from "./openai";

export const providerRegistry: Record<string, TypeDef> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
};

export const allProviders = Object.values(providerRegistry);

/** Convert RegistryForm output to the API shape for saveProvider. */
export function toProviderPayload(config: Record<string, string>) {
  return {
    api_key: config.api_key,
    model: config.model || undefined,
    max_tokens: config.max_tokens ? parseInt(config.max_tokens, 10) : undefined,
  };
}
