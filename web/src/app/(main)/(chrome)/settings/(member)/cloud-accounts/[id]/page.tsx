import { AccountForm } from "../_parts/account-form";

export default async function EditCloudAccountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AccountForm accountId={id} />;
}
