import "client-only";

import { createKanzo } from "@kanzo-tech/llm";
import { auth } from "./api/session";

/**
 * The one door to a model: `kanzo("kanzo-chat")`, `kanzo("kanzo-complete")`. Through the BFF
 * like every API call — the server holds the workspace's gateway key, so the page never does —
 * and on the session's own `fetch`.
 */
export const kanzo = createKanzo({ baseURL: "/api/v1/ai", fetch: auth.fetch });
