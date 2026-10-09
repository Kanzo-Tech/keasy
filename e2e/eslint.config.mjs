import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import playwright from "eslint-plugin-playwright";
import tseslint from "typescript-eslint";

// The habits that make an end-to-end test flaky or blind: a fixed sleep instead of waiting for what
// it waits on, a click forced past the check that a person could make it, a handle to an element
// that may since have been replaced, and a one-off read instead of an assertion that retries.
const STRICT = {
  "playwright/no-wait-for-timeout": "error",
  "playwright/no-force-option": "error",
  "playwright/no-element-handle": "error",
  "playwright/prefer-web-first-assertions": "error",
};

// The suite's own assertions: the one view that names a failure, a refusal's status and code, and a
// sign-in that lands on the app.
const ASSERTIONS = ["expectProblem", "expectRefusal", "signIn"];

const eslintConfig = defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ...playwright.configs["flat/recommended"],
    files: ["**/*.ts"],
    rules: {
      ...playwright.configs["flat/recommended"].rules,
      ...STRICT,
      "playwright/expect-expect": ["warn", { assertFunctionNames: ASSERTIONS }],
    },
  },
  {
    // A demo is declared, not written as a test: `demo()` (demos/record/recorder.ts) makes the test,
    // and each step's check runs inside it, in order — the plugin sees the checks' `expect`s outside a
    // `test(...)` it can find. And a demo whose example or feature is not on main yet is skipped by
    // its `skip` reason, which is a condition.
    files: ["demos/**/*.ts"],
    rules: {
      "playwright/no-standalone-expect": "off",
      "playwright/no-skipped-test": ["warn", { allowConditional: true }],
    },
  },
  globalIgnores(["node_modules/**", "playwright-report/**", "test-results/**", ".auth/**", "demos/out/**"]),
]);

export default eslintConfig;
