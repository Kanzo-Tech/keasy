import { createHandler } from "@/lib/api-proxy";
const handler = createHandler(({ id }) => `/connections/${id}/files/download`);
export { handler as GET };
