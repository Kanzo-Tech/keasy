import { createHandler } from "@/lib/api-proxy";
const handler = createHandler(() => "/jobs");
export { handler as GET, handler as POST };
