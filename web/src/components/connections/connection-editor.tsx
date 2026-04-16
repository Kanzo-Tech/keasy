"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { ConnectorForm } from "./connector-form";
import type { Schemas } from "@/lib/api/client";

export function ConnectionEditor() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: kinds, isLoading } = useQuery({
    queryKey: queryKeys.connections.kinds(),
    queryFn: () => api.connections.kinds(),
  });

  const createMutation = useMutation({
    mutationFn: (data: { kind: string; name: string; config: Record<string, string> }) =>
      api.connections.create({
        name: data.name,
        direction: "both",
        config: { kind: data.kind, ...data.config } as unknown as Schemas["ConnectorConfig"],
      }),
    onSuccess: async () => {
      toast.success("Connection created");
      await queryClient.invalidateQueries({ queryKey: queryKeys.connections.all() });
      router.push("/connections");
    },
    onError: (err) => toastError(err, "Failed to create connection"),
  });

  if (isLoading || !kinds) return null;

  return (
    <ConnectorForm
      kinds={kinds}
      onSubmit={(data) => createMutation.mutate(data)}
      isPending={createMutation.isPending}
      isSuccess={createMutation.isSuccess}
      submitLabel="Create"
      backHref="/connections"
    />
  );
}
