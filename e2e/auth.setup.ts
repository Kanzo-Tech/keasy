import { mkdirSync } from "node:fs";
import { test as setup } from "@playwright/test";

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
