/**
 * Open a job's corpus — the one door keasy walks through to read an output.
 *
 * The host's whole job here is access: it signs what it is asked to sign. What
 * is addressable is fossil's answer, not keasy's, and it arrives in two rungs of
 * the same call:
 *
 *   1. `open(url, { readText })` — no engine. fossil reads its own index and the
 *      per-type documents it names, and hands back a {@link CorpusAddressing}:
 *      every relation, every projection, every file.
 *   2. keasy signs exactly that list, lends it to DuckDB's file registry, and
 *      reopens the same corpus with the engine.
 *
 * What this replaces is the reason it exists. keasy used to ask the server for
 * "the discovery URLs", and the server derived them from the run report —
 * `vertices[].file` + `edges[].by_source`, names the layout post-pass deletes
 * once it has run. The host was composing a layout it does not own, and getting
 * it wrong.
 */

import { DuckDBDataProtocol } from "@duckdb/duckdb-wasm";
import {
  open,
  type CorpusAddressing,
  type QueryRow,
  type SqlCorpus,
} from "@fossil-lang/corpus";
import { Coordinator, wasmConnector } from "@kanzo-tech/ui/analytics";

import { api } from "@/lib/api";

// fossil-graph-wasm, staged into public/ by scripts/copy-fossil-wasm.mjs
// (predev/prebuild) — Next resolves no `.wasm` asset for us.
export const GRAPH_WASM_URL = "/fossil/fossil_graph_wasm_bg.wasm";

type DuckDB = Awaited<ReturnType<ReturnType<typeof wasmConnector>["getDuckDB"]>>;

/**
 * One DuckDB-WASM coordinator per document: vgplot resolves marks through a single active one, and
 * a second would have the canvas and the charts querying different databases.
 */
let booted: Promise<{ coordinator: Coordinator; db: DuckDB }> | null = null;

function boot() {
  booted ??= (async () => {
    const connector = wasmConnector();
    return { coordinator: new Coordinator(connector), db: await connector.getDuckDB() };
  })();
  return booted;
}

/**
 * Every file the corpus can address, distinct and in declaration order: each
 * vertex type's projections (the payload at scale 1 and every written level),
 * its identity index where one exists, and each relation's projections (both
 * orientations of the adjacency, and the levels that carry the endpoints'
 * coordinates).
 *
 * A type whose manifest declares no count cannot be enumerated — `files()` is
 * "how many are there", which is a different question from "address this tile" —
 * so it is skipped rather than guessed at.
 */
export function addressableFiles(addressing: CorpusAddressing): string[] {
  const out = new Set<string>();

  for (const type of addressing.types) {
    if (type.count === null) continue;
    for (const projection of type.projections) {
      for (const file of type.projectionFiles(projection.scale)) out.add(file);
    }
    for (const file of type.index?.files() ?? []) out.add(file);
  }

  for (const edge of addressing.edges) {
    for (const projection of edge.projections) {
      if (projection.direction === null || projection.tiles === null) continue;
      for (const file of edge.projectionFiles(projection.scale, projection.direction)) {
        out.add(file);
      }
    }
  }

  return [...out];
}

export interface JobCorpus {
  coordinator: Coordinator;
  corpus: SqlCorpus;
  /** The manifest documents fossil named, kept so a second open costs no reads. */
  manifestFiles: Record<string, string>;
}

/**
 * Open the corpus a completed job wrote, with keasy's access lent to it.
 *
 * The base is empty on purpose: the addressing then composes dataset-relative
 * names, which is exactly what got signed and registered, so `read_parquet` and
 * the verbs name the same files.
 */
export async function openJobCorpus(jobId: string): Promise<JobCorpus> {
  const manifestFiles: Record<string, string> = {};
  const readText = async (path: string): Promise<string> => {
    const signed = await api.jobs.signDatasetUrls(jobId, [path]);
    const res = await fetch(signed[path] ?? path);
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    const text = await res.text();
    manifestFiles[path] = text;
    return text;
  };

  const addressing = await open("", { readText, wasmUrl: GRAPH_WASM_URL });
  const signedUrls = await api.jobs.signDatasetUrls(jobId, addressableFiles(addressing));

  // DuckDB's file registry is where keasy's access meets fossil's names: the name fossil composes
  // resolves to the URL keasy signed, and a file keasy never signed fails by name.
  const { coordinator, db } = await boot();
  await coordinator.exec("SET enable_http_metadata_cache = true");
  await Promise.all(
    Object.entries(signedUrls).map(([path, url]) =>
      db.registerFileURL(path, url, DuckDBDataProtocol.HTTP, false),
    ),
  );

  const query = async (sql: string): Promise<QueryRow[]> =>
    (await coordinator.query(sql, { type: "json" })) as QueryRow[];
  const corpus = await open("", {
    query,
    manifestFiles,
    sql: "allowed",
    wasmUrl: GRAPH_WASM_URL,
  });

  return { coordinator, corpus, manifestFiles };
}

/**
 * What the corpus holds, as the host has to store it: the name fossil gave each
 * relation, the payload files that carry it, and the count it reported.
 *
 * **The name is asked for, never composed.** `table_name` is the corpus's own
 * DuckDB spelling for a relation — pre-computed there precisely so a binding
 * does not reimplement the edge-naming convention — and keasy's catalog used to
 * reimplement it anyway, in Rust, off a run report. Answering this needs an
 * engine (a relation's name is a reader's answer, not the report's), which is
 * why it happens here, in the browser that just ran the job.
 */
export async function relationsOf(corpus: SqlCorpus) {
  const schema = await corpus.schema();
  const addressing = corpus.addressing;

  const vertices = schema.vertices.flatMap((v) => {
    const address = addressing.types.find((t) => t.type === v.name);
    if (!address || address.count === null) return [];
    return [{ name: v.name, rows: v.count, files: [...address.projectionFiles(1)] }];
  });

  const edges = schema.edges.flatMap((e) => {
    const address = addressing.edges.find(
      (a) => a.edgeType === e.name && a.srcType === e.source_type && a.dstType === e.target_type,
    );
    // The source-aligned adjacency is the relation's rows; an orientation the
    // corpus does not publish has no URL to register.
    if (!address || address.adjacency("src") === null) return [];
    return [{ name: e.table_name, rows: e.count, files: [...address.projectionFiles(1, "src")] }];
  });

  return [...vertices, ...edges];
}
