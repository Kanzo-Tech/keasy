const API_URL = process.env.KEASY_API_URL ?? "http://localhost:8080";
const API_KEY = process.env.KEASY_API_KEY ?? "";

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
          "X-Api-Key": API_KEY,
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

    return new Response(res.body, {
      status: res.status,
      headers: {
        "Content-Type":
          res.headers.get("Content-Type") ?? "application/json",
        ...(res.headers.has("Content-Disposition")
          ? { "Content-Disposition": res.headers.get("Content-Disposition")! }
          : {}),
      },
    });
  };
}
