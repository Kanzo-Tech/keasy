"use client";

import { useEffect, useState } from "react";
import { Database, Plus, X } from "lucide-react";
import { PromptInputHeader } from "@kanzo-tech/ai";
import {
  FormatByte,
  InputGroupButton,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from "@kanzo-tech/ui";
import { ProblemView } from "@/components/problem-view";
import type { StorageConnection } from "@/lib/connections";
import { connectionNode, type SourceBranch, type SourceFile, type SourceNode } from "../sources";
import type { AssistantData } from "./model";

export interface SourceBarProps extends Pick<AssistantData, "connections" | "list" | "selected"> {
  /** Pick `files`, or drop them. */
  onPick: (files: readonly SourceFile[], on: boolean) => void;
  /** Drop every file of a connection. */
  onClear: (connection: string) => void;
}

/** How many of a connection's files are picked: file ids are `<connection>:<path>`. */
const countOf = (selected: ReadonlySet<string>, connection: StorageConnection) =>
  [...selected].filter((id) => id.startsWith(`${connection.name}:`)).length;

/**
 * Above the composer's field, one pill per readable connection — *+ @CORDIS* — as Claude's connectors
 * are (docs/design/assistant.md, *Sources in the composer*). A pill opens a menu of what the
 * connection lists: its name with **Select all**, then each file as a checkable item with its size,
 * and a submenu for each folder the listing returns. What is picked stays on the pill, *@Nobel
 * laureates · 6 files*, and its cross clears it.
 */
export function SourceBar({ connections, list, selected, onPick, onClear }: SourceBarProps) {
  return (
    <PromptInputHeader aria-label="Sources">
      {connections.map((connection) => {
        const count = countOf(selected, connection);
        const name = `@${connection.name}`;
        return (
          <span
            className={
              count > 0
                ? "inline-flex items-center rounded-full border border-primary bg-primary/10 text-primary"
                : "inline-flex items-center"
            }
            data-connection={connection.name}
            key={connection.name}
          >
            <Menu closeOnSelect={false}>
              <MenuTrigger asChild>
                <InputGroupButton pill variant={count > 0 ? "ghost" : "outline"}>
                  {count > 0 ? <Database /> : <Plus />}
                  {name}
                  {count > 0 && <> · {count === 1 ? "1 file" : `${count} files`}</>}
                </InputGroupButton>
              </MenuTrigger>
              <MenuContent className="w-72">
                <MenuGroup heading={name}>
                  <Listing list={list} node={connectionNode(connection)} onPick={onPick} root selected={selected} />
                </MenuGroup>
              </MenuContent>
            </Menu>
            {count > 0 && (
              <InputGroupButton aria-label={`Remove ${name}`} onClick={() => onClear(connection.name)} pill size="icon-sm" variant="ghost">
                <X />
              </InputGroupButton>
            )}
          </span>
        );
      })}
    </PromptInputHeader>
  );
}

/** Every file under `node`, listing the folders it holds as it goes. */
async function filesUnder(node: SourceBranch, list: SourceBarProps["list"]): Promise<SourceFile[]> {
  const children = await list(node);
  const nested = await Promise.all(children.map((c) => (c.kind === "file" ? [c] : filesUnder(c, list))));
  return nested.flat();
}

type Listed = { state: "loading" } | { state: "failed"; problem: unknown } | { state: "listed"; nodes: SourceNode[] };

/** What `node` lists, read when its menu opens (the content mounts then) and not before. */
function Listing({
  node,
  list,
  selected,
  onPick,
  root = false,
}: { node: SourceBranch; root?: boolean } & Pick<SourceBarProps, "list" | "selected" | "onPick">) {
  const [listed, setListed] = useState<Listed>({ state: "loading" });
  useEffect(() => {
    let live = true;
    list(node).then(
      (nodes) => live && setListed({ state: "listed", nodes }),
      (problem: unknown) => live && setListed({ state: "failed", problem }),
    );
    return () => {
      live = false;
    };
  }, [list, node.id]); // eslint-disable-line react-hooks/exhaustive-deps -- a branch is its id; the node is rebuilt each render
  if (listed.state === "loading") return <p className="px-2 py-1.5 text-muted-foreground text-xs">Listing the files…</p>;
  if (listed.state === "failed") return <ProblemView error={listed.problem} />;
  const { nodes } = listed;
  if (nodes.length === 0) return <p className="px-2 py-1.5 text-muted-foreground text-xs">No files here that can be read.</p>;
  return (
    <>
      {root && (
        <MenuItem
          onSelect={() => {
            // Everything the connection lists, folders included: a folder's files are listed to be picked.
            void filesUnder(node, list).then((every) => onPick(every, !every.every((f) => selected.has(f.id))));
          }}
          value="select-all"
        >
          Select all
        </MenuItem>
      )}
      {nodes.map((n) =>
        n.kind === "file" ? (
          <MenuCheckboxItem checked={selected.has(n.id)} key={n.id} onCheckedChange={(on) => onPick([n], on)} value={n.id}>
            <span className="flex-1 truncate">{n.name}</span>
            <span className="text-muted-foreground text-xs tabular-nums">
              <FormatByte value={n.size} />
            </span>
          </MenuCheckboxItem>
        ) : (
          <MenuSub key={n.id}>
            <MenuSubTrigger>{n.name}</MenuSubTrigger>
            <MenuSubContent className="w-72">
              <Listing list={list} node={n} onPick={onPick} selected={selected} />
            </MenuSubContent>
          </MenuSub>
        ),
      )}
    </>
  );
}
