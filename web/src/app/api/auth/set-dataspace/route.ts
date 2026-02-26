const API_URL = process.env.KEASY_API_URL ?? "http://localhost:8080";

export async function POST(req: Request) {
  const body = await req.text();
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/auth/set-dataspace`, {
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
  return new Response(null, { status: res.status });
}
