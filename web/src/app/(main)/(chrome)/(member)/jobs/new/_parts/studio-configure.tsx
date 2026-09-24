"use client";

import { useMemo } from "react";
import {
  Badge,
  Field,
  FieldDescription,
  FieldLabel,
  Float,
  RadioGroup,
  RadioGroupCard,
  RadioGroupIndicator,
  RadioGroupText,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Show,
  Switch,
  createListCollection,
} from "@kanzo-tech/ui";
import { CalendarClock, Zap } from "lucide-react";
import type { Connection, RunMode } from "@/lib/types";

export interface ConfigValues {
  mode: RunMode;
  sinkConnectionId: string | null;
  dcatEnabled: boolean;
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
 * When this job runs, and where the graph it produces is written.
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
  orgConfigured,
  orgName,
}: {
  values: ConfigValues;
  onChange: (patch: Partial<ConfigValues>) => void;
  /** Only to show the path the output will actually land on. */
  jobName: string;
  connections: Connection[];
  orgConfigured: boolean;
  orgName: string | null;
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
          When this job runs, and where the graph it produces is written.
        </p>
      </div>

      <Separator />

      <Setting
        description="Integrated jobs run once, as soon as they are created. A schedule repeats them."
        title="Run mode"
      >
        <RadioGroup
          columns={2}
          onValueChange={(d) => d.value && set("mode", d.value as RunMode)}
          value={values.mode}
        >
          <RadioGroupCard className="items-start" value="integrated">
            <Zap className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <RadioGroupText>Integrated</RadioGroupText>
              <span className="text-muted-foreground text-xs leading-snug">
                Runs as soon as it is created.
              </span>
            </div>
            <RadioGroupIndicator className="order-last mt-0.5 ms-auto" />
          </RadioGroupCard>

          {/* Not shipped, and the badge says so ON the control rather than
              leaving `disabled` to mean whatever a reader guesses. `Float` over
              a `relative` box is the whole of it. */}
          <div className="relative">
            <RadioGroupCard className="h-full items-start" disabled value="scheduled">
              <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="flex min-w-0 flex-col gap-0.5">
                <RadioGroupText>Scheduled</RadioGroupText>
                <span className="text-muted-foreground text-xs leading-snug">
                  Runs on a cron you define.
                </span>
              </div>
              <RadioGroupIndicator className="order-last mt-0.5 ms-auto" />
            </RadioGroupCard>
            <Float className="-end-2 -top-2" placement="top-end">
              <Badge size="xs" variant="secondary">
                Coming soon
              </Badge>
            </Float>
          </div>
        </RadioGroup>
      </Setting>

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

      <Separator />

      <Setting
        description={
          orgConfigured
            ? `Publishes a DCAT-AP record for ${orgName} alongside the graph, so the datasets are discoverable in a catalogue.`
            : "Publishes a DCAT-AP record alongside the graph. It names the publisher, so it needs the organisation's identity configured first."
        }
        title="Catalogue"
      >
        <Field disabled={!orgConfigured} orientation="horizontal">
          <FieldLabel className="w-fit flex-1">Publish a DCAT-AP record</FieldLabel>
          <Switch
            checked={values.dcatEnabled && orgConfigured}
            disabled={!orgConfigured}
            onCheckedChange={(d) => set("dcatEnabled", d.checked)}
          />
        </Field>
      </Setting>
    </div>
  );
}
