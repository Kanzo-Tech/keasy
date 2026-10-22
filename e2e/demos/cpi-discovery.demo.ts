import { expect, type Page } from "@playwright/test";
import { type ModelTurn, RelationPickerHarness, TimelineHarness } from "@kanzo-tech/testing";

import { DiscoverPage, saveRules } from "../support/app";
import { scriptModel } from "../support/model";
import { seedGraph } from "../support/seeds";
import { api } from "../support/stack/api";
import { demo } from "./record";

/**
 * CPI España, 15 proyectos: todo Discover en una toma, contado como lo usaría un comprador público
 * que prepara su propia CPI — qué hay, dónde aparece la IA, cómo se relaciona, cuándo pasó, qué
 * responde a una pregunta y qué falla. Las cifras salen de los JSON que convert.py deriva del TTL
 * (GUION.md tiene cada una), comprobadas con DuckDB y en la página.
 *
 * El modelo de Ask es un doble (`support/model.ts`), como en nobel-ask: responde a cada pregunta con
 * la especificación que daría un buen modelo, y lo demás es de la página — la relación que necesita
 * cada respuesta, las filas (DuckDB) y el filtro.
 */

/** Los dos cuadros de mando, guardados: el de proyectos por área y el de fases con *kind* arriba. */
const DASHBOARDS = {
  "CPIProject>hasTheme>ThematicArea": {
    filters: [],
    tiles: [{ id: "theme", kind: "chart", span: 2, type: "bar", x: "hasTheme.label", y: { op: "count" } }],
  },
  Phase: {
    filters: [],
    tiles: [
      { id: "kind", kind: "chart", span: 1, type: "bar", x: "kind", y: { op: "count" } },
      { id: "award", kind: "chart", span: 2, type: "line", x: "awardDate", y: { op: "count" } },
    ],
  },
};

const TECH = "¿Qué tecnologías piden más las soluciones?";
const MONEY = "¿Quién se lleva más importe adjudicado?";
const TURNS: ModelTurn[] = [
  {
    when: `Question: ${MONEY}`,
    reply: {
      text: JSON.stringify({
        spec: {
          of: "ProcedureParticipation",
          show: { kind: "chart", type: "bar", x: "participatingOrganization.label", y: { op: "sum", field: "awardedAmount" } },
          top: 8,
        },
      }),
    },
  },
  {
    when: `Question: ${TECH}`,
    reply: { text: JSON.stringify({ spec: { of: "SolutionSpecification", show: { kind: "chart", type: "bar", x: "requiresTechnology.label", y: { op: "count" } }, top: 8 } }) },
  },
];

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

/** «Clear every filter», el embudo del final de la barra, si hay algo que quitar. */
async function clearAll(page: Page) {
  const button = page.getByRole("button", { name: /Clear every filter/i });
  if (await button.isEnabled().catch(() => false)) await button.click();
}

/** El año en que acaba la ventana de la línea de tiempo; NaN sin ventana. */
const end = async (timeline: TimelineHarness) => Number((await timeline.range())?.slice(-4) ?? Number.NaN);

const number = (text: string) => Number(text.replace(/,/g, ""));

