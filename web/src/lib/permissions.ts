import type { Schemas } from "@/lib/api/client";

/**
 * What the server says the caller may do to one object (docs/design/permissions.md): operate it —
 * test a connection or a secret, run a graph — and manage it — change, rename, delete. The web
 * draws what this says and never re-derives it from roles.
 */
export type Can = Schemas["Can"];

/** An object the server answers with what the caller may do to it. */
export interface Permitted {
  can: Can;
  owner: Schemas["Actor"];
  target?: { direction?: string };
}

/**
 * Why `action` on `object` — a `noun` — is denied, or undefined when it is allowed. A denied action
 * is shown disabled with this, not hidden: the person learns who may, as the graph header says it.
 */
export function blocked(object: Permitted, action: keyof Can, noun: string): string | undefined {
  if (object.can[action]) return undefined;
  if (object.target?.direction === "sink") return "Only an admin can test or change the sink";
  if (action === "operate") return `Only an editor can test this ${noun}`;
  if (object.owner.id === "workspace") return `The workspace owns this ${noun}: only an admin can change it`;
  return `Only its owner (${object.owner.name}) or an admin can change this ${noun}`;
}
