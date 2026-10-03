import { ExternalLink, KeyRound, MonitorSmartphone } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  Button,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  SectionBody,
  SectionDescription,
  SectionHeader,
  SectionRoot,
  SectionTitle,
  SectionTitleGroup,
} from "@kanzo-tech/ui";
import { type AccountPage, accountUrl } from "@kanzo-tech/auth";
import { getSession, issuer } from "@/lib/auth/server";
import { initials } from "@/lib/ui/format";

// Keasy keeps no password and no session list of its own: each row opens the page of Keycloak's
// account console that does the thing, in a new tab.
const SIGN_IN: { page: AccountPage; title: string; description: string; action: string; icon: typeof KeyRound }[] = [
  {
    page: "account-security/signing-in",
    title: "Password and two-factor",
    description: "Change your password, or set up an authenticator app as a second step when you sign in.",
    action: "Signing in",
    icon: KeyRound,
  },
  {
    page: "account-security/device-activity",
    title: "Devices and sessions",
    description: "See where you are signed in, and sign out of the devices you no longer use.",
    action: "Device activity",
    icon: MonitorSmartphone,
  },
];

function ConsoleLink({ page, children }: { page: AccountPage; children: React.ReactNode }) {
  return (
    <Button asChild size="sm" variant="outline">
      <a href={accountUrl(issuer(), page)} rel="noopener noreferrer" target="_blank">
        {children}
        <ExternalLink />
      </a>
    </Button>
  );
}

export default async function SecuritySettingsPage() {
  const user = (await getSession())?.user;
  const name = user?.name ?? user?.username ?? user?.email ?? "";

  return (
    <SectionRoot>
      <SectionBody className="gap-8" scale="page">
        <SectionRoot className="gap-4" fill={false}>
          <SectionHeader>
            <SectionTitleGroup>
              <SectionTitle>Account</SectionTitle>
              <SectionDescription>
                The identity you sign in to Keasy with. Your identity provider keeps it, not Keasy.
              </SectionDescription>
            </SectionTitleGroup>
          </SectionHeader>
          <SectionBody>
            <Item variant="outline">
              <ItemMedia>
                <Avatar>
                  <AvatarFallback>{initials(name)}</AvatarFallback>
                </Avatar>
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{name}</ItemTitle>
                {user?.email && user.email !== name ? <ItemDescription>{user.email}</ItemDescription> : null}
              </ItemContent>
              <ItemActions>
                <ConsoleLink page="">Personal info</ConsoleLink>
              </ItemActions>
            </Item>
          </SectionBody>
        </SectionRoot>

        <SectionRoot className="gap-4" fill={false}>
          <SectionHeader>
            <SectionTitleGroup>
              <SectionTitle>Sign-in and sessions</SectionTitle>
              <SectionDescription>
                Managed in your identity provider&apos;s account console. Each opens it in a new tab.
              </SectionDescription>
            </SectionTitleGroup>
          </SectionHeader>
          <SectionBody>
            <ItemGroup className="gap-2">
              {SIGN_IN.map((row) => (
                <Item key={row.page} variant="outline">
                  <ItemMedia variant="icon">
                    <row.icon />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{row.title}</ItemTitle>
                    <ItemDescription>{row.description}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <ConsoleLink page={row.page}>{row.action}</ConsoleLink>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          </SectionBody>
        </SectionRoot>
      </SectionBody>
    </SectionRoot>
  );
}
