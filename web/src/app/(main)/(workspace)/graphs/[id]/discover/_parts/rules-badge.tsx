"use client";

import type * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { FileIcon, ShieldCheckIcon, UploadIcon } from "lucide-react";
import {
  Button,
  type FindingPlace,
  type FindingTally,
  FileUpload,
  FileUploadDropzone,
  FileUploadHiddenInput,
  FileUploadTrigger,
  FindingGroupRow,
  FindingsBadge,
  FindingsContent,
  FindingsGroup,
  FindingsRoot,
  PopoverHeader,
  Skeleton,
  usePopover,
} from "@kanzo-tech/ui";
import type { RdfPlace } from "@kanzo-tech/rudof-wasm";
import { ProblemView } from "@/components/problem-view";
import { SavedBy } from "@/components/provenance";
import { $api, http, type Schemas } from "@/lib/api/client";
import { queryClient } from "@/lib/api/query-client";
import { settled } from "@/lib/api/settled";
import { toastError } from "@/lib/errors";
import { useCorpus } from "@/lib/fossil/corpus";
import { nodesOf, type Rule, rulesOf, tallyOf, useReadRules, useRules } from "./rules-validation";

/**
 * The graph's rules as a badge in the filter bar — the recipe editor's findings badge, read in Graph
 * and Dashboard alike — and the work in its popover. The rules are one SHACL file the server keeps:
 * dropping a `.ttl` on the popover, or *Replace…*, replaces it, and a file rudof cannot read is
 * refused with its line and column while the previous one stays. rudof validates the corpus over the
 * page's subset; the popover lists rudof's groups under their rule, and Show — of a group, of every
 * violation or warning of a rule, of one node, or of what conforms — puts the vertices on the page as
 * the rules' one clause. `/docs/design/findings` in kanzo-ui is the model.
 */
export function RulesBadge() {
  const { graphId } = useCorpus();
  const init = { params: { path: { id: graphId } } };
  const read = $api.queryOptions("get", "/v1/graphs/{id}/rules", init);
  const saved = settled($api.useSuspenseQuery("get", "/v1/graphs/{id}/rules", init));
  // Everyone reads the rules; only whoever manages the graph replaces them.
  const { can } = settled($api.useSuspenseQuery("get", "/v1/graphs/{id}", init));

  const save = useMutation({
    mutationFn: async (file: File) =>
      (await http.PUT("/v1/graphs/{id}/rules", { ...init, body: { name: file.name, shapes: await file.text() } })).data,
    onSuccess: (written) => queryClient.setQueryData(read.queryKey, written),
  });

  return (
    // `contents`: the root is only where the file input and its context live; the badge sits in the bar.
    <FileUpload
      accept=".ttl"
      className="contents"
      disabled={!can.manage || save.isPending}
      maxFiles={1}
      onFileAccept={({ files: [file] }) => file && save.mutate(file)}
    >
      {saved ? (
        <Checked can_manage={can.manage} refused={save.error} saved={saved} />
      ) : (
        <FindingsRoot tally={undefined}>
          <Badge>No rules</Badge>
          <FindingsContent
            empty={
              <>
                {save.error && <ProblemView error={save.error} uncoded="rules/refused" />}
                <NoRules can_manage={can.manage} />
              </>
            }
            header={<PopoverHeader title="Rules" />}
          />
        </FindingsRoot>
      )}
      <FileUploadHiddenInput />
    </FileUpload>
  );
}

function Badge({ children }: { children: string }) {
  return (
    <FindingsBadge className="gap-1" size="sm">
      <ShieldCheckIcon aria-hidden className="size-3" />
      {children}
    </FindingsBadge>
  );
}

function NoRules({ can_manage }: { can_manage: boolean }) {
  if (!can_manage) return <p className="text-muted-foreground text-sm">The graph has no rules yet.</p>;
  return (
    <FileUploadDropzone className="items-center gap-1 px-3 py-6 text-center" disableClick>
      <UploadIcon aria-hidden className="size-4" />
      <p className="text-foreground text-sm">
        Drop a SHACL shapes graph here, or{" "}
        <FileUploadTrigger className="h-auto p-0" size="sm" variant="link">
          browse
        </FileUploadTrigger>
      </p>
      <p className="text-xs">Turtle (.ttl). The graph has no rules yet.</p>
    </FileUploadDropzone>
  );
}

