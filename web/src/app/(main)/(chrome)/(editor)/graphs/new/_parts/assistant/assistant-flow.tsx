"use client";

import { useMemo, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Code } from "lucide-react";
import { useRouter } from "@kanzo-tech/navigation/next";
import { Button, SectionBody, SectionFooter, Show, Spinner } from "@kanzo-tech/ui";
import type { Format } from "@fossil-lang/types";
import { $api } from "@/lib/api/client";
import { settled } from "@/lib/api/settled";
import { Boundary, Loading } from "@/components/boundary";
import { ModelStatus } from "@/components/model-status";
import { usePreloadModel } from "@/lib/ai";
import { type StorageConnection, storageConnections } from "@/lib/connections";
import * as checker from "@/lib/fossil/checker";
import { useGraphEditorStore } from "../graph-editor-store";
import { DataScreen } from "./data-screen";
import { ExploreScreen } from "./explore-screen";
import { blocks, type Question } from "./model";
import { UnderstoodScreen } from "./understood-screen";
import { useAssistant } from "./use-assistant";

const SCREENS = ["Your data", "What I understood", "Explore"] as const;

/** The assistant's page: the workspace's connections and readers, then the three screens. */
export function AssistantPage() {
  return (
    <Boundary
      fallback={
        <Loading>
          <Spinner className="m-auto" />
        </Loading>
      }
    >
      <Loaded />
    </Boundary>
  );
}

function Loaded() {
  const all = settled($api.useSuspenseQuery("get", "/v1/connections"));
  const connections = useMemo(() => storageConnections(all), [all]);
  const formats = settled(useSuspenseQuery(checker.formatsQuery));
  return <AssistantFlow connections={connections} formats={formats} />;
}

/**
 * The three screens over `useAssistant`: what each shows is the hook's, and what the person enters —
 * what the data is about, their questions, which screen — is kept here. **Advanced** leaves for the
 * studio with the picked files already written as the program's sources.
 */
export function AssistantFlow({
  connections,
  formats,
}: {
  connections: readonly StorageConnection[];
  formats: readonly Format[];
}) {
  const router = useRouter();
  // The model the Tasks behind these screens ask starts downloading as the assistant opens.
  usePreloadModel();
  const assistant = useAssistant({ connections, formats });
  const [screen, setScreen] = useState(0);
  const [about, setAbout] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);

  const advanced = () => {
    const store = useGraphEditorStore.getState();
    store.setScript(assistant.program);
    store.setCreationMode("studio");
    router.push("/graphs/new");
  };

  const blocked = (assistant.decisions ?? []).some(blocks);
  const canContinue =
    screen === 0 ? assistant.selected.size > 0 && assistant.reading === null : screen === 1 ? !blocked : false;

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
            {title}
          </li>
        ))}
      </ol>

      <SectionBody scale="page">
        <ModelStatus className="mb-4" />
        <Show when={screen === 0}>
          <DataScreen
            about={about}
            // No model in the page yet: the field is a plain one until the local model lands.
            assist={null}
            expanded={assistant.expanded}
            offers={assistant.offers}
            onAboutChange={setAbout}
            onExpandedChange={assistant.setExpanded}
            onQuestionsChange={setQuestions}
            onSelectedChange={assistant.setSelected}
            problems={assistant.problems}
            questions={questions}
            reading={assistant.reading}
            selected={assistant.selected}
            tree={assistant.sources}
          />
        </Show>
        <Show when={screen === 1}>
          <UnderstoodScreen
            decisions={assistant.decisions}
            onChoose={assistant.choose}
            preparing={assistant.build?.state === "preparing" ? assistant.build.previewRows : null}
            questions={questions}
            understanding={assistant.understanding}
          />
        </Show>
        <Show when={screen === 2}>
          <ExploreScreen build={assistant.build} decisions={assistant.decisions} onChoose={assistant.choose} />
        </Show>
      </SectionBody>

      <SectionFooter>
        <Button
          onClick={() => (screen === 0 ? router.push("/graphs") : setScreen(screen - 1))}
          size="sm"
          variant="ghost"
        >
          <ArrowLeft />
          Back
        </Button>
        <Button className="ms-auto" onClick={advanced} size="sm" variant="ghost">
          <Code />
          Advanced
        </Button>
        <Show when={screen < SCREENS.length - 1}>
          <Button disabled={!canContinue} onClick={() => setScreen(screen + 1)} size="sm">
            Continue
            <ArrowRight />
          </Button>
        </Show>
      </SectionFooter>
    </div>
  );
}
