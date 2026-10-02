import type { FieldStats } from "@kanzo-tech/ui/analytics";

/** A vertex table's `SUMMARIZE`: its fields a chart or a suggestion may name, and every column a rule may check. */
export type TableStats = FieldStats & { name: string };

/** One table's columns, by its name: what a rule may check, fossil's own included. */
export const columnsOf = (tables: readonly TableStats[], name: string): string[] =>
  tables.find((t) => t.name === name)?.columns ?? [];
