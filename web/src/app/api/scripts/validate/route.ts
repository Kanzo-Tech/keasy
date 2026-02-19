import { createHandler } from "@/lib/api-proxy";
const handler = createHandler(() => "/scripts/validate");
export { handler as POST };
