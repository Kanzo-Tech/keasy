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
export const SOURCE = "MinIO dev bucket";

/** The dev program over the seeded bucket (infra/dev/shop.fossil). */
export const SHOP = `type { Person, Order } := io.shex("@MinIO dev shapes/shop.shex")

People := io.csv("@MinIO dev bucket/people.csv")
Orders := io.csv("@MinIO dev bucket/orders.csv")

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

/** A job created through the API: `draft`, or `pending` for the browser to run when its page opens. */
export async function createJob(page: Page, { draft = false, name }: { draft?: boolean; name?: string } = {}) {
  const created = await api(page, "POST", "/v1/jobs", { script: SHOP, name, draft, sink_connection: SINK });
  expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
  return (created.body as { id: string }).id;
}

export const MISSING = "00000000-0000-4000-8000-000000000000";
