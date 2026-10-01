import "client-only";

import { createGateway } from "@kanzo-tech/llm";
import { auth } from "./api/session";

/**
 * The one door to a model: `gateway("chat")`, `gateway("complete")`. Through the BFF
 * like every API call — the server holds the workspace's gateway key, so the page never does —
 * and on the session's own `fetch`.
 */
export const gateway = createGateway({ baseURL: "/api/v1/ai", fetch: auth.fetch });
