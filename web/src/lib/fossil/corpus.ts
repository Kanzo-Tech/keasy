/**
 * Open a job's corpus — the one door keasy walks through to read an output.
 *
 * The host's whole job here is access: it signs what it is asked to sign. What
 * is addressable is fossil's answer, not keasy's, and it arrives in two rungs of
 * the same call:
 *
 *   1. `open(url, { readText })` — no engine. fossil reads its own index and the
 *      per-type documents it names, and hands back a {@link CorpusAddressing}:
 *      every relation, every projection, every file (`addressing.files()`).
 *   2. keasy signs exactly that list, lends it to DuckDB's file registry, and
 *      reopens the same corpus with the engine.
 *
 * What this replaces is the reason it exists. keasy used to ask the server for
 * "the discovery URLs", and the server derived them from the run report —
 * `vertices[].file` + `edges[].by_source`, names the layout post-pass deletes
 * once it has run. The host was composing a layout it does not own, and getting
 * it wrong.
 */

import "client-only";

import { DuckDBDataProtocol } from "@duckdb/duckdb-wasm";
import { open, type QueryRow, type SqlCorpus } from "@fossil-lang/corpus";
import { Coordinator, wasmConnector } from "@kanzo-tech/ui/analytics";

import { http } from "@/lib/api/client";

/** The root of every cached read of a job's opened output; its own, so invalidating a job never reopens it. */
export const corpusKey = (jobId: string) => ["corpus", jobId] as const;

/** Signed GET URLs for the dataset-relative keys the corpus reader enumerated. */
async function signDatasetUrls(jobId: string, paths: string[]): Promise<Record<string, string>> {
  const { data } = await http.POST("/v1/jobs/{id}/discover/urls", {
    params: { path: { id: jobId } },
    body: { paths },
  });
  return data!.files;
}

type DuckDB = Awaited<ReturnType<ReturnType<typeof wasmConnector>["getDuckDB"]>>;

/**
 * One DuckDB-WASM coordinator per document: vgplot resolves marks through a single active one, and
 * a second would have the canvas and the charts querying different databases.
 */
let booted: Promise<{ coordinator: Coordinator; db: DuckDB }> | null = null;

export function bootDuckDB() {
  booted ??= (async () => {
    const connector = wasmConnector();
    return { coordinator: new Coordinator(connector), db: await connector.getDuckDB() };
  })();
  return booted;
}

interface JobCorpus {
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
    const signed = await signDatasetUrls(jobId, [path]);
    const res = await fetch(signed[path] ?? path);
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    const text = await res.text();
    manifestFiles[path] = text;
    return text;
  };

  const addressing = await open("", { readText });
  const signedUrls = await signDatasetUrls(jobId, [...addressing.files()]);

  // DuckDB's file registry is where keasy's access meets fossil's names: the name fossil composes
  // resolves to the URL keasy signed, and a file keasy never signed fails by name.
  const { coordinator, db } = await bootDuckDB();
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
  });

  return { coordinator, corpus, manifestFiles };
}
