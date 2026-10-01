"use client";

import {
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  Show,
  Spinner,
} from "@kanzo-tech/ui";
import { Check } from "lucide-react";
import type { CheckRow, SourceRefInfo } from "@/lib/fossil/checker";
import type { StorageConnection } from "@/lib/connections";
import { type Shown } from "@/lib/errors";
import { ProblemView } from "@/components/problem-view";
import { FindingsList } from "./findings-list";
import { type OutputValues, sinkBase } from "./studio-output";

const ROLE_LABEL = { data: "data", schema: "shape" } as const;

/** The last look before a job exists: what it reads, where it writes, and what stands in the way. */
export function CreateJobDialog({
  open,
  onOpenChange,
  name,
  output,
  connections,
  refs,
  refsProblem,
  findings,
  blocked,
  creating,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  output: OutputValues;
  connections: StorageConnection[];
  refs: SourceRefInfo[];
  /** Why the references could not be read, when they could not. */
  refsProblem: Shown | null;
  findings: readonly CheckRow[];
  blocked: boolean;
  creating: boolean;
  onCreate: () => void;
}) {
  const destination = connections.find((c) => c.name === output.sinkConnectionId);
  const errors = findings.filter((f) => f.severity === 1);
  const title = `Create ${name.trim() || "job"}`;

  return (
    <Dialog lazyMount onOpenChange={(d) => onOpenChange(d.open)} open={open} unmountOnExit>
      <DialogContent size="lg">
        <DialogHeader description="Check what the job reads and where it writes." title={title} />
        <DialogBody className="flex flex-col gap-5">
          <Section title="Writes to">
            <Show
              fallback={<p className="text-destructive text-sm">No destination picked.</p>}
              when={!!destination}
            >
              <code className="break-all font-mono text-sm">
                {sinkBase(destination)}/{output.folder}/
              </code>
            </Show>
          </Section>

          <Section title={`Reads (${refs.length})`}>
            {refsProblem && <ProblemView problem={refsProblem} />}
            <Show
              fallback={
                <p className="text-muted-foreground text-sm">The program reads nothing yet.</p>
              }
              when={refs.length > 0}
            >
              <ul className="divide-y rounded-lg border">
                {refs.map((ref) => (
                  <li
                    className="flex items-baseline justify-between gap-3 px-3 py-1.5"
                    key={`${ref.connection}/${ref.path}/${ref.role}`}
                  >
                    <span className="min-w-0 truncate font-mono text-sm">
                      {ref.connection === null ? "" : `@${ref.connection}/`}
                      {ref.path}
                    </span>
                    <span className="shrink-0 text-muted-foreground text-xs">
                      {ROLE_LABEL[ref.role]}
                    </span>
                  </li>
                ))}
              </ul>
            </Show>
          </Section>

          <Show when={errors.length > 0}>
            <Section title={`Blocking problems (${errors.length})`}>
              <FindingsList findings={errors} />
            </Section>
          </Show>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Keep editing</Button>
          </DialogClose>
          <Button disabled={blocked || creating} onClick={onCreate}>
            <Show fallback={<Check />} when={creating}>
              <Spinner />
            </Show>
            {title}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">{title}</h3>
      {children}
    </section>
  );
}
