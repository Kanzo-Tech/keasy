"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Item,
  ItemDescription,
  ItemMedia,
  ItemTitle,
  Separator,
  Show,
  Spinner,
} from "@kanzo-tech/ui";
import { Check, Shapes } from "lucide-react";
import type { CheckRow, SourceRefInfo } from "@/lib/fossil/checker";
import type { ConfigValues } from "./studio-configure";
import type { Connection } from "@/lib/types";

/** LSP severity: 1 error, 2 warning, 3 information, 4 hint. */
const SEVERITY_LABEL = ["error", "error", "warning", "info", "hint"] as const;
const SEVERITY_TEXT = [
  "text-destructive dark:text-destructive-foreground",
  "text-destructive dark:text-destructive-foreground",
  "text-warning",
  "text-info",
  "text-muted-foreground",
] as const;

const ROLE_LABEL = { data: "read as data", schema: "read as a shape" } as const;

/**
 * What the job reads — fossil's typed lineage — and the compiler's findings that
 * stand in the way of creating it. Emitted classes are not drawn: fossil has no
 * query for them yet.
 */
export function StudioSummary({
  name,
  values,
  connections,
  refs,
  findings,
  blocked,
  creating,
  onCreate,
}: {
  name: string;
  values: ConfigValues;
  connections: Connection[];
  refs: SourceRefInfo[];
  findings: readonly CheckRow[];
  blocked: boolean;
  creating: boolean;
  onCreate: () => void;
}) {
  const destination = connections.find((c) => c.id === values.sinkConnectionId);
  const errors = findings.filter((f) => f.severity === 1).length;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading font-semibold text-lg">What this job reads</h2>
        <p className="text-muted-foreground text-sm">
          {refs.length} reference{refs.length === 1 ? "" : "s"} · runs {values.mode} · landing in{" "}
          <Show
            fallback={<span className="text-destructive">no destination</span>}
            when={!!destination}
          >
            <span className="font-mono">@{destination?.name}</span>
          </Show>
          {values.dcatEnabled ? " · with a DCAT-AP record" : ""}
        </p>
      </div>

      <Show
        fallback={
          <Item className="mx-auto max-w-[420px] flex-col gap-2 py-8 text-center">
            <ItemMedia
              className="group-has-data-[slot=item-description]/item:self-center text-muted-foreground [&_svg:not([class*='size-'])]:size-8"
              variant="icon"
            >
              <Shapes />
            </ItemMedia>
            <ItemTitle className="text-base">This program reads nothing yet</ItemTitle>
            <ItemDescription>
              Bind a source on the Editor page —{" "}
              <code className="font-mono text-xs">
                User := io.csv(&quot;@connection/users.csv&quot;)
              </code>{" "}
              — and it shows up here.
            </ItemDescription>
          </Item>
        }
        when={refs.length > 0}
      >
        <Card>
          <CardHeader>
            <CardTitle>References</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col">
              {refs.map((ref, i) => (
                <li key={`${ref.connection}/${ref.path}/${ref.role}`}>
                  <Show when={i > 0}>
                    <Separator />
                  </Show>
                  <div className="flex flex-wrap items-baseline justify-between gap-3 py-2">
                    <span className="font-mono text-sm">
                      <Show
                        fallback={<span className="text-muted-foreground">direct</span>}
                        when={ref.connection !== null}
                      >
                        @{ref.connection}
                      </Show>
                      /{ref.path}
                    </span>
                    <span className="text-muted-foreground text-xs">{ROLE_LABEL[ref.role]}</span>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </Show>

      <Show when={findings.length > 0}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Findings
              <Badge size="xs" variant={errors ? "destructive" : "warning"}>
                {findings.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {findings.map((f, i) => (
                <li className="flex flex-col gap-0.5 rounded-lg border p-3" key={i}>
                  <span className={`font-medium text-xs ${SEVERITY_TEXT[f.severity] ?? ""}`}>
                    Line {f.range.start.line + 1} · {SEVERITY_LABEL[f.severity] ?? "note"}
                  </span>
                  <span className="text-muted-foreground text-sm">{f.message}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </Show>

      <div className="flex items-center justify-end gap-3">
        <Show when={blocked}>
          <span className="text-muted-foreground text-sm">
            {errors > 0
              ? "Fix the program before creating the job."
              : "Write a program before creating the job."}
          </span>
        </Show>
        <Button disabled={blocked || creating} onClick={onCreate}>
          <Show fallback={<Check />} when={creating}>
            <Spinner />
          </Show>
          Create {name.trim() || "job"}
        </Button>
      </div>
    </div>
  );
}
