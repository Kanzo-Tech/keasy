const API_URL = process.env.KEASY_API_URL ?? "http://localhost:8080";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  let res: Response;
  try {
    res = await fetch(
      `${API_URL}/v1/admin/invites/${encodeURIComponent(token)}`,
      {
        method: "DELETE",
        headers: {
          ...(req.headers.has("Cookie")
            ? { Cookie: req.headers.get("Cookie")! }
            : {}),
        },
      },
    );
  } catch {
    return Response.json(
      { error: "proxy_error", message: "Backend unavailable" },
      { status: 502 },
    );
  }
  if (res.status === 204) {
    return new Response(null, { status: 204 });
  }
  const responseHeaders = new Headers({
    "Content-Type": res.headers.get("Content-Type") ?? "application/json",
  });
  return new Response(res.body, { status: res.status, headers: responseHeaders });
}
