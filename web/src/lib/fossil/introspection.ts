/**
 * Source-binding introspection — pure helpers for the schema-aware editor
 * (CONNECTION-SHAPE-MODEL step 2). Ported from the @fossil-lang/playground
 * reference (`packages/playground/src/run/introspection.ts`) so keasy and the
 * playground agree on the same source-name → primitive mapping.
 *
 * Flow: scrape `@conn/path` source bindings from the `.fossil` text
 * (`extractSourceRefs`) → resolve each to a signed URL + `DESCRIBE` it in
 * DuckDB-WASM (caller's concern) → map the DuckDB column types to canonical
 * Fossil primitives (`buildInferredDescriptor`) → push the descriptor to the
 * LSP worker via `fossil/registerInferredDescriptor`.
 *
 * LIMITATIONS (inherited from the reference regex; an AST walk supersedes it):
 *   - no multi-line constructor (`name :=\n  io.csv("...")`)
 *   - no interleaved comments between `:=` and `io.csv(`
 *   - no backslash-escaped quotes inside the URL string
 */

import type {
  InferredColumnJson,
  InferredDescriptorJson,
  InferredPrimitive,
} from "@fossil-lang/wasm";

/**
 * Map a DuckDB column-type string to the canonical Fossil primitive name.
 * MUST match `fossil-hir::infer::primitive_from_name`'s table (the bidirectional
 * checker keys off these names).
 */
export function duckdbTypeToFossilPrimitive(t: string): InferredPrimitive {
  const upper = t.trim().toUpperCase();
  if (
    upper === "INTEGER" ||
    upper === "BIGINT" ||
    upper === "INT" ||
    upper === "SMALLINT" ||
    upper === "TINYINT" ||
    upper === "HUGEINT"
  ) {
    return "Integer";
  }
  if (upper === "DOUBLE" || upper === "FLOAT" || upper === "REAL") return "Float";
  if (upper.startsWith("DECIMAL")) return "Float";
  if (upper === "BOOLEAN" || upper === "BOOL") return "Bool";
  if (upper === "DATE") return "Date";
  if (upper === "TIMESTAMP" || upper === "DATETIME") return "DateTime";
  if (upper === "TIME") return "Time";
  // VARCHAR / TEXT / STRING + any unrecognised type fall back to String
  // (matching the fossil-hir wildcard arm).
  return "String";
}

/** A source binding scraped from a `.fossil` mapping: `users := io.csv("@conn/users.csv")`. */
export interface SourceRef {
  /** The binding name on the LHS (`users`) — the descriptor's `source_name`. */
  sourceName: string;
  /** The constructor's URL argument (`@conn/users.csv`) — resolved to a signed URL. */
  url: string;
}

/**
 * Scrape source-binding RHS URLs from a `.fossil` text. Mirrors the Rust
 * sibling `extract_source_refs` (crates/fossil-cli/src/main.rs) so the editor
 * pre-introspection and the CLI agree.
 */
export function extractSourceRefs(text: string): SourceRef[] {
  const re = /(\w[\w\d_]*)\s*:=\s*io\.(?:csv|json)\(\s*['"]([^'"]+)['"]/g;
  const out: SourceRef[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1] && m[2]) {
      out.push({ sourceName: m[1], url: m[2] });
    }
  }
  return out;
}

/** A single row from DuckDB's `DESCRIBE SELECT * FROM read_csv_auto(...)`. */
export interface DescribeRow {
  column_name?: unknown;
  column_type?: unknown;
}

/**
 * Build the `InferredDescriptorJson` a `DESCRIBE` produced for one source
 * binding. `content_hash` is left empty — the Rust side derives it (ADR-0037).
 * Columns with empty names are dropped (defensive against malformed DESCRIBE
 * rows).
 */
export function buildInferredDescriptor(
  sourceName: string,
  describeRows: readonly DescribeRow[],
): InferredDescriptorJson {
  const columns: InferredColumnJson[] = describeRows
    .map((r) => ({
      name: String(r.column_name ?? ""),
      primitive: duckdbTypeToFossilPrimitive(String(r.column_type ?? "")),
    }))
    .filter((c) => c.name.length > 0);
  return { source_name: sourceName, columns, content_hash: "" };
}
