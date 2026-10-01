import { expect, type Page } from "@playwright/test";

/**
 * The suite's one assertion: a `ProblemView` naming `code` is on screen within `within` ms. The code
 * may be the view's own or a cause's in its tree — ProblemView puts `data-code` on every coded row.
 */
export async function expectProblem(page: Page, code: string, { within = 10_000 }: { within?: number } = {}) {
  const view = page.locator(`[data-problem][data-code="${code}"], [data-problem] [data-code="${code}"]`);
  await expect(view.first(), `a ProblemView naming ${code}`).toBeVisible({ timeout: within });
}
