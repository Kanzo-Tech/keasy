"use client";

import { useState } from "react";
import {
  Badge,
  Button,
  Field,
  FieldDescription,
  FieldLabel,
  FieldRequiredIndicator,
  Input,
  SectionBody,
  SectionFooter,
  SectionRoot,
  Skeleton,
  toast,
} from "@kanzo-tech/ui";
import { useRouter } from "@kanzo-tech/navigation/next";
import { initialValues, SpecForm, toBody } from "@/components/spec-form";
import { schemaOf } from "@/lib/api/spec";
import { UnsavedChangesGuard } from "@/lib/ui/unsaved-changes-guard";
import { $api, type Inputs, invalidate } from "@/lib/api/client";
import { type Credential, type Purpose, specOf } from "@/lib/connections";
import { toastError } from "@/lib/errors";
import { Boundary, Loading } from "@/components/boundary";
import { settled } from "@/lib/api/settled";

type Spec = Inputs["CredentialSpecInput"];

/** Adds a credential of `purpose`, or renames and rotates `name`. */
export function CredentialForm({ purpose, name }: { purpose?: Purpose; name?: string }) {
  if (!name) return <Form purpose={purpose ?? "storage"} />;
  return (
    <Boundary
      fallback={
        <Loading>
          <SectionRoot>
            <SectionBody scale="page">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-40 w-full" />
            </SectionBody>
          </SectionRoot>
        </Loading>
      }
    >
      <Stored name={name} />
    </Boundary>
  );
}

function Stored({ name }: { name: string }) {
  const credential = settled($api.useSuspenseQuery("get", "/v1/credentials/{name}", { params: { path: { name } } }));
  return <Form credential={credential} purpose={specOf(credential).purpose} />;
}

function Form({ credential, purpose }: { credential?: Credential; purpose: Purpose }) {
  const router = useRouter();
  const schema = schemaOf(purpose === "storage" ? "StorageCredentialInput" : "ModelCredentialInput");
  const [name, setName] = useState(credential?.name ?? "");
  const [probeUrl, setProbeUrl] = useState("");
  const [values, setValues] = useState(() =>
    initialValues(schema, credential ? specOf(credential).spec : undefined),
  );
  const inner = toBody(schema, values);
  const spec = inner && ({ [purpose]: inner } as unknown as Spec);

  const done = async (title: string) => {
    toast.create({ title, type: "success" });
    await invalidate("/v1/credentials", "/v1/connections");
    router.push(`/settings/credentials?purpose=${purpose}`);
  };
  const create = $api.useMutation("post", "/v1/credentials", {
    onSuccess: () => done("Credential validated and saved"),
    onError: (err) => toastError(err, "The credential was not saved"),
  });
  const update = $api.useMutation("patch", "/v1/credentials/{name}", {
    onSuccess: () => done("Credential rotated"),
    onError: (err) => toastError(err, "The credential was not rotated"),
  });
  const saving = create.isPending || update.isPending || create.isSuccess || update.isSuccess;

  const dirty = !!(name || probeUrl) && !credential && !saving;

  const save = () => {
    if (!spec) return;
    if (credential) {
      update.mutate({
        params: { path: { name: credential.name } },
        body: { name: name.trim() !== credential.name ? name.trim() : undefined, spec },
      });
    } else {
      create.mutate({ body: { name: name.trim(), spec, probe_url: probeUrl.trim() || undefined } });
    }
  };

  return (
    <SectionRoot>
      <SectionBody scale="page">
        {credential && credential.used_by.length > 0 && (
          <p className="text-muted-foreground text-sm">
            Rotating replaces the whole spec, and is saved only if every connection using it still
            validates: {credential.used_by.map((c) => <Badge className="ms-1" key={c} variant="outline">{c}</Badge>)}
          </p>
        )}

        <Field required>
          <FieldLabel>
            Name
            <FieldRequiredIndicator />
          </FieldLabel>
          <Input
            onChange={(e) => setName(e.target.value)}
            placeholder={purpose === "storage" ? "e.g. production-s3" : "e.g. anthropic-team"}
            value={name}
          />
        </Field>

        <SpecForm editing={!!credential} onChange={setValues} schema={schema} value={values} />

        {purpose === "storage" && !credential && (
          <Field>
            <FieldLabel>
              Test URL
              <FieldRequiredIndicator fallback="(optional)" />
            </FieldLabel>
            <FieldDescription>
              A location to list before saving (e.g. s3://my-bucket/). Without one the credential is
              first tested by the connections that use it.
            </FieldDescription>
            <Input className="font-mono" onChange={(e) => setProbeUrl(e.target.value)} value={probeUrl} />
          </Field>
        )}
      </SectionBody>

      <SectionFooter className="justify-end">
        <Button disabled={!spec || !name.trim()} isLoading={saving} onClick={save} size="sm">
          {credential ? "Validate and rotate" : "Validate and save"}
        </Button>
      </SectionFooter>
      <UnsavedChangesGuard dirty={dirty} />
    </SectionRoot>
  );
}
