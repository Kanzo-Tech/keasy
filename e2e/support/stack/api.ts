import { ApiError, createApiClient } from "@keasy/api";
import { expect, type Page } from "@playwright/test";

/** Where the suite reaches keasy: the stack on :3000, the only origin Keycloak admits. */
export const BASE_URL = process.env.KEASY_URL ?? "http://acme.localhost:3000";

/**
 * What a browser sends on the app's own requests, and Playwright's request context does not: the web
 * refuses a request that says nothing about where it came from (kanzo-ui's `isSameSite`, closed).
 */
const SAME_ORIGIN = { origin: new URL(BASE_URL).origin, "sec-fetch-site": "same-origin" };

/**
 * keasy's API as the page's session calls it: `@keasy/api`'s typed client over the page's request
 * context, which carries the context's cookies through the edge and the web as the app's own
 * requests do. Every path is a spec path and every body typed; a refusal throws `ApiError` (see {@link expectRefusal}).
 */
export function api(page: Page) {
  return createApiClient({
    baseUrl: `${BASE_URL}/api`,
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const answer = await page.request.fetch(request.url, {
        method: request.method,
        headers: { ...Object.fromEntries(request.headers), ...SAME_ORIGIN },
        data: request.body ? Buffer.from(await request.arrayBuffer()) : undefined,
        failOnStatusCode: false,
      });
      const empty = answer.status() === 204 || answer.status() === 304;
      return new Response(empty ? null : new Uint8Array(await answer.body()), { status: answer.status(), headers: answer.headers() });
    },
  });
}

/** For the scenarios with no screen: the call is refused, with this status and `code`. */
export async function expectRefusal(call: Promise<unknown>, status: number, code: string) {
  const refused = await call.then(
    () => undefined,
    (error: unknown) => {
      if (error instanceof ApiError) return { status: error.status, code: error.code };
      throw error;
    },
  );
  expect(refused).toEqual({ status, code });
}

/**
 * A request the typed client cannot make, because it is wrong on purpose (scenario 23): its status
 * and the `code` of the ErrorBody it answers.
 */
export async function raw(page: Page, method: string, path: string, body?: string) {
  const answer = await page.request.fetch(`${BASE_URL}/api${path}`, {
    method,
    headers: body === undefined ? SAME_ORIGIN : { ...SAME_ORIGIN, "content-type": "application/json" },
    // Bytes, so Playwright sends them as written rather than as a JSON string.
    data: body === undefined ? undefined : Buffer.from(body),
    failOnStatusCode: false,
  });
  return { status: answer.status(), code: ((await answer.json().catch(() => null)) as { code?: string } | null)?.code };
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

/**
 * A graph created through the API: `draft`, or submitted (`idle`) for its page's Run to run. Its
 * program is the suite's shop unless `script` is given.
 */
export async function createGraph(
  page: Page,
  { draft = false, name, script = SHOP }: { draft?: boolean; name?: string; script?: string } = {},
) {
  // A graph to run writes to a folder no other graph in the sink writes to.
  const folder = `e2e-${crypto.randomUUID()}`;
  const http = api(page);
  const { id } = (await http.POST("/v1/graphs", { body: { script, name, sink_connection: SINK, folder } })).data!;
  // A graph begins as a draft; submitting it makes it runnable.
  if (!draft) await http.POST("/v1/graphs/{id}/submit", { params: { path: { id } }, body: {} });
  return id;
}

export const MISSING = "00000000-0000-4000-8000-000000000000";
