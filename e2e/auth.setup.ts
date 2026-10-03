import { mkdirSync } from "node:fs";
import { expect, test as setup } from "@playwright/test";

import { api, CONNECTIONS } from "./support/api";
import { signIn } from "./support/sign-in";

/** Sign in once per role and keep the session cookie for the scenarios: acme's seed accounts
 * (kanzo-ui services/auth/seed). The editor is the scenarios' default; it creates, as they do. */
const ACCOUNTS = { admin: "ana", editor: "bruno", reader: "eva" } as const;

for (const [role, username] of Object.entries(ACCOUNTS)) {
  setup(`sign in as the ${role}`, async ({ page }) => {
    mkdirSync(".auth", { recursive: true });
    await signIn(page, username);
    await page.context().storageState({ path: `.auth/${role}.json` });
  });
}

/** The suite's connections over its fixtures, declared by the editor (creating needs one). */
setup("declare the suite's connections", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ storageState: ".auth/editor.json", baseURL });
  const page = await context.newPage();
  for (const connection of CONNECTIONS) {
    const created = await api(page, "POST", "/v1/connections", connection);
    // 409: a previous run declared it.
    expect([201, 409], `${connection.name}: ${JSON.stringify(created.body)}`).toContain(created.status);
  }
  await context.close();
});
