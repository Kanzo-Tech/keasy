"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  changePasswordSchema,
  type ChangePasswordValues,
} from "@/lib/auth-schemas";

export default function SecuritySettingsPage() {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
  });

  async function onSubmit(values: ChangePasswordValues) {
    try {
      const res = await fetch("/api/auth/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_password: values.current_password,
          new_password: values.new_password,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const msg = data?.message ?? "Failed to change password";
        toast.error(msg);
        return;
      }

      toast.success("Password changed successfully");
      reset();
    } catch {
      toast.error("An error occurred. Please try again.");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium">Security</h2>
        <p className="text-sm text-muted-foreground">
          Manage your account security settings.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Change Password</CardTitle>
          <CardDescription>
            Update your password to keep your account secure.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 max-w-md">
            <div className="space-y-2">
              <Label htmlFor="current_password">Current Password</Label>
              <Input
                id="current_password"
                type="password"
                {...register("current_password")}
                disabled={isSubmitting}
              />
              {errors.current_password && (
                <p className="text-sm text-destructive">
                  {errors.current_password.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="new_password">New Password</Label>
              <Input
                id="new_password"
                type="password"
                {...register("new_password")}
                disabled={isSubmitting}
              />
              {errors.new_password && (
                <p className="text-sm text-destructive">
                  {errors.new_password.message}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                At least 12 characters with uppercase, lowercase, and a digit.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm_password">Confirm New Password</Label>
              <Input
                id="confirm_password"
                type="password"
                {...register("confirm_password")}
                disabled={isSubmitting}
              />
              {errors.confirm_password && (
                <p className="text-sm text-destructive">
                  {errors.confirm_password.message}
                </p>
              )}
            </div>

            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Changing...
                </>
              ) : (
                "Change Password"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
