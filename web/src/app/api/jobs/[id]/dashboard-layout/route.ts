import { createHandler } from "@/lib/api-proxy";
const handler = createHandler(({ id }) => `/jobs/${id}/dashboard-layout`);
export { handler as GET, handler as PUT };
