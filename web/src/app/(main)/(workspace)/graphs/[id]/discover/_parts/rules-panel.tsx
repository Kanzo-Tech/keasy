"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CircleCheckIcon, PencilIcon, PlusIcon } from "lucide-react";
import { column, isIn, literal, Query } from "@uwdata/mosaic-sql";
import {
  Badge,
  Button,
  cn,
  Diagnostic,
  DiagnosticActions,
  DiagnosticContent,
  DiagnosticDescription,
  DiagnosticHeader,
  DiagnosticSeverity,
  DiagnosticSource,
  DiagnosticTitle,
  DiagnosticTrigger,
  type Finding,
  FindingsContent,
  FindingsGoTo,
  FindingsGroup,
  FindingsRoot,
  FindingsTrigger,
  ScrollArea,
  Skeleton,
  useDebouncedCommit,
} from "@kanzo-tech/ui";
import { numbers, useMosaic } from "@kanzo-tech/ui/analytics";
import { useGraphContext } from "@kanzo-tech/graph";
import { MetadataForm, pickByLanguage, useMetadataForm } from "@kanzo-tech/metadata-form";
import { createRudofEngine, type NodeShapeIR, type RudofEngine } from "@kanzo-tech/metadata-form/rudof";
import { ProblemView } from "@/components/problem-view";
import { SavedBy } from "@/components/provenance";
import { $api, http } from "@/lib/api/client";
import { queryClient } from "@/lib/api/query-client";
import { settled } from "@/lib/api/settled";
import { toastError } from "@/lib/errors";
import { useCorpus, useGraphKey, useVertices, useVocabulary } from "@/lib/fossil/corpus";
import { EMPTY_RULES, RULE_SHAPE, ruleShapes } from "./rule-shapes";
import { useCompiledRules, useValidationReport, type ValidationReport } from "./rules-validation";

/**
 * The Rules panel — the graph's data-quality rules as one SHACL shapes graph, kept by the server.
 * rudof compiles them to SQL over the corpus and reads the rows back as a validation report; the
 * findings are listed worst first, and going to one selects the vertices that fail it, so the canvas
 * lights exactly those. A rule is edited as the SHACL it is, in a form drawn from shapes for shapes.
 */
export function RulesPanel() {
  const { graphId } = useCorpus();
  const init = { params: { path: { id: graphId } } };
  const read = $api.queryOptions("get", "/v1/graphs/{id}/rules", init);
  const saved = settled($api.useSuspenseQuery("get", "/v1/graphs/{id}/rules", init));
  // Everyone reads the rules; only whoever may change the graph edits and saves them.
  const { can_modify } = settled($api.useSuspenseQuery("get", "/v1/graphs/{id}", init));

  const save = useMutation({
    mutationFn: async (shapes: string) => (await http.PUT("/v1/graphs/{id}/rules", { ...init, body: { shapes } })).data,
    onSuccess: (written) => queryClient.setQueryData(read.queryKey, written),
    onError: (err) => toastError(err, "Failed to save the rules"),
  });
  const stored = saved?.shapes ?? EMPTY_RULES;
  const { draft, change } = useDebouncedCommit(stored, (shapes) => save.mutate(shapes), SAVE_MS);
  // What is on screen: the edit being typed, else — while it is being written — what was written,
  // else what the server holds.
  const current = draft !== stored ? draft : save.isPending ? save.variables : draft;

  const { compiled, failure: refused } = useCompiledRules(current);
  const { report, failure } = useValidationReport(compiled);
  const [editing, setEditing] = useState<{ focus: string; data: string } | null>(null);

  return (
    <ScrollArea className="h-full p-3">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <RuleFindings report={report} shapes={compiled?.shapes ?? []} />
          {saved && <SavedBy className="ms-auto shrink-0" of={saved} />}
        </div>

        {refused !== undefined && <ProblemView error={refused} uncoded="rules/refused" />}
        {failure !== undefined && <ProblemView error={failure} uncoded="query/failed" />}

        <RuleList
          editing={editing?.focus}
          onEdit={can_modify ? (focus) => setEditing({ focus, data: current }) : undefined}
          shapes={compiled?.shapes}
        />

        {can_modify && (
          <Button
            className="w-full"
            onClick={() => setEditing({ focus: `urn:uuid:${crypto.randomUUID()}`, data: current })}
            size="sm"
            variant="secondary"
          >
            <PlusIcon />
            New rule
          </Button>
        )}

        {editing && (
          <RuleEditor data={editing.data} focus={editing.focus} key={editing.focus} onChange={change} onClose={() => setEditing(null)} />
        )}
      </div>
    </ScrollArea>
  );
}

