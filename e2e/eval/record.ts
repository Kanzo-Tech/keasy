import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where a run's results go: `results/<EVAL_MODEL>/<suite>.jsonl`, one line per case. `EVAL_MODEL` is
 * the label of the model the page runs (`MODEL` in `web/src/lib/ai.ts`) — the web's, not the suite's,
 * which is why the run is told it rather than reading it.
 */
const MODEL = process.env.EVAL_MODEL ?? "unlabelled";
const RESULTS = join(dirname(fileURLToPath(import.meta.url)), "results", MODEL);

export function record(suite: string, result: Record<string, unknown>): void {
  mkdirSync(RESULTS, { recursive: true });
  appendFileSync(join(RESULTS, `${suite}.jsonl`), `${JSON.stringify({ model: MODEL, at: new Date().toISOString(), ...result })}\n`);
}
