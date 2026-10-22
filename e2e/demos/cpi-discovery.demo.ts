import { expect, type Page } from "@playwright/test";
import { TimelineHarness } from "@kanzo-tech/testing";

import { DiscoverPage, saveDashboard, saveRules } from "../support/app";
import { seedGraph } from "../support/seeds";
import { demo } from "./record";

/**
 * CPI España, 15 proyectos: todo Discover en una toma, sobre el grafo del cliente. LOCAL: ni este
 * fichero ni infra/dev/examples/cpi/ van a git (.git/info/exclude). Las cifras salen de los JSON
 * que convert.py deriva del TTL, comprobadas con DuckDB y en la página.
 */
const THEMES = "CPIProject>hasTheme>ThematicArea";
const DASHBOARD = {
  filters: [],
  tiles: [{ id: "theme", kind: "chart", span: 2, type: "bar", x: "hasTheme.label", y: { op: "count" } }],
};

/** Va a un vértice desde la paleta de búsqueda: `type:<Tipo>` como chip, luego el texto, Enter. */
async function goTo(page: Page, type: string, text: string) {
  await page.getByRole("button", { name: /Find anything in the graph/ }).click();
  const box = page.getByRole("combobox", { name: "Find anything in the graph…" });
  await box.pressSequentially(`type:${type} `, { delay: 60 });
  await page.waitForTimeout(600);
  await page.keyboard.type(text, { delay: 60 });
  await expect(page.getByRole("option")).toHaveCount(1, { timeout: 30_000 });
  await page.keyboard.press("Enter");
}

/** «Clear every filter», el embudo del final de la barra. */
const clearAll = (page: Page) => page.getByRole("button", { name: /Clear every filter/i }).click();

