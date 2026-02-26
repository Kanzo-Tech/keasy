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
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type OrgEntry = {
  id: string;
  name: string;
  role: string;
  created_at: string;
};

const fetcher = (url: string) =>
  fetch(url)
    .then((r) => r.json())
    .then((r) => r.data ?? r);

const addOrgSchema = z.object({
  name: z.string().min(1, "Organization name is required"),
  admin_email: z.string().email("Invalid email address"),
});
type AddOrgValues = z.infer<typeof addOrgSchema>;

const ROLE_LABEL: Record<string, string> = {
  promotor: "Promotor",
  participant: "Participant",
};

export default function OrganizationsPage() {
  const { data: orgs, isLoading } = useSWR<OrgEntry[]>("dataspace-orgs", () =>
    fetcher("/api/admin/dataspace-organizations")
  );
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
      const res = await fetch("/api/admin/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.message ?? "Failed to add organization");
        return;
      }
      toast.success(`Invite sent to ${values.admin_email}`);
      reset();
      setDialogOpen(false);
      globalMutate("dataspace-orgs");
    } catch {
      toast.error("An error occurred");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium">Organizations</h2>
          <p className="text-sm text-muted-foreground">
            Manage organizations in this dataspace.
          </p>
        </div>
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
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={3}
                    className="text-center py-8 text-muted-foreground"
                  >
                    Loading...
                  </TableCell>
                </TableRow>
              ) : !orgs?.length ? (
                <TableRow>
                  <TableCell
                    colSpan={3}
                    className="text-center py-8 text-muted-foreground"
                  >
                    No organizations yet.
                  </TableCell>
                </TableRow>
              ) : (
                orgs.map((org) => (
                  <TableRow key={org.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        {org.name}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {ROLE_LABEL[org.role] ?? org.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(org.created_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
