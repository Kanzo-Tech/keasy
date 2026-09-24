import { ShieldCheck } from "lucide-react";
import {
  Alert,
  AlertDescription,
  SectionBody,
  SectionDescription,
  SectionHeader,
  SectionRoot,
  SectionTitle,
  SectionTitleGroup,
} from "@kanzo-tech/ui";

export default function SecuritySettingsPage() {
  return (
    <SectionRoot>
      <SectionHeader scale="page">
        <SectionTitleGroup>
          <SectionTitle level={1} scale="page">
            Password & Authentication
          </SectionTitle>
          <SectionDescription>
            Your account is managed by your organization&apos;s identity provider.
          </SectionDescription>
        </SectionTitleGroup>
      </SectionHeader>
      <SectionBody scale="page">
        <Alert>
          <ShieldCheck />
          <AlertDescription>
            To change your password or manage your authentication settings, please contact your
            administrator.
          </AlertDescription>
        </Alert>
      </SectionBody>
    </SectionRoot>
  );
}
