import { createHandler } from "@/lib/api-proxy";
const handler = createHandler(({ provider_id }) => `/settings/ai/providers/${provider_id}`);
export { handler as PUT, handler as DELETE };
