"use client";

import { Suspense } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import { registerSchema, type RegisterValues } from "@/lib/auth-schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldError } from "@/components/ui/field";

function RegisterContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tokenFromUrl = searchParams.get("token") ?? "";

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
    defaultValues: {
      name: "",
      email: "",
      password: "",
      invite_token: tokenFromUrl,
    },
  });

  async function onSubmit(values: RegisterValues): Promise<void> {
    // NOTE: backend RegisterRequest does not include name — send only email, password, invite_token
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: values.email,
        password: values.password,
        invite_token: values.invite_token,
      }),
    });

    if (!res.ok) {
      setError("root", {
        message: "Registration failed. Please check your invite token and try again.",
      });
      return;
    }

    // Post-register: auto-select dataspace if user has exactly one
    try {
      const meRes = await fetch("/api/auth/me");
      if (meRes.ok) {
        const meData = await meRes.json();
        const dataspaces = meData?.data?.dataspaces ?? [];
        if (dataspaces.length === 1) {
          await fetch("/api/auth/set-dataspace", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dataspace_id: dataspaces[0].id }),
          });
        }
      }
    } catch {
      // Non-fatal — proceed to dashboard even if auto-select fails
    }

    router.push("/");
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-bold tracking-tight">Create your account</h2>
        <p className="text-sm text-muted-foreground">
          Enter your details to get started
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="name">Name</FieldLabel>
          <Input
            id="name"
            autoComplete="name"
            disabled={isSubmitting}
            aria-invalid={!!errors.name}
            {...register("name")}
          />
          <FieldError errors={[errors.name]} />
        </Field>

        <Field data-invalid={!!errors.email}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            disabled={isSubmitting}
            aria-invalid={!!errors.email}
            {...register("email")}
          />
          <FieldError errors={[errors.email]} />
        </Field>

        <Field data-invalid={!!errors.password}>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            disabled={isSubmitting}
            aria-invalid={!!errors.password}
            {...register("password")}
          />
          <FieldError errors={[errors.password]} />
        </Field>

        <Field data-invalid={!!errors.invite_token}>
          <FieldLabel htmlFor="invite_token">Invite token</FieldLabel>
          <Input
            id="invite_token"
            disabled={isSubmitting || !!tokenFromUrl}
            aria-invalid={!!errors.invite_token}
            {...register("invite_token")}
          />
          <FieldError errors={[errors.invite_token]} />
        </Field>

        {errors.root && (
          <p className="text-destructive text-sm">{errors.root.message}</p>
        )}

        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating account...
            </>
          ) : (
            "Create account"
          )}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href="/login"
          className="text-primary underline-offset-4 hover:underline"
        >
          Log in
        </Link>
      </p>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterContent />
    </Suspense>
  );
}
