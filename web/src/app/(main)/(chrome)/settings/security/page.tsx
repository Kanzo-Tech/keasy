import { ExternalLink } from "lucide-react";
import {
  Button,
  SectionBody,
  SectionDescription,
  SectionHeader,
  SectionRoot,
  SectionTitle,
  SectionTitleGroup,
} from "@kanzo-tech/ui";
import { accountConsoleUrl } from "@/lib/auth/server";

export default function SecuritySettingsPage() {
  return (
    <SectionRoot>
      <SectionHeader scale="page">
        <SectionTitleGroup>
          <SectionTitle level={1} scale="page">
            Security
          </SectionTitle>
          <SectionDescription>
            Sign-in, password and sessions are managed by your identity provider, not by Keasy.
          </SectionDescription>
        </SectionTitleGroup>
      </SectionHeader>
      <SectionBody scale="page">
        <div>
          <Button asChild variant="outline">
            <a href={accountConsoleUrl()} rel="noopener noreferrer" target="_blank">
              Manage account
              <ExternalLink />
            </a>
          </Button>
        </div>
      </SectionBody>
    </SectionRoot>
  );
}
