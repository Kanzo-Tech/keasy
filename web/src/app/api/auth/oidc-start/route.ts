const API_URL = process.env.KEASY_API_URL ?? "http://localhost:8080";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const backendUrl = `${API_URL}/v1/auth/oidc-start${url.search}`;

  let res: Response;
  try {
    res = await fetch(backendUrl, {
      redirect: "manual", // Don't follow -- pass redirect to browser
      headers: req.headers.has("Cookie")
        ? { Cookie: req.headers.get("Cookie")! }
        : {},
    });
  } catch {
    // Backend unavailable -- redirect to login with error
    return Response.redirect(new URL("/login?error=auth_failed", req.url));
  }

  // Forward the redirect response to the browser
  const responseHeaders = new Headers();
  // Forward session cookie from Axum
  for (const cookie of res.headers.getSetCookie?.() ?? []) {
    responseHeaders.append("Set-Cookie", cookie);
  }
  const location = res.headers.get("location") ?? "/login?error=auth_failed";
  responseHeaders.set("Location", location);
  return new Response(null, { status: 302, headers: responseHeaders });
}
