"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, BookMarked, Check, Database, FileText, Plus, X } from "lucide-react";
import { PromptInputHeader } from "@kanzo-tech/ai";
import {
  Command,
  CommandContent,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  createListCollection,
  FormatByte,
  InputGroupButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@kanzo-tech/ui";
import { ProblemView } from "@/components/problem-view";
import type { StorageConnection } from "@/lib/connections";
import { connectionNode, type SourceBranch, type SourceFile } from "../sources";
import type { AssistantData } from "./model";

export interface SourceBarProps extends Pick<AssistantData, "connections" | "list" | "selected" | "vocabularies"> {
  /** Pick `files`, or drop them. */
  onPick: (files: readonly SourceFile[], on: boolean) => void;
  /** Drop files by id: a card's cross. */
  onDrop: (ids: readonly string[]) => void;
}

/** How many file cards a connection shows before the rest are one: *+4 more files · Nobel laureates*. */
const SHOWN = 3;

/** A file id is `<connection>:<path>`. */
const split = (id: string) => {
  const colon = id.indexOf(":");
  return { connection: id.slice(0, colon), path: id.slice(colon + 1) };
};

/**
 * Above the composer's field: one **+**, as Claude's composer has (docs/design/assistant.md, *One +,
 * as Claude's*), and what is picked as **file cards** — *awards.csv*, then *+4 more files · Nobel
 * laureates* — each with a cross. The **+** lists the connections; one opens to its files, every
 * folder's included, with a search over them. A connection's vocabulary comes with its data, as a
 * card of its own (*Vocabulary · comes with Nobel laureates*), which the person may remove.
 */
export function SourceBar({ connections, list, selected, vocabularies, onPick, onDrop }: SourceBarProps) {
  const byConnection = new Map<string, { data: string[]; vocabulary: string[] }>();
  for (const id of selected) {
    const { connection } = split(id);
    const entry = byConnection.get(connection) ?? { data: [], vocabulary: [] };
    (vocabularies.has(id) ? entry.vocabulary : entry.data).push(id);
    byConnection.set(connection, entry);
  }
  return (
    <PromptInputHeader aria-label="Sources">
      <AddFiles connections={connections} list={list} onPick={onPick} selected={selected} />
      {[...byConnection].map(([connection, { data: ids, vocabulary }]) => (
        <span className="contents" data-connection={connection} key={connection}>
          {vocabulary.length > 0 && (
            <FileCard
              label={`${vocabulary.length === 1 ? "Vocabulary" : `${vocabulary.length} vocabularies`} · comes with ${connection}`}
              onDrop={() => onDrop(vocabulary)}
              title={vocabulary.map((id) => split(id).path).join("\n")}
              vocabulary
            />
          )}
          {ids.slice(0, SHOWN).map((id) => (
            <FileCard key={id} label={split(id).path.split("/").pop()!} onDrop={() => onDrop([id])} title={split(id).path} />
          ))}
          {ids.length > SHOWN && (
            <FileCard
              label={`+${ids.length - SHOWN} more ${ids.length - SHOWN === 1 ? "file" : "files"} · ${connection}`}
              onDrop={() => onDrop(ids.slice(SHOWN))}
              title={ids.slice(SHOWN).map((id) => split(id).path).join("\n")}
            />
          )}
        </span>
      ))}
    </PromptInputHeader>
  );
}

/** A picked file, or the rest of a connection's, as a card with a cross. */
function FileCard({ label, title, vocabulary = false, onDrop }: { label: string; title: string; vocabulary?: boolean; onDrop: () => void }) {
  const Icon = vocabulary ? BookMarked : FileText;
  return (
    <span
      className="inline-flex max-w-64 items-center gap-1.5 rounded-lg border bg-muted/40 py-0.5 ps-2 pe-0.5 text-sm"
      data-file-card=""
      data-vocabulary={vocabulary || undefined}
      title={title}
    >
      <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{label}</span>
      <InputGroupButton aria-label={`Remove ${label}`} onClick={onDrop} size="icon-sm" variant="ghost">
        <X />
      </InputGroupButton>
    </span>
  );
}

/** Every file under `node`, listing the folders it holds as it goes. */
async function filesUnder(node: SourceBranch, list: SourceBarProps["list"]): Promise<SourceFile[]> {
  const children = await list(node);
  const nested = await Promise.all(children.map((c) => (c.kind === "file" ? [c] : filesUnder(c, list))));
  return nested.flat();
}

/** The **+**: the connections, then the files of the one opened, searched as typed. */
function AddFiles({ connections, list, selected, onPick }: Pick<SourceBarProps, "connections" | "list" | "selected" | "onPick">) {
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState<StorageConnection | null>(null);
  return (
    <Popover
      lazyMount
      onOpenChange={(d) => {
        setOpen(d.open);
        if (!d.open) setOpened(null);
      }}
      open={open}
      positioning={{ placement: "top-start" }}
      unmountOnExit
    >
      <PopoverTrigger asChild>
        <InputGroupButton aria-label="Add files" size="icon-sm" variant="outline">
          <Plus />
        </InputGroupButton>
      </PopoverTrigger>
      <PopoverContent className="flex h-96 w-80 flex-col p-0">
        {opened === null ? (
          <Connections connections={connections} onOpen={setOpened} />
        ) : (
          <Files connection={opened} list={list} onBack={() => setOpened(null)} onPick={onPick} selected={selected} />
        )}
      </PopoverContent>
    </Popover>
  );
}

/** The first level: *From a connection*, each connection one item. */
function Connections({ connections, onOpen }: { connections: readonly StorageConnection[]; onOpen: (c: StorageConnection) => void }) {
  const [query, setQuery] = useState("");
  const shown = connections.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()));
  const collection = createListCollection({ items: shown, itemToValue: (c) => c.name, itemToString: (c) => c.name });
  return (
    <Command
      className="rounded-none border-0"
      collection={collection}
      onInputValueChange={({ inputValue }) => setQuery(inputValue)}
      onSelect={({ itemValue }) => {
        const c = connections.find((x) => x.name === itemValue);
        if (c) onOpen(c);
      }}
    >
      <CommandInput aria-label="Search the connections" placeholder="Search the connections…" />
      <CommandContent>
        <CommandEmpty>No connection by that name.</CommandEmpty>
        <CommandList>
          <CommandGroup heading="From a connection">
            {shown.map((c) => (
              <CommandItem item={c} key={c.name}>
                <Database aria-hidden className="size-4 text-muted-foreground" />
                <span className="flex-1 truncate">{c.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandContent>
    </Command>
  );
}

type Listed = { state: "loading" } | { state: "failed"; problem: unknown } | { state: "listed"; files: SourceFile[] };

const BACK = "\u0000back";
const ALL = "\u0000all";

/** The second level: a connection's files, every folder's included, each picked or dropped on select. */
function Files({
  connection,
  list,
  selected,
  onPick,
  onBack,
}: { connection: StorageConnection; onBack: () => void } & Pick<SourceBarProps, "list" | "selected" | "onPick">) {
  const [listed, setListed] = useState<Listed>({ state: "loading" });
  const [query, setQuery] = useState("");
  useEffect(() => {
    let live = true;
    filesUnder(connectionNode(connection), list).then(
      (files) => live && setListed({ state: "listed", files }),
      (problem: unknown) => live && setListed({ state: "failed", problem }),
    );
    return () => {
      live = false;
    };
  }, [connection, list]);

  const files = listed.state === "listed" ? listed.files : [];
  const shown = files.filter((f) => split(f.id).path.toLowerCase().includes(query.toLowerCase()));
  const every = files.length > 0 && files.every((f) => selected.has(f.id));
  type Row = { value: string; label: string; file?: SourceFile };
  const rows: Row[] = [
    { value: BACK, label: "All connections" },
    ...(files.length > 0 && query === "" ? [{ value: ALL, label: every ? "Remove all" : "Select all" }] : []),
    ...shown.map((file) => ({ value: file.id, label: split(file.id).path, file })),
  ];
  const collection = createListCollection({ items: rows, itemToValue: (r) => r.value, itemToString: (r) => r.label });
  return (
    <Command
      className="rounded-none border-0"
      collection={collection}
      onInputValueChange={({ inputValue }) => setQuery(inputValue)}
      onSelect={({ itemValue }) => {
        if (itemValue === BACK) return onBack();
        if (itemValue === ALL) return onPick(files, !every);
        const file = files.find((f) => f.id === itemValue);
        if (!file) return;
        const on = !selected.has(file.id);
        // Data picked brings the connection's vocabulary with it: the two are one dataset.
        const brought = on && !file.vocabulary ? files.filter((f) => f.vocabulary && !selected.has(f.id)) : [];
        onPick([file, ...brought], on);
      }}
    >
      <CommandInput aria-label={`Search ${connection.name}`} placeholder={`Search ${connection.name}…`} />
      <CommandContent>
        <CommandList>
          {rows.slice(0, rows[1]?.value === ALL ? 2 : 1).map((row) => (
            <CommandItem item={row} key={row.value}>
              {row.value === BACK && <ArrowLeft aria-hidden className="size-4 text-muted-foreground" />}
              {row.label}
            </CommandItem>
          ))}
          <CommandGroup heading={connection.name}>
            {listed.state === "loading" && <p className="px-2 py-1.5 text-muted-foreground text-xs">Listing the files…</p>}
            {listed.state === "failed" && <ProblemView error={listed.problem} />}
            {listed.state === "listed" && files.length === 0 && (
              <p className="px-2 py-1.5 text-muted-foreground text-xs">No files here that can be read.</p>
            )}
            {rows
              .filter((r) => r.file)
              .map(({ value, label, file }) => (
                <CommandItem data-picked={selected.has(value) || undefined} item={{ value, label, file }} key={value}>
                  <Check aria-hidden className={selected.has(value) ? "size-4" : "invisible size-4"} />
                  <span className="flex-1 truncate">{label}</span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    <FormatByte value={file!.size} />
                  </span>
                </CommandItem>
              ))}
          </CommandGroup>
        </CommandList>
      </CommandContent>
    </Command>
  );
}
