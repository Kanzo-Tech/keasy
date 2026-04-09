import { AwsIcon } from "@/components/icons/brand-icons";
import { defineType } from "@/lib/schemas/field-def";

export const s3Connector = defineType({
  id: "s3",
  name: "Amazon S3",
  description: "AWS S3 bucket",
  icon: AwsIcon,
  fields: {
    bucket:   { label: "Bucket",      required: true, placeholder: "my-data-bucket" },
    region:   { label: "Region",      placeholder: "eu-west-1", description: "AWS region where the bucket is located" },
    endpoint: { label: "Endpoint",    description: "Leave empty for AWS S3. Set for S3-compatible services (MinIO, R2, Wasabi)." },
    prefix:   { label: "Path Prefix", placeholder: "data/raw/", description: "Optional key prefix to scope access within the bucket" },
  },
  auth: {
    methods: {
      default: { label: "Default Credentials" },
      access_keys: {
        label: "Access Keys",
        fields: {
          access_key_id:     { label: "Access Key ID",     required: true, placeholder: "AKIAIOSFODNN7EXAMPLE" },
          secret_access_key: { label: "Secret Access Key", required: true, secret: true },
        },
      },
    },
  },
});
