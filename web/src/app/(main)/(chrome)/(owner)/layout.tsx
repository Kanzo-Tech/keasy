import { redirect } from "next/navigation";
import { getEffectiveRole } from "@/lib/auth-check";

// Owner plane (metadata + people): Members, Identity, Catalog. Disjoint from the
// member data plane — members are sent to their own home.
export default async function OwnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const role = await getEffectiveRole();
  if (!role) redirect("/v1/auth/oidc-start");
  if (role !== "owner") redirect("/");
  return <>{children}</>;
}
