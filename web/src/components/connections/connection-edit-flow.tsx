"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { useCrudMutation } from "@/hooks/use-crud-mutation";
import { ConnectorForm } from "./connector-form";
import type { ConnectorKind } from "@/lib/api/connector-schemas";
import type { Schemas } from "@/lib/api/client";

export function ConnectionEditFlow({ id }: { id: string }) {
  const { data: kinds } = useQuery({
    queryKey: queryKeys.connections.kinds(),
    queryFn: () => api.connections.kinds(),
  });
  const { data: connection, isLoading } = useQuery({
    queryKey: queryKeys.connections.detail(id),
    queryFn: () => api.connections.get(id),
  });

  const updateMutation = useCrudMutation({
    mutationFn: (data: {
      kind: ConnectorKind;
      name: string;
      config: Schemas["ConnectorConfig"];
    }) =>
      api.connections.update(id, {
        name: data.name,
        config: data.config,
      }),
    successMessage: "Connection updated",
    errorMessage: "Failed to update connection",
    invalidateKey: queryKeys.connections.all(),
    navigateTo: `/connections/${id}`,
  });

  if (isLoading || !kinds || !connection) return null;

  const kind = connection.connector_type as ConnectorKind;
  const initialConfig = (connection.config ?? {}) as Record<string, unknown>;

  return (
    <ConnectorForm
      kinds={kinds}
      fixedKind={kind}
      initialName={connection.name}
      initialConfig={initialConfig}
      onSubmit={(data) => updateMutation.mutate(data)}
      isPending={updateMutation.isPending}
      submitLabel="Save"
      backHref={`/connections/${id}`}
    />
  );
}
