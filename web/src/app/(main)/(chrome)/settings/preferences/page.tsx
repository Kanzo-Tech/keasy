import {
  PreferencesDensity,
  PreferencesFont,
  PreferencesMonoFont,
  SectionBody,
  SectionDescription,
  SectionHeader,
  SectionRoot,
  SectionTitle,
  SectionTitleGroup,
  ThemePicker,
} from "@kanzo-tech/ui";

// Each control is wired straight to `KanzoThemeProvider`: no keasy state, no round trip. The graph's
// own settings are not here: they are in Discovery's Settings panel, beside the canvas they change.
const SECTIONS = [
  {
    title: "Appearance",
    description: "Control the look and feel of the interface.",
    body: <ThemePicker />,
  },
  {
    title: "Density",
    description: "How compact the interface is: the scale everything else is measured against.",
    body: <PreferencesDensity />,
  },
  {
    title: "Typography",
    description: "Choose fonts for the interface and for code.",
    body: (
      <>
        <PreferencesFont />
        <PreferencesMonoFont />
      </>
    ),
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
