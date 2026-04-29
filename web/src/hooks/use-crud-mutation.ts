"use client";

import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { toastError } from "@/lib/toast-error";

interface UseCrudMutationOptions<TVariables, TData> {
  mutationFn: (variables: TVariables) => Promise<TData>;
  successMessage?: string;
  errorMessage?: string;
  invalidateKey?: QueryKey;
  navigateTo?: string | ((data: TData) => string);
}

/**
 * Canonical wrapper for "create / update / delete → toast → invalidate → navigate"
 * mutations. Replaces the 5 hand-rolled variations across job-editor,
 * connection-editor, users, participants, and use-org-users.
 */
export function useCrudMutation<TVariables, TData>({
  mutationFn,
  successMessage,
  errorMessage,
  invalidateKey,
  navigateTo,
}: UseCrudMutationOptions<TVariables, TData>) {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn,
    onSuccess: async (data) => {
      if (successMessage) toast.success(successMessage);
      if (invalidateKey) {
        await queryClient.invalidateQueries({ queryKey: invalidateKey });
      }
      if (navigateTo) {
        const href = typeof navigateTo === "function" ? navigateTo(data) : navigateTo;
        router.push(href);
      }
    },
    onError: (err) => toastError(err, errorMessage ?? "Operation failed"),
  });
}
