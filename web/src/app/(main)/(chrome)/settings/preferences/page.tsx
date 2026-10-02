import {
  PreferencesSections,
  SectionBody,
  SectionDescription,
  SectionHeader,
  SectionRoot,
  SectionTitle,
  SectionTitleGroup,
} from "@kanzo-tech/ui";

// Each control is wired straight to `KanzoThemeProvider`: no keasy state, no round trip. Radius and
// typefaces are the theme's, so there is nothing to choose for them here. The graph's own settings
// are not here either: they are in Discovery's Settings panel, beside the canvas they change.
const SECTIONS = [
  {
    title: "Appearance",
    description: "Control the look and feel of the interface.",
    body: <PreferencesSections namespace="theme" only={["appearance"]} />,
  },
  {
    title: "Density",
    description: "How compact the interface is: the scale everything else is measured against.",
    body: <PreferencesSections namespace="theme" only={["density"]} />,
  },
];

export default function PreferencesPage() {
  return (
    <SectionRoot>
      <SectionBody className="gap-8" scale="page">
        {SECTIONS.map((section) => (
          <SectionRoot className="gap-4" fill={false} key={section.title}>
            <SectionHeader>
              <SectionTitleGroup>
                <SectionTitle>{section.title}</SectionTitle>
                <SectionDescription>{section.description}</SectionDescription>
              </SectionTitleGroup>
            </SectionHeader>
            <SectionBody>{section.body}</SectionBody>
          </SectionRoot>
        ))}
      </SectionBody>
    </SectionRoot>
  );
}
