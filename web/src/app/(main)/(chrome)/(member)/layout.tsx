import { redirect } from 'next/navigation';
import { getEffectiveRole } from '@/lib/auth-check';

// Member data plane (connections, jobs). Disjoint from the owner's metadata
// plane — the owner has no data surface and is sent back to their home.
export default async function MemberLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const role = await getEffectiveRole();
  if (!role) redirect('/v1/auth/oidc-start');
  if (role !== 'member') redirect('/');
  return <>{children}</>;
}
