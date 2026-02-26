"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const createDataspaceSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name is too long"),
  description: z.string().max(500).optional(),
});

type CreateDataspaceValues = z.infer<typeof createDataspaceSchema>;

export default function CreateDataspacePage() {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateDataspaceValues>({
    resolver: zodResolver(createDataspaceSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
  });

  async function onSubmit(values: CreateDataspaceValues) {
    try {
      const res = await fetch("/api/admin/dataspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.message ?? "Failed to create dataspace");
        return;
      }
      toast.success("Dataspace created successfully");
      router.push("/");
    } catch {
      toast.error("An error occurred");
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-lg font-medium">Create Dataspace</h2>
        <p className="text-sm text-muted-foreground">
          Create a new dataspace. You will be automatically assigned as the
          promotor.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Dataspace Details</CardTitle>
          <CardDescription>
            Enter the name and optional description for the new dataspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                {...register("name")}
                disabled={isSubmitting}
                placeholder="My Dataspace"
              />
              {errors.name && (
                <p className="text-sm text-destructive">{errors.name.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                {...register("description")}
                disabled={isSubmitting}
                placeholder="What is this dataspace for?"
              />
              {errors.description && (
                <p className="text-sm text-destructive">
                  {errors.description.message}
                </p>
              )}
            </div>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Dataspace"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
