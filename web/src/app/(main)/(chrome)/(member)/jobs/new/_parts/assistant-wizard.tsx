"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, ArrowRight, Database, Plus, Wand2 } from "lucide-react";
import { Assist, AssistProvider } from "@kanzo-tech/ai";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
  Button,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyIndicator,
  EmptyRoot,
  EmptyTitle,
  Field,
  FieldHelper,
  FieldLabel,
  FieldRequiredIndicator,
  FormatByte,
  Input,
  MenuItem,
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
  actionsColumn,
  type ColumnDef,
  DataTableContent,
  DataTablePagination,
  DataTableRoot,
  selectColumn,
  useDataTable,
} from "@kanzo-tech/ui/table";
import { Link } from "@kanzo-tech/navigation/next";
import { $api } from "@/lib/api/client";
import { kanzo } from "@/lib/ai";
import { type CompetencyQuestion, describeFiles, suggestQuestions, writeProgram } from "./assistant-prompts";
import * as checker from "@/lib/fossil/checker";
import { connectionPath, describeSources, sourceDescriptorsKey } from "./describe-sources";
import { providerFor } from "@/lib/fossil/providers";
import type { StorageConnection } from "@/lib/connections";

type Connection = StorageConnection;
type Selection = Record<string, boolean>;
type ConnectionFile = { path: string; size: number };

const STEPS = ["Connections", "Describe", "Requirements", "Generate"] as const;

/** The model the Domain field is assisted by. */
const COMPLETE = kanzo("kanzo-complete");

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
      <div className="text-end text-muted-foreground text-xs"><FormatByte unitSystem="binary" value={row.original.size} /></div>
    ),
  },
];

