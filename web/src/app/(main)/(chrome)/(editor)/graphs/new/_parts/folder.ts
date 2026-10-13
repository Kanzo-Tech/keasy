import { stringProblem, stringRule } from "@/lib/api/spec";

/** The server's rule for a folder, as the contract publishes it (`GraphFolder`). */
const rule = stringRule("GraphFolder");

export const FOLDER_MAX = rule.maxLength;

/** A name as a folder: lowercase ASCII, every other run of characters one `-`. */
export function folderSlug(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, FOLDER_MAX)
    .replace(/-+$/, "");
  return slug || "graph";
}

/** A folder for `name` no other graph has: its slug and a few random characters. */
export function freshFolder(name: string, random: () => number = Math.random): string {
  const tail = random().toString(36).slice(2, 8).padEnd(6, "0");
  return `${folderSlug(name).slice(0, FOLDER_MAX - tail.length - 1).replace(/-+$/, "")}-${tail}`;
}

/** Why the server would refuse `folder`, or `null` when it would not. */
export function folderProblem(folder: string): string | null {
  return stringProblem(rule, folder, "Lowercase letters, digits and '-', starting with a letter or digit.");
}
