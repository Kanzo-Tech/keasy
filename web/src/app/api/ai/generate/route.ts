import { streamObject } from "ai";
import { resolveProvider } from "@/lib/ai/resolve-provider";
import { GENERATE_SYSTEM_PROMPT, buildGeneratePrompt } from "@/lib/ai/prompts";
import { generateScriptSchema } from "@/lib/ai/schemas";
import type { FileSchema } from "@/lib/types";

export async function POST(req: Request) {
  const body = (await req.json()) as {
    domain: string;
    competency_questions: string[];
    schemas: FileSchema[];
    provider?: string;
  };

  const model = await resolveProvider(body.provider);

  const result = streamObject({
    model,
    system: GENERATE_SYSTEM_PROMPT,
    prompt: buildGeneratePrompt(body.domain, body.competency_questions, body.schemas),
    schema: generateScriptSchema,
    maxOutputTokens: 4096,
  });

  return result.toTextStreamResponse();
}
