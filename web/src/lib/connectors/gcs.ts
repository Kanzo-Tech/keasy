import { GoogleCloudIcon } from "@/components/icons/brand-icons";
import { defineType } from "@/lib/schemas/field-def";

export const gcsConnector = defineType({
  id: "gcs",
  name: "Google Cloud Storage",
  description: "GCS bucket",
  icon: GoogleCloudIcon,
  fields: {
    bucket: { label: "Bucket", required: true, placeholder: "my-gcs-bucket" },
    prefix: { label: "Path Prefix", placeholder: "data/raw/", description: "Optional object prefix to scope access within the bucket" },
  },
  auth: {
    methods: {
      default: { label: "Default Credentials" },
      service_account: {
        label: "Service Account",
        fields: {
          service_account_json: { label: "Service Account JSON", required: true, secret: true, type: "textarea", description: "GCP service account key in JSON format" },
        },
      },
    },
  },
});
