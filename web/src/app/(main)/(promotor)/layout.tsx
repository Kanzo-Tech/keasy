import { redirect } from 'next/navigation';
import { getEffectiveRole } from '@/lib/auth-check';

export default async function PromotorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const role = await getEffectiveRole();

  if (role !== 'promotor') {
    redirect(role ? '/connections?redirected=1' : '/v1/auth/oidc-start');
  }

  return <>{children}</>;
}
