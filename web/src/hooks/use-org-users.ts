import useSWR from "swr";
import { api } from "@/lib/api";
import { toast } from "sonner";

export function useOrgUsers() {
  const { data, isLoading, error, mutate } = useSWR("org-users", api.org.users);

  async function handleRoleChange(userId: string, newRole: string) {
    try {
      await api.org.updateRole(userId, newRole);
      toast.success("Role updated");
      mutate();
    } catch {
      toast.error("Failed to update role");
    }
  }

  async function handleRemoveUser(userId: string, userName: string) {
    try {
      await api.org.removeUser(userId);
      toast.success(`${userName} has been removed`);
      mutate();
    } catch {
      toast.error("Failed to remove user");
    }
  }

  return { users: data ?? [], isLoading, error, mutate, handleRoleChange, handleRemoveUser };
}
