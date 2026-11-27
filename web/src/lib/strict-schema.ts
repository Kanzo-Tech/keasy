/**
 * OpenAI's strict structured outputs for a schema that has optional fields. In strict mode the model
 * is held to the schema as it writes — no field it may not have, no value outside an `enum` — but
 * OpenAI takes only a schema whose every object lists all its keys as `required`, and Ask's answers
 * have optional ones. So the schema is sent with each optional key required and `null` allowed for
 * it, and the answer comes back with those `null`s dropped: the shape the schema asked for.
 *
 * Strict is the second ask, not the first. Tried against OpenAI, `gpt-4.1-mini` held to Ask's schema
 * picks its first kind of tile (one figure) where loose it picks the chart the question needs, so a
 * schema is asked for loose, as a guide the answer is checked against. Strict is for a provider that
 * takes nothing else: Claude's OpenAI-compatible API refuses `response_format` unless `strict: true`.
 *
 * Only a whole answer can be mended; a streamed one is never asked for strict.
 */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

const isObject = (value: Json | undefined): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** `schema` that also takes `null`. */
function nullable(schema: Json): Json {
  return { anyOf: [schema, { type: "null" }] };
}

/**
 * Every key of every object required, an optional one nullable instead, and no key beyond them. A
 * `$ref` stands alone in strict mode: what is written beside it (a `description`) moves to a wrapper.
 */
export function strictSchema(schema: Json): Json {
  if (Array.isArray(schema)) return schema.map(strictSchema);
  if (!isObject(schema)) return schema;
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(schema)) {
    out[key] =
      key === "properties" || key === "$defs" || key === "definitions"
        ? isObject(value)
          ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, strictSchema(v)]))
          : value
        : key === "items" || key === "anyOf" || key === "oneOf" || key === "allOf"
          ? strictSchema(value)
          : value;
  }
  if (typeof out.$ref === "string" && Object.keys(out).length > 1 && out.anyOf === undefined) {
    const { $ref, ...beside } = out;
    return { ...beside, anyOf: [{ $ref }] };
  }
  const properties = out.properties;
  if (isObject(properties)) {
    const required = new Set(Array.isArray(schema.required) ? schema.required.filter((k) => typeof k === "string") : []);
    out.properties = Object.fromEntries(
      Object.entries(properties).map(([k, v]) => [k, required.has(k) ? v : nullable(v)]),
    );
    out.required = Object.keys(properties);
    out.additionalProperties = false;
  }
  return out;
}

/** `value` without the keys a strict answer set to `null`: the optional fields it left out. */
export function withoutNulls(value: Json): Json {
  if (Array.isArray(value)) return value.map(withoutNulls);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== null)
      .map(([k, v]) => [k, withoutNulls(v)]),
  );
}

/**
 * A chat completion request in its two forms: `loose`, its JSON schema with `strict: false`, the one
 * asked first; and `strict`, its schema made strict, for a provider that refuses the loose one — its
 * answer to be mended with {@link mendedCompletion}. A request with no schema is `loose` as it was; a
 * streamed one has no `strict`.
 */
export function schemaRequests(body: JsonObject): { loose: JsonObject; strict?: JsonObject } {
  const format = body.response_format;
  if (!isObject(format) || format.type !== "json_schema" || !isObject(format.json_schema)) return { loose: body };
  const spec = format.json_schema;
  const loose = { ...body, response_format: { ...format, json_schema: { ...spec, strict: false } } };
  if (body.stream === true) return { loose };
  const json_schema = { ...spec, strict: true, ...(spec.schema === undefined ? {} : { schema: strictSchema(spec.schema) }) };
  return { loose, strict: { ...body, response_format: { ...format, json_schema } } };
}

/**
 * Whether a refusal of the relay is the provider refusing how the schema was asked for (a 400 that
 * names the schema or `response_format`: Claude's, for anything but strict), so the other form may
 * be taken; a wrong key, an unknown model or a silence is not.
 */
export function refusesSchema(problem: Json): boolean {
  if (!isObject(problem) || problem.code !== "ai/refused" || typeof problem.detail !== "string") return false;
  return /\b400\b/.test(problem.detail) && /schema|response_format/i.test(problem.detail);
}

/** A whole chat completion with each answer's `null`s dropped; one that does not read as JSON, as it was. */
export function mendedCompletion(completion: Json): Json {
  if (!isObject(completion) || !Array.isArray(completion.choices)) return completion;
  return {
    ...completion,
    choices: completion.choices.map((choice) => {
      if (!isObject(choice) || !isObject(choice.message) || typeof choice.message.content !== "string") return choice;
      let answer: Json;
      try {
        answer = JSON.parse(choice.message.content) as Json;
      } catch {
        return choice;
      }
      return { ...choice, message: { ...choice.message, content: JSON.stringify(withoutNulls(answer)) } };
    }),
  };
}
