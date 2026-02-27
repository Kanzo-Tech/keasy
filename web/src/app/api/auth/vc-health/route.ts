const API_URL = process.env.KEASY_API_URL ?? "http://localhost:8080";

export async function GET() {
  try {
    const res = await fetch(`${API_URL}/v1/auth/vc-health`);
    const data = await res.text();
    return new Response(data, {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    // If backend is unreachable, VC is unavailable
    return Response.json({ data: { vc_available: false } });
  }
}
