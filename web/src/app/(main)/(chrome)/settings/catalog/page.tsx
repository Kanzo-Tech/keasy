"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Database } from "lucide-react";
import { toastError } from "@/lib/toast-error";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { PageShell } from "@/components/layout/page-shell";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormPageSkeleton } from "@/components/settings/form-page-skeleton";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";

const schema = z.object({
  connector_id: z.string().min(1, "Select a connection"),
  base_url: z.string().min(1, "Base URL is required"),
});

type FormValues = z.infer<typeof schema>;

export default function CatalogStoragePage() {
  const queryClient = useQueryClient();

  const { data: connections, isLoading: loadingConnections } = useQuery({
    queryKey: queryKeys.connections.all(),
    queryFn: () => api.connections.list(),
  });

  const { data: config, isLoading: loadingConfig } = useQuery({
    queryKey: queryKeys.settings.catalogStorage,
    queryFn: api.settings.catalogStorage,
  });

  const isLoading = loadingConnections || loadingConfig;
  const showSkeleton = useDelayedLoading(isLoading);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { connector_id: "", base_url: "" },
  });

  // Sync form with loaded data
  useEffect(() => {
    if (config) {
      form.reset({
        connector_id: config.connector_id ?? "",
        base_url: config.base_url ?? "",
      });
    }
  }, [config, form]);

  const saveMutation = useMutation({
    mutationFn: (values: FormValues) =>
      api.settings.saveCatalogStorage({
        connector_id: values.connector_id,
        base_url: values.base_url.trim(),
      }),
    onSuccess: async () => {
      toast.success("Catalog storage saved");
      await queryClient.invalidateQueries({
        queryKey: queryKeys.settings.catalogStorage,
      });
    },
    onError: (err) => toastError(err, "Failed to save catalog storage"),
  });

  if (isLoading) {
    return showSkeleton ? <FormPageSkeleton /> : null;
  }

  if (!connections || connections.length === 0) {
    return (
      <PageShell>
        <PageShell.Content>
          <EmptyState
            icon={Database}
            title="No connections"
            description="Add a connection first to configure catalog storage."
            action={
              <Button asChild size="sm" variant="outline">
                <Link href="/connections">Go to Connections</Link>
              </Button>
            }
          />
        </PageShell.Content>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageShell.Content>
        <form
          id="catalog-storage-form"
          onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))}
          className="flex flex-col gap-6"
        >
          <Controller
            control={form.control}
            name="connector_id"
            render={({ field, fieldState }) => (
              <Field data-invalid={!!fieldState.error || undefined}>
                <FieldLabel>Connection</FieldLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="h-8 text-sm" aria-invalid={fieldState.invalid}>
                    <SelectValue placeholder="Select a connection" />
                  </SelectTrigger>
                  <SelectContent>
                    {connections.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />

          <Controller
            control={form.control}
            name="base_url"
            render={({ field, fieldState }) => (
              <Field data-invalid={!!fieldState.error || undefined}>
                <FieldLabel>Base URL</FieldLabel>
                <Input
                  {...field}
                  placeholder="s3://my-bucket/catalog"
                  className="h-8 text-sm"
                  aria-invalid={fieldState.invalid}
                />
                <FieldDescription>
                  Root path where catalog data will be stored (e.g.
                  s3://my-bucket/catalog)
                </FieldDescription>
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
        </form>
      </PageShell.Content>

      <PageShell.Footer>
        <div />
        <Button
          type="submit"
          form="catalog-storage-form"
          size="sm"
          disabled={saveMutation.isPending || saveMutation.isSuccess}
        >
          {saveMutation.isPending ? "Saving..." : "Save"}
        </Button>
      </PageShell.Footer>
    </PageShell>
  );
}
