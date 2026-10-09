"use client";

import { useMutation } from "@tanstack/react-query";
import { FileIcon, UploadIcon } from "lucide-react";
import {
  Badge,
  Button,
  Diagnostic,
  DiagnosticActions,
  DiagnosticContent,
  DiagnosticDescription,
  DiagnosticHeader,
  DiagnosticList,
  DiagnosticSeverity,
  DiagnosticSource,
  DiagnosticTitle,
  DiagnosticTrigger,
  FileUpload,
  FileUploadDropzone,
  FileUploadHiddenInput,
  FileUploadTrigger,
  ScrollArea,
  Skeleton,
} from "@kanzo-tech/ui";
import { ProblemView } from "@/components/problem-view";
import { SavedBy } from "@/components/provenance";
import { $api, http, type Schemas } from "@/lib/api/client";
import { queryClient } from "@/lib/api/query-client";
import { settled } from "@/lib/api/settled";
import { toastError } from "@/lib/errors";
import { useCorpus } from "@/lib/fossil/corpus";
import { type Finding, nodesOf, type Rule, rulesOf, useReadRules, useRules } from "./rules-validation";

/**
 * The Rules panel — the graph's data-quality rules as one SHACL file, kept by the server. Nobody
 * edits a rule here: dropping a `.ttl` replaces the file, and a file rudof cannot read is refused
 * with its line and column while the previous one stays. rudof validates the corpus over the page's
 * subset; the findings are listed per rule, and Show — of one finding, of every violation or warning
 * of a rule, or of what conforms — puts the vertices on the page as the panel's one clause.
 */
export function RulesPanel() {
  const { graphId } = useCorpus();
  const init = { params: { path: { id: graphId } } };
  const read = $api.queryOptions("get", "/v1/graphs/{id}/rules", init);
  const saved = settled($api.useSuspenseQuery("get", "/v1/graphs/{id}/rules", init));
  // Everyone reads the rules; only whoever may change the graph replaces them.
  const { can_modify } = settled($api.useSuspenseQuery("get", "/v1/graphs/{id}", init));

  const save = useMutation({
    mutationFn: async (file: File) =>
      (await http.PUT("/v1/graphs/{id}/rules", { ...init, body: { name: file.name, shapes: await file.text() } })).data,
    onSuccess: (written) => queryClient.setQueryData(read.queryKey, written),
  });

  return (
    <ScrollArea className="h-full p-3">
      <div className="space-y-3">
        {save.error && <ProblemView error={save.error} uncoded="rules/refused" />}
        <FileUpload
          accept=".ttl"
          disabled={!can_modify || save.isPending}
          maxFiles={1}
          onFileAccept={({ files: [file] }) => file && save.mutate(file)}
        >
          <FileUploadDropzone className="items-stretch gap-1 px-3 py-2.5 text-start" disableClick>
            {saved ? <RulesFile can_modify={can_modify} saved={saved} /> : <NoRules />}
          </FileUploadDropzone>
          <FileUploadHiddenInput />
        </FileUpload>
        {save.error && saved && (
          <p className="text-muted-foreground text-xs">Nothing changed: the graph keeps {saved.name}.</p>
        )}
        {saved && <Findings text={saved.shapes} />}
      </div>
    </ScrollArea>
  );
}

function NoRules() {
  return (
    <div className="flex flex-col items-center gap-1 py-6 text-center">
      <UploadIcon aria-hidden className="size-4" />
      <p className="text-foreground text-sm">
        Drop a SHACL shapes graph, or{" "}
        <FileUploadTrigger className="h-auto p-0" size="sm" variant="link">
          browse
        </FileUploadTrigger>
      </p>
      <p className="text-xs">Turtle (.ttl). The graph has no rules yet.</p>
    </div>
  );
}

/** The file the rules are: its name and size, who saved it, and the file back. */
function RulesFile({ saved, can_modify }: { saved: Schemas["Rules"]; can_modify?: boolean }) {
  const { rules } = useReadRules(saved.shapes);
  const count = rules?.model.nodeShapes.length;
  return (
    <>
      <div className="flex min-w-0 items-center gap-2">
        <FileIcon aria-hidden className="size-4 shrink-0" />
        <span className="truncate font-mono text-foreground text-sm">{saved.name}</span>
        {count !== undefined && (
          <span className="shrink-0 text-xs">
            · {count} {count === 1 ? "rule" : "rules"}
          </span>
        )}
        <Button asChild className="ms-auto h-auto p-0" size="sm" variant="link">
          <a download={saved.name} href={`data:text/turtle;charset=utf-8,${encodeURIComponent(saved.shapes)}`}>
            Download
          </a>
        </Button>
      </div>
      <p className="text-xs">
        <SavedBy of={saved} />
        {can_modify && (
          <>
            {". Drop a .ttl here, or "}
            <FileUploadTrigger className="h-auto p-0 text-xs" size="sm" variant="link">
              browse
            </FileUploadTrigger>
            {", to replace it."}
          </>
        )}
      </p>
    </>
  );
}

