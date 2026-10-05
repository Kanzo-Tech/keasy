import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// A raw link or router walks past the unsaved-changes guard, and nothing at runtime notices.
const NAVIGATION = [
  { name: "next/link", message: "Use Link from @kanzo-tech/navigation/next." },
  {
    name: "next/navigation",
    importNames: ["useRouter"],
    message: "Use useRouter from @kanzo-tech/navigation/next.",
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: { "no-restricted-imports": ["error", { paths: NAVIGATION }] },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
