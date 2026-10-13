"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useRouter } from "@kanzo-tech/navigation/next";
import { Spinner } from "@kanzo-tech/ui";
import type { Format } from "@fossil-lang/types";
import { $api } from "@/lib/api/client";
import { settled } from "@/lib/api/settled";
import { Boundary, Loading } from "@/components/boundary";
import { ModelStatus } from "@/components/model-status";
import { ProblemView } from "@/components/problem-view";
import { usePreloadModel } from "@/lib/ai";
import { type AssistantConversation, type AssistantMessage, useAssistantConversation } from "@/lib/assistant-conversation";
import { type StorageConnection, storageConnections } from "@/lib/connections";
import { toastError } from "@/lib/errors";
import * as checker from "@/lib/fossil/checker";
import { usePreview } from "@/lib/fossil/preview";
import { useGraphEditorStore } from "../graph-editor-store";
import { useBuild } from "../use-build";
import { AssistantChat } from "./assistant-chat";
import { type Replies, type Restored, restore } from "./conversation";
import type { Question } from "./model";
import type { Preview } from "./preview-turn";
import { useAssistant } from "./use-assistant";

/**
 * The assistant's page: the workspace's connections and readers, then the conversation —
 * `?conversation=<id>` resumes a kept one, and `&decision=<id>` opens that decision's turn.
 */
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
  // Read once: the conversation's id is written back to the URL as it is saved, and that is not a
  // conversation to open again.
  const params = useSearchParams();
  const [opened] = useState(() => ({ conversation: params.get("conversation"), decision: params.get("decision") }));
  return <AssistantFlow connections={connections} formats={formats} {...opened} />;
}

/**
 * The conversation `conversation` — or a new one — read, then resumed: the chat starts where it
 * stood, and `decision` is opened at its options (Discover's **Change**).
 */
export function AssistantFlow({
  connections,
  formats,
  conversation = null,
  decision = null,
}: {
  connections: readonly StorageConnection[];
  formats: readonly Format[];
  conversation?: string | null;
  decision?: string | null;
}) {
  // The model the Tasks behind these turns ask starts downloading as the assistant opens.
  usePreloadModel();
  const kept = useAssistantConversation(conversation);
  // The id of the conversation the next save goes to, on the URL, so a reload resumes it.
  useEffect(() => {
    if (kept.id === null) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("conversation") === kept.id) return;
    window.history.replaceState(null, "", `${url.pathname}?conversation=${encodeURIComponent(kept.id)}`);
  }, [kept.id]);
  if (kept.problem !== undefined) return <ProblemView className="m-auto" error={kept.problem} />;
  if (kept.messages === undefined) {
    return (
      <Loading>
        <Spinner className="m-auto" />
      </Loading>
    );
  }
  return <Resumed connections={connections} formats={formats} kept={kept} reopen={decision} seed={restore(kept.messages)} />;
}

/**
 * The conversation over `useAssistant`, from `seed`: the preview of the program the mapping writes,
 * and the whole graph built on request, from the conversation saved first. **Advanced** leaves for
 * the studio with the picked files already written as the program's sources.
 */
function Resumed({
  connections,
  formats,
  kept,
  seed,
  reopen,
}: {
  connections: readonly StorageConnection[];
  formats: readonly Format[];
  kept: AssistantConversation;
  /** Where the conversation stood when it was opened; read once. */
  seed: Restored;
  reopen: string | null;
}) {
  const router = useRouter();
  // What the person has replied, which the Tasks wait on; the chat keeps it and says each change.
  const [replies, setReplies] = useState<Replies>(seed.replies);
  const onReplies = useCallback((next: Replies) => setReplies(next), []);
  // The questions kept; whether each can be answered is the hook's to say.
  const [questions, setQuestions] = useState<Question[]>(seed.questions);
  const assistant = useAssistant({ connections, formats, about: replies.about, asked: replies.asked, questions, seed });

  // The preview runs the mapping's program; while it writes the next one, the last stays on screen.
  const ran = usePreview(assistant.mapped, assistant.described);
  const preview: Preview =
    assistant.writing && ran.state !== "idle" ? { state: "running", corpus: ran.corpus, rerun: ran.rerun } : ran;

  // The whole graph, once asked for, from the conversation saved first: a save over a built
  // conversation starts a new one, so the build waits for the id the save answered.
  const { progress, build } = useBuild(assistant.mapped, assistant.described, { conversation: kept.id ?? undefined });
  const [asked, setAsked] = useState<{ conversation: string; program: string } | null>(null);
  useEffect(() => {
    if (asked !== null && asked.conversation === kept.id && asked.program === assistant.mapped) build();
  }, [asked, kept.id, assistant.mapped, build]);
  const { save } = kept;
  const onSave = useCallback(
    (messages: readonly AssistantMessage[]) => void save(messages).catch((error: unknown) => toastError(error, "The conversation could not be saved")),
    [save],
  );
  const onBuild = (messages: readonly AssistantMessage[]) => {
    const program = assistant.mapped;
    if (program === null) return;
    save(messages).then(
      (conversation) => setAsked({ conversation, program }),
      (error: unknown) => toastError(error, "The conversation could not be saved, so the graph was not built"),
    );
  };

  const advanced = () => {
    const store = useGraphEditorStore.getState();
    store.setScript(assistant.program);
    store.setCreationMode("studio");
    router.push("/graphs/new");
  };
  return (
    <AssistantChat
      {...assistant}
      build={progress}
      built={kept.built}
      initial={seed.replies}
      onAdvanced={advanced}
      onBack={() => router.push("/graphs")}
      onBuild={onBuild}
      onChoose={assistant.choose}
      onExpandedChange={assistant.setExpanded}
      onQuestionsChange={setQuestions}
      onReplies={onReplies}
      onSave={onSave}
      onSelectedChange={assistant.setSelected}
      preview={preview}
      program={assistant.mapped}
      questions={assistant.questions}
      reopen={reopen}
      status={<ModelStatus />}
    />
  );
}
