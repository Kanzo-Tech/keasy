"use client";

import { useCallback, useMemo, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useRouter } from "@kanzo-tech/navigation/next";
import { Spinner } from "@kanzo-tech/ui";
import type { Format } from "@fossil-lang/types";
import { $api } from "@/lib/api/client";
import { settled } from "@/lib/api/settled";
import { Boundary, Loading } from "@/components/boundary";
import { ModelStatus } from "@/components/model-status";
import { usePreloadModel } from "@/lib/ai";
import { type StorageConnection, storageConnections } from "@/lib/connections";
import * as checker from "@/lib/fossil/checker";
import { useGraphEditorStore } from "../graph-editor-store";
import { AssistantChat } from "./assistant-chat";
import { NO_REPLIES, type Replies } from "./conversation";
import type { Question } from "./model";
import { useAssistant } from "./use-assistant";

/** The assistant's page: the workspace's connections and readers, then the conversation. */
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
 * The conversation over `useAssistant`. **Advanced** leaves for the studio with the picked files
 * already written as the program's sources.
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
  // What the person has replied, which the Tasks wait on; the chat keeps it and says each change.
  const [replies, setReplies] = useState<Replies>(NO_REPLIES);
  const onReplies = useCallback((next: Replies) => setReplies(next), []);
  // The questions kept; whether each can be answered is the hook's to say.
  const [questions, setQuestions] = useState<Question[]>([]);
  const assistant = useAssistant({ connections, formats, about: replies.about, asked: replies.asked, questions });
  const advanced = () => {
    const store = useGraphEditorStore.getState();
    store.setScript(assistant.program);
    store.setCreationMode("studio");
    router.push("/graphs/new");
  };
  return (
    <AssistantChat
      {...assistant}
      onAdvanced={advanced}
      onBack={() => router.push("/graphs")}
      onChoose={assistant.choose}
      onExpandedChange={assistant.setExpanded}
      onQuestionsChange={setQuestions}
      onReplies={onReplies}
      onSelectedChange={assistant.setSelected}
      questions={assistant.questions}
      status={<ModelStatus />}
    />
  );
}
