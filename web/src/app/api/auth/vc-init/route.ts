const API_URL = process.env.KEASY_API_URL ?? "http://localhost:8080";

export async function POST() {
  try {
    const res = await fetch(`${API_URL}/v1/auth/vc-init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.text();
    return new Response(data, {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return Response.json(
      { error: "proxy_error", message: "Backend unavailable" },
      { status: 502 }
    );
  }
}
