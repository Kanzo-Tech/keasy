"use client";

import { Suspense } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import useSWR from "swr";

import { loginSchema, type LoginValues } from "@/lib/auth-schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldError } from "@/components/ui/field";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionExpired = searchParams.get("reason") === "session_expired";

  const { data: vcHealth } = useSWR("/api/auth/vc-health", fetcher, {
    refreshInterval: 30000,
    fallbackData: { data: { vc_available: false } },
  });

  const vcAvailable = vcHealth?.data?.vc_available === true;

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: LoginValues): Promise<void> {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });

    if (!res.ok) {
      setError("root", { message: "Invalid email or password" });
      return;
    }

    // Post-login: auto-select dataspace if user has exactly one
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

    const redirectTo = searchParams.get("redirect");
    const destination =
      redirectTo && redirectTo.startsWith("/") ? redirectTo : "/";
    router.push(destination);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-bold tracking-tight">Welcome back</h2>
        <p className="text-sm text-muted-foreground">
          Enter your credentials to continue
        </p>
      </div>

      {sessionExpired && (
        <p className="text-sm text-muted-foreground text-center bg-muted rounded-md p-3">
          Your session has expired. Please log in again.
        </p>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
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
            autoComplete="current-password"
            disabled={isSubmitting}
            aria-invalid={!!errors.password}
            {...register("password")}
          />
          <FieldError errors={[errors.password]} />
        </Field>

        {errors.root && (
          <p className="text-destructive text-sm">{errors.root.message}</p>
        )}

        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Logging in...
            </>
          ) : (
            "Log in"
          )}
        </Button>
      </form>

      <div className="relative my-1">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">Or</span>
        </div>
      </div>

      {vcAvailable ? (
        <Link
          href="/login/vc"
          className="text-sm text-muted-foreground hover:text-primary text-center block"
        >
          Sign in with Verifiable Credentials
        </Link>
      ) : (
        <p className="text-sm text-muted-foreground text-center opacity-60 cursor-not-allowed">
          VC login temporarily unavailable
        </p>
      )}

      <p className="text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link
          href="/register"
          className="text-primary underline-offset-4 hover:underline"
        >
          Register
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  );
}
