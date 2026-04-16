"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";

import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SecretInput } from "@/components/ui/secret-input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";

import type { Schemas } from "@/lib/api/client";
import { getConnectorIcon } from "@/lib/connectors/connector-icons";

type ConnectorKind = Schemas["ConnectorKindInfo"];

interface FieldSpec {
  name: string;
  description?: string;
  example?: string;
  required: boolean;
  secret: boolean;
  multiline?: boolean;
  type: "string";
}

function extractFieldSpecs(kind: string): FieldSpec[] {
  const specs = CONNECTOR_FIELDS[kind];
  if (!specs) return [];
  return specs;
}

const CONNECTOR_FIELDS: Record<string, FieldSpec[]> = {
  s3: [
    { name: "bucket", description: "Bucket name", example: "my-data-bucket", required: true, secret: false, type: "string" },
    { name: "prefix", description: "Optional key prefix to scope access within the bucket", example: "data/raw/", required: false, secret: false, type: "string" },
    { name: "region", description: "AWS region where the bucket lives", example: "eu-west-1", required: false, secret: false, type: "string" },
    { name: "access_key_id", description: "Access Key ID. Leave empty for IAM role / default credential chain", example: "AKIAIOSFODNN7EXAMPLE", required: false, secret: false, type: "string" },
    { name: "secret_access_key", description: "Secret Access Key", required: false, secret: true, type: "string" },
    { name: "session_token", description: "Session Token for STS temporary credentials", required: false, secret: true, type: "string" },
    { name: "endpoint", description: "S3-compatible endpoint. Leave empty for AWS S3; set for MinIO, R2, Wasabi", example: "https://s3.eu-west-1.amazonaws.com", required: false, secret: false, type: "string" },
  ],
  gcs: [
    { name: "bucket", description: "Bucket name", example: "my-gcs-bucket", required: true, secret: false, type: "string" },
    { name: "prefix", description: "Optional object prefix within the bucket", required: false, secret: false, type: "string" },
    { name: "service_account_json", description: "Service account JSON key. Used by object_store for URL signing", required: false, secret: true, multiline: true, type: "string" },
    { name: "hmac_key_id", description: "HMAC key ID (generate in GCP Console → Interoperability)", example: "GOOG1EXAMPLE", required: false, secret: false, type: "string" },
    { name: "hmac_secret", description: "HMAC secret paired with hmac_key_id", required: false, secret: true, type: "string" },
  ],
  azure_blob: [
    { name: "container", description: "Container name", example: "my-container", required: true, secret: false, type: "string" },
    { name: "prefix", description: "Optional blob prefix within the container", required: false, secret: false, type: "string" },
    { name: "connection_string", description: "Azure Storage connection string (Portal → Access Keys → Connection string)", example: "DefaultEndpointsProtocol=https;AccountName=a;AccountKey=k;EndpointSuffix=core.windows.net", required: true, secret: true, type: "string" },
  ],
};

interface ConnectorFormProps {
  kinds: ConnectorKind[];
  onSubmit: (data: { kind: string; name: string; config: Record<string, string> }) => void;
  isPending?: boolean;
  isSuccess?: boolean;
  submitLabel?: string;
  backHref?: string;
}

export function ConnectorForm({
  kinds,
  onSubmit,
  isPending,
  isSuccess,
  submitLabel = "Create",
  backHref,
}: ConnectorFormProps) {
  const router = useRouter();
  const [selectedKind, setSelectedKind] = useState(kinds[0]?.kind ?? "");
  const [name, setName] = useState("");
  const [config, setConfig] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const fields = useMemo(() => extractFieldSpecs(selectedKind), [selectedKind]);

  useEffect(() => {
    setConfig({});
    setErrors({});
  }, [selectedKind]);

  useEffect(() => {
    if (isSuccess) {
      setName("");
      setConfig({});
    }
  }, [isSuccess]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (!name.trim()) {
      newErrors.name = "Name is required";
    }

    for (const field of fields) {
      if (field.required && !config[field.name]?.trim()) {
        newErrors[field.name] = `${field.description ?? field.name} is required`;
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setErrors({});

    const cleanConfig: Record<string, string> = {};
    for (const [key, val] of Object.entries(config)) {
      if (val.trim()) cleanConfig[key] = val;
    }

    onSubmit({ kind: selectedKind, name, config: cleanConfig });
  }

  return (
    <PageShell>
      <PageShell.Header
        title="New Connection"
        actions={
          backHref && (
            <Button variant="ghost" size="icon" onClick={() => router.push(backHref)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )
        }
      />
      <PageShell.Content>
        <form onSubmit={handleSubmit} className="mx-auto max-w-xl space-y-8 pb-12">
        <FieldSet>
          <FieldLegend>Connector Type</FieldLegend>
          <FieldDescription>Choose the type of storage to connect to</FieldDescription>
          <RadioGroup value={selectedKind} onValueChange={setSelectedKind} className="grid grid-cols-1 gap-3 pt-2">
            {kinds.map((k) => {
              const Icon = getConnectorIcon(k.kind);
              return (
                <label
                  key={k.kind}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition ${
                    selectedKind === k.kind ? "border-primary bg-accent" : "border-border hover:bg-accent/50"
                  }`}
                >
                  <RadioGroupItem value={k.kind} className="sr-only" />
                  <Icon className="h-5 w-5 shrink-0" />
                  <div>
                    <div className="font-medium text-sm">{k.name}</div>
                    <div className="text-xs text-muted-foreground">{k.description}</div>
                  </div>
                </label>
              );
            })}
          </RadioGroup>
        </FieldSet>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="conn-name">Name</FieldLabel>
            <FieldDescription>Used as identifier in @references (e.g. @my-connection/file.csv)</FieldDescription>
            <FieldContent>
              <Input
                id="conn-name"
                placeholder="e.g. hr-data"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </FieldContent>
            {errors.name && <FieldError>{errors.name}</FieldError>}
          </Field>

          {fields.map((field) => (
            <Field key={field.name}>
              <FieldLabel htmlFor={`field-${field.name}`}>
                {field.name.replace(/_/g, " ")}
                {field.required && <span className="text-destructive ml-0.5">*</span>}
              </FieldLabel>
              {field.description && <FieldDescription>{field.description}</FieldDescription>}
              <FieldContent>
                {field.multiline ? (
                  <Textarea
                    id={`field-${field.name}`}
                    placeholder={field.example}
                    value={config[field.name] ?? ""}
                    onChange={(e) => setConfig((p) => ({ ...p, [field.name]: e.target.value }))}
                    rows={4}
                  />
                ) : field.secret ? (
                  <SecretInput
                    id={`field-${field.name}`}
                    placeholder={field.example}
                    value={config[field.name] ?? ""}
                    onChange={(e) => setConfig((p) => ({ ...p, [field.name]: e.target.value }))}
                  />
                ) : (
                  <Input
                    id={`field-${field.name}`}
                    placeholder={field.example}
                    value={config[field.name] ?? ""}
                    onChange={(e) => setConfig((p) => ({ ...p, [field.name]: e.target.value }))}
                  />
                )}
              </FieldContent>
              {errors[field.name] && <FieldError>{errors[field.name]}</FieldError>}
            </Field>
          ))}
        </FieldGroup>

        <div className="flex justify-end">
          <Button type="submit" disabled={isPending}>
            {isPending ? "Creating..." : submitLabel}
          </Button>
        </div>
        </form>
      </PageShell.Content>
    </PageShell>
  );
}
