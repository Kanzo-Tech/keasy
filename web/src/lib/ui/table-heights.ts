/**
 * How a table scrolls inside itself, its header pinned.
 *
 * One table that is the page (the graphs, the connections) takes the height its section has left
 * under the toolbar and over the pagination, so both stay in view and the rows fill whatever the
 * viewport gives them. It is a flex layout, not a measured height: the root is a column that fills
 * the section's body, the bordered box may shrink, and the table's wrapper, a scroll container,
 * shrinks with it (its automatic minimum is zero) and scrolls. `maxHeight` only keeps that wrapper a
 * scroll container, so the header pins to it and a wide table still scrolls sideways.
 *
 * One table inside a page (a wizard step, a graph's schema) stops where the dashboard's table tile does.
 */
export const PAGE_TABLE = {
  root: "flex min-h-0 flex-1 flex-col",
  content: "flex min-h-0 flex-col",
  maxHeight: "100%",
} as const;
export const PART_TABLE_HEIGHT = "28rem";
