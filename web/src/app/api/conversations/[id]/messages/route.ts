import { createHandler } from "@/lib/api-proxy";
const handler = createHandler(({ id }) => `/conversations/${id}/messages`);
export { handler as GET };
