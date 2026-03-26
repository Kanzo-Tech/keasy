import countries from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";

countries.registerLocale(enLocale);

const namesByCode = countries.getNames("en", { select: "official" });

export const COUNTRY_OPTIONS = Object.entries(namesByCode)
  .map(([code, name]) => ({ value: code, label: `${name} (${code})` }))
  .sort((a, b) => a.label.localeCompare(b.label));

export function getCountryName(code: string): string | undefined {
  return countries.getName(code, "en", { select: "official" });
}
