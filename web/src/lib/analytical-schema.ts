import type { FieldStatsItem } from "@/lib/api";
import type { PipelineOutput } from "@/lib/types";

// ── Field roles & schema types ───────────────────────────────────────────

export type FieldRole = "measure" | "dimension" | "identifier";

export interface FieldSchema {
  name: string;
  type: string;
  iri: string;
  role: FieldRole;
  distinct?: number;
  count?: number;
  isObjectProperty?: boolean;
  /** Which entity type owns this field */
  sourceType: string;
}

export interface EntityType {
  typeName: string;
  rdfType?: string;
  fields: FieldSchema[];
}

// ── Type graph edge ──────────────────────────────────────────────────────

export interface TypeEdge {
  fromType: string;
  toType: string;
  predicateIri: string;
  predicateName: string;
}

// ── FieldRef — matches server's FieldRef struct ──────────────────────────

export interface FieldRef {
  predicate: string;
  path: string[];
}

// ── Analytical schema interface ──────────────────────────────────────────

export interface AnalyticalSchema {
  types: EntityType[];
  edges: TypeEdge[];
  allFields: FieldSchema[];
  reachableFrom: (anchor: string) => FieldSchema[];
  resolve: (anchor: string, field: FieldSchema) => FieldRef;
  fieldByKey: (key: string) => FieldSchema | undefined;
  edgeBetween: (from: string, to: string) => TypeEdge | undefined;
  splitCandidates: (anchor: string, excludeKey?: string) => FieldSchema[];
}

// ── Role inference ───────────────────────────────────────────────────────

const IDENTIFIER_RATIO = 0.8;
const ORDINAL_NUMERIC_RATIO = 0.05;
const MAX_ORDINAL_NUMERIC_DISTINCT = 40;
const MAX_DIMENSION_DISTINCT = 200;
const MAX_SPLIT_DISTINCT = 20;

export function inferRole(
  type: string,
  distinct?: number,
  count?: number,
  isObjectProperty?: boolean,
): FieldRole {
  if (isObjectProperty) return "identifier";
  if (type === "Bool") return "dimension";
  if (type === "Int" || type === "Float") {
    if (
      distinct != null &&
      count != null &&
      count > 0 &&
      distinct < MAX_ORDINAL_NUMERIC_DISTINCT &&
      distinct / count < ORDINAL_NUMERIC_RATIO
    ) {
      return "dimension";
    }
    return "measure";
  }
  if (distinct == null || count == null || count === 0) return "dimension";
  if (distinct > MAX_DIMENSION_DISTINCT) return "identifier";
  if (distinct / count > IDENTIFIER_RATIO) return "identifier";
  return "dimension";
}

// ── Builder ──────────────────────────────────────────────────────────────

export function buildAnalyticalSchema(
  outputs: PipelineOutput[],
  fieldStats?: FieldStatsItem[],
): AnalyticalSchema {
  // 1. Stats lookup
  const statsMap = new Map<string, FieldStatsItem>();
  if (fieldStats) {
    for (const s of fieldStats) statsMap.set(s.predicate, s);
  }

  // 2. Build entity types with sourceType on each field
  const types: EntityType[] = outputs.map((o) => {
    const fields: FieldSchema[] = [];
    for (const field of o.fields) {
      if (!field.uri) continue;
      const stat = statsMap.get(field.uri);
      fields.push({
        name: field.name,
        type: field.type,
        iri: field.uri,
        distinct: stat?.distinct,
        count: stat?.count,
        isObjectProperty: stat?.is_object_property,
        role: inferRole(field.type, stat?.distinct, stat?.count, stat?.is_object_property),
        sourceType: o.type_name,
      });
    }
    return {
      typeName: o.type_name,
      rdfType: o.rdf_type ?? undefined,
      fields,
    };
  });

  // 3. Build type graph edges — object property fields pointing to another known type
  const typeNameSet = new Set(types.map((t) => t.typeName));
  const edges: TypeEdge[] = [];
  for (const et of types) {
    for (const f of et.fields) {
      if (f.isObjectProperty && typeNameSet.has(f.type)) {
        edges.push({
          fromType: et.typeName,
          toType: f.type,
          predicateIri: f.iri,
          predicateName: f.name,
        });
      }
    }
  }

  // Pre-index edges by fromType→toType for O(1) lookups
  const edgeByFromTo = new Map<string, TypeEdge>();
  for (const e of edges) {
    edgeByFromTo.set(`${e.fromType}->${e.toType}`, e);
  }

  // 4. Flat array of non-object-property fields
  const allFields: FieldSchema[] = types.flatMap((et) =>
    et.fields.filter((f) => !f.isObjectProperty),
  );

  // 5. Key lookup
  const keyMap = new Map<string, FieldSchema>();
  for (const f of allFields) {
    keyMap.set(fieldKey(f), f);
  }

  // 6. Schema methods
  const reachableCache = new Map<string, FieldSchema[]>();

  function reachableFrom(anchor: string): FieldSchema[] {
    const cached = reachableCache.get(anchor);
    if (cached) return cached;
    const reachableTypes = new Set([anchor]);
    for (const e of edges) {
      if (e.fromType === anchor) reachableTypes.add(e.toType);
    }
    const result = allFields.filter((f) => reachableTypes.has(f.sourceType));
    reachableCache.set(anchor, result);
    return result;
  }

  function resolve(anchor: string, field: FieldSchema): FieldRef {
    if (field.sourceType === anchor) {
      return { predicate: field.iri, path: [] };
    }
    const edge = edgeByFromTo.get(`${anchor}->${field.sourceType}`);
    if (edge) {
      return { predicate: field.iri, path: [edge.predicateIri] };
    }
    // Fallback: direct
    return { predicate: field.iri, path: [] };
  }

  function fieldByKey(key: string): FieldSchema | undefined {
    return keyMap.get(key);
  }

  function edgeBetween(from: string, to: string): TypeEdge | undefined {
    return edgeByFromTo.get(`${from}->${to}`);
  }

  function splitCandidates(anchor: string, excludeKey?: string): FieldSchema[] {
    return reachableFrom(anchor).filter(
      (f) =>
        f.role === "dimension" &&
        (f.distinct ?? Infinity) <= MAX_SPLIT_DISTINCT &&
        (!excludeKey || fieldKey(f) !== excludeKey),
    );
  }

  return { types, edges, allFields, reachableFrom, resolve, fieldByKey, edgeBetween, splitCandidates };
}

// ── Helpers (pure, no React) ─────────────────────────────────────────────

/** Canonical key for a field: `TypeName::fieldName` */
export function fieldKey(f: FieldSchema): string {
  return `${f.sourceType}::${f.name}`;
}

/** Pick the best default anchor type — the one with most dimension + measure fields */
export function defaultAnchorType(schema: AnalyticalSchema): EntityType {
  return schema.types.reduce((best, cur) => {
    const score = (t: EntityType) =>
      t.fields.filter((f) => f.role !== "identifier" && !f.isObjectProperty).length;
    return score(cur) > score(best) ? cur : best;
  }, schema.types[0]);
}

