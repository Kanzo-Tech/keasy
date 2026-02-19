import { createHandler } from "@/lib/api-proxy";
const handler = createHandler(({ id }) => `/jobs/${id}/graph`);
export { handler as GET };
