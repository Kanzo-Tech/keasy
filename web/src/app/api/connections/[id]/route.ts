import { createHandler } from "@/lib/api-proxy";
const handler = createHandler(({ id }) => `/connections/${id}`);
export { handler as GET, handler as PUT, handler as DELETE };
