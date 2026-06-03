import { redirect } from 'next/navigation';
import { getEffectiveRole } from '@/lib/auth-check';

export default async function OwnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const role = await getEffectiveRole();

  if (role !== 'owner') {
    redirect(role ? '/?redirected=1' : '/v1/auth/oidc-start');
  }

  return <>{children}</>;
}
