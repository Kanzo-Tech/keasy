import { createHandler } from "@/lib/api-proxy";
const handler = createHandler(({ id }) => `/jobs/${id}`);
export { handler as GET, handler as PUT, handler as DELETE };
