"use client";

import { useMemo } from "react";
import {
  Field,
  FieldDescription,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Show,
  createListCollection,
} from "@kanzo-tech/ui";
import type { Connection } from "@/lib/types";

export interface ConfigValues {
  sinkConnectionId: string | null;
}

/** One setting, said the way a settings page says it: what it is on the left, the
 *  control on the right. Below the container's `@2xl` the two stack, because at
 *  that width a 15rem label column leaves nothing for the control. */
function Setting({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-4 @2xl:grid-cols-[15rem_minmax(0,1fr)] @2xl:gap-10">
      <div className="flex flex-col gap-1">
        <h3 className="font-medium text-sm">{title}</h3>
        <p className="text-muted-foreground text-sm leading-snug">{description}</p>
      </div>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </section>
  );
}

/**
 * Where the graph this job produces is written.
 *
 * It was a narrow stack of hand-rolled `FormField`s around controlled inputs —
 * three settings in a column with a great deal of nothing either side. This is
 * the shape a settings page has: the explanation on the left, the control on the
 * right, a rule between sections, which fills the width with sentences rather
 * than padding. Container queries, not viewport ones: what is narrow here is the
 * page minus the sidebar, and `md:` cannot see the sidebar.
 *
 * The job's NAME is not here any more. It is in the studio's header, editable in
 * place, because it labels all three pages rather than being one page's field.
 */
export function StudioConfigure({
  values,
  onChange,
  jobName,
  connections,
}: {
  values: ConfigValues;
  onChange: (patch: Partial<ConfigValues>) => void;
  /** Only to show the path the output will actually land on. */
  jobName: string;
  connections: Connection[];
}) {
  const set = <K extends keyof ConfigValues>(key: K, value: ConfigValues[K]) =>
    onChange({ [key]: value } as Partial<ConfigValues>);

  // Only a WRITABLE connection can hold output — keasy models that as
  // `direction: "sink"`, so the destination list is not the connection list.
  const sinks = useMemo(() => connections.filter((c) => c.direction === "sink"), [connections]);
  const destinations = useMemo(
    () =>
      createListCollection({
        items: sinks.map((c) => ({ label: `@${c.name}`, value: c.id, url: c.url })),
      }),
    [sinks],
  );

  const destination = sinks.find((c) => c.id === values.sinkConnectionId);
  const slug = (jobName || "unnamed-job").trim().toLowerCase().replace(/\s+/g, "-");

  return (
    <div className="@container mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-8">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading font-semibold text-lg">Configure</h2>
        <p className="text-muted-foreground text-sm">
          Where the graph this job produces is written.
        </p>
      </div>

      <Separator />

      <Setting
        description="Only a connection the workspace can write to can hold output. The job gets its own folder under the one you pick."
        title="Destination"
      >
        <Field>
          <Select
            collection={destinations}
            onValueChange={(d) => set("sinkConnectionId", d.value[0] ?? null)}
            value={values.sinkConnectionId ? [values.sinkConnectionId] : []}
          >
            <SelectTrigger className="w-full max-w-md">
              <SelectValue placeholder="Where the generated graph lands…" />
            </SelectTrigger>
            <SelectContent>
              {destinations.items.map((item) => (
                <SelectItem item={item} key={item.value}>
                  <span className="font-mono">{item.label}</span>
                  <span className="ms-2 text-muted-foreground text-xs">{item.url}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* The resolved path, not a description of it. A settings page that
              tells you the rule and leaves you to apply it is making you do
              arithmetic. */}
          <FieldDescription>
            <Show
              fallback={
                <span className="text-destructive">
                  {sinks.length === 0
                    ? "No writable connection yet — add one under Connections."
                    : "Pick one before creating the job."}
                </span>
              }
              when={!!destination}
            >
              Writes to{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                {destination?.url}/{slug}
              </code>
            </Show>
          </FieldDescription>
        </Field>
      </Setting>
    </div>
  );
}
