import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The repository root, where docker-compose.yml is. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function compose(...args: string[]) {
  execFileSync("docker", ["compose", ...args], { cwd: ROOT, stdio: "inherit" });
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