/** One model call at a time: started, stopped when superseded or left, and how it ended. */
function useCall() {
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const ctrl = useRef<AbortController>(undefined);
  useEffect(() => () => ctrl.current?.abort(), []);

  const run = useCallback(async (work: (signal: AbortSignal) => Promise<void>) => {
    ctrl.current?.abort();
    const mine = new AbortController();
    ctrl.current = mine;
    setStatus("running");
    setError(null);
    try {
      await work(mine.signal);
      if (!mine.signal.aborted) setStatus("done");
    } catch (e) {
      if (mine.signal.aborted) return;
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const cancel = useCallback(() => {
    ctrl.current?.abort();
    setStatus("idle");
  }, []);

  return { status, error, run, cancel };
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
  providers: checker.ProviderInfo[];
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
    getRowId: (c) => c.name,
  });
  const selected = connectionTable.getSelectedRowModel().rows.map((row) => row.original);
  const cloud = selected;

  const listings = useQueries({
    queries: cloud.map((c) =>
      $api.queryOptions("get", "/v1/connections/{name}/files", { params: { path: { name: c.name } } }),
    ),
  });
  const readable = cloud.map((connection, i) => {
    const files = (listings[i]?.data ?? []).filter((f) => providerFor(f.path, "data", providers));
    const selection =
      fileSelection[connection.name] ?? Object.fromEntries(files.map((f) => [f.path, true]));
    return { connection, files, selection, loading: listings[i]?.isPending ?? true };
  });
  const picked = readable.flatMap(({ connection, files, selection }) =>
    files.filter((f) => selection[f.path]).map((f) => ({ connection, path: f.path })),
  );

  // The picked files, written as the source bindings the generated program will
  // hold and described the way the editor describes a program's sources.
  const bindings = picked.flatMap(({ connection, path }) => {
    const provider = providerFor(path, "data", providers);
    return provider
      ? [{ constructor: provider.name, uri: `@${connection.name}/${connectionPath(connection, path)}` }]
      : [];
  });
  const program = bindings.map((b, i) => `f${i} := io.${b.constructor}("${b.uri}")`).join("\n");
  const described = useQuery({
    queryKey: sourceDescriptorsKey(bindings.map((b) => b.uri)),
    queryFn: async () => describeSources(await (await checker.jobProgram()).sources(program)),
    enabled: step > 0 && bindings.length > 0,
  });
  const schemasReady =
    readable.every((r) => !r.loading) && (bindings.length === 0 || !described.isPending);
  const schemas = described.data ?? [];

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
      actionsColumn<CompetencyQuestion>({
        label: (row) => `Actions for requirement ${row.index + 1}`,
        menu: (row) => (
          <MenuItem
            onSelect={() => setReqs((prev) => prev.filter((r) => r.id !== row.original.id))}
            value="remove"
            variant="destructive"
          >
            Remove
          </MenuItem>
        ),
      }),
    ],
    [],
  );
  const reqTable = useDataTable({ columns: reqColumns, data: reqs, getRowId: (r) => r.id });
  const questions = reqTable
    .getSelectedRowModel()
    .rows.map((row) => row.original.question.trim())
    .filter(Boolean);

  const suggest = useCall();
  const generate = useCall();
  const [draft, setDraft] = useState("");

  // Each question lands in the table as soon as the model has written it whole.
  const askForRequirements = () =>
    void suggest.run(async (signal) => {
      setReqs([]);
      let n = 0;
      for await (const q of suggestQuestions(domain, schemas, signal)) {
        const id = `cq${++n}`;
        setReqs((prev) => [...prev, { id, ...q }]);
        reqTable.setRowSelection((prev) => ({ ...prev, [id]: true }));
      }
    });

  const generateProgram = () =>
    void generate.run(async (signal) => {
      let program = "";
      for await (const partial of writeProgram(domain, questions, schemas, signal)) {
        program = partial.program ?? program;
        setDraft(program);
      }
      onComplete(program);
      toast.create({ title: "Script generated — review before submitting", type: "success" });
    });

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
              <EmptyRoot>
                <EmptyHeader>
                  <EmptyIndicator variant="icon">
                    <Database />
                  </EmptyIndicator>
                  <EmptyTitle asChild>
                    <h3>No data connections</h3>
                  </EmptyTitle>
                  <EmptyDescription>The assistant drafts a program from the data you connect.</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button asChild size="sm" variant="outline">
                    <Link href="/connections/new?type=data">Create a data connection</Link>
                  </Button>
                </EmptyContent>
              </EmptyRoot>
            }
            when={dataConnections.length > 0}
          >
            <p className="text-muted-foreground text-sm">Select the data connections to include.</p>
            <DataTableRoot table={connectionTable}>
              <DataTableContent<Connection>
                onRowClick={(c) => connectionTable.getRow(c.name).toggleSelected()}
              />
              <DataTablePagination />
            </DataTableRoot>
            {readable.map(({ connection, files, selection, loading }) => (
              <ConnectionFiles
                connection={connection}
                files={files}
                key={connection.name}
                loading={loading}
                onSelectionChange={(next) => setFileSelection((prev) => ({ ...prev, [connection.name]: next }))}
                selection={selection}
              />
            ))}
          </Show>
        </StepsContent>

        <StepsContent className="flex flex-col gap-4" index={1}>
          {/* The model that helps write the domain reads the files it will be about. */}
          <AssistProvider context={() => describeFiles(schemas)} model={COMPLETE}>
            <Field>
              <FieldLabel>
                Domain
                <FieldRequiredIndicator fallback="(optional)" />
              </FieldLabel>
              <Assist onValueChange={setDomain} value={domain}>
                <Textarea placeholder="e.g. daily weather observations from Spanish stations" rows={6} />
              </Assist>
              <FieldHelper>What the knowledge graph is about, or what it is for.</FieldHelper>
            </Field>
          </AssistProvider>
          <Show when={!schemasReady}>
            <p className="flex items-center gap-2 text-muted-foreground text-sm">
              <Spinner aria-hidden />
              Reading the schemas of the selected files
            </p>
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
            when={suggest.status === "running" && reqs.length === 0}
          >
            <p className="flex items-center gap-2 text-muted-foreground text-sm">
              <Spinner aria-hidden />
              Suggesting requirements
            </p>
          </Show>
        </StepsContent>

        <StepsContent className="flex flex-col gap-4" index={3}>
          <Show when={generate.status === "running"}>
            <p className="flex items-center gap-2 text-muted-foreground text-sm">
              <Spinner aria-hidden />
              Writing the Fossil program
            </p>
          </Show>
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
          <Show when={draft.length > 0}>
            <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-muted-foreground text-xs">
              {draft}
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
