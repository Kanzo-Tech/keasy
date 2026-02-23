import { createHandler } from "@/lib/api-proxy";
const handler = createHandler(({ id }) => `/jobs/${id}/conversations`);
export { handler as GET, handler as POST };
