import type { Page } from "@playwright/test";

import { test } from "../support/fixtures";
import { hasExample } from "../support/seeds";
import { ASSISTANT } from "./cases";
import { record } from "./record";

/**
 * The assistant's cases, through today's wizard (`graphs/new`, *Assistant*) and the model the stack
 * points `chat` at: the files picked, the domain written, the requirements the model suggests, and
 * the program it writes for the case's own questions — which the studio's checker then reads, as its
 * header's findings badge says. One line per example in `results/<EVAL_MODEL>/assistant.jsonl`.
 *
 * What is scored is what today's wizard can be held to: that the model's requirements could be read,
 * and that its program checks against the files and the shapes it names. Whether the graph answers
 * the questions is the Task's criterion of done (`docs/design/assistant.md`), not this baseline's.
 */

const STEP_MS = Number(process.env.EVAL_QUESTION_MS ?? 8 * 60_000);

/** The studio's findings badge: *Valid*, or its errors and warnings. */
const TALLY = /^(Valid|\d+ (error|warning|note)s?( · \d+ warnings?)?)$/;

async function tally(page: Page): Promise<string> {
  const badge = page.getByText(TALLY).first();
  await badge.waitFor({ timeout: 60_000 });
  // The checker answers after the editor mounts the program; give it a moment to replace "Valid".
  await page.waitForTimeout(3_000);
  return (await badge.textContent())?.trim() ?? "";
}

test.describe.configure({ mode: "serial" });
test.use({ harnessTimeout: STEP_MS });

for (const c of ASSISTANT) {
  test(`assistant: ${c.example}`, async ({ page }) => {
    test.skip(!hasExample(c.example), `no ${c.example} seed`);
    test.setTimeout(3 * STEP_MS + 5 * 60_000);
    const started = Date.now();
    const result: Record<string, unknown> = { case: c.example };
    try {
      await page.goto("/graphs/new");
      await page.addStyleTag({ content: ".tsqd-parent-container { display: none !important; }" });
      await page.getByText("Assistant", { exact: true }).click();

      // Ark draws a checkbox's control over its input: ticked from the keyboard, as in ai.spec.ts.
      const tick = async (name: string, on: boolean) => {
        const box = page.getByRole("checkbox", { name: `Select ${name}`, exact: true });
        if ((await box.isChecked()) !== on) {
          await box.focus();
          await box.press("Space");
        }
      };
      await tick(c.connection, true);
      // Untouched, a connection offers every readable file; the case's are kept, the rest unticked.
      const files = page.getByRole("checkbox", { name: /^Select / });
      await page.getByRole("checkbox", { name: `Select ${c.files[0]}`, exact: true }).waitFor();
      for (const name of await files.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""))) {
        const path = name.replace(/^Select /, "");
        // A file's row is named by its path; the connections and the select-all header are not files.
        if (!/\.[a-z]+$/i.test(path)) continue;
        if (!c.files.includes(path)) await tick(path, false).catch(() => undefined);
      }
      await page.getByPlaceholder("e.g. daily weather observations from Spanish stations").fill(c.domain);
      await page.getByRole("button", { name: "Continue" }).click({ timeout: STEP_MS });

      // Requirements: what the model suggests, kept as the result; then the case's own questions.
      const suggested = Date.now();
      const requirements = page.getByPlaceholder("Type a requirement...");
      const failed = page.getByText(/could not be read|failed/i);
      // The spinner goes with the first suggestion while the rest still stream: the list is read once
      // it has stopped growing, or once the step says it failed.
      await page.getByText("Suggesting requirements").waitFor({ timeout: 60_000 }).catch(() => undefined);
      for (let last = -1, still = 0; still < 90_000 && Date.now() - suggested < STEP_MS; ) {
        const n = await requirements.count();
        if ((await failed.count()) > 0) break;
        still = n === last && n > 0 ? still + 10_000 : 0;
        last = n;
        await page.waitForTimeout(10_000);
      }
      result.requirements = await requirements.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
      result.requirementsMs = Date.now() - suggested;
      result.requirementsFailed = (await failed.count()) > 0;

      // Every suggestion off, the case's questions on — the program is written for the same questions
      // whatever the model suggested.
      for (const box of await page.getByRole("checkbox", { name: /^Select row/ }).all()) {
        if (await box.isChecked()) await box.press("Space");
      }
      for (const question of c.questions) {
        await page.getByRole("button", { name: "Add requirement" }).click();
        await requirements.last().fill(question);
      }

      const writing = Date.now();
      await page.getByRole("button", { name: "Generate" }).click();
      await page.getByText(/Script generated|could not|failed|wrote no program/i).first().waitFor({ timeout: STEP_MS });
      result.programMs = Date.now() - writing;
      result.program = await page.locator(".cm-content").first().textContent({ timeout: 30_000 }).catch(() => null);
      result.checker = result.program ? await tally(page) : null;
    } catch (error) {
      result.failure = error instanceof Error ? error.message.split("\n")[0] : String(error);
    }
    record("assistant", {
      ...result,
      pass: result.checker === "Valid",
      ms: Date.now() - started,
    });
  });
}
