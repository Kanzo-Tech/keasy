import { expect, type Page } from "@playwright/test";

import { type Example, rules } from "../seeds";
import { api } from "../stack/api";

/**
 * What keasy's API saves for a graph, written as the page's own editors write it, for a spec or a
 * demo that starts from a configured page rather than configuring it on camera.
 */

/** Saves the dev example's `rules.ttl` as the graph's rules, as dropping it on the rules' badge does. */
export async function saveRules(page: Page, graphId: string, example: Example): Promise<void> {
  const saved = await api(page, "PUT", `/v1/graphs/${graphId}/rules`, { name: `${example}.ttl`, shapes: rules(example) });
  expect(saved.status, JSON.stringify(saved.body)).toBeLessThan(300);
}

/**
 * Saves `spec` as the graph's dashboard for the relation keyed `relationKey` (`"Airport"`,
 * `"Comment>replyOfPost>Post"`), as the Dashboard view's editor does.
 */
export async function saveDashboard(page: Page, graphId: string, relationKey: string, spec: unknown): Promise<void> {
  const saved = await api(page, "PUT", `/v1/graphs/${graphId}/dashboard`, { spec: { byRelation: { [relationKey]: spec } } });
  expect(saved.status, JSON.stringify(saved.body)).toBeLessThan(300);
}
