const API_URL = process.env.KEASY_API_URL ?? "http://localhost:8080";

export async function POST(req: Request) {
  const body = await req.text();
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/admin/dataspaces`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(req.headers.has("Cookie")
          ? { Cookie: req.headers.get("Cookie")! }
          : {}),
      },
      body,
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
  for (const cookie of res.headers.getSetCookie?.() ?? []) {
    responseHeaders.append("Set-Cookie", cookie);
  }
  return new Response(res.body, { status: res.status, headers: responseHeaders });
}
