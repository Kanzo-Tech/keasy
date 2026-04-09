import { streamObject } from "ai";
import { resolveProvider } from "@/lib/ai/resolve-provider";
import { CQ_SYSTEM_PROMPT, buildSuggestPrompt } from "@/lib/ai/prompts";
import { competencyQuestionsSchema } from "@/lib/ai/schemas";
import type { FileSchema } from "@/lib/types";

export async function POST(req: Request) {
  const body = (await req.json()) as {
    domain: string;
    schemas: FileSchema[];
    provider?: string;
  };

  const model = await resolveProvider(body.provider);

  const result = streamObject({
    model,
    system: CQ_SYSTEM_PROMPT,
    prompt: buildSuggestPrompt(body.domain, body.schemas),
    schema: competencyQuestionsSchema,
    maxOutputTokens: 2048,
  });

  return result.toTextStreamResponse();
}
