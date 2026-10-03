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

// Roles are asked inside this workspace's organization, and only roles.ts knows how.
const ROLES = {
  name: "@kanzo-tech/auth",
  importNames: ["can"],
  message: "Use holds (lib/auth/roles) or useRole (lib/auth/use-role): a role is asked inside this workspace's organization.",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: { "no-restricted-imports": ["error", { paths: [...NAVIGATION, ROLES] }] },
  },
  {
    files: ["src/lib/auth/roles.ts"],
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
