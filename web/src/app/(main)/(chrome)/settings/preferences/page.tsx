import {
  PreferencesColor,
  PreferencesDensity,
  PreferencesFont,
  PreferencesMonoFont,
  PreferencesRadius,
  PreferencesSections,
  SectionBody,
  SectionDescription,
  SectionHeader,
  SectionRoot,
  SectionTitle,
  SectionTitleGroup,
} from "@kanzo-tech/ui";

// Each control is wired straight to `KanzoThemeProvider`: no keasy state, no round trip.
const SECTIONS = [
  {
    title: "Appearance",
    description: "Control the look and feel of the interface.",
    body: <PreferencesColor />,
  },
  {
    title: "Shape and density",
    description: "Corner radius and the scale everything else is measured against.",
    body: (
      <>
        <PreferencesRadius />
        <PreferencesDensity />
      </>
    ),
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
  {
    // What the installed packages contribute — today `GRAPH_SECTION`.
    title: "Graph",
    description: "How the discovery canvas draws, and how hard its simulation pulls.",
    body: <PreferencesSections />,
  },
];

export default function PreferencesPage() {
  return (
    <SectionRoot>
      <SectionBody className="gap-8" scale="page">
        {SECTIONS.map((section) => (
          <section className="space-y-4" key={section.title}>
            <SectionHeader>
              <SectionTitleGroup>
                <SectionTitle>{section.title}</SectionTitle>
                <SectionDescription>{section.description}</SectionDescription>
              </SectionTitleGroup>
            </SectionHeader>
            {section.body}
          </section>
        ))}
      </SectionBody>
    </SectionRoot>
  );
}
