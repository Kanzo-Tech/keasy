# Demo CPI España · 15 proyectos — guion de grabación

Una sola toma de Discover sobre el grafo del cliente: 18 pasos, unos 4 minutos y 1600×900,
con subtítulos en castellano. El vídeo grabado está al lado (`cpi-discovery-light.mp4`), junto con el
póster y los tiempos de cada subtítulo. Esta carpeta es el paquete:
datos, mapping, reglas y `e2e/demos/cpi-discovery.demo.ts` para regrabarla en tu Mac.

## El grafo

El TTL integrado (22.255 triples) se convierte en un JSON por tipo y otro por relación, con su
`shapes.shex` y un `mapping.fossil`. Keasy lo construye como cualquier otro ejemplo: el resultado son
**5.449 nodos y 9.034 aristas**, y cada sujeto conserva su IRI del TTL. Hay tres decisiones que
conviene conocer:

- **Tipos unificados.** Las clases que comparten nodos se juntan en una: `Phase` reúne la consulta
  preliminar, la licitación y la adjudicación (15/19/19), y `Organization` reúne la entidad pública,
  la agrupación y la organización (18/46/203). Lo que distingue a cada una va en una columna `kind`
  (`https://example.org/cpi-demo/ns#kind`).
- **`cpi:derivedFrom`** apunta a tres tipos distintos, y fossil no admite un predicado con dos destinos.
  Por eso se parte en `demo:derivedFromNeed`, `demo:derivedFromObjective` y `demo:derivedFromProblem`.
- **`rdfs:label` en cada nodo.** Es el título, o si no lo hay el prefLabel o el texto, cortado a 80
  caracteres. Kanzo-ui nombra las filas por `rdfs:label`/`skos:prefLabel`, y `cpi:title` no lo es.

Se pierde una sola tripleta: un `hasContractTerm` que apunta a un nodo que no existe.

## La toma

| # | Subtítulo | Qué pasa | Cifra comprobada |
|---|---|---|---|
| 1 | 15 proyectos de CPI: 5.449 nodos y 9.034 relaciones | arranca el layout | `5.4K nodes · 9K edges` |
| 2 | Agrupa el grafo en comunidades | Settings → Clustered, aristas ocultas | 5.449 |
| 3 | Busca un proyecto y abre su ficha: SENDA | paleta `type:CPIProject` + «senda», Enter | ficha de SENDA en Info · **póster** |
| 4 | Busca en todo el grafo: «inteligencia» | `label:inteligencia` → Add to subset | 37 |
| 5 | 37 nodos de 15 tipos distintos: encuádralos | Frame | 37 |
| 6 | Cuadro de mando: proyectos por área temática | Dashboard, relación `CPIProject > hasTheme > ThematicArea` | — |
| 7 | Pulsa una barra: Inteligencia Artificial | pick | 5 |
| 8 | El mismo filtro en el grafo: los 5 proyectos de IA | vista Graph + Frame | 5 |
| 9 | Cada fase del expediente: consulta, licitación, adjudicación | relación `Phase` | — |
| 10 | Solo las adjudicaciones | pick en *Count by kind* | 19 |
| 11 | Arrastra en el tiempo: adjudicadas desde 2022 | brush en *awardDate* | 8–9 |
| 12 | Línea de tiempo: cada fase en su fecha de publicación | Settings → Timeline `publicationDate` | — |
| 13 | Reprodúcelas de 2017 a 2024 | brush y Play | > 0 |
| 14 | 2021–2022: el pico de actividad | brush 2021–2022 + Frame | > 0 |
| 15 | Reglas SHACL: comprueba el grafo entero | Check | `All 5,449 nodes checked · 5,330 conform` |
| 16 | 55 criterios de adjudicación incumplen una regla | Show 55 de AwardCriterion + Frame | 55 |
| 17 | 31 no declaran su ponderación | Show 31 | 31 |
| 18 | Quédate con lo que cumple: 349 de las 468 entidades | Keep what conforms | 349 |

Las reglas (`rules.ttl`) son tres: los **proyectos** necesitan promotor y título, y si no declaran
ámbito territorial salta un aviso (1 violación y 4 avisos); los **criterios de adjudicación**
necesitan ponderación, y si no dicen cómo se evalúan salta un aviso (31 y 26); las **organizaciones**
reciben un aviso cuando no tienen tipo (59, de ellos las 46 agrupaciones). «Keep what conforms» se
queda con los nodos revisados que cumplen, es decir, 468 − 119 = 349, y no con los 5.330 del grafo.

## Qué no sale, y por qué

- **Ask y el asistente.** El modelo corre en WebGPU y este contenedor no tiene GPU. En tu Mac
  funcionan, y se puede añadir un paso de Ask con preguntas de verdad.
- **Map placement.** Necesita dos columnas numéricas tipo coordenadas, y el grafo no tiene ninguna.
- **Etiquetas en el grafo.** Keasy no le pasa `title` a `GraphRoot`, así que el lienzo etiqueta por
  IRI. Por eso la toma va con las etiquetas apagadas. Arreglarlo es un cambio de una línea en
  `discover/page.tsx` (`title="label"` o la columna que nombre el tipo) y merece un PR aparte.
- **Fluidez.** Grabé sin GPU, así que el paso 2 (el layout agrupado) tarda unos 50 s en pantalla. En
  el Mac con Metal es cuestión de segundos.

## Regrabar en tu Mac

```sh
cd keasy
git fetch origin claude/project-thread-30cgjm && git checkout claude/project-thread-30cgjm
make dev
make demo DEMO=cpi-discovery            # claro y oscuro; THEME=dark para uno solo
```

Si el cliente pasa otro TTL con el mismo vocabulario: `python3 infra/dev/examples/cpi/convert.py nuevo.ttl salida/` y
copia `mapping.fossil`, `shapes/shapes.shex` y `data/` en `infra/dev/examples/cpi/`. Las cifras
fijas de la demo (37, 5, 19, 55, 31, 349) habría que volver a leerlas.
