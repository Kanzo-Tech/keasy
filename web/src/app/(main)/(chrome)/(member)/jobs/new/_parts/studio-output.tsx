"use client";

import { useMemo } from "react";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
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

/** Where the graph this job produces is written: a sink, and a folder under it. */
export function StudioOutput({
  values,
  onChange,
  folderTaken,
  connections,
}: {
  values: OutputValues;
  onChange: (patch: Partial<OutputValues>) => void;
  /** The server answered that another job writes to this folder already. */
  folderTaken: boolean;
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
  const folderError =
    folderProblem(values.folder) ??
    (folderTaken ? "Another job writes to this folder already. Pick another." : null);

  return (
    <div className="flex flex-col gap-5 p-3">
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
            ? "No writable connection yet. Add one under Connections."
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
    </div>
  );
}
