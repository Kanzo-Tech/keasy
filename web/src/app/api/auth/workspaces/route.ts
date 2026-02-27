const API_URL = process.env.KEASY_API_URL ?? "http://localhost:8080";

export async function GET(req: Request) {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/auth/workspaces`, {
      method: "GET",
      headers: {
        ...(req.headers.has("Cookie")
          ? { Cookie: req.headers.get("Cookie")! }
          : {}),
      },
    });
  } catch {
    return Response.json(
      { error: "proxy_error", message: "Backend unavailable" },
      { status: 502 }
    );
  }
  const responseHeaders = new Headers({
    "Content-Type": res.headers.get("Content-Type") ?? "application/json",
  });
  return new Response(res.body, { status: res.status, headers: responseHeaders });
}
