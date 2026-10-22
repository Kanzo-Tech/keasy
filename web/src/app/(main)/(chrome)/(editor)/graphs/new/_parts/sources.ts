import type { Format } from "@fossil-lang/types";
import { bindingName, formatFor } from "@fossil-lang/wasm";
import { createTreeCollection } from "@kanzo-tech/ui";
import type { Schemas } from "@/lib/api/client";
import { reference, type StorageConnection } from "@/lib/connections";

/**
 * A node of the files a program reads from: a connection, a folder under it, or a file a format
 * reads. The one shape of the tree: the studio's Sources and the assistant's picker both draw it
 * through `use-sources.ts`, and `childrenOf` is the one way it grows.
 */
export type SourceNode = SourceBranch | SourceFile;

/** A connection or a folder under it: listed when it is opened, and not before. */
export interface SourceBranch {
  id: string;
  name: string;
  kind: "connection" | "folder";
  connection: StorageConnection;
  /** The folder it lists, relative to the connection, as the files endpoint takes its `prefix`. */
  under: string;
  /** Its children once listed; absent until it is opened. */
  children?: SourceNode[];
  /** Why its last listing failed, shown beside it while it has no children; opening it again retries. */
  problem?: unknown;
}

/** A file a format reads. */
export interface SourceFile {
  id: string;
  name: string;
  kind: "file";
  /** Its whole line, `name := io.<reader>("@conn/path")`. */
  line: string;
  /** The reference a program writes for it, `@conn/path`: what fossil's profile reads it by. */
  reference: string;
  /** Its reader, the `io.` constructor its extension names. */
  reader: string;
  /** Its size in bytes, as the listing gave it. */
  size: number;
  /** It is a vocabulary — a ShEx, SHACL or OWL file, read as a schema — and not data. */
  vocabulary: boolean;
  children?: never;
}

/**
 * The format that reads `path`, and whether the file is a vocabulary: one no data format reads and a
 * schema format does (`shapes.shex`). A connection is a location and nothing more; what a file in it
 * is, its format says (docs/design/assistant.md, *A dataset's vocabulary is a file beside it*). An
 * extension two formats share — a `.ttl` is `rdf` as data and `shacl` as a schema — is read as data:
 * telling the two apart takes the file's content, which a listing does not have.
 */
function readerOf(path: string, formats: readonly Format[]) {
  const data = formatFor(path, "data", formats);
  if (data) return { format: data, vocabulary: false };
  const schema = formatFor(path, "schema", formats);
  return schema ? { format: schema, vocabulary: true } : undefined;
}

/** A connection, unopened. */
export function connectionNode(c: StorageConnection): SourceBranch {
  return { id: c.name, name: `@${c.name}`, kind: "connection", connection: c, under: "" };
}

/**
 * The children of `parent` from one listing of its folder: the folders directly under it that hold
 * a readable file, unopened, then the readable files directly in it, each with its whole line and
 * size. A file's path under the connection is fossil's `referenceTo`, and the name its line binds it
 * by is fossil's `bindingName` (the lexer's rule, which boots fossil's module the first time), so
 * nothing here re-derives either.
 */
export async function childrenOf(
  parent: SourceBranch,
  listing: readonly Schemas["FileEntry"][],
  formats: readonly Format[],
  { signal }: { signal?: AbortSignal } = {},
): Promise<SourceNode[]> {
  const c = parent.connection;
  const { under } = parent;
  const at = `@${c.name}/`;
  const folders = new Map<string, SourceBranch>();
  const files: SourceFile[] = [];
  for (const { path, size } of listing) {
    const ref = reference(c, path);
    if (!ref.startsWith(at + under)) continue;
    const rest = ref.slice(at.length + under.length);
    const read = readerOf(rest, formats);
    if (!read) continue;
    const slash = rest.indexOf("/");
    if (slash >= 0) {
      const folder = `${under}${rest.slice(0, slash + 1)}`;
      if (!folders.has(folder)) {
        folders.set(folder, { id: `${c.name}/${folder}`, name: rest.slice(0, slash + 1), kind: "folder", connection: c, under: folder });
      }
    } else {
      files.push({
        id: `${c.name}:${path}`,
        name: rest,
        kind: "file",
        reader: read.format.name,
        line: `${await bindingName(rest, { signal })} := io.${read.format.name}("${ref}")`,
        reference: ref,
        size,
        vocabulary: read.vocabulary,
      });
    }
  }
  const byName = (a: SourceNode, b: SourceNode) => a.name.localeCompare(b.name);
  return [...[...folders.values()].sort(byName), ...files.sort(byName)];
}

/**
 * The tree's collection over `roots`. A branch is one by its count of children (Ark's lazy branch):
 * an unlisted one counts one and opens through `loadChildren`, a listed empty one counts none.
 */
export const sourceCollection = (roots: readonly SourceNode[]) =>
  createTreeCollection<SourceNode>({
    rootNode: { id: "", name: "", kind: "folder", children: [...roots] } as SourceNode,
    nodeToChildrenCount: (node) => (node.kind === "file" ? undefined : (node.children?.length ?? 1)),
  });
