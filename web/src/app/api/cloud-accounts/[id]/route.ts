import { createHandler } from "@/lib/api-proxy";
const handler = createHandler(({ id }) => `/cloud-accounts/${id}`);
export { handler as GET, handler as PUT, handler as DELETE };
