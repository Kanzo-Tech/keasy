import { expect, type Page } from "@playwright/test";

/**
 * The suite's one assertion: a problem naming `code` is on screen within `within` ms — a `ProblemView`,
 * the failure `Chat` draws, or the one behind the model's badge, opened. The code may be the view's own
 * or a cause's in its tree: `Problem` puts `data-code` on every coded row.
 */
export async function expectProblem(page: Page, code: string, { within = 10_000 }: { within?: number } = {}) {
  const view = page.locator(
    [
      `[data-problem][data-code="${code}"]`,
      `[data-problem] [data-code="${code}"]`,
      `[data-slot="chat-error"] [data-code="${code}"]`,
      `[data-slot="model-badge-content"] [data-code="${code}"]`,
    ].join(", "),
  );
  await expect(view.first(), `a ProblemView naming ${code}`).toBeVisible({ timeout: within });
}

/**
 * The page's model failed to load, as `code`: its badge (`@kanzo-tech/ai`'s `ModelBadge`) says so within
 * `within` ms, and pressed, opens the problem naming it — then closed again, so the page is as it was.
 */
export async function expectModelProblem(page: Page, code: string, { within = 10_000 }: { within?: number } = {}) {
  const badge = page.locator('[data-slot="model-badge"][data-load="failed"]').first();
  await expect(badge, "the model's badge says it failed").toBeVisible({ timeout: within });
  await badge.click();
  await expectProblem(page, code);
  await page.keyboard.press("Escape");
}
