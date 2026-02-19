import { createHandler } from "@/lib/api-proxy";
const handler = createHandler(() => "/graph");
export { handler as GET };
