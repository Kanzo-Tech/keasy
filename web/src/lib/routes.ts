/** Where a failed sign-in, callback or sign-out lands, with `?code=`; `proxy.ts` keeps it public. */
export const PROBLEM_PAGE = "/auth/error";

/** The BFF's API proxy: same origin, forwarded to the resource server with the session's token. */
export const API = "/api";

/**
 * Model calls, through the API proxy. `@kanzo-tech/llm`'s `createGateway` bounds them itself, so
 * `deadlineFetch` passes them through whole.
 */
export const MODEL_CALLS = `${API}/v1/ai`;
