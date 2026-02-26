const API_URL = process.env.KEASY_API_URL ?? "http://localhost:8080";

type RouteCtx = { params: Promise<Record<string, string>> };

export function createHandler(
  pathFn: (params: Record<string, string>, url: URL) => string
) {
  return async (req: Request, ctx: RouteCtx) => {
    const params = await ctx.params;
    const url = new URL(req.url);
    const path = pathFn(params, url);

    let res: globalThis.Response;
    try {
      res = await fetch(`${API_URL}/v1${path}${url.search}`, {
        method: req.method,
        headers: {
          ...(req.headers.has("Cookie")
            ? { Cookie: req.headers.get("Cookie")! }
            : {}),
          ...(req.headers.has("Content-Type")
            ? { "Content-Type": req.headers.get("Content-Type")! }
            : {}),
        },
        body: ["POST", "PUT", "PATCH"].includes(req.method)
          ? await req.text()
          : undefined,
      });
    } catch {
      return Response.json(
        { error: { code: "proxy_error", message: "Backend unavailable" } },
        { status: 502 }
      );
    }

    const responseHeaders = new Headers({
      "Content-Type": res.headers.get("Content-Type") ?? "application/json",
    });
    if (res.headers.has("Content-Disposition")) {
      responseHeaders.set(
        "Content-Disposition",
        res.headers.get("Content-Disposition")!
      );
    }
    // Forward all Set-Cookie headers (login/register set keasy.sid)
    const setCookies = res.headers.getSetCookie?.() ?? [];
    for (const cookie of setCookies) {
      responseHeaders.append("Set-Cookie", cookie);
    }
    return new Response(res.body, { status: res.status, headers: responseHeaders });
  };
}
