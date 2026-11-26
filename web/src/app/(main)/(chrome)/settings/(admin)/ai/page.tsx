"use client";

import { useState } from "react";
import { Cloud, MonitorSmartphone, TriangleAlert } from "lucide-react";
import {
  Alert,
  AlertDescription,
  Button,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  PasswordInput,
  PasswordInputGroup,
  PasswordInputInput,
  PasswordInputTrigger,
  RadioGroup,
  RadioGroupCard,
  RadioGroupText,
  SectionBody,
  SectionDescription,
  SectionFooter,
  SectionHeader,
  SectionRoot,
  SectionTitle,
  SectionTitleGroup,
  Skeleton,
  toast,
} from "@kanzo-tech/ui";
import { Boundary, Loading } from "@/components/boundary";
import { $api, type Schemas } from "@/lib/api/client";
import { settled } from "@/lib/api/settled";

// Which model every member's Ask and assistant run on: the one in the page, or an external
// OpenAI-compatible API the server holds the key of. Stored, not yet called: until the relay is
// wired, Ask and the assistant still run on the model in the page.

/** Where the model runs. Another one, such as a local Ollama, is one more entry here. */
const SOURCES = [
  {
    value: "browser",
    label: "In your browser",
    holds: "Qwen3-4B on each member's device. Nothing leaves it.",
    icon: MonitorSmartphone,
  },
  {
    value: "external",
    label: "External model",
    holds: "An OpenAI-compatible API, with the workspace's key.",
    icon: Cloud,
  },
] as const;

type Source = (typeof SOURCES)[number]["value"];
type External = Schemas["AiModelView"];

const META = { invalidates: ["/v1/ai/model"] } as const;

export default function AiModelPage() {
  return (
    <Boundary
      fallback={
        <Loading>
          <SectionRoot>
            <SectionBody scale="page">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-40 w-full" />
            </SectionBody>
          </SectionRoot>
        </Loading>
      }
    >
      <AiModel />
    </Boundary>
  );
}

function AiModel() {
  const { external } = settled($api.useSuspenseQuery("get", "/v1/ai/model"));
  // Saved, the form starts again from what the server holds.
  return <Form external={external ?? undefined} key={external?.updated_at ?? "none"} />;
}

function Form({ external }: { external?: External }) {
  const [source, setSource] = useState<Source>(external ? "external" : "browser");
  const [baseUrl, setBaseUrl] = useState(external?.base_url ?? "https://api.openai.com/v1");
  const [model, setModel] = useState(external?.model ?? "");
  const [apiKey, setApiKey] = useState("");
  const [removeKey, setRemoveKey] = useState(false);

  const set = $api.useMutation("put", "/v1/ai/model", {
    meta: { ...META, success: "AI model saved", failure: "The AI model was not saved" },
  });
  const remove = $api.useMutation("delete", "/v1/ai/model", {
    meta: { ...META, success: "Ask and the assistant run in the browser again", failure: "The AI model was not removed" },
  });
  const keyStored = external?.has_key === true && !removeKey;

  const save = () =>
    source === "external"
      ? set.mutate({
          body: {
            base_url: baseUrl,
            model,
            // Left out, the stored key is kept; empty, it is removed.
            ...(apiKey.trim() ? { api_key: apiKey } : removeKey ? { api_key: "" } : {}),
          },
        })
      : remove.mutate({});

  return (
    <SectionRoot>
      <SectionBody className="gap-8" scale="page">
        <SectionRoot className="gap-4" fill={false}>
          <SectionHeader>
            <SectionTitleGroup>
              <SectionTitle>Model</SectionTitle>
              <SectionDescription>Where the model every member&apos;s Ask and assistant use runs.</SectionDescription>
            </SectionTitleGroup>
          </SectionHeader>
          <SectionBody>
            <RadioGroup
              aria-label="Model"
              columns={SOURCES.length}
              onValueChange={(details) => details.value && setSource(details.value as Source)}
              value={source}
            >
              {SOURCES.map((s) => (
                <RadioGroupCard className="flex-col items-start" key={s.value} value={s.value}>
                  <span className="flex items-center gap-2">
                    <s.icon aria-hidden className="size-4" />
                    <RadioGroupText>{s.label}</RadioGroupText>
                  </span>
                  <span className="text-muted-foreground text-xs">{s.holds}</span>
                </RadioGroupCard>
              ))}
            </RadioGroup>
          </SectionBody>
        </SectionRoot>

        {source === "external" && (
          <SectionRoot className="gap-4" fill={false}>
            <SectionHeader>
              <SectionTitleGroup>
                <SectionTitle>External model</SectionTitle>
                <SectionDescription>Any OpenAI-compatible API, OpenAI itself included.</SectionDescription>
              </SectionTitleGroup>
            </SectionHeader>
            <SectionBody>
              <FieldGroup>
                <Field required>
                  <FieldLabel>Base URL</FieldLabel>
                  <Input
                    className="font-mono"
                    onChange={(event) => setBaseUrl(event.target.value)}
                    placeholder="https://api.openai.com/v1"
                    value={baseUrl}
                  />
                  <FieldDescription>The root of the API.</FieldDescription>
                </Field>

                <Field>
                  <FieldLabel>API key</FieldLabel>
                  <PasswordInput>
                    <PasswordInputGroup>
                      <PasswordInputInput
                        autoComplete="new-password"
                        onChange={(event) => setApiKey(event.target.value)}
                        placeholder={keyStored ? "Stored. Leave empty to keep it" : "sk-…"}
                        value={apiKey}
                      />
                      <PasswordInputTrigger />
                    </PasswordInputGroup>
                  </PasswordInput>
                  <FieldDescription>
                    Stored encrypted on the server. Every member&apos;s Ask and assistant use it. An API that takes
                    no key, such as a local Ollama, leaves it empty.
                  </FieldDescription>
                  {keyStored && (
                    <Button
                      className="self-start"
                      onClick={() => {
                        setRemoveKey(true);
                        setApiKey("");
                      }}
                      size="sm"
                      variant="ghost"
                    >
                      Remove key
                    </Button>
                  )}
                </Field>

                <Field required>
                  <FieldLabel>Model</FieldLabel>
                  <Input
                    className="font-mono"
                    onChange={(event) => setModel(event.target.value)}
                    placeholder="gpt-4o-mini"
                    value={model}
                  />
                  <FieldDescription>The name the provider gives it.</FieldDescription>
                </Field>
              </FieldGroup>

              <Alert variant="warning">
                <TriangleAlert />
                <AlertDescription>
                  Every member&apos;s questions, and the data Ask reads, are sent to this provider.
                </AlertDescription>
              </Alert>
            </SectionBody>
          </SectionRoot>
        )}
      </SectionBody>

      {(source === "external" || external) && (
        <SectionFooter className="justify-end gap-2">
          {source === "external" && (
            <Button
              onClick={() => toast.create({ title: "Not connected yet", description: "Testing comes with the relay." })}
              size="sm"
              variant="outline"
            >
              Test connection
            </Button>
          )}
          <Button
            disabled={source === "external" && (!baseUrl.trim() || !model.trim())}
            isLoading={set.isPending || remove.isPending}
            onClick={save}
            size="sm"
          >
            {source === "external" ? "Save" : "Use the browser model"}
          </Button>
        </SectionFooter>
      )}
    </SectionRoot>
  );
}