/** Saved after a pause, not per keystroke: a rule is many edits and one decision. */
const SAVE_MS = 800;

/** The last segment of an IRI: what a reader calls the type or the property. */
const local = (iri: string) => iri.slice(Math.max(iri.lastIndexOf("#"), iri.lastIndexOf("/")) + 1) || iri;

/** A rule as a line: the type it applies to, and the properties it checks. */
function describe(shape: NodeShapeIR): { target: string; checks: string } {
  return {
    target: shape.targetClasses.map(local).join(", ") || "No type yet",
    checks: shape.properties.map((p) => local(p.pathKey.replace(/[<>]/g, ""))).join(" · ") || "No checks yet",
  };
}

/** The rules in the document, each a button to its editor where the reader may edit. */
function RuleList({
  shapes,
  editing,
  onEdit,
}: {
  shapes: NodeShapeIR[] | undefined;
  editing: string | undefined;
  onEdit?: (focus: string) => void;
}) {
  if (!shapes) return <Skeleton className="h-16" />;
  if (shapes.length === 0) return <p className="text-muted-foreground text-xs">No rules yet.</p>;
  return (
    <ul className="space-y-1">
      {shapes.map((shape) => {
        const { target, checks } = describe(shape);
        return (
          <li
            className={cn(
              "flex items-center gap-2 rounded-md border px-2 py-1.5",
              editing === shape.id && "border-primary",
            )}
            key={shape.id}
          >
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-xs">{target}</span>
              <span className="block truncate font-mono text-[11px] text-muted-foreground">{checks}</span>
            </span>
            {shape.deactivated && <Badge variant="secondary">Off</Badge>}
            {onEdit && (
              <Button aria-label={`Edit the rule on ${target}`} onClick={() => onEdit(shape.id)} size="icon-sm" variant="ghost">
                <PencilIcon />
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** One finding: a constraint of a rule, and the vertices that fail it. */
interface RuleFinding extends Finding {
  message: string;
  rule: string;
  where: string;
  nodes: string[];
}

const VARIANT: Record<string, RuleFinding["variant"]> = {
  "http://www.w3.org/ns/shacl#Violation": "destructive",
  "http://www.w3.org/ns/shacl#Warning": "warning",
  "http://www.w3.org/ns/shacl#Info": "info",
};

const WORD = { destructive: "Violation", warning: "Warning", info: "Note" } as const;

/**
 * The rules a property shape's result belongs to. A check is a blank node, which the report names but
 * the shapes model does not, so it is found by the path it checks.
 */
function ruleOf(shapes: NodeShapeIR[], pathKey: string | undefined): string {
  const owners = shapes.filter((s) => s.properties.some((p) => p.pathKey === pathKey));
  return owners.map((s) => describe(s).target).join(", ") || "A rule";
}

/** The report's results, one finding per rule, constraint and path, the most vertices first. */
function findingsOf(report: ValidationReport, shapes: NodeShapeIR[]): RuleFinding[] {
  const languages = typeof navigator === "undefined" ? ["en"] : [...navigator.languages, "en", ""];
  const byShape = new Map(shapes.map((s) => [s.id, describe(s).target]));
  const found = new Map<string, RuleFinding>();
  for (const result of report.results) {
    const shape = result.sourceShape?.value ?? "";
    const component = result.sourceConstraintComponent ?? "";
    const id = `${shape}|${component}|${result.pathKey ?? ""}`;
    const finding = found.get(id) ?? {
      id,
      variant: VARIANT[result.severity ?? ""] ?? "destructive",
      message: pickByLanguage(result.message, languages)?.value ?? local(component),
      rule: byShape.get(shape) ?? ruleOf(shapes, result.pathKey),
      where: [result.pathKey && local(result.pathKey.replace(/[<>]/g, "")), local(component).replace(/ConstraintComponent$/, "")]
        .filter(Boolean)
        .join(" · "),
      nodes: [],
    };
    finding.nodes.push(result.focusNode.value);
    found.set(id, finding);
  }
  return [...found.values()].sort((a, b) => b.nodes.length - a.nodes.length);
}

/**
 * What the rules found, behind one badge: a tally painted by the worst finding, the findings grouped
 * worst first, and Show on each — the vertices that fail it, selected on the canvas.
 */
function RuleFindings({ report, shapes }: { report: ValidationReport | undefined; shapes: NodeShapeIR[] }) {
  const { coordinator } = useMosaic();
  const { select } = useGraphContext();
  const key = useGraphKey();
  const vertices = useVertices();
  const findings = useMemo(() => (report ? findingsOf(report, shapes) : []), [report, shapes]);

  if (!report) return <Skeleton className="h-5 w-28" />;

  const show = async (finding: RuleFinding) => {
    const query = Query.from(vertices)
      .select(key)
      .where(isIn(column("subject"), finding.nodes.map((node) => literal(node))));
    select(numbers(await coordinator.query(query), key), "external", `${finding.rule}: ${finding.message}`);
  };
  const row = (finding: RuleFinding) => (
    <Diagnostic variant={finding.variant}>
      <DiagnosticHeader>
        <DiagnosticSeverity>{WORD[finding.variant]}</DiagnosticSeverity>
        <DiagnosticTitle>{finding.message}</DiagnosticTitle>
        <DiagnosticActions>
          <FindingsGoTo>Show {finding.nodes.length.toLocaleString()}</FindingsGoTo>
          <DiagnosticTrigger aria-label={`Details of ${finding.message}`} />
        </DiagnosticActions>
      </DiagnosticHeader>
      <DiagnosticContent>
        <DiagnosticDescription>
          {finding.nodes.length.toLocaleString()} {finding.nodes.length === 1 ? "vertex fails" : "vertices fail"} it.
        </DiagnosticDescription>
        <DiagnosticSource>
          {finding.rule} · {finding.where}
        </DiagnosticSource>
      </DiagnosticContent>
    </Diagnostic>
  );

  return (
    <FindingsRoot findings={findings} onSelect={(finding) => void show(finding).catch((err) => toastError(err, "The graph could not show them"))}>
      <FindingsTrigger>
        {({ destructive, warning, info }) =>
          destructive ? (
            `${destructive.toLocaleString()} violated`
          ) : warning ? (
            `${warning.toLocaleString()} warnings`
          ) : info ? (
            `${info.toLocaleString()} notes`
          ) : (
            <>
              <CircleCheckIcon />
              In order
            </>
          )
        }
      </FindingsTrigger>
      <FindingsContent description="What the rules found in what is in view." title="Findings">
        <FindingsGroup title="Violations" variant="destructive">
          {row}
        </FindingsGroup>
        <FindingsGroup title="Warnings" variant="warning">
          {row}
        </FindingsGroup>
        <FindingsGroup title="Notes" variant="info">
          {row}
        </FindingsGroup>
      </FindingsContent>
    </FindingsRoot>
  );
}

/**
 * One rule, edited as SHACL through shapes for shapes. The form edits a session of the whole document
 * — `data` as it was when the rule was opened — and every edit hands the whole document back,
 * serialised by rudof.
 */
function RuleEditor({
  focus,
  data,
  onChange,
  onClose,
}: {
  focus: string;
  data: string;
  onChange: (shapes: string) => void;
  onClose: () => void;
}) {
  const vocabulary = useVocabulary();
  const shapes = useMemo(() => ruleShapes(vocabulary), [vocabulary]);
  const [engine] = useState<RudofEngine>(() => createRudofEngine());
  const form = useMetadataForm({ shapes, data, focusNode: focus, rootShape: RULE_SHAPE, engine });
  const { subscribe } = form;
  useEffect(() => subscribe(() => void engine.serialize("text/turtle").then(onChange)), [subscribe, engine, onChange]);

  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex items-center gap-2">
        <p className="font-medium text-muted-foreground text-xs">Rule</p>
        <Button className="ms-auto" onClick={onClose} size="sm" variant="ghost">
          Done
        </Button>
      </div>
      {form.error ? (
        <ProblemView error={form.error} uncoded="rules/refused" />
      ) : form.ready ? (
        <MetadataForm attribution={false} form={form} />
      ) : (
        <Skeleton className="h-40" />
      )}
    </div>
  );
}
