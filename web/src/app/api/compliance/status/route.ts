const API_URL = process.env.KEASY_API_URL ?? "http://localhost:8080";

function proxyHeaders(req: Request): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(req.headers.has("Cookie") ? { Cookie: req.headers.get("Cookie")! } : {}),
  };
}

export async function GET(req: Request) {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/gaia-x/compliance`, {
      method: "GET",
      headers: proxyHeaders(req),
    });
  } catch {
    return Response.json({ error: "proxy_error", message: "Backend unavailable" }, { status: 502 });
  }
  const responseHeaders = new Headers({
    "Content-Type": res.headers.get("Content-Type") ?? "application/json",
  });
  for (const cookie of res.headers.getSetCookie?.() ?? []) {
    responseHeaders.append("Set-Cookie", cookie);
  }
  return new Response(res.body, { status: res.status, headers: responseHeaders });
}
