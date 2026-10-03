import type { TableStats } from "@/lib/fossil/corpus";

export type { TableStats };

/** One table's columns, by its name: what a rule may check, fossil's own included. */
export const columnsOf = (tables: readonly TableStats[], name: string): string[] =>
  tables.find((t) => t.name === name)?.columns ?? [];
