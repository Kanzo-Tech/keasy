"use client";

import { ExternalLink } from "lucide-react";
import { splitWords } from "@kanzo-tech/relations";
import {
  Badge,
  Button,
  FormatNumber,
  StatDescription,
  StatLabel,
  StatRoot,
  StatValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@kanzo-tech/ui";
import type { Question, Relation, Thing } from "./model";
import { type Answered, type Preview, PreviewTab } from "./preview-tab";
import { listed } from "./tasks/model";

/** The panel's tabs: what the files hold, and the answers over the first rows. */
export type PanelTab = "data" | "preview";

export interface AssistantPanelProps {
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  things: readonly Thing[];
  relations: readonly Relation[] | null;
  preview: Preview;
  questions: readonly Question[];
  /** What the preview's Ask answered to a question. */
  onAnswered: Answered;
  /** There is a program: **Open in the editor** opens it, and the graph can be built from it. */
  program: string | null;
  /** Decisions with no safe answer still to take: the build waits on them. */
  open: number;
  /** The conversation was built from, or is building: nothing more to build here. */
  done: boolean;
  onEditor: () => void;
  onBuild: () => void;
  /** Leads to the first decision the build waits on, in the conversation. */
  onOpen: () => void;
}

/**
 * Beside the conversation, as Claude's artifact pane is: what the assistant found, always on screen,
 * and the actions on the graph it is making — **Open in the editor** and **Build the graph**, which
 * says what it waits on (docs/design/assistant.md, *The panel*).
 */
export function AssistantPanel(props: AssistantPanelProps) {
  const { tab, onTab, open, program, done } = props;
  // Asked for before there is anything to preview, the panel stays on Data.
  const shown = tab === "preview" && !previewable(props.preview) ? "data" : tab;
  return (
    <Tabs className="flex min-h-0 flex-1 flex-col" onValueChange={(d) => onTab(d.value as PanelTab)} value={shown}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        <TabsList>
          <TabsTrigger value="data">Data</TabsTrigger>
          <TabsTrigger disabled={!previewable(props.preview)} value="preview">
            Preview
          </TabsTrigger>
        </TabsList>
        {/* The actions on the graph come once there is a program to act on. */}
        {program !== null && (
          <div className="ms-auto flex flex-wrap items-center gap-2">
            <Button onClick={props.onEditor} size="sm" title="Write the shapes and the program yourself" variant="ghost">
              Open in the editor
              <ExternalLink aria-hidden className="size-3.5" />
            </Button>
            {!done && (
              <Button disabled={open > 0} onClick={props.onBuild} size="sm">
                Build the graph
              </Button>
            )}
          </div>
        )}
        {program !== null && !done && open > 0 && (
          <p className="basis-full text-end text-muted-foreground text-xs" data-waits="">
            The build waits on{" "}
            <Button className="h-auto p-0 text-xs" onClick={props.onOpen} variant="link">
              {open === 1 ? "1 question with no safe answer" : `${open} questions with no safe answer`}
            </Button>
          </p>
        )}
      </div>
      <TabsContent className="min-h-0 flex-1 overflow-auto p-4" value="data">
        <DataTab relations={props.relations} things={props.things} />
      </TabsContent>
      <TabsContent className="min-h-0 flex-1 overflow-auto p-4" value="preview">
        <PreviewTab onAnswered={props.onAnswered} preview={props.preview} questions={props.questions} />
      </TabsContent>
    </Tabs>
  );
}

/** The preview has something to show — answers, or why it failed: until then its tab is off. */
const previewable = (preview: Preview) => preview.state === "failed" || (preview.state !== "idle" && preview.graph !== null);

/**
 * What each one of a thing holds, from its columns: "name, gender, birth date and 4 more". Column
 * names are the data's own words, so they are said (`birth_date` → "birth date", by mosaic's `splitWords`) and not renamed.
 */
export function holdsLine(holds: readonly string[], shown = 4): string | null {
  if (holds.length === 0) return null;
  const words = holds.map(splitWords);
  if (words.length <= shown + 1) return listed(words);
  return `${words.slice(0, shown).join(", ")} and ${words.length - shown} more`;
}

/** One thing as a stat: its name, how many, and what each one holds. */
function ThingCard({ thing }: { thing: Thing }) {
  const holds = holdsLine(thing.holds);
  return (
    <StatRoot className="w-full content-start gap-y-0.5 py-3" data-thing={thing.id}>
      <StatLabel className="text-foreground">{thing.name}</StatLabel>
      {thing.count === null ? (
        <span className="col-span-full pt-1 text-muted-foreground text-xs">Not counted yet</span>
      ) : (
        <StatValue className="pt-1 text-xl">
          <FormatNumber value={thing.count} />
        </StatValue>
      )}
      {holds && <StatDescription className="col-span-full pt-1 text-xs">Each one holds {holds}.</StatDescription>}
    </StatRoot>
  );
}

/** A relation as its sentence, with one real row of it as a chip. */
function RelationLine({ relation }: { relation: Relation }) {
  return (
    <li className="flex flex-col items-start gap-1.5 py-2.5 first:pt-0 last:pb-0">
      <span>{relation.sentence}</span>
      {relation.example && (
        <Badge className="max-w-full font-normal text-muted-foreground" variant="outline">
          <span className="text-muted-foreground/80">e.g.</span>
          <span className="truncate text-foreground">{relation.example.join(" · ")}</span>
        </Badge>
      )}
    </li>
  );
}

/** *Data*: the things with their counts — fossil's profile, before any model — and how they hang together. */
function DataTab({ things, relations }: { things: readonly Thing[]; relations: readonly Relation[] | null }) {
  return (
    <section aria-label="Data" className="flex flex-col gap-4">
      <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">In your files</h3>
      {/* Rows that fill: the last row's cards widened to close it — never a card alone beside a hole. */}
      <ul className="flex flex-wrap gap-2" data-things="">
        {things.map((thing) => (
          <li className="flex flex-1 basis-48" key={thing.id}>
            <ThingCard thing={thing} />
          </li>
        ))}
      </ul>
      {relations && relations.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">How it fits together</h3>
          <ul className="flex flex-col divide-y">
            {relations.map((r) => (
              <RelationLine key={r.id} relation={r} />
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
