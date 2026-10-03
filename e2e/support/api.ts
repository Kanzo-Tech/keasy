import { expect, type Page } from "@playwright/test";

export interface Answer {
  status: number;
  body: unknown;
}

/**
 * A call to keasy's API from inside the page, so it carries the session cookie and the BFF's
 * same-origin check sees what the app's own requests look like. For arranging a scenario, and for
 * the few scenarios whose failure has no screen of its own (23, 26).
 */
export async function api(page: Page, method: string, path: string, body?: unknown, raw?: string): Promise<Answer> {
  if (!page.url().startsWith("http")) await page.goto("/settings/preferences");
  return page.evaluate(
    async ({ method, path, body, raw }) => {
      const init: RequestInit = { method, headers: {} };
      if (raw !== undefined) {
        init.body = raw;
        init.headers = { "content-type": "application/json" };
      } else if (body !== undefined) {
        init.body = JSON.stringify(body);
        init.headers = { "content-type": "application/json" };
      }
      const response = await fetch(`/api${path}`, init);
      const text = await response.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        // Not JSON: the text is the answer.
      }
      return { status: response.status, body: parsed };
    },
    { method, path, body, raw },
  );
}

/** For the scenarios with no screen: the refusal's status and its `code`, the ErrorBody's. */
export function expectRefusal(answer: Answer, status: number, code: string) {
  expect({ status: answer.status, code: (answer.body as { code?: string } | null)?.code }).toEqual({ status, code });
}

export const SINK = "Workspace output";
/** The suite's own connections, over its fixtures (e2e/fixtures/, mirrored by `s3-init`). */
export const SOURCE = "E2E source";
export const SHAPES = "E2E shapes";
const CREDENTIAL = "Dev S3";

export const CONNECTIONS = [
  { name: SOURCE, secret: CREDENTIAL, target: { url: "s3://keasy-dev/e2e/data/", kind: "data", direction: "source" } },
  { name: SHAPES, secret: CREDENTIAL, target: { url: "s3://keasy-dev/e2e/vocab/", kind: "vocab", direction: "source" } },
] as const;

/** The program over the fixtures. */
export const SHOP = `type { Person, Order } := io.shex("@${SHAPES}/shop.shex")

People := io.csv("@${SOURCE}/people.csv")
Orders := io.csv("@${SOURCE}/orders.csv")

Buyers : Person from People
    @subject = "https://example.org/person/{People.person_id}"
    name     = People.name
    email    = People.email
    city     = People.city
    country  = People.country

Purchases : Order from Orders
    @subject = "https://example.org/order/{Orders.order_id}"
    product  = Orders.product
    quantity = Orders.quantity
    total    = Orders.total_eur
    buyer    = Person(Orders.person_id)
`;

/** A graph created through the API: `draft`, or submitted (`idle`) for its page's Run to run. */
export async function createGraph(page: Page, { draft = false, name }: { draft?: boolean; name?: string } = {}) {
  // A graph to run writes to a folder no other graph in the sink writes to.
  const folder = `e2e-${crypto.randomUUID()}`;
  const created = await api(page, "POST", "/v1/graphs", { script: SHOP, name, sink_connection: SINK, folder });
  expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
  const { id } = created.body as { id: string };
  // A graph begins as a draft; submitting it makes it runnable.
  if (!draft) {
    const submitted = await api(page, "POST", `/v1/graphs/${id}/submit`, {});
    expect(submitted.status, JSON.stringify(submitted.body)).toBeLessThan(300);
  }
  return id;
}

export const MISSING = "00000000-0000-4000-8000-000000000000";
