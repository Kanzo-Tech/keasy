"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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

const inviteRegisterSchema = z
  .object({
    password: z
      .string()
      .min(12, "At least 12 characters")
      .regex(/[A-Z]/, "Must contain an uppercase letter")
      .regex(/[a-z]/, "Must contain a lowercase letter")
      .regex(/[0-9]/, "Must contain a digit"),
    confirm_password: z.string(),
  })
  .refine((d) => d.password === d.confirm_password, {
    message: "Passwords do not match",
    path: ["confirm_password"],
  });
type InviteRegisterValues = z.infer<typeof inviteRegisterSchema>;

function InviteForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token") ?? "";
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<InviteRegisterValues>({
    resolver: zodResolver(inviteRegisterSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
  });

  useEffect(() => {
    if (!token) {
      setInvalid(true);
      setLoading(false);
      return;
    }
    fetch(`/api/auth/invite-info?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((data) => {
        const e = data.data?.email ?? data.email;
        if (e) {
          setEmail(e);
        } else {
          setInvalid(true);
        }
      })
      .catch(() => setInvalid(true))
      .finally(() => setLoading(false));
  }, [token]);

  async function onSubmit(values: InviteRegisterValues) {
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password: values.password,
          invite_token: token,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(
          data?.message ?? "Registration failed. The invite may have expired."
        );
        return;
      }

      // Auto-set dataspace after registration
      try {
        const meRes = await fetch("/api/auth/me");
        const meData = await meRes.json();
        const me = meData.data ?? meData;
        if (me.dataspaces?.length === 1) {
          await fetch("/api/auth/set-dataspace", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dataspace_id: me.dataspaces[0].id }),
          });
        }
      } catch {
        // Non-fatal — proceed to dashboard
      }

      router.push("/");
    } catch {
      toast.error("An error occurred");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (invalid) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Invalid Invite</CardTitle>
          <CardDescription>
            This invite link is invalid or has expired. Please contact your
            administrator.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Accept Invite</CardTitle>
        <CardDescription>
          Set your password to complete registration.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label>Email</Label>
            <Input value={email ?? ""} disabled className="bg-muted" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              {...register("password")}
              disabled={isSubmitting}
            />
            {errors.password && (
              <p className="text-sm text-destructive">
                {errors.password.message}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              At least 12 characters with uppercase, lowercase, and a digit.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm_password">Confirm Password</Label>
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
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating account...
              </>
            ) : (
              "Create Account"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function InvitePage() {
  return (
    <div className="flex items-center justify-center min-h-full">
      <Suspense fallback={null}>
        <InviteForm />
      </Suspense>
    </div>
  );
}
