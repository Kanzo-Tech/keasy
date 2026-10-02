import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The repository root, where docker-compose.yml is. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The stack the suite runs against: the dev stack without models (e2e/compose.yml), as `make e2e`
 * and CI bring it up. Every call names the same files, so compose sees one project. */
const FILES = ["-f", "docker-compose.yml", "-f", "e2e/compose.yml"];

function compose(...args: string[]) {
  execFileSync("docker", ["compose", ...FILES, ...args], { cwd: ROOT, stdio: "inherit" });
}

/** Stop `services`. Paired with {@link up} in a `finally`, so a failed scenario leaves the stack whole. */
export function stop(...services: string[]) {
  compose("stop", ...services);
}

/** Start `services` (any profile) and wait until they report healthy. */
export function up(...services: string[]) {
  compose("--profile", "faults", "up", "-d", "--wait", ...services);
}

/** Start `services` without waiting on a health check (LiteLLM's needs its model backend). */
export function start(...services: string[]) {
  compose("--profile", "faults", "up", "-d", ...services);
}

/** Run `scenario` with `services` stopped, and bring them back whatever happens. */
export async function without(services: string[], scenario: () => Promise<void>) {
  stop(...services);
  try {
    await scenario();
  } finally {
    up(...services);
  }
}
