import { providerFor, type ProviderInfo } from "@fossil-lang/wasm";
import type { TreeNodeType } from "@kanzo-tech/ui";
import { reference, type StorageConnection } from "@/lib/connections";

/**
 * A node of the sources explorer: a connection, a folder under it, or a file a provider reads. A
 * connection or folder carries `childrenCount` and no children until it is opened — Ark's lazy
 * branch — and `under` is the folder it lists, relative to the connection, as the files endpoint
 * takes its `prefix`.
 */
export interface SourceNode extends TreeNodeType {
  children?: SourceNode[];
  childrenCount?: number;
  connection?: StorageConnection;
  under?: string;
  /** A file's whole line, `name := io.<reader>("@conn/path")`. */
  line?: string;
  /** A file's reader, the `io.` constructor its extension names. */
  reader?: string;
}

/** What a program reads a connection's files as: a vocabulary's are schemas, the rest data. */
export const roleOf = (c: StorageConnection) => (c.kind === "vocab" ? "schema" : "data");

/** A connection, unopened. */
export function connectionNode(c: StorageConnection): SourceNode {
  return { id: c.name, name: `@${c.name}`, connection: c, under: "", childrenCount: 1 };
}

/**
 * A binding named after the file, as `IDENT` is written (`grammar.bnf`): its name without the
 * extension, each character an identifier cannot hold an `_`, and an `_` before a leading digit.
 */
export function bindingName(file: string): string {
  const stem = file.replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9_]/g, "_");
  return /^[0-9]/.test(stem) || stem === "" ? `_${stem}` : stem;
}

/**
 * The children of `parent` from one listing of its folder: the folders directly under it that hold
 * a readable file, unopened, then the readable files directly in it, each with its whole line. A
 * file's path under the connection is fossil's `referenceTo`, so nothing here re-derives a prefix.
 */
export function childrenOf(
  parent: SourceNode,
  keys: readonly string[],
  providers: readonly ProviderInfo[],
): SourceNode[] {
  const c = parent.connection!;
  const under = parent.under ?? "";
  const role = roleOf(c);
  const at = `@${c.name}/`;
  const folders = new Map<string, SourceNode>();
  const files: SourceNode[] = [];
  for (const key of keys) {
    const ref = reference(c, key);
    if (!ref.startsWith(at + under)) continue;
    const rest = ref.slice(at.length + under.length);
    const provider = providerFor(rest, role, providers);
    if (!provider) continue;
    const slash = rest.indexOf("/");
    if (slash >= 0) {
      const folder = `${under}${rest.slice(0, slash + 1)}`;
      if (!folders.has(folder)) {
        folders.set(folder, { id: `${c.name}/${folder}`, name: rest.slice(0, slash + 1), connection: c, under: folder, childrenCount: 1 });
      }
    } else {
      files.push({
        id: `${c.name}:${key}`,
        name: rest,
        reader: provider.name,
        line: `${bindingName(rest)} := io.${provider.name}("${ref}")`,
      });
    }
  }
  const byName = (a: SourceNode, b: SourceNode) => a.name.localeCompare(b.name);
  return [...[...folders.values()].sort(byName), ...files.sort(byName)];
}
