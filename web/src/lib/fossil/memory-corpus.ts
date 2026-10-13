import { attach, type Attachment } from "@fossil-lang/corpus";
import type { CorpusFile } from "@fossil-lang/executor";
import type { Engine } from "@kanzo-tech/ui/analytics";

/** Every in-memory attach registers its files under a prefix of its own. */
let attaches = 0;

/**
 * A corpus answered in memory (a preview run, `into: "memory"`) attached to `engine` as the catalog
 * `name`, exactly as a stored one is: its files registered with DuckDB-WASM as buffers under a prefix
 * of their own, and fossil's `attach` pointed at that prefix as a corpus at a URL — which needs
 * nothing of fossil beyond what it has, since a registered name is a URL DuckDB reads. Detaching it
 * gives back the catalog, then the buffers.
 *
 * The prefix is this attach's alone, so a preview run again under the same name does not lose its
 * files to the one it replaces, whose detach comes later.
 */
export async function attachInMemory(
  name: string,
  files: readonly CorpusFile[],
  { engine, signal }: { engine: Engine; signal?: AbortSignal },
): Promise<Attachment> {
  const prefix = `memory-${++attaches}/`;
  const names = files.map((f) => `${prefix}${f.path}`);
  const drop = () => engine.dropFiles(names);
  let attached: Attachment;
  try {
    for (const [at, file] of files.entries()) await engine.registerFileBuffer(names[at]!, file.bytes);
    attached = await attach(name, { engine, url: prefix, ...(signal ? { signal } : {}) });
  } catch (cause) {
    await drop().catch(() => undefined); // The attach's failure is the one said; a buffer left behind is not.
    throw cause;
  }
  let detached: Promise<void> | undefined;
  const detach = () =>
    (detached ??= (async () => {
      try {
        await attached.detach();
      } finally {
        await drop();
      }
    })());
  return { name, detach, [Symbol.asyncDispose]: detach };
}
