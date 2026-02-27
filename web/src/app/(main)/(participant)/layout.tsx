import { redirect } from 'next/navigation';
import { getEffectiveRole } from '@/lib/auth-check';

export default async function ParticipantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const role = await getEffectiveRole();

  if (role === 'promotor') {
    redirect('/participants?redirected=1');
  }

  if (!role) {
    redirect('/login');
  }

  return <>{children}</>;
}