demo("cpi-discovery", "CPI España, 15 proyectos: grafo, búsqueda, ficha, relaciones, crossfilter, tiempo, Ask y reglas SHACL", {
  async arrange({ page, env }) {
    // Sin GPU, teclear en el composer con una respuesta ya dibujada pasa de los 30 s por acción.
    page.setDefaultTimeout(120_000);
    await scriptModel(page, { turns: TURNS });
    const id = await seedGraph(page, "cpi", { name: "CPI España · 15 proyectos" });
    await saveRules(page, id, "cpi");
    await api(page).PUT("/v1/graphs/{id}/dashboard", { params: { path: { id } }, body: { spec: { byRelation: DASHBOARDS } } });
    const discover = await DiscoverPage.open(page, env, id);
    const graph = await discover.graph();
    await graph.ready();
    // El grafo agrupado por comunidades y asentado antes de grabar: en cámara no se espera al layout.
    const settings = await discover.settings();
    await settings.marks("Legible");
    await settings.edges("Hidden");
    await settings.labels("None");
    await settings.backdrop({ vignette: true, grid: true });
    await settings.placement("Clustered");
    await graph.run();
    await page.waitForTimeout(Number(process.env.CPI_SETTLE ?? 60_000));
    await graph.pause();
    await graph.frame();
    // El modelo cargado antes de la toma.
    await (await discover.ask()).warmUp();
    await discover.panel("Info");
    const timeline = () => env.getHarness(TimelineHarness.with({ title: /^Timeline: / }));
    const picker = () => env.getHarness(RelationPickerHarness);
    return { discover, graph, settings, timeline, picker, bar: await discover.filters(), rules: await discover.rules() };
  },

  steps: ({ discover, graph, settings, timeline, picker, bar, rules }, { page }) => {
    const tile = async (title: string) => (await discover.dashboard()).tile(title);
    return [
      // ── 1. Qué hay ─────────────────────────────────────────────────────────
      {
        subtitle: "15 proyectos de Compra Pública de Innovación, en un grafo",
        check: async () => expect(await discover.counts()).toMatch(/5\.4K nodes · 9K edges/),
      },
      {
        subtitle: "Retos, requisitos, criterios, ofertas: 5.449 piezas enlazadas",
        action: () => page.getByText("CPIProject", { exact: true }).first().hover(),
        check: async () => expect(await discover.kept()).toBe("5,449"),
      },
      // ── 2. Encontrar ───────────────────────────────────────────────────────
      {
        subtitle: "Abre un proyecto: SENDA, diagnóstico médico en la nube",
        action: () => goTo(page, "CPIProject", "senda"),
        check: async () => expect(page.getByRole("complementary", { name: "Info panel" })).toContainText(/SENDA/, { timeout: 30_000 }),
        poster: true,
      },
      {
        subtitle: "¿Dónde piden inteligencia artificial los 15 expedientes?",
        async action() {
          await bar.remove("Node");
          const search = await discover.search();
          // La paleta recuerda el chip type:CPIProject de antes: fuera.
          await page.getByRole("button", { name: /Find anything in the graph/ }).click();
          await page.getByRole("combobox", { name: "Find anything in the graph…" }).fill("");
          await page.getByRole("dialog").locator('[data-part="item-delete-trigger"]').first().click();
          await search.add("label:inteligencia", 37);
        },
        check: () => expect.poll(() => discover.kept()).toBe("37"),
      },
      {
        subtitle: "En 37 sitios: requisitos, criterios, objetivos, soluciones…",
        action: () => graph.frame(),
        check: () => expect.poll(() => discover.kept()).toBe("37"),
      },
      // ── 3. Relacionar ──────────────────────────────────────────────────────
      {
        subtitle: "Cuadro de mando: una fila por proyecto",
        async action() {
          await clearAll(page);
          await discover.view("Dashboard");
          await (await picker()).pick("CPIProject");
        },
        check: () => expect.poll(() => discover.kept()).toBe("15"),
      },
      {
        subtitle: "Relaciona tablas: cada proyecto con su área temática",
        action: async () => (await picker()).add(">hasTheme>ThematicArea"),
        check: async () => void (await tile("Count by hasTheme.label")),
      },
      {
        subtitle: "La IA es el área más repetida: pulsa la barra",
        action: async () => (await (await tile("Count by hasTheme.label")).chart()).pick({ y: "Inteligencia Artificial" }),
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
      // ── 4. Cuándo ──────────────────────────────────────────────────────────
      {
        subtitle: "Cada expediente pasa por fases: consulta, licitación, adjudicación",
        async action() {
          await clearAll(page);
          await graph.frame();
          await discover.view("Dashboard");
          await (await picker()).pick("Phase");
        },
        check: async () => void (await tile("Count by kind")),
      },
      {
        subtitle: "Solo las adjudicaciones: 19",
        action: async () => (await (await tile("Count by kind")).chart()).pick({ y: "Adjudicación" }),
        check: () => expect.poll(() => discover.kept()).toBe("19"),
      },
      {
        subtitle: "Arrastra en el tiempo: las adjudicadas desde 2022",
        action: async () => (await (await tile("Count by awardDate")).chart()).brush({ x: [new Date("2022-01-01"), new Date("2026-06-01")] }),
        check: () => expect.poll(() => discover.kept()).toMatch(/^(8|9)$/),
      },
      {
        subtitle: "Línea de tiempo: cada fase en su fecha de publicación",
        async action() {
          await clearAll(page);
          await discover.view("Graph");
          await graph.ready();
          await graph.frame();
          await discover.panel("Settings");
          await settings.timeline("publicationDate");
          await (await discover.dock()).close();
        },
        check: async () => expect(await (await timeline()).range()).toBeNull(),
      },
      {
        subtitle: "Reprodúcelas: de 2017 a 2024",
        async action() {
          const t = await timeline();
          await t.brush([new Date("2017-09-10"), new Date("2024-11-10")]);
          await t.play();
          // Play recorre la ventana desde su inicio, acumulando, y para solo al final.
          await expect.poll(() => end(t), { timeout: 10_000 }).toBeLessThan(2024).catch(() => undefined);
          await expect.poll(() => end(t), { timeout: 120_000 }).toBeGreaterThanOrEqual(2024);
          await t.pause();
        },
        check: async () => expect(number(await discover.kept())).toBeGreaterThan(0),
      },
      // ── 5. Preguntar ───────────────────────────────────────────────────────
      {
        subtitle: "Pregunta en lenguaje natural, sobre lo que tienes delante",
        async action() {
          await clearAll(page);
          await discover.view("Dashboard");
          await (await (await discover.ask()).composer()).ask(TECH);
        },
        check: async () => {},
      },
      {
        subtitle: "La respuesta es un gráfico, calculado sobre tus datos",
        action: async () => (await (await discover.ask()).composer()).answer(),
        async check() {
          const rows = await (await (await discover.ask()).composer()).rows();
          expect(rows.some((row) => Object.values(row).includes("INTELIGENCIA ARTIFICIAL"))).toBe(true);
        },
      },
      {
        subtitle: "¿Quién se lleva más importe adjudicado?",
        async action() {
          const answers = await (await discover.ask()).composer();
          await answers.ask(MONEY);
          await answers.answer();
        },
        async check() {
          const rows = await (await (await discover.ask()).composer()).rows();
          expect(rows.some((row) => Object.values(row).some((cell) => /FCC AQUALIA/.test(cell)))).toBe(true);
        },
      },
      {
        subtitle: "Filtra por la respuesta y míralo en el grafo",
        async action() {
          await (await (await discover.ask()).composer()).filterTo();
          await discover.view("Graph");
          await graph.ready();
          await graph.frame();
        },
        check: () => expect.poll(async () => number(await discover.kept())).toBeGreaterThan(0),
      },
      // ── 6. Comprobar ───────────────────────────────────────────────────────
      {
        subtitle: "Reglas de calidad SHACL sobre todo el grafo",
        async action() {
          await clearAll(page);
          await graph.frame();
          await (await discover.dock()).close();
          expect(await rules.check()).toBe("All 5,449 nodes checked · 5,330 conform");
        },
        check: async () => expect(await (await rules.rule("AwardCriterion")).state()).toBe("31 violations · 26 warnings"),
      },
      {
        subtitle: "Regla: todo criterio de adjudicación declara su ponderación",
        async action() {
          await (await rules.rule("AwardCriterion")).show(/ponderación/);
          await graph.frame();
        },
        check: () => expect.poll(() => discover.kept()).toBe("31"),
        poster: true,
      },
      {
        subtitle: "Aviso: 26 criterios no dicen si son fórmula o juicio de valor",
        action: async () => (await rules.rule("AwardCriterion")).show(/cómo se evalúa/),
        check: () => expect.poll(() => discover.kept()).toBe("26"),
      },
      {
        subtitle: "Aviso: 59 organizaciones sin tipo (empresa, universidad…)",
        async action() {
          await (await rules.rule("Organization")).show(/no tiene tipo/);
          await graph.frame();
        },
        check: () => expect.poll(() => discover.kept()).toBe("59"),
      },
      {
        subtitle: "Quédate solo con lo que cumple todas las reglas",
        action: () => rules.conforms(),
        // Los sujetos que rudof da por conformes: 15 proyectos, 186 criterios y 267 organizaciones
        // revisados, menos los 119 señalados.
        check: () => expect.poll(() => discover.kept()).toBe("349"),
      },
    ];
  },
});
