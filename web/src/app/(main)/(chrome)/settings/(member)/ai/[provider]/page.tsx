import { ProviderForm } from "../_parts/provider-form";

export default async function EditAiProviderPage({
  params,
}: {
  params: Promise<{ provider: string }>;
}) {
  const { provider } = await params;
  return <ProviderForm providerId={provider} />;
}
