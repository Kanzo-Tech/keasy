import { createHandler } from "@/lib/api-proxy";
const handler = createHandler(({ id }) => `/conversations/${id}`);
export { handler as PUT, handler as DELETE };
