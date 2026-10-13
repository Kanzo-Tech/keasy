import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// The failure guards (fossil docs/design/failure, "The guards"), stated as rules. An exception is the
// rule's own suppression at the site, `// eslint-disable-next-line <rule> -- <reason>`: the reason
// is the guard's, and a reviewer reads it where the exception is.

const RESTRICTED_IMPORTS = [
  // A raw link or router walks past the unsaved-changes guard, and nothing at runtime notices.
  { name: "next/link", message: "Use Link from @kanzo-tech/navigation/next." },
  {
    name: "next/navigation",
    importNames: ["useRouter"],
    message: "Use useRouter from @kanzo-tech/navigation/next.",
  },
  // A query that fails throws to the nearest `Boundary`, which shows it by `ProblemView` — so no
  // screen can forget to read `error` and draw an empty list instead. A site whose partial data is
  // worth showing next to the failure says so in its suppression.
  {
    name: "@tanstack/react-query",
    importNames: ["useQuery", "useQueries"],
    message: "Read with useSuspenseQuery: a failure throws to the route's boundary.",
  },
];

const RESTRICTED_SYNTAX = [
  // `x ??= start()` caches whatever `start()` returned for the life of the page — a rejected promise
  // included, so one transient failure poisons the tab until it is reloaded.
  {
    selector: "AssignmentExpression[operator='??='][right.type='CallExpression']",
    message: "A ??= memo keeps a failure for good: fetchQuery with staleTime: Infinity forgets it.",
  },
  // A `.catch` that throws the failure away.
  ...[
    "ArrowFunctionExpression[body.type='Identifier'][body.name='undefined']",
    "ArrowFunctionExpression > BlockStatement[body.length=0]",
  ].map((swallow) => ({
    selector: `CallExpression[callee.property.name='catch'] > ${swallow}`,
    message: "A failure swallowed is a failure nobody sees: say why losing it is correct.",
  })),
];

// Every wait on the network has a deadline, set in one place: `lib/deadline.ts`.
const FETCH = "Fetch through deadlineFetch (lib/deadline.ts): every wait on the network has a deadline.";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "no-restricted-imports": ["error", { paths: RESTRICTED_IMPORTS }],
      "no-restricted-syntax": ["error", ...RESTRICTED_SYNTAX],
      // A block holding a comment is not empty: the comment is the reason.
      "no-empty": "error",
      "no-restricted-globals": ["error", { name: "fetch", message: FETCH }],
      "no-restricted-properties": [
        "error",
        { object: "window", property: "fetch", message: FETCH },
        { object: "globalThis", property: "fetch", message: FETCH },
        { object: "$api", property: "useQuery", message: "Read with $api.useSuspenseQuery: a failure throws to the route's boundary." },
      ],
    },
  },
  {
    files: ["src/lib/deadline.ts"],
    rules: { "no-restricted-globals": "off", "no-restricted-properties": "off" },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "no-restricted-globals": "off",
      "no-restricted-properties": "off",
      "no-restricted-syntax": "off",
    },
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
