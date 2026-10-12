import { DiscoverPage, saveDashboard } from "../support/app";
import { expect, test } from "../support/fixtures";
import { hasExample, seedGraph } from "../support/seeds";
import { ASK, type Pair } from "./cases";
import { warmUp } from "./model";
import { record } from "./record";

/**
 * Ask's cases, asked of the model the stack points `chat` at, through whatever the Ask panel runs —
 * end to end: the panel, the BFF, the gateway and the page's engine. Live only, never replayed: what is measured is
 * the model. Each case is one result line in `results/<EVAL_MODEL>/ask.jsonl`, scored or failed, and
 * a case that fails is a result, not a failed test — the suite fails only when it cannot ask at all.
 */

/** How long one question may take, on the CPU a baseline runs on. */
const QUESTION_MS = Number(process.env.EVAL_QUESTION_MS ?? 8 * 60_000);

/**
 * What the model said in one call, read from the stream the page received: its text, its reasoning
 * and the tool calls it wrote — so a failed case says whether the model called `answer`, wrote prose
 * instead, or thought until the time ran out. Cut to the tail: the end is where a call is decided.
 */
function said(sse: string, status: number): { status: number; text: string; reasoning: string; calls: string; tokens?: number; body?: string } {
  let text = "";
  let reasoning = "";
  let calls = "";
  let tokens: number | undefined;
  for (const line of sse.split("\n")) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
    try {
      const chunk = JSON.parse(line.slice(6));
      const delta = chunk.choices?.[0]?.delta ?? {};
      text += delta.content ?? "";
      reasoning += delta.reasoning_content ?? "";
      for (const call of delta.tool_calls ?? []) calls += `${call.function?.name ?? ""}${call.function?.arguments ?? ""}`;
      tokens = chunk.usage?.completion_tokens ?? tokens;
    } catch {
      // A line cut by the stream's end: what came before it is kept.
    }
  }
  const tail = (s: string) => (s.length > 600 ? `…${s.slice(-600)}` : s);
  // Nothing read as a stream: a refusal or an error the gateway answered instead, kept as it came.
  const body = text || reasoning || calls ? undefined : sse.slice(0, 600);
  return { status, text: tail(text), reasoning: tail(reasoning), calls: tail(calls), tokens, body };
}

/** Whether `rows` — an answer's data table — holds a row reading `label` and `n` (separators aside). */
function holds(rows: readonly Record<string, string>[], [label, n]: Pair): boolean {
  return rows.some((row) => {
    const cells = Object.values(row);
    return (label === null || cells.includes(label)) && cells.some((cell) => cell.replace(/[,\s]/g, "") === String(n));
  });
}

test.describe.configure({ mode: "serial" });
// A harness waits as long as a question may take: an answer begins only once the model has read the
// whole prompt, which on a CPU is minutes.
test.use({ harnessTimeout: QUESTION_MS });

