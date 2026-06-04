import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { toast } from "sonner";

export function useOrgUsers() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.org.users,
    queryFn: api.org.users,
  });

  const removeUserMutation = useMutation({
    mutationFn: ({ userId }: { userId: string; userName: string }) =>
      api.org.removeUser(userId),
    onSuccess: (_, { userName }) => {
      toast.success(`${userName} has been removed`);
      queryClient.invalidateQueries({ queryKey: queryKeys.org.users });
    },
    onError: () => toast.error("Failed to remove user"),
  });

  function handleRemoveUser(userId: string, userName: string) {
    if (!removeUserMutation.isPending) removeUserMutation.mutate({ userId, userName });
  }

  return {
    users: data ?? [],
    isLoading,
    error,
    handleRemoveUser,
    removePending: removeUserMutation.isPending,
  };
}
