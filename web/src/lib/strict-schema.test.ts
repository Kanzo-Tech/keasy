import { describe, expect, it } from "vitest";
import { mendedCompletion, refusesSchema, schemaRequests, strictSchema, withoutNulls } from "./strict-schema";

/** The shape of Ask's answer, cut down: `of` required, `where` and `top` optional, a `$defs` reused. */
const ASK = {
  type: "object",
  properties: {
    spec: {
      type: "object",
      properties: {
        of: { type: "string", const: "Airport" },
        where: { type: "array", items: { type: "object", properties: { field: { $ref: "#/$defs/f0" }, in: { type: "array", items: { type: "string" } } }, required: ["field", "in"], additionalProperties: false } },
        top: { type: "number" },
      },
      required: ["of"],
      additionalProperties: false,
    },
  },
  required: ["spec"],
  $defs: { f0: { type: "string", enum: ["name", "country"] } },
};

describe("a strict schema", () => {
  it("requires every key and lets an optional one be null", () => {
    const strict = strictSchema(ASK) as typeof ASK;
    const spec = strict.properties.spec as unknown as { required: string[]; properties: Record<string, unknown> };
    expect(spec.required).toEqual(["of", "where", "top"]);
    expect(spec.properties.of).toEqual({ type: "string", const: "Airport" });
    expect(spec.properties.top).toEqual({ anyOf: [{ type: "number" }, { type: "null" }] });
  });

  it("keeps what the schema refers to, and its own required keys, untouched", () => {
    const strict = JSON.stringify(strictSchema(ASK));
    expect(strict).toContain('"$defs":{"f0":{"type":"string","enum":["name","country"]}}');
    expect(strict).toContain('"required":["field","in"]');
  });

  it("leaves a $ref alone, what was beside it on a wrapper (OpenAI: $ref cannot have keywords)", () => {
    const strict = strictSchema({ type: "object", properties: { field: { $ref: "#/$defs/f0", description: "What it reads." } }, required: ["field"] }) as {
      properties: { field: unknown };
    };
    expect(strict.properties.field).toEqual({ description: "What it reads.", anyOf: [{ $ref: "#/$defs/f0" }] });
  });

  it("closes every object to keys beyond its own", () => {
    const strict = strictSchema({ type: "object", properties: { a: { type: "string" } } }) as { additionalProperties: boolean };
    expect(strict.additionalProperties).toBe(false);
  });
});

describe("a strict answer", () => {
  it("drops the nulls the model wrote for what it left out", () => {
    expect(withoutNulls({ spec: { of: "Airport", where: null, top: null, show: { title: null, kind: "stat" } } })).toEqual({
      spec: { of: "Airport", show: { kind: "stat" } },
    });
  });

  it("is mended inside a whole completion, and one that is not JSON is left as it was", () => {
    const completion = { choices: [{ message: { content: '{"spec":{"of":"Airport","top":null}}' } }, { message: { content: "not json" } }] };
    expect(mendedCompletion(completion)).toEqual({ choices: [{ message: { content: '{"spec":{"of":"Airport"}}' } }, { message: { content: "not json" } }] });
  });
});

describe("a request", () => {
  const body = { model: "m", messages: [], response_format: { type: "json_schema", json_schema: { name: "response", schema: ASK } } };

  it("is asked loose first, its schema as it was", () => {
    const { loose } = schemaRequests(body);
    expect(loose.response_format).toEqual({ type: "json_schema", json_schema: { name: "response", schema: ASK, strict: false } });
  });

  it("has a strict form beside it, its schema made strict", () => {
    const { strict } = schemaRequests(body);
    expect(JSON.stringify(strict)).toContain('"strict":true');
    expect(JSON.stringify(strict)).toContain('"required":["of","where","top"]');
  });

  it("has no strict form when the answer streams: a chunk cannot be mended", () => {
    const { loose, strict } = schemaRequests({ ...body, stream: true });
    expect(strict).toBeUndefined();
    expect(JSON.stringify(loose)).toContain('"strict":false');
  });

  it("without a schema is sent as it was", () => {
    const plain = { model: "m", messages: [] };
    expect(schemaRequests(plain)).toEqual({ loose: plain });
  });
});

describe("a refusal", () => {
  const refused = (detail: string) => ({ code: "ai/refused", detail });

  it("of how the schema was asked for is told apart, to ask again the other way", () => {
    expect(refusesSchema(refused("the provider answered 400 Bad Request: Invalid schema for response_format 'response'"))).toBe(true);
    expect(refusesSchema(refused("the provider answered 400 Bad Request: response_format is only supported as json_schema with strict: true"))).toBe(true);
  });

  it("for any other reason is not: a wrong key, a silence, a schema word in a 401", () => {
    expect(refusesSchema(refused("the provider answered 401 Unauthorized: Incorrect API key provided"))).toBe(false);
    expect(refusesSchema({ code: "ai/silent", detail: "400 schema" })).toBe(false);
    expect(refusesSchema(refused("the provider answered 429 Too Many Requests: schema quota"))).toBe(false);
  });
});
