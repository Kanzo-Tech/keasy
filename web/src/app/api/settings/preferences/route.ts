import { createHandler } from "@/lib/api-proxy";
const handler = createHandler(() => "/settings/preferences");
export { handler as GET, handler as PUT };
