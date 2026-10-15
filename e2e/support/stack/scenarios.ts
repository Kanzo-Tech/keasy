/**
 * The scenarios of the failure audit (keasy/audits/2026-10-01/audit-fallos-keasy.md, "Escenarios que
 * una suite e2e debe forzar"), copied here because the audit lives outside this repository.
 * `coverage.spec.ts` holds every one to a test named `NN …`, but those {@link ELSEWHERE} forces.
 * 7 (Valkey down), 9 (callback state mismatch) and 25 (sign-out with Keycloak down) are not here:
 * since kanzo-ui 0.48 the session store, the callback and the sign-out are the platform's edge
 * (oauth2-proxy), not keasy's.
 */
export const SCENARIOS: Record<number, string> = {
  1: "missing graph in discover",
  2: "graph not completed in discover",
  3: "vending that never answers",
  4: "store that refuses to vend",
  5: "API down",
  6: "API answers 500",
  8: "Keycloak down during sign-in",
  10: "session expired mid-way",
  // The model runs in the page, so 11–16 are the failures of a model there.
  11: "a browser without WebGPU, where the model cannot run",
  12: "the model's shards cannot be downloaded",
  13: "a model that stops writing",
  14: "a model that fails mid-answer",
  15: "a structured answer that does not parse",
  16: "an answer outside the spec",
  17: "a rule that fails",
  18: "run too large",
  19: "tab closed mid-run",
  20: "deleting a running graph",
  21: "file listing that fails",
  22: "missing draft",
  23: "routes and bodies axum refuses",
  24: "graph without WebGL",
  26: "rate limit",
};

/**
 * Scenarios a suite other than this one forces, and where: the stack's web serves no faster than the
 * dev limiter refills, so the browser cannot burst past it.
 */
export const ELSEWHERE: Record<number, string> = {
  26: "server/tests/api/failures.rs, a_burst_over_the_rate_is_refused_as_request_rate_limited",
};
