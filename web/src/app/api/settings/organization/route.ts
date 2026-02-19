import { createHandler } from "@/lib/api-proxy";
const handler = createHandler(() => "/settings/organization");
export { handler as GET, handler as PUT };
