import { createHandler } from "@/lib/api-proxy";
const handler = createHandler(() => "/connections");
export { handler as GET, handler as POST };
