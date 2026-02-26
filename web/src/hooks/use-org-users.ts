import useSWR from "swr";
import { fetchOrgUsers, updateOrgUserRole, removeOrgUser } from "@/lib/api";
import { toast } from "sonner";

export function useOrgUsers() {
  const { data, isLoading, error, mutate } = useSWR("org-users", fetchOrgUsers);

  async function handleRoleChange(userId: string, newRole: string) {
    try {
      await updateOrgUserRole(userId, newRole);
      toast.success("Role updated");
      mutate();
    } catch {
      toast.error("Failed to update role");
    }
  }

  async function handleRemoveUser(userId: string, userName: string) {
    try {
      await removeOrgUser(userId);
      toast.success(`${userName} has been removed`);
      mutate();
    } catch {
      toast.error("Failed to remove user");
    }
  }

  return { users: data ?? [], isLoading, error, mutate, handleRoleChange, handleRemoveUser };
}
