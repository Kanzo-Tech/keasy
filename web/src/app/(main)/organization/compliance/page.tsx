import { redirect } from "next/navigation";

export default function ComplianceRedirect() {
  redirect("/organization/details");
}
