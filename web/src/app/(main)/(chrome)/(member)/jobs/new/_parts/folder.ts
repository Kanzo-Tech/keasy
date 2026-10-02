/** The server's rule for a folder: `[a-z0-9][a-z0-9-]*`, at most this long. */
const FOLDER_MAX = 63;

/** A name as a folder: lowercase ASCII, every other run of characters one `-`. */
export function folderSlug(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, FOLDER_MAX)
    .replace(/-+$/, "");
  return slug || "job";
}

/** Why the server would refuse `folder`, or `null` when it would not. */
export function folderProblem(folder: string): string | null {
  if (!folder) return "A folder is required.";
  if (folder.length > FOLDER_MAX) return `At most ${FOLDER_MAX} characters.`;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(folder)) {
    return "Lowercase letters, digits and '-', starting with a letter or digit.";
  }
  return null;
}
