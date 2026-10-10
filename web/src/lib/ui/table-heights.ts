/**
 * How tall a table may grow before it scrolls inside itself, its header pinned. One table that is
 * the page (the graphs, the connections) fills the viewport less the page's header, its toolbar
 * and its pagination, so the toolbar above and the pages below stay in view; one table inside a
 * page (a wizard step, a graph's schema) stops where the dashboard's table tile does.
 */
export const PAGE_TABLE_HEIGHT = "calc(100dvh - 16rem)";
export const PART_TABLE_HEIGHT = "28rem";
