// copy-fossil-wasm.mjs — stage the fossil-wasm artefact into public/ so the
// LSP Worker can fetch it by a stable static URL.
//
// Per @fossil-lang/wasm's documented Next.js pattern: serve `fossil_wasm_bg.wasm`
// from `public/` and pass the static URL (`/fossil/fossil_wasm_bg.wasm`) to
// `initFossilWasm`, rather than relying on bundler `.wasm` asset magic (which
// varies across webpack/Turbopack). Runs in `predev` + `prebuild`. The copied
// file is gitignored — node_modules is the source of truth, re-staged on every
// dev/build after a re-vendor bumps the wasm.

import { createRequire } from "node:module";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

// Each fossil-wasm artefact the app fetches by a stable static URL:
//  - @fossil-lang/wasm     → LSP Worker (`/fossil/fossil_wasm_bg.wasm`)
//  - @fossil-lang/graph    → discovery verb client (`/fossil/fossil_graph_wasm_bg.wasm`)
//  - @fossil-lang/executor → browser job runner / DataFusion-WASM (`/fossil/fossil_df_wasm_bg.wasm`)
const ARTEFACTS = [
  { pkg: "@fossil-lang/wasm/pkg/fossil_wasm_bg.wasm", file: "fossil_wasm_bg.wasm" },
  { pkg: "@fossil-lang/graph/pkg/fossil_graph_wasm_bg.wasm", file: "fossil_graph_wasm_bg.wasm" },
  { pkg: "@fossil-lang/executor/pkg/fossil_df_wasm_bg.wasm", file: "fossil_df_wasm_bg.wasm" },
];

for (const { pkg, file } of ARTEFACTS) {
  // Prefer the package's `./pkg/*.wasm` export; fall back to the physical
  // node_modules path (pnpm symlink — copyFileSync follows it).
  let src;
  try {
    src = require.resolve(pkg);
  } catch {
    src = resolve(here, `../node_modules/${pkg}`);
  }
  const dest = resolve(here, `../public/fossil/${file}`);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  console.log(`[copy-fossil-wasm] ${src} → ${dest}`);
}
