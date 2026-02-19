import { createHandler } from "@/lib/api-proxy";
const handler = createHandler(() => "/settings/ai");
export { handler as GET, handler as PUT };
