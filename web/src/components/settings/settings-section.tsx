import {
  SectionActions,
  SectionBody,
  SectionDescription,
  SectionHeader,
  SectionRoot,
  SectionTitle,
  SectionTitleGroup,
} from "@kanzo-tech/ui";

interface SettingsSectionProps {
  title: React.ReactNode;
  description?: string;
  children: React.ReactNode;
  /** End-aligned controls on the header row. */
  actions?: React.ReactNode;
}

/**
 * A settings block, assembled from the design system's Section parts.
 *
 * What keasy still owns here is the stacking, and only that. `SectionRoot` and `SectionBody`
 * are sized to fill a shell region — one Section per region — while these pages put two or
 * three inside a scrolling `PageShell.Content`, so each has to take its content's height
 * rather than a share of the page's. The override lives here once instead of at every site.
 */
export function SettingsSection({
  title,
  description,
  children,
  actions,
}: SettingsSectionProps) {
  return (
    <SectionRoot className="flex-none gap-4">
      <SectionHeader>
        <SectionTitleGroup>
          <SectionTitle>{title}</SectionTitle>
          {description && <SectionDescription>{description}</SectionDescription>}
        </SectionTitleGroup>
        {actions && <SectionActions>{actions}</SectionActions>}
      </SectionHeader>
      <SectionBody className="flex-none overflow-visible">{children}</SectionBody>
    </SectionRoot>
  );
}
