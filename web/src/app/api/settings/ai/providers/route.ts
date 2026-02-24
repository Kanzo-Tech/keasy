import { createHandler } from "@/lib/api-proxy";
const handler = createHandler(() => "/settings/ai/providers");
export { handler as GET };
