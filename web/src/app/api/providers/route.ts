import { createHandler } from "@/lib/api-proxy";
const handler = createHandler(() => "/providers");
export { handler as GET };
