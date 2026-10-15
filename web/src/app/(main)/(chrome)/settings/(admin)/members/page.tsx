import { ExternalLink, Users } from "lucide-react";
import {
  Button,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
  SectionBody,
  SectionDescription,
  SectionHeader,
  SectionRoot,
  SectionTitle,
  SectionTitleGroup,
} from "@kanzo-tech/ui";
import { organizationConsoleUrl, organizationOf } from "@kanzo-tech/auth";
import { auth, issuer } from "@/lib/auth/server";

/**
 * The organization's settings in Keycloak's admin console; `undefined` when the realm sent the
 * organization without its id.
 */
async function consoleUrl(): Promise<string | undefined> {
  const session = await auth.session({ required: true });
  const organization = organizationOf(session, session.organization ?? "");
  return organization && organizationConsoleUrl(issuer(), organization);
}

export default async function MembersSettingsPage() {
  const url = await consoleUrl();

  return (
    <SectionRoot>
      <SectionBody className="gap-8" scale="page">
        <SectionRoot className="gap-4" fill={false}>
          <SectionHeader>
            <SectionTitleGroup>
              <SectionTitle>Members</SectionTitle>
              <SectionDescription>Who belongs to this workspace, and the role each holds.</SectionDescription>
            </SectionTitleGroup>
          </SectionHeader>
          <SectionBody>
            <Item variant="outline">
              <ItemMedia variant="icon">
                <Users />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>Members are managed in your organization&apos;s identity console.</ItemTitle>
                {url ? null : <ItemDescription>Ask your platform administrator.</ItemDescription>}
              </ItemContent>
              {url ? (
                <ItemActions>
                  <Button asChild size="sm" variant="outline">
                    <a href={url} rel="noopener noreferrer" target="_blank">
                      Open console
                      <ExternalLink />
                    </a>
                  </Button>
                </ItemActions>
              ) : null}
            </Item>
          </SectionBody>
        </SectionRoot>
      </SectionBody>
    </SectionRoot>
  );
}
