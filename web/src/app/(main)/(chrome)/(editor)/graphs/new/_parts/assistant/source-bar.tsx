"use client";

import { useEffect, useState } from "react";
import { BookMarked, Database, FileText, Plus, X } from "lucide-react";
import { PromptInputHeader } from "@kanzo-tech/ai";
import {
  FormatByte,
  InputGroupButton,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuGroup,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
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
 * Above the composer's field, on the left: one **+** (`AddFiles`), as Claude's composer has, and what
 * is picked beside it as **file cards** — *awards.csv*, then *+4 more files · Nobel laureates* — each
 * with a cross (docs/design/assistant.md, *One +, as Claude's*). A connection's vocabulary comes with
 * its data, as a card of its own (*Vocabulary · comes with Nobel laureates*), which the person may
 * remove.
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

export type AddFilesProps = Pick<SourceBarProps, "connections" | "list" | "selected" | "onPick">;

/**
 * The **+**: a menu, as Claude's is — *From a connection*, each connection a submenu of its files,
 * every folder's included, each checked when picked. It stays open as files are checked.
 */
export function AddFiles({ connections, list, selected, onPick }: AddFilesProps) {
  return (
    <Menu closeOnSelect={false} positioning={{ placement: "top-start" }}>
      <MenuTrigger asChild>
        <InputGroupButton aria-label="Add files" size="icon-sm" variant="ghost">
          <Plus />
        </InputGroupButton>
      </MenuTrigger>
      <MenuContent className="w-60">
        <MenuGroup heading="From a connection">
          {connections.map((c) => (
            <MenuSub closeOnSelect={false} key={c.name} lazyMount unmountOnExit>
              <MenuSubTrigger>
                <Database aria-hidden className="text-muted-foreground" />
                <span className="flex-1 truncate">{c.name}</span>
              </MenuSubTrigger>
              <MenuSubContent className="max-h-80 w-72 overflow-y-auto">
                <Files connection={c} list={list} onPick={onPick} selected={selected} />
              </MenuSubContent>
            </MenuSub>
          ))}
        </MenuGroup>
      </MenuContent>
    </Menu>
  );
}

type Listed = { state: "loading" } | { state: "failed"; problem: unknown } | { state: "listed"; files: SourceFile[] };

/** A connection's files, listed as its submenu opens: *Select all*, then each file, checked when picked. */
function Files({ connection, list, selected, onPick }: { connection: StorageConnection } & Pick<SourceBarProps, "list" | "selected" | "onPick">) {
  const [listed, setListed] = useState<Listed>({ state: "loading" });
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

  if (listed.state === "loading") return <p className="px-2 py-1.5 text-muted-foreground text-sm">Listing the files…</p>;
  if (listed.state === "failed") return <ProblemView error={listed.problem} />;
  const { files } = listed;
  if (files.length === 0) return <p className="px-2 py-1.5 text-muted-foreground text-sm">No files here that can be read.</p>;
  const toggle = (file: SourceFile, on: boolean) => {
    // Data picked brings the connection's vocabulary with it: the two are one dataset.
    const brought = on && !file.vocabulary ? files.filter((f) => f.vocabulary && !selected.has(f.id)) : [];
    onPick([file, ...brought], on);
  };
  return (
    <>
      <MenuCheckboxItem checked={files.every((f) => selected.has(f.id))} onCheckedChange={(on) => onPick(files, on === true)} value="all">
        Select all
      </MenuCheckboxItem>
      <MenuSeparator />
      {files.map((file) => (
        <MenuCheckboxItem
          checked={selected.has(file.id)}
          key={file.id}
          onCheckedChange={(on) => toggle(file, on === true)}
          title={split(file.id).path}
          value={file.id}
        >
          <span className="flex-1 truncate">{split(file.id).path}</span>
          <span className="text-muted-foreground text-xs tabular-nums">
            <FormatByte value={file.size} />
          </span>
        </MenuCheckboxItem>
      ))}
    </>
  );
}
