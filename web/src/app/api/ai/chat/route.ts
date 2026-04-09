import { streamText, tool } from "ai";
import { resolveProvider } from "@/lib/ai/resolve-provider";
import { sqlSystemPrompt } from "@/lib/ai/prompts";
import { generateSqlSchema } from "@/lib/ai/schemas";

const sqlTool = tool({
  description: "Generate a DuckDB SQL query to answer the user's question about their data",
  inputSchema: generateSqlSchema,
});

export async function POST(req: Request) {
  const { messages, provider, schema } = await req.json();
  const model = await resolveProvider(provider);

  const result = streamText({
    model,
    system: sqlSystemPrompt(schema),
    messages,
    tools: { generate_sql: sqlTool },
    maxOutputTokens: 2048,
  });

  return result.toUIMessageStreamResponse();
}
