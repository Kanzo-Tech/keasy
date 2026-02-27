const API_URL = process.env.KEASY_API_URL ?? "http://localhost:8080";

export async function POST(req: Request) {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/auth/logout`, {
      method: "POST",
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
  // Forward Set-Cookie so backend can clear keasy.sid
  for (const cookie of res.headers.getSetCookie?.() ?? []) {
    responseHeaders.append("Set-Cookie", cookie);
  }
  return new Response(res.body, { status: res.status, headers: responseHeaders });
}
