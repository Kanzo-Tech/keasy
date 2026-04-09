import { cookies } from "next/headers";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

const API_URL = process.env.KEASY_API_URL;
if (!API_URL) throw new Error("KEASY_API_URL environment variable is required");

interface AiSettingsResponse {
  data: {
    provider: string;
    api_key: string;
    model: string | null;
    max_tokens: number | null;
  };
}

/**
 * Resolve the AI provider and model from the Rust backend.
 * Forwards session cookies for auth — only callable from Next.js API routes.
 */
export async function resolveProvider(providerId?: string): Promise<LanguageModel> {
  const cookieStore = await cookies();
  const url = new URL(`${API_URL}/v1/internal/ai/resolve`);
  if (providerId) url.searchParams.set("provider", providerId);

  const res = await fetch(url.toString(), {
    headers: { Cookie: cookieStore.toString() },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(body || "AI provider not configured");
  }

  const { data: settings } = (await res.json()) as AiSettingsResponse;

  switch (settings.provider) {
    case "anthropic": {
      const provider = createAnthropic({ apiKey: settings.api_key });
      return provider(settings.model ?? "claude-sonnet-4-20250514");
    }
    case "openai": {
      const provider = createOpenAI({ apiKey: settings.api_key });
      return provider(settings.model ?? "gpt-4o");
    }
    default:
      throw new Error(`Unknown AI provider: ${settings.provider}`);
  }
}
