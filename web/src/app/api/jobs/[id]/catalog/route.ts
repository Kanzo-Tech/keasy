import { createHandler } from "@/lib/api-proxy";
const handler = createHandler(({ id }) => `/jobs/${id}/catalog`);
export { handler as GET };
