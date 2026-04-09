"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { connectorRegistry } from "@/lib/connectors";
import { RegistryForm } from "@/lib/schemas/registry-form";

const connectorTypes = Object.values(connectorRegistry);

export function ConnectionEditor() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (data: { typeId: string; name: string; config: Record<string, string> }) =>
      api.connections.create({
        name: data.name,
        connector_type: data.typeId,
        direction: "both",
        config: Object.keys(data.config).length > 0 ? data.config : undefined,
      }),
    onSuccess: async () => {
      toast.success("Connection created");
      await queryClient.invalidateQueries({ queryKey: queryKeys.connections.all() });
      router.push("/connections");
    },
    onError: (err) => toastError(err, "Failed to create connection"),
  });

  return (
    <RegistryForm
      types={connectorTypes}
      typeLabel="Connector Type"
      typeDescription="Choose the type of storage to connect to"
      showName
      namePlaceholder="e.g. hr-data"
      nameDescription="Used as identifier in @references (e.g. @my-connection/file.csv)"
      onSubmit={(data) => createMutation.mutate(data)}
      isPending={createMutation.isPending}
      isSuccess={createMutation.isSuccess}
      submitLabel="Create"
      backHref="/connections"
    />
  );
}
