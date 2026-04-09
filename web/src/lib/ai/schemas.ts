import { z } from "zod";

export const competencyQuestionsSchema = z.object({
  competency_questions: z.array(
    z.object({
      id: z.string(),
      question: z.string(),
      rationale: z.string(),
    }),
  ),
});

export const generateScriptSchema = z.object({
  script: z.string().describe("The complete Fossil script"),
});

export const generateSqlSchema = z.object({
  reasoning: z
    .string()
    .describe("Step-by-step explanation of which tables/columns were chosen and why"),
  sql: z.string().describe("A valid DuckDB SQL SELECT query"),
  explanation: z
    .string()
    .describe("One-sentence summary of what the query retrieves"),
});
