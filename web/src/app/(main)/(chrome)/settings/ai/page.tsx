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
  toast,
} from "@kanzo-tech/ui";

// The page alone: nothing here is kept or asked yet. Which model Ask and the assistant use is still
// `lib/ai.ts`'s, the one in the page; choosing here changes nothing until the choice is wired.

/** Where the model runs. Another one, such as a local Ollama, is one more entry here. */
const SOURCES = [
  {
    value: "browser",
    label: "In your browser",
    holds: "Qwen3-4B on this device. Nothing leaves it.",
    icon: MonitorSmartphone,
  },
  {
    value: "external",
    label: "External model",
    holds: "An OpenAI-compatible API, with your key.",
    icon: Cloud,
  },
] as const;

type Source = (typeof SOURCES)[number]["value"];

const notYet = () => toast.create({ title: "Not connected yet", description: "This page does not save or test anything yet." });

export default function AiModelPage() {
  const [source, setSource] = useState<Source>("browser");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");

  return (
    <SectionRoot>
      <SectionBody className="gap-8" scale="page">
        <SectionRoot className="gap-4" fill={false}>
          <SectionHeader>
            <SectionTitleGroup>
              <SectionTitle>Model</SectionTitle>
              <SectionDescription>Where the model Ask and the assistant use runs.</SectionDescription>
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
                <Field>
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
                        autoComplete="off"
                        onChange={(event) => setApiKey(event.target.value)}
                        placeholder="sk-…"
                        value={apiKey}
                      />
                      <PasswordInputTrigger />
                    </PasswordInputGroup>
                  </PasswordInput>
                  <FieldDescription>Kept in this browser only.</FieldDescription>
                </Field>

                <Field>
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
                <AlertDescription>Your questions and the data Ask reads are sent to this provider.</AlertDescription>
              </Alert>
            </SectionBody>
          </SectionRoot>
        )}
      </SectionBody>

      <SectionFooter className="justify-end gap-2">
        {source === "external" && (
          <Button onClick={notYet} size="sm" variant="outline">
            Test connection
          </Button>
        )}
        <Button onClick={notYet} size="sm">
          Save
        </Button>
      </SectionFooter>
    </SectionRoot>
  );
}
