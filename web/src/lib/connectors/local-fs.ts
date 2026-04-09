import { HardDrive } from "lucide-react";
import { defineType } from "@/lib/schemas/field-def";

export const localFsConnector = defineType({
  id: "local_fs",
  name: "Local Filesystem",
  description: "Local directory",
  icon: HardDrive,
  fields: {
    base_path: { label: "Base Path", required: true, placeholder: "/data/uploads", description: "Absolute path to the directory" },
  },
});
