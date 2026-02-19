import { createHandler } from "@/lib/api-proxy";
const handler = createHandler(({ id }) => `/connections/${id}/files`);
export { handler as GET };