demo("cpi-discovery", "CPI España, 15 proyectos: grafo, búsqueda, ficha, cuadro de mando, crossfilter, línea de tiempo y reglas SHACL", {
  async arrange({ page, env }) {
    const id = await seedGraph(page, "cpi", { name: "CPI España · 15 proyectos" });
    await saveRules(page, id, "cpi");
    await saveDashboard(page, id, THEMES, DASHBOARD);
    const discover = await DiscoverPage.open(page, env, id);
    const graph = await discover.graph();
    await graph.ready();
    await graph.pause();
    const settings = await discover.settings();
    await settings.marks("Legible");
    await settings.edges("Straight");
    await settings.labels("None");
    await settings.backdrop({ vignette: true, grid: true });
    await discover.panel("Info");
    const timeline = () => env.getHarness(TimelineHarness.with({ title: /^Timeline: / }));
    return { discover, graph, settings, timeline, bar: await discover.filters(), rules: await discover.rules() };
  },

  steps: ({ discover, graph, settings, timeline, bar, rules }, { page }) => [
    // ── El grafo ──────────────────────────────────────────────────────────
    {
      subtitle: "15 proyectos de CPI: 5.449 nodos y 9.034 relaciones",
      action: () => graph.run(),
      check: async () => expect(await discover.counts()).toMatch(/5\.4K nodes · 9K edges/),
    },
    {
      subtitle: "Agrupa el grafo en comunidades",
      async action() {
        await discover.panel("Settings");
        await settings.placement("Clustered");
        await settings.edges("Hidden");
        await graph.run();
        await page.waitForTimeout(6_000);
        await graph.pause();
        await discover.panel("Info");
      },
      check: async () => expect(await discover.kept()).toBe("5,449"),
    },
    {
      subtitle: "Busca un proyecto y abre su ficha: SENDA",
      action: () => goTo(page, "CPIProject", "senda"),
      check: async () =>
        expect(page.getByRole("complementary", { name: "Info panel" })).toContainText(/SENDA/, { timeout: 30_000 }),
      poster: true,
    },
    {
      subtitle: "Busca en todo el grafo: «inteligencia»",
      async action() {
        await bar.remove("Node");
        const search = await discover.search();
        // La paleta recuerda el chip type:CPIProject de antes: fuera, con Retroceso.
        await page.getByRole("button", { name: /Find anything in the graph/ }).click();
        const box = page.getByRole("combobox", { name: "Find anything in the graph…" });
        await box.fill("");
        await page.getByRole("dialog").locator('[data-part="item-delete-trigger"]').first().click();
        await expect(page.getByRole("dialog").getByText("type:CPIProject")).toHaveCount(0);
        await search.add("label:inteligencia", 37);
      },
      check: () => expect.poll(() => discover.kept()).toBe("37"),
    },
    {
      subtitle: "37 nodos de 15 tipos distintos: encuádralos",
      action: () => graph.frame(),
      check: () => expect.poll(() => discover.kept()).toBe("37"),
    },
    // ── El cuadro de mando y el crossfilter ─────────────────────────────────
    {
      subtitle: "Cuadro de mando: proyectos por área temática",
      async action() {
        await clearAll(page);
        await discover.view("Dashboard");
        await discover.relation("CPIProject", [">hasTheme>ThematicArea"]);
      },
      check: async () => void (await (await discover.dashboard()).tile("Count by hasTheme.label")),
    },
    {
      subtitle: "Pulsa una barra: Inteligencia Artificial",
      action: async () => (await (await (await discover.dashboard()).tile("Count by hasTheme.label")).chart()).pick({ y: "Inteligencia Artificial" }),
      check: () => expect.poll(() => discover.kept()).toBe("5"),
    },
    {
      subtitle: "El mismo filtro en el grafo: los 5 proyectos de IA",
      async action() {
        await discover.view("Graph");
        await graph.ready();
        await graph.frame();
      },
      check: () => expect.poll(() => discover.kept()).toBe("5"),
    },
    {
      subtitle: "Cada fase del expediente: consulta, licitación, adjudicación",
      async action() {
        await bar.remove("hasTheme.label");
        await discover.view("Dashboard");
        await discover.relation("Phase");
      },
      check: async () => void (await (await discover.dashboard()).tile("Count by kind")),
    },
    {
      subtitle: "Solo las adjudicaciones",
      action: async () => (await (await (await discover.dashboard()).tile("Count by kind")).chart()).pick({ y: "Adjudicación" }),
      check: () => expect.poll(() => discover.kept()).toBe("19"),
    },
    {
      subtitle: "Arrastra en el tiempo: adjudicadas desde 2022",
      action: async () =>
        (await (await (await discover.dashboard()).tile("Count by awardDate")).chart()).brush({ x: [new Date("2022-01-01"), new Date("2026-06-01")] }),
      check: () => expect.poll(() => discover.kept()).toMatch(/^(8|9)$/),
    },
    // ── La línea de tiempo ─────────────────────────────────────────────────
    {
      subtitle: "Línea de tiempo: cada fase en su fecha de publicación",
      async action() {
        await clearAll(page);
        await discover.view("Graph");
        await graph.ready();
        await discover.panel("Settings");
        await settings.timeline("publicationDate");
        await discover.panel("Info");
      },
      check: async () => expect(await (await timeline()).range()).toBeNull(),
    },
    {
      subtitle: "Reprodúcelas de 2017 a 2024",
      async action() {
        const t = await timeline();
        await t.brush([new Date("2017-09-10"), new Date("2024-11-10")]);
        await t.play();
        await page.waitForTimeout(15_000);
        await t.pause();
      },
      check: async () => expect(Number(await discover.kept())).toBeGreaterThan(0),
    },
    {
      subtitle: "2021–2022: el pico de actividad",
      async action() {
        await bar.remove("publicationDate");
        await (await timeline()).brush([new Date("2021-01-01"), new Date("2022-12-31")]);
        await graph.frame();
      },
      check: async () => expect(Number(await discover.kept())).toBeGreaterThan(0),
    },
    // ── Las reglas ─────────────────────────────────────────────────────────
    {
      subtitle: "Reglas SHACL: comprueba el grafo entero",
      async action() {
        await clearAll(page);
        await (await discover.dock()).close();
        expect(await rules.check()).toBe("All 5,449 nodes checked · 5,330 conform");
      },
      check: async () => expect(await (await rules.rule("AwardCriterion")).state()).toBe("31 violations · 26 warnings"),
    },
    {
      subtitle: "55 criterios de adjudicación incumplen una regla",
      async action() {
        await (await rules.rule("AwardCriterion")).showAll();
        await graph.frame();
      },
      check: () => expect.poll(() => discover.kept()).toBe("55"),
    },
    {
      subtitle: "31 no declaran su ponderación",
      action: async () => (await rules.rule("AwardCriterion")).show(/ponderación/),
      check: () => expect.poll(() => discover.kept()).toBe("31"),
    },
    {
      subtitle: "Quédate con lo que cumple: 349 de las 468 entidades",
      action: () => rules.conforms(),
      // Lo que se queda son los sujetos que rudof da por conformes: 15 proyectos, 186 criterios y
      // 267 organizaciones revisados, menos los 119 señalados.
      check: () => expect.poll(() => discover.kept()).toBe("349"),
    },
  ],
});
