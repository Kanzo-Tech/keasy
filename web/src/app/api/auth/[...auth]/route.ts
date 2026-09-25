import { authHandlers } from "@/lib/auth";

export const GET = (request: Request) => authHandlers().GET(request);
export const POST = (request: Request) => authHandlers().POST(request);
