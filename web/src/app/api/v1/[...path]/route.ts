import { apiHandlers } from "@/lib/auth/server";

export const GET = (request: Request) => apiHandlers().GET(request);
export const POST = (request: Request) => apiHandlers().POST(request);
export const PUT = (request: Request) => apiHandlers().PUT(request);
export const PATCH = (request: Request) => apiHandlers().PATCH(request);
export const DELETE = (request: Request) => apiHandlers().DELETE(request);
// Its own, or Next answers a HEAD with GET and the store gets a URL signed for the wrong method.
export const HEAD = (request: Request) => apiHandlers().HEAD(request);

export const dynamic = "force-dynamic";
