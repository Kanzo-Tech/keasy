import { createHandler } from "@/lib/api-proxy";
const handler = createHandler(() => "/graph/expand");
export { handler as POST };
