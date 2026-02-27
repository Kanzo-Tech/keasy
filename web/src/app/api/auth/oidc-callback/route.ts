const API_URL = process.env.KEASY_API_URL ?? "http://localhost:8080";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const backendUrl = `${API_URL}/v1/auth/oidc-callback${url.search}`;

  let res: Response;
  try {
    res = await fetch(backendUrl, {
      redirect: "manual",
      headers: req.headers.has("Cookie")
        ? { Cookie: req.headers.get("Cookie")! }
        : {},
    });
  } catch {
    return Response.redirect(new URL("/login?error=auth_failed", req.url));
  }

  const responseHeaders = new Headers();
  // Forward session cookie from Axum to browser (CRITICAL for auth)
  for (const cookie of res.headers.getSetCookie?.() ?? []) {
    responseHeaders.append("Set-Cookie", cookie);
  }
  // Forward redirect location (to /connections or /login?error=auth_failed)
  const location = res.headers.get("location") ?? "/login?error=auth_failed";
  responseHeaders.set("Location", location);
  return new Response(null, { status: 302, headers: responseHeaders });
}
