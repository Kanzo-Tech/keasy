import spec from "@keasy/api/openapi.json";

/** The slice of JSON Schema utoipa emits and keasy's forms read. */
export interface JsonSchema {
  $ref?: string;
  type?: string | string[];
  title?: string;
  description?: string;
  format?: string;
  enum?: string[];
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

/**
 * The figures the server publishes for its clients to keep in step with (`x-keasy-bounds`): its
 * request deadline, which the browser's own must exceed, and a job's lease, which a runner's
 * heartbeat divides.
 */
export const bounds = spec["x-keasy-bounds"];
