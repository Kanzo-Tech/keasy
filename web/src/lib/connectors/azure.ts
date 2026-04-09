import { AzureIcon } from "@/components/icons/brand-icons";
import { defineType } from "@/lib/schemas/field-def";

export const azureConnector = defineType({
  id: "azure_blob",
  name: "Azure Blob Storage",
  description: "Azure Blob container",
  icon: AzureIcon,
  fields: {
    account_name: { label: "Account Name", required: true, placeholder: "mystorageaccount", description: "Azure storage account name" },
    container:    { label: "Container",    required: true, placeholder: "my-container", description: "Blob container name" },
    prefix:       { label: "Path Prefix",  placeholder: "data/raw/", description: "Optional blob prefix to scope access within the container" },
  },
  auth: {
    methods: {
      account_key: {
        label: "Account Key",
        fields: {
          access_key: { label: "Account Key", required: true, secret: true, description: "Azure storage account access key" },
        },
      },
      sas_token: {
        label: "SAS Token",
        fields: {
          sas_token: { label: "SAS Token", required: true, secret: true, description: "Shared Access Signature token" },
        },
      },
    },
  },
});
