import { redirect } from 'next/navigation';
import { getEffectiveRole } from '@/lib/auth-check';

// The data surface (connections, jobs) is for any workspace member. Roles are
// hierarchical, so the owner uses it too — only unauthenticated users are sent
// to log in ("none" is already handled by the parent (main) layout).
export default async function MemberLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const role = await getEffectiveRole();
  if (!role) redirect('/v1/auth/oidc-start');
  return <>{children}</>;
}
