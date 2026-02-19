import { createHandler } from "@/lib/api-proxy";
const handler = createHandler(() => "/cloud-accounts");
export { handler as GET, handler as POST };
