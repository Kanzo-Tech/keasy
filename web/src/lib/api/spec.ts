import spec from "@keasy/api/openapi.json";

/** The slice of JSON Schema utoipa emits and keasy's forms read. */
export interface JsonSchema {
  $ref?: string;
  type?: string | string[];
  title?: string;
  description?: string;
  format?: string;
  enum?: string[];
  pattern?: string;
  maxLength?: number;
  minLength?: number;
  default?: unknown;
  writeOnly?: boolean;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  oneOf?: JsonSchema[];
}

const components = spec.components.schemas as unknown as Record<string, JsonSchema>;

/** A component of the published contract, by name. */
export function schemaOf(name: string): JsonSchema {
  const found = components[name];
  if (!found) throw new Error(`openapi.json has no schema ${name}`);
  return found;
}

/** A string component's parse rule; lengths count code points, as the server's do. */
export interface StringRule {
  pattern: RegExp;
  minLength: number;
  maxLength: number;
}

/** The rule a string component of the contract carries, compiled. */
export function stringRule(name: string): StringRule {
  const { pattern, minLength, maxLength } = schemaOf(name);
  if (pattern === undefined || maxLength === undefined) {
    throw new Error(`openapi.json's ${name} carries no pattern and maxLength`);
  }
  return { pattern: new RegExp(pattern, "u"), minLength: minLength ?? 0, maxLength };
}

/** Why `rule` refuses `value`, in words, or `null` when it does not; `spelling` says the pattern. */
export function stringProblem(rule: StringRule, value: string, spelling: string): string | null {
  const length = [...value].length;
  if (length < rule.minLength) return "Required.";
  if (length > rule.maxLength) return `At most ${rule.maxLength} characters.`;
  return rule.pattern.test(value) ? null : spelling;
}

/**
 * The figures the server publishes for its clients to keep in step with (`x-keasy-bounds`): its
 * request deadline, which the browser's own must exceed, and a graph's lease, which a runner's
 * heartbeat divides.
 */
export const bounds = spec["x-keasy-bounds"];
