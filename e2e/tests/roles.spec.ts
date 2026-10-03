import { expect, test } from "../support/fixtures";

import { signIn } from "../support/sign-in";

test.describe("a reader", () => {
  test.use({ storageState: ".auth/reader.json" });

  test("sees the shared jobs but is offered no Create job", async ({ page }) => {
    await page.goto("/jobs");
    await expect(page.getByPlaceholder("Search jobs...").or(page.getByRole("heading", { name: "No jobs yet" }))).toBeVisible();
    await expect(page.getByRole("link", { name: "Create job" })).toHaveCount(0);
  });
});

test.describe("a member with no role", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("is shown the forbidden page", async ({ page }) => {
    await signIn(page, "fede");
    await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
  });
});

test("an editor asking for the workspace's storage is sent to preferences", async ({ page }) => {
  await page.goto("/settings/storage");
  await expect(page).toHaveURL(/\/settings\/preferences$/);
});
