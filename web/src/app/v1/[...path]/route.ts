import { apiToken } from "@/lib/auth";

/**
 * The BFF's other half: every `/v1` call, forwarded to the Rust resource server
 * with the credential attached.
 *
 * This exists because of the rule the whole design rests on — **the token never
 * reaches the browser**. Something has to attach it, and the only process that
 * holds one is this one. So the browser calls `/v1/...` same-origin with a
 * cookie it cannot read, this reads the cookie, and the API sees a bearer token
 * it validates against the realm's JWKS. The API client's `baseUrl` is still
 * `/`, so no call site knows any of this happened.
 *
 * Nothing here decides anything. It does not read roles, does not inspect the
 * body, and refuses only when there is no credential to send at all, or when the
 * browser says the request did not come from this application — the resource
 * server is what refuses a request, and putting a second opinion here would be
 * putting authorization in the place that cannot enforce it.
 */

const API = process.env.KEASY_API_URL;

/** Methods that can change something, and so are worth forging. */
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Does the browser say this write came from this application?
 *
 * Authenticating by cookie means a cross-site form or `fetch` can spend the
 * session without ever reading it, and `SameSite=Lax` is not the whole answer
 * here: "site" is the registrable domain, so `a.keasy.example` and
 * `b.keasy.example` are same-site. Between two workspaces on the same domain —
 * which is exactly how this fleet is deployed — Lax stops nothing, and the two
 * tenants are precisely the pair that must not be able to write for each other.
 *
 * `Sec-Fetch-Site` is the browser's own account of where the request started,
 * and it is one the page cannot set: it is a forbidden header name. Widely
 * available across browsers since March 2023, which is well inside what an
 * application compiling WebAssembly already requires — so a write without it is
 * not a browser this product runs in, and is refused rather than assumed.
 *
 * Only writes are checked. A cross-site read is already answered by CORS, and
 * gating reads here would break nothing today but would make this proxy a thing
 * with opinions, which it is deliberately not.
 */
function sameOriginWrite(request: Request): boolean {
  if (!UNSAFE_METHODS.has(request.method)) return true;
  return request.headers.get("sec-fetch-site") === "same-origin";
}

/** The response envelope the API client already knows how to route on. */
function refuse(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ error: code, message }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/**
 * Headers that describe *this* hop and must not be replayed on the next one.
 *
 * `cookie` above all: the session cookie is this tier's business and the API has
 * no use for it — forwarding it would quietly offer the resource server a second
 * credential to be tempted by. `host` and `content-length` are recomputed by the
 * outgoing request, and a body forwarded as a stream is chunked, so a
 * transcribed length would be a lie.
 */
const DROP_FROM_REQUEST = [
  "cookie",
  "host",
  "connection",
  "content-length",
  "authorization",
  "transfer-encoding",
];

/** Set by the fetch below, and wrong if copied from the upstream answer. */
const DROP_FROM_RESPONSE = ["content-encoding", "content-length", "transfer-encoding"];

async function proxy(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  // First, and before anything is read: a request from somewhere else is not a
  // request, so there is nothing here to configure, look up or forward for it.
  if (!sameOriginWrite(request)) {
    return refuse("auth/cross_site_write", "Cross-site writes are refused", 403);
  }

  if (API === undefined || API === "") {
    return refuse("internal_error", "KEASY_API_URL is not configured", 500);
  }

  const token = await apiToken(request.headers.get("cookie"));
  if (token === null) {
    return refuse("auth/session_required", "Authentication required", 401);
  }

  const { path } = await context.params;
  const incoming = new URL(request.url);
  const target = new URL(`${API.replace(/\/$/, "")}/v1/${path.join("/")}`);
  target.search = incoming.search;

  const headers = new Headers(request.headers);
  for (const name of DROP_FROM_REQUEST) headers.delete(name);
  headers.set("authorization", `Bearer ${token}`);

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    // Streams the request body through rather than buffering it — an upload and
    // an SSE request both pass without this tier deciding how big they may be.
    ...(hasBody ? { duplex: "half" } : {}),
    redirect: "manual",
    cache: "no-store",
  });

  const answered = new Headers(upstream.headers);
  for (const name of DROP_FROM_RESPONSE) answered.delete(name);

  // `upstream.body` rather than the bytes: the assistant and the discovery chat
  // answer with SSE, and buffering here would hold every token until the last.
  return new Response(upstream.body, { status: upstream.status, headers: answered });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;

/** A proxy has nothing to prerender, and a cached answer would be someone else's. */
export const dynamic = "force-dynamic";
