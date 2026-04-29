"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { useCrudMutation } from "@/hooks/use-crud-mutation";
import { ConnectorForm } from "./connector-form";
import type { ConnectorKind } from "@/lib/api/connector-schemas";
import type { Schemas } from "@/lib/api/client";

export function ConnectionEditor() {
  const { data: kinds, isLoading } = useQuery({
    queryKey: queryKeys.connections.kinds(),
    queryFn: () => api.connections.kinds(),
  });

  const createMutation = useCrudMutation({
    mutationFn: (data: {
      kind: ConnectorKind;
      name: string;
      config: Schemas["ConnectorConfig"];
    }) =>
      api.connections.create({
        name: data.name,
        direction: "both",
        config: data.config,
      }),
    successMessage: "Connection created",
    errorMessage: "Failed to create connection",
    invalidateKey: queryKeys.connections.all(),
    navigateTo: "/connections",
  });

  if (isLoading || !kinds) return null;

  return (
    <ConnectorForm
      kinds={kinds}
      onSubmit={(data) => createMutation.mutate(data)}
      isPending={createMutation.isPending}
      submitLabel="Create"
      backHref="/connections"
    />
  );
}
