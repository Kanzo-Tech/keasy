import { createHandler } from "@/lib/api-proxy";
const handler = createHandler(() => "/settings/schema");
export { handler as GET };
