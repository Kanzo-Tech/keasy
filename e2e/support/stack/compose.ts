import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The repository root, where compose.yaml is. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The stack the suite runs against: the dev stack (compose.yaml and compose.override.yaml, which
 * compose reads on its own), as `make e2e` and CI bring it up. */
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

/** Restart `services` alone, whatever their dependencies are doing, and wait until they report healthy. */
export function restart(...services: string[]) {
  compose("restart", ...services);
  compose("up", "-d", "--wait", "--no-deps", ...services);
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
