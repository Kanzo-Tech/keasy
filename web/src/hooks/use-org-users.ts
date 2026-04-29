import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { useCrudMutation } from "@/hooks/use-crud-mutation";

export function useOrgUsers() {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.org.users,
    queryFn: api.org.users,
  });

  const roleChangeMutation = useCrudMutation({
    mutationFn: ({ userId, newRole }: { userId: string; newRole: string }) =>
      api.org.updateRole(userId, newRole),
    successMessage: "Role updated",
    errorMessage: "Failed to update role",
    invalidateKey: queryKeys.org.users,
  });

  const removeUserMutation = useCrudMutation<
    { userId: string; userName: string },
    void
  >({
    mutationFn: ({ userId }) => api.org.removeUser(userId),
    errorMessage: "Failed to remove user",
    invalidateKey: queryKeys.org.users,
  });
  // Custom success toast for remove (uses the userName variable, which
  // useCrudMutation's static successMessage doesn't expose).
  const removeOnSuccess = removeUserMutation.mutate;
  const wrappedRemove = (vars: { userId: string; userName: string }) => {
    removeUserMutation.mutate(vars, {
      onSuccess: () => toast.success(`${vars.userName} has been removed`),
    });
    return removeOnSuccess;
  };

  function handleRoleChange(userId: string, newRole: string) {
    if (!roleChangeMutation.isPending)
      roleChangeMutation.mutate({ userId, newRole });
  }

  function handleRemoveUser(userId: string, userName: string) {
    if (!removeUserMutation.isPending) wrappedRemove({ userId, userName });
  }

  return {
    users: data ?? [],
    isLoading,
    error,
    handleRoleChange,
    handleRemoveUser,
    roleChangePending: roleChangeMutation.isPending,
    removePending: removeUserMutation.isPending,
  };
}
