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

  const roleChangeMutation = useMutation({
    mutationFn: ({ userId, newRole }: { userId: string; newRole: string }) =>
      api.org.updateRole(userId, newRole),
    onSuccess: () => {
      toast.success("Role updated");
      queryClient.invalidateQueries({ queryKey: queryKeys.org.users });
    },
    onError: () => toast.error("Failed to update role"),
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

  function handleRoleChange(userId: string, newRole: string) {
    roleChangeMutation.mutate({ userId, newRole });
  }

  function handleRemoveUser(userId: string, userName: string) {
    removeUserMutation.mutate({ userId, userName });
  }

  return {
    users: data ?? [],
    isLoading,
    error,
    handleRoleChange,
    handleRemoveUser,
  };
}
