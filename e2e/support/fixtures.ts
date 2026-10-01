import { expect, test as base, type Page } from "@playwright/test";

import { api, createJob } from "./api";

/** A job the browser has run to completion, so its corpus opens in Discovery. */
async function runToCompletion(page: Page): Promise<string> {
  const id = await createJob(page, { name: "e2e corpus" });
  await page.goto(`/jobs/${id}`);
  await expect(page.getByRole("link", { name: "Open Discovery" })).toBeVisible({ timeout: 180_000 });
  return id;
}

export const MODEL_CREDENTIAL = "e2e-fake-llm";
export const MODEL_CONNECTION = "e2e-model";

/** A model connection on the fake provider, running `model` — which says how the provider misbehaves. */
export async function withModel(page: Page, model: string, scenario: () => Promise<void>) {
  const credential = await api(page, "GET", `/v1/credentials/${MODEL_CREDENTIAL}`);
  if (credential.status === 404) {
    const created = await api(page, "POST", "/v1/credentials", {
      name: MODEL_CREDENTIAL,
      spec: { model: { kind: "openai", api_key: "e2e-not-a-key", base_url: "http://fake-llm:8000/v1" } },
    });
    expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
  }
  const connection = await api(page, "POST", "/v1/connections", {
    name: MODEL_CONNECTION,
    credential: MODEL_CREDENTIAL,
    target: { model: { model } },
  });
  expect(connection.status, JSON.stringify(connection.body)).toBeLessThan(300);
  try {
    await scenario();
  } finally {
    await api(page, "DELETE", `/v1/connections/${encodeURIComponent(MODEL_CONNECTION)}`);
  }
}

/** Open a job's Discovery on the dock panel `panel` (Info · Ask · Rules · Settings). */
export async function openPanel(page: Page, jobId: string, panel: "Ask" | "Rules") {
  await page.goto(`/jobs/${jobId}/discover`);
  await page.getByRole("button", { name: panel, exact: true }).or(page.getByRole("radio", { name: panel })).first().click();
}

/** Ask the Ask panel `question`. */
export async function ask(page: Page, question: string) {
  const box = page.getByPlaceholder("Ask about your data…");
  await box.fill(question);
  await box.press("Enter");
}

export const test = base.extend<object, { corpusJob: string }>({
  corpusJob: [
    async ({ browser }, use) => {
      const context = await browser.newContext({ storageState: ".auth/member.json", baseURL: process.env.KEASY_URL ?? "http://localhost:3000" });
      const page = await context.newPage();
      const id = await runToCompletion(page);
      await context.close();
      await use(id);
    },
    { scope: "worker" },
  ],
});

export { expect };