/** The plural a severity reads in, in the badge's tally. */
const NOUN = { violation: ["violation", "violations"], warning: ["warning", "warnings"], info: ["note", "notes"] } as const;

/** *2 violations · 3 warnings*: the badge's words, and so its name. */
function tallyWords(tally: FindingTally): string {
  return (["violation", "warning", "info"] as const)
    .filter((severity) => tally[severity] > 0)
    .map((severity) => `${tally[severity].toLocaleString()} ${NOUN[severity][tally[severity] === 1 ? 0 : 1]}`)
    .join(" · ");
}

/** The clause *Show what conforms* puts on the page. */
const CONFORMS = "Conforms to the rules";

/** The rules file, read and checked over the page's subset: the badge's tally, and the popover's groups. */
function Checked({ saved, can_manage, refused }: { saved: Schemas["Rules"]; can_manage: boolean; refused: Error | null }) {
  const { rules: read, failure: unreadable } = useReadRules(saved.shapes);
  const { checked, failure, picked, withdraw, show, conforming } = useRules(read);
  const rules = read && checked ? rulesOf(read.model, checked.findings) : undefined;
  const tally = rules ? tallyOf(rules) : undefined;
  const words =
    unreadable !== undefined || failure !== undefined
      ? "Rules not checked"
      : !tally
        ? "Checking rules…"
        : tally.total === 0
          ? "Conforms to the rules"
          : tallyWords(tally);

  const failed = (err: unknown) => toastError(err, "The graph could not show them");
  const toggle = (label: string, publish: () => Promise<void>) =>
    picked === label ? withdraw() : void publish().catch(failed);

  const problem =
    unreadable !== undefined ? (
      <ProblemView error={unreadable} uncoded="rules/refused" />
    ) : failure !== undefined ? (
      <ProblemView error={failure} uncoded="query/failed" />
    ) : !rules ? (
      <Skeleton className="h-32" />
    ) : undefined;

  return (
    <FindingsRoot tally={tally}>
      <Badge>{words}</Badge>
      <FindingsContent
        empty={problem ?? <AllConform rules={rules ?? []} />}
        header={
          <RulesHeader
            can_manage={can_manage}
            checked={checked}
            conforms={{ pressed: picked === CONFORMS, toggle: () => toggle(CONFORMS, () => conforming(CONFORMS)) }}
            count={read?.model.nodeShapes.length}
            refused={refused}
            saved={saved}
          />
        }
      >
        {rules?.map((rule) => (
          <FindingsGroup key={rule.id} tally={rule.tally} title={rule.name}>
            <RuleState rule={rule} />
            {(["violation", "warning"] as const).map((severity) => {
              const nodes = nodesOf(rule.groups, severity);
              if (nodes.length === 0) return null;
              const label = `${rule.name} · ${NOUN[severity][1]}`;
              const what = nodes.length === 1 ? `the 1 ${NOUN[severity][0]}` : `all ${nodes.length.toLocaleString()} ${NOUN[severity][1]}`;
              return (
                <ShowAll key={severity} pressed={picked === label} toggle={() => toggle(label, () => show(nodes, label))}>
                  Show {what}
                </ShowAll>
              );
            })}
            {rule.groups.map((group) => {
              const label = `${rule.name}: ${group.message}`;
              const nodes = nodesOf([group]);
              const n = nodes.length.toLocaleString();
              return (
                <FindingGroupRow
                  action={{ label: picked === label ? `Showing ${n}` : `Show ${n}`, run: () => toggle(label, () => show(nodes, label)) }}
                  describe={(place) => describe(place, rule, show, failed)}
                  group={group}
                  key={`${group.rule.id}|${group.places[0]?.path ?? ""}|${group.severity}`}
                />
              );
            })}
          </FindingsGroup>
        ))}
      </FindingsContent>
    </FindingsRoot>
  );
}

/** *Show all 44 violations* of a rule, keasy#127: the popover closes, as a row's Show closes it. */
function ShowAll({ pressed, toggle, children }: { pressed: boolean; toggle: () => void; children: React.ReactNode }) {
  const popover = usePopover();
  return (
    <li className="flex">
      <Button
        aria-pressed={pressed}
        onClick={() => {
          popover.setOpen(false);
          toggle();
        }}
        size="sm"
        variant={pressed ? "secondary" : "outline"}
      >
        {children}
      </Button>
    </li>
  );
}

