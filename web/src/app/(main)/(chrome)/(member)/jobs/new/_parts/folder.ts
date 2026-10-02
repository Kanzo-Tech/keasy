import { stringProblem, stringRule } from "@/lib/api/spec";

/** The server's rule for a folder, as the contract publishes it (`JobFolder`). */
const rule = stringRule("JobFolder");

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
  return slug || "job";
}

/** Why the server would refuse `folder`, or `null` when it would not. */
export function folderProblem(folder: string): string | null {
  return stringProblem(rule, folder, "Lowercase letters, digits and '-', starting with a letter or digit.");
}