for (const c of ASK) {
  test(`ask: ${c.id}`, async ({ page, env }) => {
    test.skip(!hasExample(c.example), `no ${c.example} seed`);
    test.setTimeout(c.ask.length * QUESTION_MS + 15 * 60_000);
    const id = await seedGraph(page, c.example, { name: `Eval · ${c.example}`, reuse: true });
    const key = [c.page.root, ...(c.page.hops ?? [])].join("");
    const filter = c.page.filter;
    const title = filter ? `Count by ${filter.x}` : undefined;
    await saveDashboard(page, id, key, {
      filters: [],
      tiles: filter ? [{ id: "filter", kind: "chart", span: 1, type: "bar", title, x: filter.x, y: { op: "count" } }] : [],
    });

    const discover = await DiscoverPage.open(page, env, id, { view: "dashboard" });
    await discover.relation(c.page.root, c.page.hops ?? []);
    const dashboard = await discover.dashboard();
    await dashboard.settled();
    // What the page keeps, as its readout says, once the filter has taken: the proof the case asked
    // under it. A pick takes effect after it returns, so the readout is waited on, as the demo waits.
    const whole = await discover.kept();
    if (filter && title) await (await (await dashboard.tile(title)).chart()).pick({ y: filter.pick });
    const kept = filter
      ? await expect.poll(() => discover.kept(), { timeout: 30_000 }).not.toBe(whole).then(
          () => discover.kept(),
          () => undefined,
        )
      : whole;
    if (filter && kept === undefined) {
      return record("ask", { case: c.id, pass: false, failure: "the page was not filtered: the case could not be set up", missing: c.holds, present: [], rows: [], calls: [], turns: [], ms: 0 });
    }
    await page.addStyleTag({ content: ".tsqd-parent-container { display: none !important; }" });
    await discover.panel("Ask");
    const panel = await discover.ask();
    const cold = await warmUp(page, QUESTION_MS).then(
      () => undefined,
      (error: Error) => error.message,
    );
    if (cold) return record("ask", { case: c.id, pass: false, failure: cold, missing: c.holds, present: [], rows: [], calls: [], turns: [], ms: 0 });
    const answers = await panel.composer();

    // Every model call the page makes from here on, as it was streamed back.
    const calls: ReturnType<typeof said>[] = [];
    page.on("response", (response) => {
      if (!response.url().includes("/api/ai/chat/completions")) return;
      void response.text().then((body) => calls.push(said(body, response.status())), () => undefined);
    });

    const started = Date.now();
    const turns: number[] = [];
    let rows: Record<string, string>[] = [];
    let failure: string | undefined;
    let answered: string | undefined;
    let card: { text: string; tables: number } | undefined;
    // A case that must end in words — a question back, or no answer — is scored on the reply, which a
    // turn that draws no card leaves as the conversation's last message.
    const words = c.expects === "question" || c.expects === "refusal";
    let replied: string | undefined;
    try {
      for (const [n, question] of c.ask.entries()) {
        const asked = Date.now();
        // A call that fails draws the panel's Problem and no card: the case ends there, with its code,
        // rather than waiting out the clock for a card that is not coming.
        const problems = page.locator('[data-slot="chat-error"] [data-code], [data-problem][data-code]');
        const before = await problems.count();
        const failed = problems
          .nth(before)
          .waitFor({ timeout: QUESTION_MS })
          .then(async () => {
            const problem = problems.nth(before);
            throw new Error(`the panel failed: ${await problem.getAttribute("data-code")}: ${(await problem.textContent())?.trim()}`);
          });
        // A model that writes prose and never calls `answer` draws neither: its turn ends, the
        // composer is ready again, and no card began. That ends the case too, as soon as it happens.
        const cards = page.locator('[data-slot="answer-card"]');
        const cardsBefore = await cards.count();
        const submit = page.locator('[data-slot="prompt-input-submit"]').last();
        const prose = (async () => {
          for (;;) {
            await page.waitForTimeout(2_000);
            if (Date.now() - asked > 5_000 && (await submit.getAttribute("data-status")) === "ready" && (await cards.count()) === cardsBefore) {
              throw new Error("the model answered without calling answer");
            }
            if ((await cards.count()) > cardsBefore) return new Promise<never>(() => {});
          }
        })();
        await Promise.race([answers.ask(question).then(() => answers.answer()), failed, prose]).then(
          async (tile) => {
            answered = await tile.text();
          },
          async (error: Error) => {
            if (!(words && n === c.ask.length - 1 && /without calling answer/.test(error.message))) throw error;
            const reply = page.locator('[data-slot="message"][data-role="assistant"]').last();
            replied = (await reply.innerText().catch(() => "")).slice(0, 1500);
          },
        );
        void failed.catch(() => undefined);
        void prose.catch(() => undefined);
        turns.push(Date.now() - asked);
      }
      if (words) throw new Error(replied === undefined ? `answered where it should have ${c.expects === "question" ? "asked which" : "said it cannot"}` : "");
      // An answer that read no rows draws no data table; asked of the harness, that is a wait to its
      // timeout for a table that will not come.
      // The rows as the library's harness reads them, the demo's way. It waits for the table as long
      // as any harness wait; an answer that read no rows draws none, so it is given 20 s, not that.
      const read = await Promise.race([
        answers.rows(),
        new Promise<undefined>((resolve) => setTimeout(resolve, 20_000, undefined)),
      ]).catch(() => undefined);
      if (read === undefined) failure = "the answer read no rows";
      else rows = read;
      // The whole card, not only its chart: it says the clauses it was read under and the ones it
      // could not answer, which is what an answer over the wrong rows needs to say.
      const last = page.locator('[data-slot="answer-card"]').last();
      card = { text: (await last.innerText().catch(() => "")).slice(0, 1500), tables: await last.locator("table").count() };
    } catch (error) {
      failure = (error instanceof Error ? error.message.split("\n")[0] : String(error)) || undefined;
      // A run stopped from outside — Ctrl-C, a second run over it — ends the test under every wait,
      // and that is no result of the model's: nothing is written.
      if (/Test ended|has been closed/.test(failure ?? "")) throw error;
    }
    const missing = c.holds.filter((pair) => !holds(rows, pair));
    const present = (c.lacks ?? []).filter((pair) => holds(rows, pair));
    // A question back offers the relations as numbered options, two at least.
    if (c.expects === "question" && replied !== undefined && !/^\s*1\.\s.+\n\s*2\.\s/m.test(replied)) {
      failure = "it did not ask which, with the relations as options";
    }
    record("ask", {
      case: c.id,
      pass: !failure && missing.length === 0 && present.length === 0,
      failure,
      answered,
      replied,
      kept,
      card,
      missing,
      present,
      rows: rows.slice(0, 10),
      calls,
      turns,
      ms: Date.now() - started,
    });
  });
}