/** What the rules found over the page's subset, per rule; Show puts a finding's vertices on the page. */
function Findings({ text }: { text: string }) {
  const { rules: read, failure: unreadable } = useReadRules(text);
  const { checked, failure, picked, withdraw, show, conforming } = useRules(read);

  if (unreadable !== undefined) return <ProblemView error={unreadable} uncoded="rules/refused" />;
  if (failure !== undefined) return <ProblemView error={failure} uncoded="query/failed" />;
  if (!read || !checked) return <Skeleton className="h-32" />;

  const failed = (err: unknown) => toastError(err, "The graph could not show them");
  const toggle = (label: string, publish: () => Promise<void>) =>
    picked === label ? withdraw() : void publish().catch(failed);
  const rules = rulesOf(read.model, checked.report);
  const scope = checked.inScope === checked.total ? "Checked over all" : `Checked over the selection: ${checked.inScope.toLocaleString()} of`;

  return (
    <>
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-muted-foreground text-xs">
          {scope} {checked.total.toLocaleString()} nodes
        </p>
        <Button
          aria-pressed={picked === CONFORMS}
          className="shrink-0"
          onClick={() => toggle(CONFORMS, () => conforming(CONFORMS))}
          size="sm"
          variant={picked === CONFORMS ? "secondary" : "outline"}
        >
          Show what conforms
        </Button>
      </div>
      {rules.map((rule) => (
        <section aria-label={rule.name} className="rounded-lg border" key={rule.id}>
          <header className="flex min-w-0 items-center gap-2 px-3 py-2">
            <h3 className="shrink-0 font-medium text-sm">{rule.name}</h3>
            <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-xs">{rule.checks}</span>
            <RuleState rule={rule} />
          </header>
          {rule.unchecked && !rule.off && <p className="border-t px-3 py-2 text-muted-foreground text-xs">{rule.unchecked}</p>}
          {rule.findings.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t px-3 py-2">
              {SEVERITIES.map((severity) => {
                const nodes = nodesOf(rule, severity.variant);
                if (nodes.length === 0) return null;
                const label = `${rule.name} · ${severity.plural}`;
                const n = nodes.length.toLocaleString();
                const what = nodes.length === 1 ? `the 1 ${severity.singular}` : `all ${n} ${severity.plural}`;
                return (
                  <Button
                    aria-pressed={picked === label}
                    key={severity.variant}
                    onClick={() => toggle(label, () => show(nodes, label))}
                    size="sm"
                    variant={picked === label ? "secondary" : "outline"}
                  >
                    Show {what}
                  </Button>
                );
              })}
            </div>
          )}
          {rule.findings.length > 0 && (
            <DiagnosticList className="border-t p-2">
              {rule.findings.map((finding) => {
                const label = `${rule.name}: ${finding.message}`;
                const n = finding.nodes.length.toLocaleString();
                return (
                  <Diagnostic key={finding.id} variant={finding.variant}>
                    <DiagnosticHeader>
                      <DiagnosticSeverity>{WORD[finding.variant]}</DiagnosticSeverity>
                      <DiagnosticTitle>{finding.message}</DiagnosticTitle>
                      <DiagnosticActions>
                        <Button
                          aria-pressed={picked === label}
                          onClick={() => toggle(label, () => show(finding.nodes, label))}
                          size="sm"
                          variant={picked === label ? "secondary" : "outline"}
                        >
                          {picked === label ? `Showing ${n}` : `Show ${n}`}
                        </Button>
                        <DiagnosticTrigger aria-label={`Details of ${finding.message}`} />
                      </DiagnosticActions>
                    </DiagnosticHeader>
                    <DiagnosticContent>
                      <DiagnosticDescription>
                        {n} {finding.nodes.length === 1 ? "vertex fails" : "vertices fail"} it.
                      </DiagnosticDescription>
                      <DiagnosticSource>{finding.where}</DiagnosticSource>
                    </DiagnosticContent>
                  </Diagnostic>
                );
              })}
            </DiagnosticList>
          )}
        </section>
      ))}
    </>
  );
}

const WORD = { destructive: "Violation", warning: "Warning", info: "Note" } as const;

/** The severities a rule shows at once: every vertex it flags as a violation, or as a warning. */
const SEVERITIES = [
  { variant: "destructive", singular: "violation", plural: "violations" },
  { variant: "warning", singular: "warning", plural: "warnings" },
] as const;

/** The clause Show what conforms puts on the page. */
const CONFORMS = "Conforms to the rules";

/** A rule's state at a glance: off, not checked, in order, or its findings by severity. */
function RuleState({ rule }: { rule: Rule }) {
  if (rule.off) return <Badge size="sm" variant="secondary">Off</Badge>;
  if (rule.unchecked) return <Badge size="sm" variant="outline">Not checked</Badge>;
  if (rule.findings.length === 0) return <Badge size="sm" variant="success">In order</Badge>;
  const tally = (variant: Finding["variant"]) => rule.findings.filter((f) => f.variant === variant).length;
  return (
    <span className="flex shrink-0 gap-1">
      {(["destructive", "warning", "info"] as const).map(
        (variant) =>
          tally(variant) > 0 && (
            <Badge aria-label={`${tally(variant)} ${WORD[variant].toLowerCase()}s`} key={variant} size="sm" variant={variant}>
              {tally(variant)}
            </Badge>
          ),
      )}
    </span>
  );
}
