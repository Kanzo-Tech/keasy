import { SectionBody, SectionRoot } from "@kanzo-tech/ui";
import { Dashboard } from "./dashboards";

export default function HomePage() {
  return (
    <SectionRoot>
      <SectionBody className="gap-8" scale="page">
        <Dashboard />
      </SectionBody>
    </SectionRoot>
  );
}
