/** How a name in the data is said to the person: `birth_date` → "birth date", `LaureateAward` → "laureate award". */
export function spoken(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .trim()
    .toLowerCase();
}

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
