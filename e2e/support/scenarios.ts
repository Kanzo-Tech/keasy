/**
 * The 26 scenarios of the failure audit (keasy/audits/2026-10-01/audit-fallos-keasy.md, "Escenarios
 * que una suite e2e debe forzar"), copied here because the audit lives outside this repository.
 * `coverage.spec.ts` holds every one to a test named `NN …`.
 */
export const SCENARIOS: Record<number, string> = {
  1: "missing job in discover",
  2: "job not completed in discover",
  3: "vending that never answers",
  4: "store that refuses to vend",
  5: "API down",
  6: "API answers 500",
  7: "Valkey down",
  8: "Keycloak down during sign-in",
  9: "callback state mismatch",
  10: "session expired mid-way",
  // 11–15 were written against model connections; the AI gateway replaced them (keasy main,
  // a47894d), so each now forces the same failure where it lives today.
  11: "no model connection — now: the AI gateway is down",
  12: "provider without credit — now: a refusal the gateway relays",
  13: "provider silent mid-stream — now: the AI gateway accepts and never answers",
  14: "provider error event mid-stream",
  15: "model answers non-JSON — now: a structured answer that does not parse",
  16: "invalid SQL from the model",
  17: "a rule that fails",
  18: "run too large",
  19: "tab closed mid-run",
  20: "deleting a running job",
  21: "file listing that fails",
  22: "missing draft",
  23: "routes and bodies axum refuses",
  24: "graph without WebGL",
  25: "sign-out with Keycloak down",
  26: "rate limit",
};
