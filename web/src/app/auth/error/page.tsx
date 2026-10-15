import { AuthProblem } from "./auth-problem";

/**
 * Where a session that could not be read lands: `auth.session({ required: true })` redirects here
 * with the problem's code in `?code=` (`problemPage`) — a forwarded token that did not verify, or the
 * realm's keys not answering. Outside `(main)`, so it reads no session.
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
