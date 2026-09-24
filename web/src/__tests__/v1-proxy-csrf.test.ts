import { describe, expect, it, vi } from "vitest";

// The proxy never reaches the session for a request it refuses on origin, and
// this test asserts exactly that by leaving `apiToken` unimplemented: a call to
// it is a failure of the thing under test.
const apiToken = vi.fn(() => {
  throw new Error("the proxy read the session for a cross-site write");
});
vi.mock("@/lib/auth", () => ({ apiToken }));

const { DELETE, GET, PATCH, POST, PUT } = await import("@/app/v1/[...path]/route");

const params = Promise.resolve({ path: ["jobs"] });

function call(method: string, secFetchSite?: string) {
  const handler = { POST, PUT, PATCH, DELETE, GET }[method]!;
  const headers = new Headers();
  if (secFetchSite !== undefined) headers.set("sec-fetch-site", secFetchSite);
  const request = new Request("http://localhost:3000/v1/jobs", {
    method,
    headers,
    ...(method === "GET" ? {} : { body: "{}" }),
  });
  return handler(request, { params });
}

/**
 * `SameSite=Lax` is not a boundary between two workspaces: "site" is the
 * registrable domain, so `a.keasy.example` and `b.keasy.example` are same-site,
 * and that pair is exactly the one that must not be able to write for each
 * other. `Sec-Fetch-Site` is, and the page cannot set it.
 */
describe("the /v1 proxy and cross-site writes", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])("refuses a cross-site %s", async (method) => {
    const answer = await call(method, "cross-site");
    expect(answer.status).toBe(403);
    expect(await answer.json()).toMatchObject({ error: "auth/cross_site_write" });
    expect(apiToken).not.toHaveBeenCalled();
  });

  it("refuses a same-site write from another workspace's subdomain", async () => {
    expect((await call("POST", "same-site")).status).toBe(403);
  });

  it("refuses a write from a client that does not say where it came from", async () => {
    expect((await call("POST")).status).toBe(403);
  });

  // Past the origin check, and only then does the proxy start doing its job —
  // here it stops at the unset KEASY_API_URL, which is proof enough that the
  // refusal above is about the origin and not about everything.
  it("lets a same-origin write through to the rest of the proxy", async () => {
    expect((await call("POST", "same-origin")).status).toBe(500);
  });

  // Reads are CORS's business; gating them here would give this proxy opinions.
  it("does not gate reads on the header", async () => {
    expect((await call("GET", "cross-site")).status).toBe(500);
  });
});
