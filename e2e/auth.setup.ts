import { mkdirSync } from "node:fs";
import { expect, test as setup } from "@playwright/test";

import { api, CONNECTIONS } from "./support/api";
import { signIn } from "./support/sign-in";

/** Sign in once per account and keep the session cookie for the scenarios. */
const ACCOUNTS = { member: "dev@keasy.local", owner: "owner@keasy.local" } as const;

for (const [role, email] of Object.entries(ACCOUNTS)) {
  setup(`sign in as the ${role}`, async ({ page }) => {
    mkdirSync(".auth", { recursive: true });
    await signIn(page, email);
    await page.context().storageState({ path: `.auth/${role}.json` });
  });
}

/** The suite's connections over its fixtures, declared by the member (sources are a member's). */
setup("declare the suite's connections", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ storageState: ".auth/member.json", baseURL });
  const page = await context.newPage();
  for (const connection of CONNECTIONS) {
    const created = await api(page, "POST", "/v1/connections", connection);
    // 409: a previous run declared it.
    expect([201, 409], `${connection.name}: ${JSON.stringify(created.body)}`).toContain(created.status);
  }
  await context.close();
});
