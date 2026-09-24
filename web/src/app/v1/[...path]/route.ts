import { apiProxy } from "@/lib/auth";

export const GET = (request: Request) => apiProxy().GET(request);
export const POST = (request: Request) => apiProxy().POST(request);
export const PUT = (request: Request) => apiProxy().PUT(request);
export const PATCH = (request: Request) => apiProxy().PATCH(request);
export const DELETE = (request: Request) => apiProxy().DELETE(request);

export const dynamic = "force-dynamic";
