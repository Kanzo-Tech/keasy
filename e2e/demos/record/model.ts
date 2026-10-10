import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page, Request } from "@playwright/test";

import { AI } from "../../support/fixtures";

/**
 * **The model's words, recorded once and replayed** — for a demo that asks the model. The split is
 * kanzo-ui's workspace showcase's (`GraphAsk` over `mockModel`): what the model *says* is canned, and
 * the `answer` tool it calls still runs on the page, under the page's crossfilter, against the real
 * corpus. So the numbers on screen are DuckDB's on every take, and a recorded tool call that dropped
 * the filter fails the take's check all the same.
 *
 * keasy's model is behind the BFF, so the recording is made at the network: one SSE body per model
 * call the page made (`AI`), keyed by the call's last user message and whether it carries a tool's
 * result back, in the order the page made them.
 *
 * - **Replay** is the default: each call is answered with the next recorded body under its key, and a
 *   call the recording does not hold is refused and named — the question, the prompt or the tool's
 *   schema changed, and the recording is to be captured again.
 * - **`LIVE=1`** asks the model through the gateway (`make demo` swaps it onto e2e/demos/models.yml).
 * - **`LIVE=1 RECORD=1`** does that and keeps what the model said; the demo writes it to
 *   `e2e/demos/recordings/<demo>.json` only once every check of the take has passed, so a refused
 *   query or an answer over the wrong rows is never recorded.
 *
 * Capture, with the stack and the seeds up: `make demo DEMO=snb-ask LIVE=1 RECORD=1`, then commit
 * the recording. Capture again when the prompt, the tool's schema or the example changes.
 */

const RECORDINGS = join(dirname(fileURLToPath(import.meta.url)), "..", "recordings");

export const LIVE = process.env.LIVE === "1";
export const RECORD = process.env.RECORD === "1";

interface Call {
  /** The call's key: its last user message, and `tool` when it carries a tool's result back. */
  key: string;
  /** What the gateway streamed back, whole. */
  body: string;
}

export interface Model {
  /** Whether the model is asked: `LIVE=1`. */
  readonly live: boolean;
  /** Calls the recording did not hold, by key: empty on a take that replayed cleanly. */
  readonly unrecorded: readonly string[];
  /** Writes what was captured, under `RECORD=1`; called once the take's checks have passed. */
  keep(): void;
}

/** The key a model call is recorded under. */
function keyOf(request: Request): string {
  const body = JSON.parse(request.postData() ?? "{}") as { messages?: { role: string; content: unknown }[] };
  const messages = body.messages ?? [];
  const user = [...messages].reverse().find((message) => message.role === "user");
  const words =
    typeof user?.content === "string"
      ? user.content
      : Array.isArray(user?.content)
        ? (user.content as { text?: string }[]).map((part) => part.text ?? "").join("")
        : "";
  return `${messages.some((message) => message.role === "tool") ? "tool · " : ""}${words}`;
}

/** Puts the model of `demo` on `page`: replayed from its recording, or live (and captured). */
export async function model(page: Page, demo: string): Promise<Model> {
  const file = join(RECORDINGS, `${demo}.json`);
  if (RECORD && !LIVE) throw new Error("RECORD=1 captures a live take: run it with LIVE=1 RECORD=1");

  if (LIVE) {
    const captured: Call[] = [];
    if (RECORD) {
      await page.route(AI, async (route) => {
        const response = await route.fetch();
        const body = await response.text();
        captured.push({ key: keyOf(route.request()), body });
        await route.fulfill({ response, body });
      });
    }
    return {
      live: true,
      unrecorded: [],
      keep() {
        if (!RECORD) return;
        mkdirSync(RECORDINGS, { recursive: true });
        writeFileSync(file, `${JSON.stringify({ demo, calls: captured }, null, 2)}\n`);
      },
    };
  }

  if (!existsSync(file)) {
    throw new Error(`${demo} replays the model from demos/recordings/${demo}.json, which is not there: capture it with make demo DEMO=${demo} LIVE=1 RECORD=1`);
  }
  const { calls } = JSON.parse(readFileSync(file, "utf8")) as { calls: Call[] };
  const served = new Set<number>();
  const unrecorded: string[] = [];
  await page.route(AI, async (route) => {
    const key = keyOf(route.request());
    const at = calls.findIndex((call, index) => !served.has(index) && call.key === key);
    if (at < 0) {
      unrecorded.push(key);
      return route.abort("failed");
    }
    served.add(at);
    return route.fulfill({ status: 200, contentType: "text/event-stream", body: calls[at]!.body });
  });
  return { live: false, unrecorded, keep() {} };
}
