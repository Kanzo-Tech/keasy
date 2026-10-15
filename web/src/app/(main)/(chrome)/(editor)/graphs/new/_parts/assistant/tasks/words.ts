import { splitWords } from "@kanzo-tech/mosaic";

/** "a laureate", "an award". */
export const withArticle = (words: string) => `${/^[aeiou]/i.test(words) ? "an" : "a"} ${words}`;

/** A noun's plural, as English mostly makes it. */
export function plural(noun: string): string {
  if (/[^aeiou]y$/i.test(noun)) return `${noun.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(noun)) return `${noun}es`;
  return `${noun}s`;
}

/** A plural noun's singular: `affiliations` → `affiliation`. */
export function singular(noun: string): string {
  if (/ies$/i.test(noun)) return `${noun.slice(0, -3)}y`;
  if (/(ss|us|is)$/i.test(noun)) return noun;
  if (/(xes|ches|shes|sses)$/i.test(noun)) return noun.slice(0, -2);
  return noun.replace(/s$/i, "");
}

/** `nobel affiliations` → `NobelAffiliations`. */
export function pascal(words: string): string {
  return words
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join("");
}

/** `Laureate` → `laureate`. */
export const camel = (name: string) => (name ? name[0]!.toLowerCase() + name.slice(1) : name);

const list = new Intl.ListFormat("en-GB", { type: "conjunction" });

/** "a, b and c". */
export const listed = (items: readonly string[]) => list.format(items);

const NUMBERS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** "two things to decide": the count in words while it is small, as a sentence says it. */
export function inWords(n: number, noun: string, many = plural(noun)): string {
  return `${NUMBERS[n] ?? n} ${n === 1 ? noun : many}`;
}

/**
 * What each one of a thing holds, from its columns: "name, gender, birth date and 4 more". Column
 * names are the data's own words, so they are said (`birth_date` → "birth date", by mosaic's `splitWords`) and not renamed.
 */
export function holdsLine(holds: readonly string[], shown = 4): string | null {
  if (holds.length === 0) return null;
  const words = holds.map(splitWords);
  if (words.length <= shown + 1) return listed(words);
  return `${words.slice(0, shown).join(", ")} and ${words.length - shown} more`;
}

/** "nobel_laureates.csv" → "Nobel laureates": a file's name as a thing's, until `model` names it. */
export function thingName(file: string): string {
  const words = splitWords(file.replace(/\.[^.]*$/, ""));
  return words ? words[0]!.toUpperCase() + words.slice(1) : file;
}
