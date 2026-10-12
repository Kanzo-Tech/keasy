import { DiscoverPage, saveDashboard } from "../support/app";
import { test } from "../support/fixtures";
import { hasExample, seedGraph } from "../support/seeds";
import { ASK, type Pair } from "./cases";
import { record } from "./record";

/**
 * Ask's cases, asked of the model the stack points `chat` at — today's `dataAgent`, end to end: the
 * panel, the BFF, the gateway and the page's engine. Live only, never replayed: what is measured is
 * the model. Each case is one result line in `results/<EVAL_MODEL>/ask.jsonl`, scored or failed, and
 * a case that fails is a result, not a failed test — the suite fails only when it cannot ask at all.
 */

/** How long one question may take, on the CPU a baseline runs on. */
const QUESTION_MS = Number(process.env.EVAL_QUESTION_MS ?? 8 * 60_000);

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
    if (filter && title) await (await (await dashboard.tile(title)).chart()).pick({ y: filter.pick });
    await page.addStyleTag({ content: ".tsqd-parent-container { display: none !important; }" });
    await discover.panel("Ask");
    const answers = await (await discover.ask()).composer();

    const started = Date.now();
    const turns: number[] = [];
    let rows: Record<string, string>[] = [];
    let failure: string | undefined;
    let answered: string | undefined;
    try {
      for (const question of c.ask) {
        const asked = Date.now();
        await answers.ask(question);
        answered = await (await answers.answer()).text();
        turns.push(Date.now() - asked);
      }
      // An answer that read no rows draws no data table; asked of the harness, that is a wait to its
      // timeout for a table that will not come.
      const table = page.getByRole("table", { name: /^The rows the answer was read from/ });
      if ((await table.count()) === 0) failure = "the answer read no rows";
      else rows = await answers.rows();
    } catch (error) {
      failure = error instanceof Error ? error.message.split("\n")[0] : String(error);
    }
    const missing = c.holds.filter((pair) => !holds(rows, pair));
    const present = (c.lacks ?? []).filter((pair) => holds(rows, pair));
    record("ask", {
      case: c.id,
      pass: !failure && missing.length === 0 && present.length === 0,
      failure,
      answered,
      missing,
      present,
      rows: rows.slice(0, 10),
      turns,
      ms: Date.now() - started,
    });
  });
}
