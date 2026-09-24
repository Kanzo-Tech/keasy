"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useQueries } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, ArrowRight, Database, MoreHorizontal, Plus, Wand2 } from "lucide-react";
import { type AiStatus, type RunState, Task, TaskList, TaskStatus, TaskTitle, useAiStream } from "@kanzo-tech/ai";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
  Button,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  Item,
  ItemActions,
  ItemDescription,
  ItemMedia,
  ItemTitle,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  SectionBody,
  SectionFooter,
  Show,
  Spinner,
  Steps,
  StepsContent,
  StepsIndicator,
  StepsItem,
  StepsList,
  StepsSeparator,
  StepsTitle,
  StepsTrigger,
  Textarea,
  toast,
} from "@kanzo-tech/ui";
import {
  type ColumnDef,
  DataTableContent,
  DataTablePagination,
  DataTableRoot,
  selectColumn,
  useDataTable,
} from "@kanzo-tech/ui/table";
import { api } from "@/lib/api";
import { type SseFrame, failOnError } from "@/lib/api/sse";
import { formatSize } from "@/lib/formatters";
import { queryKeys } from "@/lib/query-keys";
import type { CompetencyQuestion, Connection, FileSchema, ProviderInfo } from "@/lib/types";
import { readableFiles } from "@/lib/utils";

type Selection = Record<string, boolean>;
type ConnectionFile = { path: string; size: number };

const STEPS = ["Connections", "Describe", "Requirements", "Generate"] as const;

const RUN_STATE: Record<AiStatus, RunState> = {
  idle: "pending",
  loading: "running",
  ready: "done",
  error: "failed",
};

const CONNECTION_COLUMNS: ColumnDef<Connection>[] = [
  selectColumn<Connection>({ rowLabel: (row) => `Select ${row.original.name}` }),
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  },
  {
    accessorKey: "url",
    header: "URL",
    cell: ({ row }) => <span className="font-mono text-muted-foreground text-xs">{row.original.url}</span>,
  },
];

const FILE_COLUMNS: ColumnDef<ConnectionFile>[] = [
  selectColumn<ConnectionFile>({ rowLabel: (row) => `Select ${row.original.path}` }),
  {
    accessorKey: "path",
    header: "File",
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.path}</span>,
  },
  {
    accessorKey: "size",
    header: () => <div className="text-end">Size</div>,
    cell: ({ row }) => (
      <div className="text-end text-muted-foreground text-xs">{formatSize(row.original.size)}</div>
    ),
  },
];

/** keasy's SSE frames through the library's stream: deltas accumulate, `complete` is the result. */
function useScriptStream() {
  const stream = useAiStream<SseFrame>();
  const [text, setText] = useState("");
  const { run } = stream;

  const start = useCallback(
    <T,>(source: (signal: AbortSignal) => AsyncGenerator<SseFrame>, onComplete: (result: T) => void) => {
      setText("");
      void run(
        (signal) => failOnError(source(signal)),
        (frame) => {
          if (frame.event === "delta") setText((prev) => prev + frame.data);
          else if (frame.event === "complete") onComplete(JSON.parse(frame.data) as T);
        },
      );
    },
    [run],
  );

  return { ...stream, start, text };
}

function ConnectionFiles({
  connection,
  files,
  loading,
  selection,
  onSelectionChange,
}: {
  connection: Connection;
  files: ConnectionFile[];
  loading: boolean;
  selection: Selection;
  onSelectionChange: (selection: Selection) => void;
}) {
  const table = useDataTable({
    columns: FILE_COLUMNS,
    data: files,
    getRowId: (file) => file.path,
    state: { rowSelection: selection },
    onRowSelectionChange: (update) =>
      onSelectionChange(typeof update === "function" ? update(selection) : update),
  });

  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium text-sm">
        Files in <span className="font-mono">@{connection.name}</span>
      </h3>
      <DataTableRoot table={table}>
        <DataTableContent<ConnectionFile>
          empty={loading ? <Spinner className="mx-auto" /> : "No files a provider can read."}
          onRowClick={(file) => table.getRow(file.path).toggleSelected()}
        />
        <DataTablePagination />
      </DataTableRoot>
    </section>
  );
}

