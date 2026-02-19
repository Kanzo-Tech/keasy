import { createHandler } from "@/lib/api-proxy";
const handler = createHandler(() => "/graph/search");
export { handler as POST };
