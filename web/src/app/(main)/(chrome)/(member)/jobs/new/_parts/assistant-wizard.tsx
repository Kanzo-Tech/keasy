"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Database, Plus, Wand2 } from "lucide-react";
import { Assist, AssistProvider } from "@kanzo-tech/ai";
import {
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
import { engine } from "@kanzo-tech/ui/analytics";
import { introspect } from "@fossil-lang/introspect";
import { $api } from "@/lib/api/client";
import { gateway } from "@/lib/ai";
import { type CompetencyQuestion, describeFiles, suggestQuestions, writeProgram } from "./assistant-prompts";
import * as checker from "@/lib/fossil/checker";
import { host } from "@/lib/fossil/host";
import { sourceDescriptorsKey } from "./use-source-descriptors";
import { providerFor } from "@/lib/fossil/providers";
import { reference, type StorageConnection } from "@/lib/connections";
import { ProblemView } from "@/components/problem-view";
import { ClientError, toastError } from "@/lib/errors";

type Connection = StorageConnection;
type Selection = Record<string, boolean>;
type ConnectionFile = { path: string; size: number };

const SCREENS = ["Sources", "Requirements"] as const;

/** The model the Domain field is assisted by. */
const COMPLETE = gateway("complete");

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
  // What was thrown, whole: a gateway refusal, `ai/silent`, a structured answer that would not parse.
  const [error, setError] = useState<unknown>(null);
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
      setError(e);
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
  error,
  onRetry,
  selection,
  onSelectionChange,
}: {
  connection: Connection;
  files: ConnectionFile[];
  loading: boolean;
  /** Why this connection's files could not be listed: shown in place of them, beside the others. */
  error: unknown;
  onRetry: () => void;
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
      {error ? (
        <ProblemView error={error} onRetry={onRetry} />
      ) : (
        <DataTableRoot table={table}>
          <DataTableContent<ConnectionFile>
            empty={loading ? <Spinner className="mx-auto" /> : "No files a provider can read."}
            onRowClick={(file) => table.getRow(file.path).toggleSelected()}
          />
          <DataTablePagination />
        </DataTableRoot>
      )}
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
  const [screen, setScreen] = useState(0);
  // Per connection, once the member has touched it; untouched means every readable file.
  const [fileSelection, setFileSelection] = useState<Record<string, Selection>>({});
  const [domain, setDomain] = useState("");
  const [reqs, setReqs] = useState<CompetencyQuestion[]>([]);

  // The sink is a data connection too, but one the program writes to, not reads from.
  const dataConnections = useMemo(
    () => connections.filter((c) => c.kind === "data" && c.direction !== "sink"),
    [connections],
  );
  const connectionTable = useDataTable({
    columns: CONNECTION_COLUMNS,
    data: dataConnections,
    getRowId: (c) => c.name,
  });
  const selected = connectionTable.getSelectedRowModel().rows.map((row) => row.original);

  // The named exception to "useSuspenseQuery only" (fossil docs/design/failure, G2.4): one listing
  // per selected connection, and the ones that loaded are worth showing beside the one that did
  // not — so each reads its own `error` and shows it in its place.
  const listings = useQueries({
    queries: selected.map((c) =>
      $api.queryOptions("get", "/v1/connections/{name}/files", { params: { path: { name: c.name } } }),
    ),
  });
  const readable = selected.map((connection, i) => {
    const files = (listings[i]?.data ?? []).filter((f) => providerFor(f.path, "data", providers));
    const selection =
      fileSelection[connection.name] ?? Object.fromEntries(files.map((f) => [f.path, true]));
    const listing = listings[i];
    return {
      connection,
      files,
      selection,
      loading: listing?.isPending ?? true,
      error: listing?.error ?? null,
      retry: () => void listing?.refetch(),
    };
  });
  const picked = readable.flatMap(({ connection, files, selection }) =>
    files.filter((f) => selection[f.path]).map((f) => ({ connection, path: f.path })),
  );

  // The picked files, written as the source bindings the generated program will
  // hold and described the way the editor describes a program's sources — while
  // the member is still writing the domain.
  const bindings = picked.flatMap(({ connection, path }) => {
    const provider = providerFor(path, "data", providers);
    return provider
      ? [{ constructor: provider.name, uri: reference(connection, path) }]
      : [];
  });
  const program = bindings.map((b, i) => `f${i} := io.${b.constructor}("${b.uri}")`).join("\n");
  // The same exception: the description depends on the wizard's own selection, and its failure is
  // shown on the Sources screen, which then does not go on without the schemas.
  const described = useQuery({
    queryKey: sourceDescriptorsKey(bindings.map((b) => b.uri)),
    queryFn: async ({ signal }) =>
      introspect(await (await checker.jobProgram({ signal })).sources(program), {
        host,
        engine: await engine({ signal }),
        signal,
      }),
    enabled: bindings.length > 0,
  });
  const schemasReady =
    readable.every((r) => !r.loading && !r.error) &&
    (bindings.length === 0 || (!described.isPending && !described.isError));
  const schemas = described.data?.descriptors ?? [];
  const undescribed = described.data?.undescribed ?? [];

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
      // An answer that is not the JSON asked for streams no element and throws nothing: it would
      // read as "No requirements yet." Asked for five to ten, none is a failure.
      if (n === 0 && !signal.aborted) {
        throw new ClientError(
          "llm/failed",
          "The model's suggestions could not be read",
          "The answer held no requirement in the form asked for.",
        );
      }
    });

  const generateProgram = () =>
    void generate.run(async (signal) => {
      let program = "";
      for await (const partial of writeProgram(domain, questions, schemas, signal)) {
        program = partial.program ?? program;
        setDraft(program);
      }
      if (!program.trim() && !signal.aborted) {
        throw new ClientError("llm/failed", "The model wrote no program", "The answer held no program in the form asked for.");
      }
      onComplete(program);
      toast.create({ title: "Script generated — review before submitting", type: "success" });
    });

  const addRequirement = () => {
    const id = `custom-${Date.now()}`;
    setReqs((prev) => [...prev, { id, question: "", rationale: "Custom requirement" }]);
    reqTable.setRowSelection((prev) => ({ ...prev, [id]: true }));
  };

  const proceed = () => {
    if (reqs.length === 0) askForRequirements();
    setScreen(1);
  };
  const back = () => {
    suggest.cancel();
    generate.cancel();
    setScreen(0);
  };

  const canProceed = selected.length > 0 && schemasReady;
  const generating = generate.status === "running";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ol className="flex h-14 shrink-0 items-center justify-center gap-2 border-b px-3 text-sm">
        {SCREENS.map((title, index) => (
          <li
            aria-current={index === screen ? "step" : undefined}
            className={index === screen ? "font-medium" : "text-muted-foreground"}
            key={title}
          >
            {index > 0 && <span className="me-2 text-muted-foreground">·</span>}
            {index + 1} {title}
          </li>
        ))}
      </ol>

      <SectionBody scale="page">
        <Show when={screen === 0}>
          <div className="flex flex-col gap-4">
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
              {readable.map(({ connection, files, selection, loading, error, retry }) => (
                <ConnectionFiles
                  connection={connection}
                  error={error}
                  files={files}
                  key={connection.name}
                  loading={loading}
                  onRetry={retry}
                  onSelectionChange={(next) => setFileSelection((prev) => ({ ...prev, [connection.name]: next }))}
                  selection={selection}
                />
              ))}
              {/* The model that helps write the domain reads the files it will be about. */}
              <AssistProvider
                context={() => describeFiles(schemas)}
                model={COMPLETE}
                // The field says it failed under itself; the code (`ai/silent`, a gateway refusal) is said here.
                onFailure={(error) => toastError(error, "The suggestion failed")}
              >
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
              {described.isError && (
                <ProblemView onRetry={() => void described.refetch()} error={described.error} />
              )}
              {/* Each file that could not be described, and why: the program is written without its columns. */}
              {undescribed.map(({ source, problem }) => (
                <ProblemView error={problem} key={source.key} />
              ))}
              <Show when={!schemasReady && !described.isError}>
                <p className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Spinner aria-hidden />
                  Reading the schemas of the selected files
                </p>
              </Show>
            </Show>
          </div>
        </Show>

        <Show when={screen === 1}>
          <div className="flex flex-col gap-4">
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
                  {suggest.status === "error" && (
                    <ProblemView error={suggest.error} onRetry={askForRequirements} uncoded="llm/failed" />
                  )}
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
            <Show when={generating}>
              <p className="flex items-center gap-2 text-muted-foreground text-sm">
                <Spinner aria-hidden />
                Writing the Fossil program
              </p>
            </Show>
            {generate.status === "error" && (
              <ProblemView error={generate.error} onRetry={generateProgram} uncoded="llm/failed" />
            )}
            <Show when={draft.length > 0}>
              <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-muted-foreground text-xs">
                {draft}
              </pre>
            </Show>
          </div>
        </Show>
      </SectionBody>

      <SectionFooter>
        <Button disabled={screen === 0} onClick={back} size="sm" variant="ghost">
          <ArrowLeft />
          Back
        </Button>
        <Show
          fallback={
            <Button disabled={questions.length === 0 || generating} onClick={generateProgram} size="sm">
              <Wand2 />
              Generate
            </Button>
          }
          when={screen === 0}
        >
          <Button disabled={!canProceed} onClick={proceed} size="sm">
            Continue
            <ArrowRight />
          </Button>
        </Show>
      </SectionFooter>
    </div>
  );
}