export function AssistantWizard({
  onComplete,
  connections,
  providers,
}: {
  onComplete: (script: string) => void;
  connections: Connection[];
  providers: ProviderInfo[];
}) {
  const [step, setStep] = useState(0);
  // Per connection, once the member has touched it; untouched means every readable file.
  const [fileSelection, setFileSelection] = useState<Record<string, Selection>>({});
  const [domain, setDomain] = useState("");
  const [reqs, setReqs] = useState<CompetencyQuestion[]>([]);

  const dataConnections = useMemo(() => connections.filter((c) => c.kind === "data"), [connections]);
  const connectionTable = useDataTable({
    columns: CONNECTION_COLUMNS,
    data: dataConnections,
    getRowId: (c) => c.id,
  });
  const selected = connectionTable.getSelectedRowModel().rows.map((row) => row.original);
  const cloud = selected.filter((c) => c.location_type === "cloud");

  const listings = useQueries({
    queries: cloud.map((c) => ({
      queryKey: queryKeys.connections.files(c.id),
      queryFn: () => api.connections.files(c.id),
    })),
  });
  const readable = cloud.map((connection, i) => {
    const files = readableFiles(listings[i]?.data ?? [], providers, "data");
    const selection =
      fileSelection[connection.id] ?? Object.fromEntries(files.map((f) => [f.path, true]));
    return { connection, files, selection, loading: listings[i]?.isPending ?? true };
  });
  const picked = readable.flatMap(({ connection, files, selection }) =>
    files.filter((f) => selection[f.path]).map((f) => ({ connection, path: f.path })),
  );

  const schemaQueries = useQueries({
    queries: picked.map(({ connection, path }) => ({
      queryKey: queryKeys.connections.schema(connection.id, path),
      queryFn: () => api.connections.schema(connection.id, path),
      enabled: step > 0,
    })),
  });
  const schemasReady = readable.every((r) => !r.loading) && schemaQueries.every((q) => !q.isPending);
  const schemas: FileSchema[] = picked.flatMap(({ connection, path }, i) => {
    const columns = schemaQueries[i]?.data?.columns;
    return columns ? [{ connection_name: connection.name, file_path: path, columns }] : [];
  });

  const reqColumns = useMemo<ColumnDef<CompetencyQuestion>[]>(
    () => [
      selectColumn<CompetencyQuestion>(),
      {
        id: "requirement",
        header: "Requirement",
        cell: ({ row }) => (
          <div className="flex flex-col gap-0.5">
            <Input
              className="h-7 border-0 px-0 text-sm shadow-none focus-visible:ring-0"
              onChange={(e) => {
                const { value } = e.target;
                setReqs((prev) => prev.map((r) => (r.id === row.original.id ? { ...r, question: value } : r)));
              }}
              onClick={(e) => e.stopPropagation()}
              placeholder="Type a requirement..."
              value={row.original.question}
            />
            <span className="text-muted-foreground text-xs">{row.original.rationale}</span>
          </div>
        ),
      },
      {
        id: "actions",
        size: 48,
        cell: ({ row }) => (
          <div className="text-end">
            <Menu positioning={{ placement: "bottom-end" }}>
              <MenuTrigger asChild>
                <Button
                  aria-label="Requirement actions"
                  onClick={(e) => e.stopPropagation()}
                  size="icon-sm"
                  variant="ghost"
                >
                  <MoreHorizontal />
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem
                  onSelect={() => setReqs((prev) => prev.filter((r) => r.id !== row.original.id))}
                  value="remove"
                  variant="destructive"
                >
                  Remove
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
        ),
      },
    ],
    [],
  );
  const reqTable = useDataTable({ columns: reqColumns, data: reqs, getRowId: (r) => r.id });
  const questions = reqTable
    .getSelectedRowModel()
    .rows.map((row) => row.original.question.trim())
    .filter(Boolean);

  const suggest = useScriptStream();
  const generate = useScriptStream();

  const askForRequirements = () =>
    suggest.start<{ competency_questions: CompetencyQuestion[] }>(
      (signal) => api.assistant.suggestStream({ domain, schemas }, signal),
      ({ competency_questions }) => {
        setReqs(competency_questions);
        reqTable.setRowSelection(Object.fromEntries(competency_questions.map((q) => [q.id, true])));
      },
    );

  const generateProgram = () =>
    generate.start<{ script: string }>(
      (signal) => api.assistant.generateStream({ domain, competency_questions: questions, schemas }, signal),
      ({ script }) => {
        onComplete(script);
        toast.create({ title: "Script generated — review before submitting", type: "success" });
      },
    );

  const addRequirement = () => {
    const id = `custom-${Date.now()}`;
    setReqs((prev) => [...prev, { id, question: "", rationale: "Custom requirement" }]);
    reqTable.setRowSelection((prev) => ({ ...prev, [id]: true }));
  };

  const next = () => {
    if (step === 1 && reqs.length === 0) askForRequirements();
    if (step === 2) generateProgram();
    setStep(step + 1);
  };
  const back = () => {
    if (step === 2) suggest.cancel();
    if (step === 3) generate.cancel();
    setStep(step - 1);
  };

  const canNext = [selected.length > 0, schemasReady, questions.length > 0][step] ?? false;

  return (
    <Steps className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden" count={STEPS.length} step={step}>
      <div className="flex h-14 shrink-0 items-center justify-center border-b px-3">
        <StepsList className="w-full max-w-xl">
          {STEPS.map((title, index) => (
            <StepsItem index={index} key={title}>
              <StepsTrigger disabled>
                <StepsIndicator>{index + 1}</StepsIndicator>
                <StepsTitle className="hidden sm:inline">{title}</StepsTitle>
              </StepsTrigger>
              <StepsSeparator />
            </StepsItem>
          ))}
        </StepsList>
      </div>

      <SectionBody scale="page">
        <StepsContent className="flex flex-col gap-4" index={0}>
          <Show
            fallback={
              <Item className="mx-auto my-auto max-w-md flex-col gap-2 py-10 text-center">
                <ItemMedia
                  className="group-has-data-[slot=item-description]/item:self-center text-muted-foreground [&_svg:not([class*='size-'])]:size-8"
                  variant="icon"
                >
                  <Database />
                </ItemMedia>
                <ItemTitle className="text-base">No data connections</ItemTitle>
                <ItemDescription>The assistant drafts a program from the data you connect.</ItemDescription>
                <ItemActions>
                  <Button asChild size="sm" variant="outline">
                    <Link href="/connections/new?type=data">Create a data connection</Link>
                  </Button>
                </ItemActions>
              </Item>
            }
            when={dataConnections.length > 0}
          >
            <p className="text-muted-foreground text-sm">Select the data connections to include.</p>
            <DataTableRoot table={connectionTable}>
              <DataTableContent<Connection>
                onRowClick={(c) => connectionTable.getRow(c.id).toggleSelected()}
              />
              <DataTablePagination />
            </DataTableRoot>
            {readable.map(({ connection, files, selection, loading }) => (
              <ConnectionFiles
                connection={connection}
                files={files}
                key={connection.id}
                loading={loading}
                onSelectionChange={(next) => setFileSelection((prev) => ({ ...prev, [connection.id]: next }))}
                selection={selection}
              />
            ))}
          </Show>
        </StepsContent>

        <StepsContent className="flex flex-col gap-4" index={1}>
          <Field>
            <FieldLabel>Domain</FieldLabel>
            <Textarea
              onChange={(e) => setDomain(e.target.value)}
              placeholder="e.g. daily weather observations from Spanish stations"
              rows={6}
              value={domain}
            />
            <FieldDescription>Optional. What the knowledge graph is about, or what it is for.</FieldDescription>
          </Field>
          <Show when={!schemasReady}>
            <TaskList>
              <Task state="running">
                <TaskStatus />
                <TaskTitle>Reading the schemas of the selected files</TaskTitle>
              </Task>
            </TaskList>
          </Show>
        </StepsContent>

        <StepsContent className="flex flex-col gap-4" index={2}>
          <Show
            fallback={
              <>
                <div className="flex items-center justify-between gap-4">
                  <p className="text-muted-foreground text-sm">
                    What the knowledge graph should be able to answer.
                  </p>
                  <Button onClick={addRequirement} size="sm" variant="outline">
                    <Plus />
                    Add requirement
                  </Button>
                </div>
                <Show when={suggest.status === "error"}>
                  <Alert variant="destructive">
                    <AlertCircle />
                    <AlertTitle>Suggesting requirements failed</AlertTitle>
                    <AlertDescription>{suggest.error}</AlertDescription>
                    <AlertAction>
                      <Button onClick={askForRequirements} size="sm" variant="outline">
                        Try again
                      </Button>
                    </AlertAction>
                  </Alert>
                </Show>
                <DataTableRoot table={reqTable}>
                  <DataTableContent<CompetencyQuestion>
                    empty="No requirements yet."
                    onRowClick={(r) => reqTable.getRow(r.id).toggleSelected()}
                  />
                  <DataTablePagination />
                </DataTableRoot>
              </>
            }
            when={suggest.status === "loading"}
          >
            <TaskList>
              <Task state="running">
                <TaskStatus />
                <TaskTitle>Suggesting requirements</TaskTitle>
              </Task>
            </TaskList>
            <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-muted-foreground text-xs">
              {suggest.text}
            </pre>
          </Show>
        </StepsContent>

        <StepsContent className="flex flex-col gap-4" index={3}>
          <TaskList>
            <Task state={RUN_STATE[generate.status]}>
              <TaskStatus />
              <TaskTitle>Generating the Fossil program</TaskTitle>
            </Task>
          </TaskList>
          <Show when={generate.status === "error"}>
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>Generation failed</AlertTitle>
              <AlertDescription>{generate.error}</AlertDescription>
              <AlertAction>
                <Button onClick={generateProgram} size="sm" variant="outline">
                  Try again
                </Button>
              </AlertAction>
            </Alert>
          </Show>
          <Show when={generate.text.length > 0}>
            <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-muted-foreground text-xs">
              {generate.text}
            </pre>
          </Show>
        </StepsContent>
      </SectionBody>

      <SectionFooter>
        <Button disabled={step === 0} onClick={back} size="sm" variant="ghost">
          <ArrowLeft />
          Back
        </Button>
        <Show when={step < 3}>
          <Button disabled={!canNext} onClick={next} size="sm">
            <Show
              fallback={
                <>
                  Next
                  <ArrowRight />
                </>
              }
              when={step === 2}
            >
              <Wand2 />
              Generate
            </Show>
          </Button>
        </Show>
      </SectionFooter>
    </Steps>
  );
}
