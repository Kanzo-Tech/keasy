import { createHandler } from "@/lib/api-proxy";
const handler = createHandler(() => "/validate");
export { handler as POST };
