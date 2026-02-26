"use client";

import { useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, Plus, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/empty-state";
import { organizationColumns } from "@/components/columns/organization-columns";
import { fetchDataspaceOrganizations, addOrganization } from "@/lib/api";

const addOrgSchema = z.object({
  name: z.string().min(1, "Organization name is required"),
  admin_email: z.string().email("Invalid email address"),
});
type AddOrgValues = z.infer<typeof addOrgSchema>;

export default function OrganizationsPage() {
  const { data: orgs, isLoading } = useSWR("dataspace-orgs", fetchDataspaceOrganizations);
  const [dialogOpen, setDialogOpen] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AddOrgValues>({
    resolver: zodResolver(addOrgSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
  });

  async function onAddOrg(values: AddOrgValues) {
    try {
      await addOrganization(values);
      toast.success(`Invite sent to ${values.admin_email}`);
      reset();
      setDialogOpen(false);
      globalMutate("dataspace-orgs");
    } catch {
      toast.error("Failed to add organization");
    }
  }

  const addOrgDialog = (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Add Organization
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Organization</DialogTitle>
          <DialogDescription>
            Register a participant organization and invite their admin.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onAddOrg)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="org-name">Organization Name</Label>
            <Input
              id="org-name"
              {...register("name")}
              disabled={isSubmitting}
              placeholder="Acme Corp"
            />
            {errors.name && (
              <p className="text-sm text-destructive">
                {errors.name.message}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="admin-email">Admin Email</Label>
            <Input
              id="admin-email"
              type="email"
              {...register("admin_email")}
              disabled={isSubmitting}
              placeholder="admin@acme.com"
            />
            {errors.admin_email && (
              <p className="text-sm text-destructive">
                {errors.admin_email.message}
              </p>
            )}
          </div>
          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending invite...
              </>
            ) : (
              "Send Invite"
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium">Organizations</h2>
          <p className="text-sm text-muted-foreground">
            Manage organizations in this dataspace.
          </p>
        </div>
        {addOrgDialog}
      </div>

      {!isLoading && !orgs?.length ? (
        <EmptyState
          icon={Building2}
          title="No organizations yet"
          description="Add participant organizations to this dataspace."
          action={
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Organization
                </Button>
              </DialogTrigger>
            </Dialog>
          }
        />
      ) : (
        <DataTable
          columns={organizationColumns}
          data={orgs ?? []}
          searchKey="name"
          searchPlaceholder="Search organizations..."
        />
      )}
    </div>
  );
}
