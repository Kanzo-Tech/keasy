import type { ComponentType } from "react";
// react-icons 5.6.0 dropped the Simple Icons Amazon/AWS brand glyphs
// (trademark cleanup); the AWS mark now lives in the Font Awesome set.
import { FaAws } from "react-icons/fa";
import { VscAzure } from "react-icons/vsc";
import { Cloud } from "lucide-react";

type Icon = ComponentType<{ className?: string }>;

/** How a credential kind is drawn — the kinds themselves come from the contract. */
const byPrefix: [string, Icon][] = [
  ["s3", FaAws],
  ["azure", VscAzure],
];

export function getProviderIcon(kind: string): Icon {
  return byPrefix.find(([prefix]) => kind.startsWith(prefix))?.[1] ?? Cloud;
}
