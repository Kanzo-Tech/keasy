import { mount } from "@fossil-lang/storage";
import { FossilError, type CorpusFile, type Host } from "@fossil-lang/types";
import { attachGraph, GraphArError, type GraphAttachment } from "@kanzo-tech/graphar-duckdb";
import type { Engine } from "@kanzo-tech/mosaic";

import { ClientError } from "@/lib/errors";

/**
 * How keasy attaches what a run wrote: a GraphAr graph and the RML-Core mapping beside it
 * (`/docs/format` on fossil's site). fossil keeps no reader of its own: the host composes `mount`
 * (the credential), `attachGraph` (the views and the five `graphar_*` relations) and, for the
 * meaning, rudof's `Mapping` (`lib/fossil/rudof.ts`). The names are fixed by fossil's writer and
 * joined by no pointer: the graph document, and the mapping beside it.
 */
export const GRAPH_ENTRY = "fossil.graph.yml";
export const MAPPING_FILE = "mapping.ttl";

/** A user-defined type has no storage in GraphAr; fossil's `langString` is two strings, and DuckDB's spelling is this. */
const USER_TYPES = { langString: "STRUCT(value VARCHAR, lang VARCHAR)" } as const;

/** A graph attached to the page's engine under `name`: SQL names it `"<name>"."<Type>"`. */
export interface Attachment {
  /** The catalog: `"<name>"."<Type>"`, and `"<name>".graphar_vertex_types` and its four siblings. */
  readonly name: string;
  /** The text of `mapping.ttl`, read from where the graph is: what the graph means as RDF. */
  mapping(options: { signal: AbortSignal }): Promise<string>;
  /** Gives back what the attach took: the catalog and the credential. A second call does nothing. */
  detach(): Promise<void>;
}

interface Where {
  /** What SQL calls each file of the graph, handed paths relative to the graph document. */
  resolve: (paths: readonly string[]) => Promise<string[]>;
  /** The text of a file of the graph. */
  text: (path: string, signal: AbortSignal) => Promise<string>;
  /** What attaching took besides the catalog. */
  release: () => Promise<void>;
}

/** Attach a graph that `where` reaches, under `name`; what the attach made is given back when it fails. */
async function attached(engine: Engine, name: string, where: Where, signal: AbortSignal | undefined): Promise<Attachment> {
  let graph: GraphAttachment;
  try {
    graph = await attachGraph(engine, name, where.resolve, { entry: GRAPH_ENTRY, signal, userTypes: USER_TYPES });
  } catch (failure) {
    // eslint-disable-next-line no-restricted-syntax -- the attach's own failure is the one thrown below; a release that also failed adds nothing the person can act on
    await where.release().catch(() => undefined);
    // GraphAr's refusal is its own grammar (`unreadable`, `invalid`); the screen speaks `area/kind`.
    if (failure instanceof GraphArError) {
      throw new ClientError("graph/unreadable", "This graph's files cannot be read.", failure.message, { cause: failure });
    }
    throw failure;
  }
  let released = false;
  return {
    name,
    mapping: ({ signal }) => where.text(MAPPING_FILE, signal),
    detach: async () => {
      if (released) return;
      released = true;
      await graph.detach();
      await where.release();
    },
  };
}

/**
 * A job's graph, under the credential the host vends `read` on for it — the one prefix its output is
 * under, kept fresh by `mount` until the attachment is given back.
 *
 * @throws {FossilError} `storage/ambiguous-prefix` for a job vended more than one prefix; what `mount`
 *   throws. {@link ClientError} `graph/unreadable` for a graph whose files do not read as GraphAr — one
 *   built before keasy wrote it, above all.
 */
export async function attachJob(job: string, { engine, host, signal }: { engine: Engine; host: Host; signal?: AbortSignal }): Promise<Attachment> {
  const mounted = await mount(engine, host, { job }, "read", { signal });
  if (mounted.prefixes.length !== 1) {
    // eslint-disable-next-line no-restricted-syntax -- the ambiguity is the failure thrown below; a close that also failed adds nothing the person can act on
    await mounted.close().catch(() => undefined);
    throw FossilError.of("storage/ambiguous-prefix", { scope: `job ${job}`, count: mounted.prefixes.length });
  }
  const prefix = mounted.prefixes[0]!;
  const resolve = (paths: readonly string[]) => mounted.files(paths.map((path) => `${prefix}${path}`));
  return attached(
    engine,
    job,
    {
      resolve,
      text: async (path, signal) => {
        const [file] = await resolve([path]);
        const answer = await engine.query(`SELECT content FROM read_text('${file!.replace(/'/g, "''")}')`, { signal });
        return String(answer.getChild("content")?.get(0));
      },
      release: () => mounted.close(),
    },
    signal,
  );
}

/** How many graphs from memory have been attached in this realm: each takes a prefix of its own. */
let fromMemory = 0;

/**
 * The files a run into memory answered, registered with the engine under a prefix of this attachment's
 * own, so a second attach under the same name does not take the files of the one it replaces; giving
 * the attachment back drops them. The engine copies the bytes.
 */
export async function attachFiles(
  name: string,
  { engine, files, signal }: { engine: Engine; files: readonly CorpusFile[]; signal?: AbortSignal },
): Promise<Attachment> {
  const base = `fossil-memory/${++fromMemory}/`;
  const held = new Map(files.map((f) => [f.path, f.bytes]));
  const registered: string[] = [];
  return attached(
    engine,
    name,
    {
      resolve: async (paths) => {
        const names: string[] = [];
        for (const path of paths) {
          const bytes = held.get(path);
          if (bytes === undefined) throw new Error(`The run wrote no ${path}`);
          const file = `${base}${path}`;
          if (!registered.includes(file)) {
            await engine.registerFileBuffer(file, bytes);
            registered.push(file);
          }
          names.push(file);
        }
        return names;
      },
      text: async (path) => {
        const bytes = held.get(path);
        if (bytes === undefined) throw new Error(`The run wrote no ${path}`);
        return new TextDecoder().decode(bytes);
      },
      release: () => engine.dropFiles(registered.splice(0)),
    },
    signal,
  );
}
