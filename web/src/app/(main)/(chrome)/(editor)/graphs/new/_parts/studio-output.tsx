"use client";

import { useMemo } from "react";
import { ChevronDown, FolderDown } from "lucide-react";
import {
  Button,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Show,
  createListCollection,
} from "@kanzo-tech/ui";
import type { StorageConnection } from "@/lib/connections";
import { folderProblem } from "./folder";

export interface OutputValues {
  sinkConnectionId: string | null;
  /** The output's folder under the sink, as the server will receive it. */
  folder: string;
}

/** The sink's base URL without its trailing slash. */
export const sinkBase = (sink: StorageConnection | undefined) => sink?.url.replace(/\/+$/, "");

/**
 * Where the graph's output is written — a sink, and a folder under it — shown beside its name the
 * way a document shows the folder it lives in, and changed in a popover from there.
 */
export function StudioOutput({
  open,
  onOpenChange,
  values,
  onChange,
  folderRefused,
  connections,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  values: OutputValues;
  onChange: (patch: Partial<OutputValues>) => void;
  /** What the server said about this folder when Create sent it: another graph's, or misspelled. */
  folderRefused: string | null;
  connections: StorageConnection[];
}) {
  // Only a writable connection can hold output: keasy models that as `direction: "sink"`.
  const sinks = useMemo(() => connections.filter((c) => c.direction === "sink"), [connections]);
  const destinations = useMemo(
    () =>
      createListCollection({
        items: sinks.map((c) => ({
          label: `@${c.name}`,
          value: c.name,
          url: c.url,
        })),
      }),
    [sinks],
  );

  const destination = sinks.find((c) => c.name === values.sinkConnectionId);
  const folderError = folderProblem(values.folder) ?? folderRefused;

  return (
    <Popover onOpenChange={(d) => onOpenChange(d.open)} open={open} positioning={{ placement: "bottom-start" }}>
      <PopoverTrigger asChild>
        <Button
          aria-invalid={!destination || !!folderError}
          className="min-w-0 font-mono"
          size="sm"
          variant="ghost"
        >
          <FolderDown />
          <span className="truncate">
            {destination ? `@${destination.name} ${values.folder}/` : "Pick where it lands"}
          </span>
          <ChevronDown />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96">
        <PopoverHeader title="Where it lands" />
        <PopoverBody className="flex flex-col gap-5">
          <Field invalid={!destination}>
            <FieldLabel>Destination</FieldLabel>
            <Select
              collection={destinations}
              onValueChange={(d) => onChange({ sinkConnectionId: d.value[0] ?? null })}
              value={values.sinkConnectionId ? [values.sinkConnectionId] : []}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Where the graph lands…" />
              </SelectTrigger>
              <SelectContent>
                {destinations.items.map((item) => (
                  <SelectItem item={item} key={item.value}>
                    <span className="font-mono">{item.label}</span>
                    <span className="ms-2 truncate text-muted-foreground text-xs">{item.url}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError>
              {sinks.length === 0
                ? "No workspace storage yet. Ask an admin to set it up in Settings → Workspace storage."
                : "Pick where the graph lands."}
            </FieldError>
          </Field>

          <Field invalid={!!folderError}>
            <FieldLabel>Folder</FieldLabel>
            <Input
              className="font-mono"
              onChange={(e) => onChange({ folder: e.target.value })}
              spellCheck={false}
              value={values.folder}
            />
            <FieldError>{folderError}</FieldError>
            <Show when={!!destination && !folderError}>
              <FieldDescription className="break-all">
                Writes to{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                  {sinkBase(destination)}/{values.folder}/
                </code>
              </FieldDescription>
            </Show>
          </Field>
        </PopoverBody>
      </PopoverContent>
    </Popover>
  );
}
