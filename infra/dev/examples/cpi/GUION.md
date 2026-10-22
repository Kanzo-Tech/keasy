# Demo CPI España · 15 proyectos — guion de grabación

Una sola toma de Discover sobre el grafo del cliente, en 23 pasos, a 1600×900 y con subtítulos en
castellano. Cuenta una historia: la de un comprador público que prepara su propia CPI y quiere
saber qué hay, dónde aparece la IA, cómo se relacionan proyectos y áreas, cuándo pasó cada fase,
qué responde a una pregunta y qué datos fallan. El layout agrupado por comunidades se asienta
antes de grabar (`CPI_SETTLE`, 60 s por defecto), así que en cámara no se espera.

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
| 1 | 15 proyectos de Compra Pública de Innovación, en un grafo | el grafo agrupado, ya asentado | `5.4K nodes · 9K edges` |
| 2 | Retos, requisitos, criterios, ofertas: 5.449 piezas enlazadas | hover en la leyenda | 5.449 |
| 3 | Abre un proyecto: SENDA, diagnóstico médico en la nube | paleta `type:CPIProject` + «senda» | ficha en Info · **póster** |
| 4 | ¿Cuánta IA hay en estos expedientes? Busca «inteligencia» | `label:inteligencia` → Add to subset | 37 |
| 5 | Sale en 37 piezas: requisitos, criterios, soluciones… | Frame | 37 |
| 6 | Cuadro de mando: una fila por proyecto | Dashboard, relación `CPIProject` | 15 |
| 7 | Relaciona tablas: cada proyecto con su área temática | añade el salto `>hasTheme>ThematicArea` | tile por área |
| 8 | La IA es el área más repetida: pulsa la barra | pick | 5 |
| 9 | El mismo filtro en el grafo: los 5 proyectos de IA | Graph + Frame | 5 |
| 10 | Cada expediente pasa por fases: consulta, licitación, adjudicación | limpia, encuadra todo, relación `Phase` | tile *Count by kind* |
| 11 | Solo las adjudicaciones: 19 | pick | 19 |
| 12 | Arrastra en el tiempo: las adjudicadas desde 2022 | brush en *awardDate* | 8–9 |
| 13 | Línea de tiempo: cada fase en su fecha de publicación | Graph, zoom out, timeline `publicationDate`, dock cerrado | — |
| 14 | Reprodúcelas: de 2017 a 2024 | brush y Play hasta el final | > 0 |
| 15 | Pregunta en lenguaje natural, sobre lo que tienes delante | Ask: «Which technologies do the solutions require most?» | — |
| 16 | La respuesta es un gráfico, calculado sobre tus datos | respuesta: tecnologías por solución | INTELIGENCIA ARTIFICIAL, 7 |
| 17 | ¿Quién se lleva más importe adjudicado? | Ask («Who won the largest awarded amounts?»), la pregunta entra de golpe y la respuesta se baja a la vista: suma de `awardedAmount` por organización | UTE FCC AQUALIA…, 16,99 M€ |
| 18 | Filtra por la respuesta y míralo en el grafo | Filter to + Graph + Frame | > 0 |
| 19 | ¿Son fiables estos datos? Revísalos con tus reglas | Check | `All 5,449 nodes checked · 5,330 conform` |
| 20 | 31 criterios sin ponderación: difíciles de justificar | Show + Frame | 31 · **póster** |
| 21 | 26 no dicen si puntúan por fórmula o por juicio de valor | Show | 26 |
| 22 | 59 organizaciones sin tipo: ¿empresa, universidad, centro? | Show + Frame | 59 |
| 23 | Trabaja solo con lo fiable: 349 piezas que cumplen | Keep what conforms | 349 |

## Las reglas, y qué buscan

En la toma no se habla de SHACL sino de lo que le importa al cliente: si puede fiarse de los datos.
Cada subtítulo dice qué falla y por qué importa (un criterio sin ponderación es una adjudicación
difícil de justificar). Por debajo son reglas SHACL, en `rules.ttl`, y el cliente puede escribir las
suyas. Son tres:

- **Proyecto** (`CPIProject`): necesita promotor (`isPromotedBy`) y título; si no declara ámbito
  territorial, aviso. Da 1 violación y 4 avisos.
- **Criterio de adjudicación** (`AwardCriterion`): debe declarar su ponderación (`weight`, un número
  ≥ 0), y si no dice cómo se evalúa (fórmula o juicio de valor), aviso. Da 31 violaciones y 26 avisos.
- **Organización** (`Organization`): aviso si no tiene tipo (empresa, universidad, centro
  tecnológico…). Da 59, entre ellos las 46 agrupaciones.

«Keep what conforms» se queda con los nodos revisados que cumplen, es decir, 468 − 119 = 349, y no con
los 5.330 del grafo.

## Ask

El modelo de Ask es un doble (`e2e/support/model.ts`), como en `nobel-ask`: a cada pregunta responde
con la especificación que daría un buen modelo, y el resto es de la página: la relación que necesita
la respuesta, las filas (DuckDB, bajo el filtro de la página) y el filtro. Así la toma sale igual cada
vez y no necesita GPU.

## Qué no sale, y por qué

- **Map placement.** Necesita dos columnas numéricas tipo coordenadas, y el grafo no tiene ninguna.
- **Etiquetas en el grafo.** Keasy no le pasa `title` a `GraphRoot`, así que el lienzo etiqueta por
  IRI. Por eso la toma va con las etiquetas apagadas. Arreglarlo es un cambio de una línea en
  `discover/page.tsx` y merece un PR aparte.
- **Colores.** Van a los ocho primeros tipos; `convert.py` pone primero los importantes (proyecto,
  fase, organización, participación, criterio, solución, requisito, área temática).

## Regrabar en tu Mac

```sh
cd keasy
git fetch origin claude/project-thread-30cgjm && git checkout claude/project-thread-30cgjm
make dev
make demo DEMO=cpi-discovery            # claro y oscuro; THEME=dark para uno solo
```

Si el cliente pasa otro TTL con el mismo vocabulario: `python3 infra/dev/examples/cpi/convert.py nuevo.ttl salida/` y
copia `mapping.fossil`, `shapes/shapes.shex` y `data/` en `infra/dev/examples/cpi/`. Las cifras
fijas de la demo (37, 5, 19, 31, 26, 59, 349) habría que volver a leerlas.
