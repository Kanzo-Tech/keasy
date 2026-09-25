import { authHandlers } from "@/lib/auth/server";

export const GET = (request: Request) => authHandlers().GET(request);
export const POST = (request: Request) => authHandlers().POST(request);
