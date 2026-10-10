import { expect, test } from "../support/fixtures";

import { signIn } from "../support/auth/sign-in";
import { ConnectionsPage } from "../support/app";
import { api, createGraph, expectRefusal, SOURCE } from "../support/stack/api";

/** A connection the instance declares (infra/dev/bootstrap.json): the workspace owns it, no person. */
const SEEDED = "LDBC SNB";

/** A connection as the API answers it, as far as these scenarios read it. */
interface Connection {
  owner: { id: string };
  can: { operate: boolean; manage: boolean };
  updated_by?: { id: string } | null;
  validation?: { by?: { name: string } | null } | null;
}

test.describe("a reader", () => {
  test.use({ storageState: ".auth/reader.json" });

  test("sees the shared graphs but is offered no New graph", async ({ page }) => {
    await page.goto("/graphs");
    await expect(page.getByPlaceholder("Search graphs...").or(page.getByRole("heading", { name: "No graphs yet" }))).toBeVisible();
    await expect(page.getByRole("link", { name: "New graph" })).toHaveCount(0);
  });

  test("is refused a source's files, and is told who lists them", async ({ page, env }) => {
    // What lies under a source is used, not read: a reader reads curated outputs.
    expectRefusal(await api(page, "GET", `/v1/connections/${encodeURIComponent(SOURCE)}/files`), 403, "rbac/insufficient-role");
    await page.goto(`/connections/${encodeURIComponent(SOURCE)}`);
    await expect(page.getByText("Only an editor can list a connection's files.")).toBeVisible();

    const connections = await ConnectionsPage.open(page, env);
    expect(await connections.hasActions(SOURCE), "a reader's rows offer no menu").toBe(false);
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

test("an editor tests a seeded connection, and is shown why they may not delete it", async ({ page, env }) => {
  const path = `/v1/connections/${encodeURIComponent(SEEDED)}`;
  const before = (await api(page, "GET", path)).body as Connection;
  expect(before.owner.id).toBe("workspace");
  expect(before.can).toEqual({ operate: true, manage: false });

  const menu = await (await ConnectionsPage.open(page, env)).actions(SEEDED);
  expect(await menu.offered("Test")).toEqual({ enabled: true, reason: "" });
  const remove = await menu.offered("Delete");
  expect(remove.enabled).toBe(false);
  expect(remove.reason).toMatch(/workspace owns this connection: only an admin can change it/);

  await menu.choose("Test");
  await expect(page.getByText(/^Validation (passed|failed)$/)).toBeVisible();
  // Testing operates the connection: the report names who asked, and nobody updated it.
  const after = (await api(page, "GET", path)).body as Connection;
  expect(after.validation?.by?.name, "the report names the editor").toBeTruthy();
  expect(after.updated_by ?? null).toEqual(before.updated_by ?? null);
});

test("an editor runs again a graph someone else owns, without taking it", async ({ page, browser, baseURL }) => {
  test.setTimeout(240_000);
  // The admin's graph, run once by them through the API and stopped, so it waits to run again.
  const admin = await browser.newContext({ storageState: ".auth/admin.json", baseURL });
  const adminPage = await admin.newPage();
  const id = await createGraph(adminPage, { name: "e2e someone else's" });
  const owner = ((await api(adminPage, "GET", `/v1/graphs/${id}`)).body as { owner: { id: string } }).owner.id;
  await admin.close();

  await page.goto(`/graphs/${id}`);
  // Running operates a graph: the editor's Run is enabled. Deleting manages it: disabled, with why.
  await page.getByRole("button", { name: /More graph actions/ }).click();
  await expect(page.getByRole("menuitem", { name: /^Delete/ })).toBeDisabled();
  await expect(page.getByRole("menuitem", { name: /^Delete/ })).toContainText("or an admin can change this graph");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByRole("button", { name: "Explore" })).toBeEnabled({ timeout: 180_000 });
  const ran = (await api(page, "GET", `/v1/graphs/${id}`)).body as { owner: { id: string }; runner: { id: string } };
  expect(ran.owner.id, "running it does not take it").toBe(owner);
  expect(ran.runner.id).not.toBe(owner);
});
