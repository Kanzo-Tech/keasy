const API_URL = process.env.KEASY_API_URL ?? "http://localhost:8080";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/auth/vc-status/${sessionId}`);
  } catch {
    return Response.json(
      { error: "proxy_error", message: "Backend unavailable" },
      { status: 502 }
    );
  }
  // Forward Set-Cookie headers — critical for session establishment
  const responseHeaders = new Headers({
    "Content-Type": res.headers.get("Content-Type") ?? "application/json",
  });
  for (const cookie of res.headers.getSetCookie?.() ?? []) {
    responseHeaders.append("Set-Cookie", cookie);
  }
  return new Response(res.body, { status: res.status, headers: responseHeaders });
}
