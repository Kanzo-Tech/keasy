import { AuthProblem } from "./auth-problem";

/**
 * Where a sign-in that failed lands: the auth callback redirects here with the `AuthError`'s code
 * in `?code=`, and `(main)/layout.tsx` does with `session/store-unavailable`. Outside `(main)`, so it
 * needs no session, and public in `proxy.ts`, so an anonymous browser is not sent round again.
 */
export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  const { code } = await searchParams;
  const named = (Array.isArray(code) ? code[0] : code) ?? "auth/unknown";
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <AuthProblem code={named} />
    </main>
  );
}
