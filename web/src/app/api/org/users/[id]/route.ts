const API_URL = process.env.KEASY_API_URL ?? "http://localhost:8080";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.text();
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/org/users/${id}`, {
      method: "PUT",
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

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/org/users/${id}`, {
      method: "DELETE",
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
  return new Response(null, { status: res.status });
}
