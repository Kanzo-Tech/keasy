import "client-only";

import { createGateway } from "@kanzo-tech/llm";
import { auth } from "./api/session";
import { MODEL_CALLS } from "./routes";

/**
 * The one door to a model: `gateway("chat")`, `gateway("complete")`. Through the BFF
 * like every API call — it forwards to the AI gateway with the session's token exchanged for the
 * gateway and this organization, so no key exists to hold — and on the session's own `fetch`.
 */
export const gateway = createGateway({ baseURL: MODEL_CALLS, fetch: auth.fetch });
