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
import { organizationOf } from "@kanzo-tech/auth";
import { auth, issuer } from "@/lib/auth/server";

/**
 * The organization's console, from `KEASY_ORG_ADMIN_URL` with `{issuer_origin}`, `{alias}` and
 * `{id}` filled in; `undefined` when the deployment names none.
 */
async function consoleUrl(): Promise<string | undefined> {
  const template = process.env.KEASY_ORG_ADMIN_URL?.trim();
  if (!template) return undefined;
  const session = await auth.session({ required: true });
  const alias = session.organization ?? "";
  const values: Record<string, string> = {
    issuer_origin: new URL(issuer()).origin,
    alias: encodeURIComponent(alias),
    id: encodeURIComponent(organizationOf(session, alias)?.id ?? ""),
  };
  return template.replace(/\{(issuer_origin|alias|id)\}/g, (_, key: string) => values[key]);
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