/** A sampled node, as its row reads it: the node, *Show* to put it alone on the page, and its value. */
function describe(
  place: RdfPlace,
  rule: Rule,
  show: (nodes: readonly string[], label: string) => Promise<void>,
  failed: (err: unknown) => void,
): FindingPlace {
  const node = place.focus.value;
  return {
    where: node,
    action: { label: "Show", run: () => void show([node], `${rule.name}: ${node}`).catch(failed) },
    detail: place.value ? `Value: ${place.value.value}` : undefined,
  };
}

/** A rule's state when it has no group to list: off, not checked, or in order. */
function RuleState({ rule }: { rule: Rule }) {
  const state = rule.off ? "Off" : rule.unchecked ? `Not checked: ${rule.unchecked}` : rule.groups.length === 0 ? "In order" : undefined;
  if (!state) return null;
  return <li className="text-muted-foreground text-xs" data-slot="rule-state">{state}</li>;
}

/** Nothing found: each rule, in order, off or not checked. */
function AllConform({ rules }: { rules: Rule[] }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">Every node checked conforms to the rules.</p>
      {rules.map((rule) => (
        <FindingsGroup key={rule.id} tally={rule.tally} title={rule.name}>
          <RuleState rule={rule} />
        </FindingsGroup>
      ))}
    </div>
  );
}

interface RulesHeaderProps {
  saved: Schemas["Rules"];
  count: number | undefined;
  can_manage: boolean;
  refused: Error | null;
  checked: { inScope: number; total: number } | undefined;
  conforms: { pressed: boolean; toggle: () => void };
}

/**
 * Above the list, not scrolling with it: the file — its name, its rules, who saved it, the file back,
 * *Replace…* — a drop zone for the next one, what the rules were checked over, and *Show what conforms*.
 */
function RulesHeader({ saved, count, can_manage, refused, checked, conforms }: RulesHeaderProps) {
  const popover = usePopover();
  const scope = checked
    ? checked.inScope === checked.total
      ? `Checked over all ${checked.total.toLocaleString()} nodes`
      : `Checked over the selection: ${checked.inScope.toLocaleString()} of ${checked.total.toLocaleString()} nodes`
    : undefined;
  return (
    <PopoverHeader className="gap-2 border-b">
      <FileUploadDropzone className="items-stretch gap-1 border-0 p-0 text-start" disableClick>
        <div className="flex min-w-0 items-center gap-2">
          <FileIcon aria-hidden className="size-4 shrink-0" />
          <span className="min-w-0 truncate font-mono text-foreground text-sm">{saved.name}</span>
          {count !== undefined && (
            <span className="shrink-0 text-xs">
              · {count} {count === 1 ? "rule" : "rules"}
            </span>
          )}
          <span className="ms-auto flex shrink-0 items-center gap-2">
            <Button asChild className="h-auto p-0" size="sm" variant="link">
              <a download={saved.name} href={`data:text/turtle;charset=utf-8,${encodeURIComponent(saved.shapes)}`}>
                Download
              </a>
            </Button>
            {can_manage && (
              <FileUploadTrigger className="h-auto p-0" size="sm" variant="link">
                Replace…
              </FileUploadTrigger>
            )}
          </span>
        </div>
        <p className="text-xs">
          <SavedBy of={saved} />
          {can_manage && ". Drop a .ttl here to replace it."}
        </p>
      </FileUploadDropzone>
      {refused && (
        <>
          <ProblemView error={refused} uncoded="rules/refused" />
          <p className="text-muted-foreground text-xs">Nothing changed: the graph keeps {saved.name}.</p>
        </>
      )}
      {scope && (
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 text-muted-foreground text-xs">{scope}</p>
          <Button
            aria-pressed={conforms.pressed}
            className="shrink-0"
            onClick={() => {
              // As a row's Show does: the popover closes, and the page shows what it put there.
              popover.setOpen(false);
              conforms.toggle();
            }}
            size="sm"
            variant={conforms.pressed ? "secondary" : "outline"}
          >
            Show what conforms
          </Button>
        </div>
      )}
    </PopoverHeader>
  );
}
