# Design: a grammar-of-graphics overhaul of the graph system (roadmap 33)

Status: implemented, roadmap 33 complete (approved design 2026-10-01, with the answers in §10). Built: stage 1 (33a, the layer engine), stage 2 (33b, layers in the document), stage 3 (33c, the graph builder, the Layers section and selection by layer, with native presets and the v1 bridge retired) and stage 4 (33d, the new combinations, drawing by layer for frame-drawn marks too, the v1 layouts and the shadow test retired, the matrix generated into DATA_MODEL.md §6.2a); see ROADMAP.md item 33 and decisions 258–264 for how it went, including where it departs from this design (lines by group were built without a facet decision; Q4 was resolved in roadmap 34d: linked separate graphs, DECISIONS.md decisions 380–389). The builder UI in §7.1 follows the mockup the user approved. Every citation is `file:line` in the repository as it stands after roadmap 32.

---

## 1. Summary, goals and non-goals

### 1.1 Summary

Today a graph is a `graphType` (15 values, `packages/model/src/graph.ts:18-41`) plus one big per-data-set style bag, `SeriesStyle` (`graph.ts:134-256`). That bag holds a section for every kind of mark: points, bar, box, violin, label, pointLabels, center, error, line, spaghetti, envelope, area, band, yAxis, markOrder. `layoutGraph` picks one of seven hand-written layouts by the type's prefix (`packages/graph/src/layout/dispatch.ts:23-32`). Inside those layouts, `graphType` checks and `show` flags decide what gets drawn, for example:

- `column.ts:140` draws bars only for `column.bar`.
- `column.ts:280` draws error bars for anything except `column.box`.
- `grouped.ts:237` never draws points on stacked bars.

The combinations a user can get are therefore fixed by the code, and each new chart type has meant another family or another `show` flag (decisions 84–88, 217–222).

**Proposal.** A graph becomes a *frame* plus a list of *layers*:

- The frame is the coordinate system: category slots, grouped clusters, XY, polar or matrix.
- Each layer is **geom × stat × position**, with its own sparse style, per-data-set overrides and a data source. The data source is the graph's table by default, or analysis outputs, or functions.
- The table kind decides which layers are allowed, through one compatibility matrix.
- A builder popup (presets on top, a geom checklist with per-geom dropdowns, a live preview) replaces the New graph / Graph type / Duplicate as… choices.
- Format graph gets a Layers list.

The existing layout code is not rewritten from scratch. It is **carved into geom drawers and frame scaffolds**. Stage 1 proves the carving is exact: all 75 golden SVGs (70 graphs + 5 pages, `packages/graph/test/__snapshots__/golden/`) stay byte-identical, and a *shadow compile* test compares old and new scenes for every graph.

### 1.2 Goals

1. **Layered construction.** Any allowed combination can be built by ticking boxes. For example: bars (mean) + points (every value) + error bars (SEM) on a grouped table; violin + box + points; a line through the means across the rows of a column table.
2. **Typed tables stay in charge.** The table kind implies the mapping: column slots are data sets, grouped clusters are rows, XY is X vs Y, parts-of-whole slices are rows. Explicit aesthetic mapping (X/Y/size/colour/shape by variable) exists **only for multiple-variables tables**.
3. **Presets for the common case.** One click gives today's looks: every entry of `GRAPH_PRESETS` (`presets.ts:39-287`) plus every graph type that no preset covers. A preset is now a function from table to layers.
4. **Nothing existing changes.**
   - Every v1 file opens and renders identically.
   - Stage 1 changes no bytes.
   - Stage 2 changes documents only through a deterministic, tested migration.
5. **One engine.** No drawing code branches on a table kind or a preset. Adding a chart type means adding or extending a geom, stat or position, plus its matrix entry, defaults, legend glyph, extent, skyline and golden.
6. **Selection and formatting by layer.** On the canvas, in Format graph, in undo and in Magic.

### 1.3 Non-goals (for roadmap 33)

- A general ggplot clone:
  - no free aesthetic expressions;
  - no `stat_smooth` inside graphs (fits stay analyses);
  - no coordinate systems beyond flip and polar;
  - no user-scripted geoms.
- Facets inside one graph. Small multiples stay separate graphs (decision 41; Q4 resolved in roadmap 34d: sets of linked separate graphs, one per level, data set or row). The polar frame's "one pie per data set" is the only built-in panelling, as today.
- Changes to analyses, results, `ANALYSES_VERSION`, page layouts, export or the scene/renderer contract. `Scene`, `SceneNode` and the SVG/PDF writers stay as they are; `SceneNode` gains one optional field, `layer`.
- Reading the graph definitions of .pzfx files. That becomes feasible afterwards (roadmap 39).

### 1.4 What stays as in table-based lab graphing tools

| Kept | How |
|---|---|
| Typed tables (Column, Grouped, XY, Survival, Parts of whole, Nested, Contingency, Multiple variables) | Table kind → frame, implied mapping and allowed layers (§3) |
| Series follow the table (`include: 'all'`, decision 9) | Unchanged: `seriesSource` stays graph-level; layers read "the graph's series" by default |
| A data set has one colour, one Y axis and one legend entry | Identity fields stay per data set (`seriesOverrides[key]`: colour, yAxis, pointLabels, order) and are shared by all layers |
| Presets first | The builder opens on a preset chosen for the table; the checklist is the "customise" step |
| Live brackets, point labels, Magic, slices, shared axes, orientation, size and scale | Graph-level services, unchanged in meaning (§5.5) |
| Format dialogs routed by the clicked element (decision 56) | Same dialogs; Appearance gains a layer dimension (§7.3) |

---

## 2. The layer model

### 2.1 What the current model couples (the problems)

| Coupling (cited) | Consequence |
|---|---|
| `center.stat` both chooses the value that bars and error bars use (`data.ts:348` `centerOf`) and turns the centre line on or off (`column.ts:308`, `'none'`). `column.bar`'s theme has `center.stat: 'none'` yet its bars sit at the mean (`theme.ts:172-177`). | A "summary" and a "mark" share one field |
| Mark existence mixes `show` flags (points, line, bar on XY, box on XY, spaghetti, envelope, area, band) with graphType tests (bars, boxes, pairs, estimation) and `'none'` stats (centre, error) | Three different "is it drawn?" mechanisms |
| Error bars are suppressed on `column.box` (`column.ts:280`), `grouped.box` (`grouped.ts:269`), XY "each" (`xy.ts:331-333`) and XY envelopes (`xy.ts:333`) | Hidden rules the user cannot see |
| Stacked grouped bars silently drop points and lines (`grouped.ts:123,237`) | Same |
| Theme defaults are keyed by graphType (`theme.ts:170-248`): points 6 / 5 / 4.5 / 4 pt, caps 8 / 6 / 5, bar width 0.6 / 0.8 / 1, centre width 0.3 / 0.45 / 1 | Defaults depend on the "chart type" |
| Drawing order is a per-data-set kind list, `markOrder` (`graph.ts:78`, `theme.ts:290-302`, decision 81), with XY reversing it (`theme.ts:219`) | Order is by mark kind, not by what the user added |
| Extent, legend glyph and link rules branch per family (`links.ts:30-36,107-114`, `column.ts:411`, `grouped.ts:403`, `xy.ts:431-432`) | Every new type touches five places |
| Curves are `extraSeries` with their own target root `['extraSeries', i]` (`graph.ts:697-704`, `xy.ts:131-203`). Functions are a third list (`graph.ts:682-694`, `xy.ts:207-222`). | Three kinds of "series" |

### 2.2 Types (zod-style sketches, `packages/model/src/layers.ts`, new)

```ts
/** Short id, unique within its graph; deterministic on migration ('bars', 'points', 'error', …). */
export const LayerId = z.string().regex(/^[a-z][A-Za-z0-9]{0,23}$/)

/** The coordinate frame: what the slots / axes are. Chosen from the table kind (§3). */
export const Frame = z.enum([
  'category', // one slot per data set (column, nested, MV-as-columns, 100% bars of parts of whole)
  'grouped',  // one cluster per row, data sets within (grouped, contingency)
  'xy',       // continuous X and Y (XY, survival, bubble, analysis-output graphs)
  'polar',    // wedges, one pie per data set (parts of whole)
  'matrix',   // category × category tiles (heat maps)
])

export const Geom = z.enum([
  'points',     // symbols (each value, or one per summary)
  'bar',        // bar from a baseline to a value; stacked segments
  'errorbar',   // Y error bars (and XY X error bars from the table)
  'center',     // short horizontal line at a summary (column / grouped dot plots, subject means)
  'box',        // box & whiskers, or floating bar (min–max) with its centre line
  'violin',     // mirrored density with centre / quartile lines
  'line',       // joins summaries across X / rows / categories, or each replicate (spaghetti)
  'step',       // staircase (Kaplan-Meier)
  'censor',     // tick marks at censored times
  'area',       // fill between a line and a baseline
  'band',       // fill between lo and hi (error envelope, confidence band)
  'connector',  // joins the values of one table row across categories (before-after)
  'refline',    // a line across the plot at a statistic (grand mean)
  'difference', // estimation plot: a difference and its CI in its own slot
  'tile',       // heat-map cell
  'wedge',      // pie / donut slice
  'label',      // text at a mark: bar labels, cell values, slice labels
])

const Center = z.enum(['mean', 'median', 'geomean'])
const ErrorStat = ErrorSpec.shape.stat         // 'SD' | 'SEM' | 'CI' | 'range' | 'IQR' | 'MAD' | …

export const Stat = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('identity') }),   // each value / cell value / output or function points
  z.object({
    kind: z.literal('summary'),
    center: Center,
    error: ErrorStat.optional(),               // errorbar, band; absent = none
    by: z.enum(['series', 'subject', 'all']).optional(), // subject: nested means; all: grand mean
  }),
  z.object({ kind: z.literal('boxplot'), whiskers: Whiskers, center: Center.optional() }),
  z.object({ kind: z.literal('range'), center: Center.optional() }),  // floating bars: min–max
  z.object({ kind: z.literal('density'), smoothing: z.number().min(0.1).max(10),
             extent: z.enum(['truncated', 'extended']) }),
  z.object({ kind: z.literal('km') }),         // Kaplan-Meier (survival tables)
  z.object({ kind: z.literal('fraction') }),   // share of the whole (parts of whole)
  z.object({ kind: z.literal('difference'), ci: z.enum(['pooled', 'welch']) }),
  z.object({ kind: z.literal('cell'), standardize: z.enum(['none', 'row', 'column']).optional() }),
  z.object({ kind: z.literal('bin'), width: z.number().positive().optional(),   // stage 4
             measure: z.enum(['count', 'percent', 'fraction']).optional() }),
])

/** Where marks sit within a slot (category / grouped frames), or across X. */
export const Position = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('identity') }),                    // slot centre; XY: at X
  z.object({ kind: z.literal('dodge'), by: z.enum(['series', 'subject']).optional() }),
  z.object({ kind: z.literal('aligned') }),                     // grouped: every data set at the row centre
  z.object({ kind: z.literal('stack'), percent: z.boolean().optional(), gap: Pt.optional() }),
])

/** Where a layer's series come from. */
export const LayerData = z.discriminatedUnion('from', [
  z.object({ from: z.literal('table') }),                        // the graph's seriesSource (default)
  z.object({ from: z.literal('outputs'), series: z.array(OutputSeries) }), // was ExtraSeries
  z.object({ from: z.literal('functions'), functions: z.array(FunctionDef) }), // was graph.functions
  z.object({ from: z.literal('layer'), layer: LayerId }),        // the same series as another layer
])
export const OutputSeries = ExtraSeries.omit({ style: true })     // { id, ref: {node,key}, colorOf? }
export const FunctionDef = FunctionCurve.omit({ style: true })    // { id, equation, params, from, to, … }

/** Multiple-variables tables only: variables mapped to aesthetics (the old style.bubble). */
export const Aes = z.object({
  x: DataSetKey, y: DataSetKey,
  size: DataSetKey.optional(), color: DataSetKey.optional(),
  shape: DataSetKey.optional(), group: DataSetKey.optional(),   // shape, group: stage 4 / roadmap 34
}).partial()

/** Per data set (or output / function) within one layer. */
const LayerSeries = <S extends z.ZodTypeAny>(style: S) => z.object({
  style: style.optional(),           // sparse, over the layer's style
  stat: StatParams.optional(),       // e.g. median for one data set; replicates each vs mean
  hide: z.boolean().optional(),      // leave this data set out of this layer
}).partial()

const LayerBase = {
  id: LayerId,
  name: z.string().max(80).optional(),     // shown in Layers; absent = generated ("Bars (mean)")
  visible: z.boolean().optional(),         // false: kept but not drawn (see migration of stacks)
  data: LayerData.optional(),              // absent = { from: 'table' }
  on: LayerId.optional(),                  // attached to a host: errorbar, label, center (§2.4)
  aes: Aes.optional(),                     // only for multiple-variables tables
  seriesHidden: z.boolean().optional(),    // data sets drawn only where series[k].hide === false
  legend: z.enum(['auto', 'hide']).optional(),
}

// One member per geom, each with its own style schema: the old SeriesStyle sections.
export const Layer = z.discriminatedUnion('geom', [
  z.object({ ...LayerBase, geom: z.literal('points'),
    stat: z.union([Identity, Summary]), position: Position.optional(),
    style: PointsStyle.optional(), series: z.record(SeriesKey, LayerSeries(PointsStyle)).optional() }),
  z.object({ ...LayerBase, geom: z.literal('bar'),
    stat: z.union([Summary, Identity, Fraction, Bin]), position: Position.optional(),
    style: BarStyle.optional(), series: … }),
  z.object({ ...LayerBase, geom: z.literal('errorbar'), stat: Summary, style: ErrorBarStyle.optional(), series: … }),
  // … center, box (Boxplot | Range), violin (Density), line (Summary | Identity), step / censor / band (Km),
  //   area, band (Summary | Identity), connector, refline, difference, tile (Cell | Identity), wedge, label
])
export type Layer = z.infer<typeof Layer>
```

Per-geom style schemas are the existing `SeriesStyle` sections, moved rather than invented:

| Geom style | From (v1) |
|---|---|
| `PointsStyle` | `points` without `show` and `replicates`; `jitter` renamed `spread` (same values `'auto' \| 'none' \| number`), `excludedStyle` |
| `BarStyle` | `bar` without `show` (`fill`, `border`, `width`, `binWidth`, `baseline`) |
| `ErrorBarStyle` | `error` without `stat` (`direction`, `capWidth`, `line`, `x`) |
| `CenterStyle` | `center` without `stat` (`line`, `width`) |
| `BoxStyle` / `ViolinStyle` | `box` without `kind` and `show` (`whiskers` → stat); `violin` (`quartiles`, `quartileLine`; `smoothing` and `extent` → stat) |
| `LineStyle` | `line` without `show` (`stroke`, `gaps`) + `fade` (spaghetti) |
| `AreaStyle` / `BandStyle` | `area` (`opacity`, `baseline`), `envelope` / `band` (`opacity`) |
| `LabelStyle` | `BarLabel` without `show` (`graph.ts:82-93`), `label.stat` → stat |
| `TileStyle` | `HeatmapStyle` cell part: `missing`, `border`, `cluster {rows, columns, distance, linkage, dendrogram}` |
| `WedgeStyle` | `PieStyle` slice part (`graph.ts:359-374`) |
| `DifferenceStyle` | `EstimationStyle` (`guides`) |

### 2.3 The graph node, v2

```ts
export const GraphNode = z.object({
  kind: z.literal('graph'), id: NodeId, name: z.string(),
  frame: Frame,
  layers: z.array(Layer).max(32),                  // back to front
  /** Theme-defaults family: the v1 graphType value (§6.3). Absent = the frame's default. */
  look: GraphLook.optional(),                      // same 15 literals as v1 GraphType
  /** Provenance only: the preset that built the layers (the builder highlights it). */
  preset: z.string().optional(),
  /**
   * Draw order where marks overlap: 'layer' (every data set's bars, then every data set's points,
   * as ggplot; the default for new graphs, user decision 2026-10-01) or 'series' (each data set's
   * layers together, data sets in order, as v1 drew them; set by the v1 → v2 migration).
   */
  drawOrder: z.enum(['layer', 'series']).optional(),   // absent = 'layer'
  seriesSource: …unchanged…,                       // table, include, rows
  /** Identity of each data set, shared by every layer. Was SeriesStyle. */
  seriesOverrides: z.record(DataSetKey, SeriesIdentity),
  /** Single data points / cells / slices: unchanged schema (PointStyle, graph.ts:285-310). */
  pointOverrides: z.record(SeriesKey, z.record(PointKey, PointStyle)).optional(),
  size, axes, annotations, legend, title, titleOffset, links, notes,   // unchanged
  style: GraphStyle,                               // trimmed, below
  scales: z.object({ color: ColorScale, size: SizeScale }).partial().optional(),
})

export const SeriesIdentity = z.object({
  color: ColorRef, yAxis: z.enum(['left', 'right']), pointLabels: PointLabels,
  /** Front-to-back order of this data set's layers (was markOrder); others follow the list. */
  order: z.array(LayerId).max(32),
}).partial()

// GraphStyle v2 keeps: seriesDefaults (a SeriesIdentity), text, palette, frame, background,
//   plotBackground, bracket, categoryGap, orientation, polar { hole, startAngle, clockwise }.
// Moved into layers or scales: arrangement / stack → Position; nested → points position + aes;
//   estimation → difference layer; bubble → aes + scales; pie → polar + wedge + label;
//   grandMean → refline layer; heatmap → tile layer + scales.color + axis order.
export const ColorScale = z.object({         // the heat map's and the bubble's colour scales, one schema
  colors: z.union([ColorMapName, z.tuple([RGB, RGB])]), reverse: z.boolean(),
  min: z.number(), max: z.number(), midpoint: z.number(),
  bar: z.object({ show: z.boolean(), position: z.enum(['right', 'bottom']), title: z.string() }).partial(),
}).partial()
export const SizeScale = z.object({ max: Pt, min: Pt }).partial()
```

**Why `seriesOverrides` keeps its name.** Its schema narrows to identity fields (colour, axis, labels, order), but keeping the name keeps `['seriesOverrides', key]` meaning "the data set". That path is what `route.ts:63-70`, `SceneSvg.tsx:227-241`, `remap.ts:204-211`, `commands.ts:352-355` and Magic (`magic.ts:137-145`) already use, so churn is small.

**Why `pointOverrides` is unchanged.** Its `color`, `hide`, `label` and `labelOffset` apply to a datum across layers. That is what grouped cells already do (decision 80, `grouped.ts:151-155`). `shape`, `size`, `fill` and `border` are read by points layers, `bar` / `box` by bar and box layers, and `explode` by wedges. No migration of point keys is needed, so row remapping (`commands.ts:361-372`) needs no change. Per-layer mark overrides are deferred (decision 234).

### 2.4 Attached layers (`on`)

Error bars, labels and centre lines belong to a host (as in v1 and other lab graphing tools). Examples: the bar's error bar points away from the bar's baseline (`extent.ts:216-225`); a stacked bar's error bar sits on the segment's end (`grouped.ts:273-276`); a label goes above the bar and its error bar (`labels.ts:61`). An attached layer:

- takes the host's position (slot, dodge, stack segment);
- takes the host's summary centre, unless it sets its own;
- takes its skyline (the label sits above the host's highest mark).

It is removed with its host, after a prompt in the UI.

The builder shows attached layers indented under their host ("Error bars on Bars: SD ▾"). This answers the user's example: "points and bars, with a dropdown on bars to summarise by mean" becomes Bars (Mean ▾), with Error bars (SD ▾) attached, plus Points (Every value).

### 2.5 Style cascade, v2

```
geom style:   theme.series[look ?? frameDefault][section]  →  layer.style  →  layer.series[key].style
stat params:  layer.stat                                   →  layer.series[key].stat
identity:     theme                                        →  style.seriesDefaults  →  seriesOverrides[key]
datum:        (layer-resolved mark)                        →  pointOverrides[key][pointKey]
```

This is v1's `theme[graphType] → seriesDefaults → seriesOverrides[key]` (`theme.ts:305-352`), split by section. The theme table `theme.series[look]` is reused unchanged in stages 1–2, so migrated graphs resolve to the same values. (Roadmap 37: the table is per-geom defaults under context rules, a style over them, `markDefaults(theme, graph)`; the values are the same.)

"All data sets" in Appearance writes `layer.style`; one data set writes `layer.series[key].style`. That is decisions 59/78 with the layer as the extra key. The "mixed" display (`differsAcross`, `SeriesPanel.tsx:116`) is unchanged.

### 2.6 How extra series, fits and functions fit

| v1 | v2 |
|---|---|
| `extraSeries[i]` = `{id, ref, colorOf, style}` (`graph.ts:697-704`), created by `outputSeriesFor` (`factory.ts:358-385`) | Entries of an **output layer**'s `data.series` (id, ref and colorOf unchanged); style in `layer.series[id]`. Migration puts all of a graph's extra series, in order, into one `line` layer `curves`, one `band` layer `curveBands` (`data: {from:'layer', layer:'curves'}`) and one `points` layer `curvePoints` (each only if some series shows it; theme `curve` shows line and band, `theme.ts:249-256`). New analyses add series to the existing `curves` layers, or create them. |
| Output graphs (ROC, Bland-Altman, QQ, volcano…): `include: []` + extra series (`factory.ts:391-424`, decision 33) | `frame: 'xy'`, `include: []`, only output layers. `removalSet` (`commands.ts:432-450`) keeps the rule "no table series, every output from removed nodes". |
| `graph.functions` (`graph.ts:682-694`) | One `line` layer `functions` with `data: {from:'functions', functions}`, per-function style in `layer.series[fnId]`. |
| `legend.hidden` holds data set keys, extra series ids and function ids | Unchanged: the same ids stay series keys. |
| Output points keyed `r<row>` under the extra series id (`xy.ts:176-195`) | Unchanged (`pointOverrides[outputSeriesId]`). |

---

## 3. Compatibility: table kind × geom × stat × position

Key: ✓ = allowed (the stats listed). **R** = needs raw replicate values (it is disabled with the reason "needs raw values" for mean/SD/N entry formats, like `needsRaw` in `factory.ts:21-31`). ◇ = new in stage 4. — = not offered.

### 3.1 Frames and implied mapping

| Table kind | Frame(s) | Slots / axes (implied mapping) |
|---|---|---|
| Column; result tables of column kind | category | Slot = data set; value axis Y |
| Nested | category | Slot = group (data set); subjects = subcolumns (dodge `by: 'subject'`, shade or shape) |
| Grouped; contingency | grouped | Cluster = row; data sets dodged / aligned / stacked |
| XY | xy | X column vs Y data sets; replicates = subcolumns |
| Survival | xy (linear, Y as percent) | Time vs survival per group |
| Parts of whole | polar; category (100% bars) | Wedge / segment = row, one whole per data set |
| Multiple variables | category (variables as data sets), xy with `aes`, matrix | Explicit mapping only here |
| Grouped, MV (heat maps) | matrix | Columns = data sets or variables; rows = rows |
| Any (analysis outputs) | xy | Output X / Y / lo / hi |

### 3.2 Geoms × table kinds (stats)

| Geom | Column / Nested | Grouped | Contingency | XY | Survival | Parts of whole | MV |
|---|---|---|---|---|---|---|---|
| points | identity **R**, summary | identity **R**, summary (mean symbol) | identity (counts) | identity, summary | — | — | as columns; xy `aes` identity (bubble) |
| bar | summary | summary | identity / summary | identity (at X), summary; ◇ bin | — | fraction (100% bars) | as columns |
| errorbar | summary (attached) | summary (attached) | — | summary (+ X errors from the table) | — | — | as columns |
| center | summary (`by` series / subject) | summary | — | — | — | — | as columns |
| box | boxplot **R**, range **R** | boxplot **R**, range **R** | — | boxplot **R** (at X) | — | — | as columns |
| violin | density **R** | density **R** | — | ◇ density at X | — | — | as columns |
| line | ◇ summary across slots | summary across rows | ◇ identity | summary, identity (spaghetti **R**) | — | — | ◇ xy `aes` with group |
| step | — | — | — | ◇ summary (staircase) | km | — | — |
| censor | — | — | — | — | km | — | — |
| area | — | ◇ summary | — | summary | — | — | — |
| band | — | ◇ summary | — | summary (envelope), identity (outputs) | km (CI) | — | — |
| connector | identity **R** (≥ 2 data sets; not nested) | ◇ | — | — | — | — | as columns |
| refline | summary `by: all` | ◇ | — | ◇ | — | — | as columns |
| difference | difference (≥ 2 data sets, linear Y; not nested) | — | — | — | — | — | as columns |
| tile | — | cell (mean) | ◇ cell (count) | — | — | — | identity (matrix) |
| wedge | — | — | — | — | — | fraction (polar) | — |
| label | summary / n / value (attached) | same | identity / fraction | identity / summary | — | fraction / value / category | as columns; cells |

Result tables follow their own kind, as now (`DATA_MODEL.md` §6.1 "Graphs of result tables"). Output and function layers (line, points, band with identity) are allowed on any `xy`-frame graph.

### 3.3 Positions per geom

| Geom | category | grouped | xy / polar / matrix |
|---|---|---|---|
| points | identity; dodge `by: 'subject'` (nested); spread = swarm / none / width (style) | dodge, aligned | identity |
| bar | identity; stack (parts of whole, by row) | dodge, aligned, stack (`percent`, `gap`) | identity |
| box, violin | identity | dodge, aligned | identity (at X) |
| line, connector | identity | dodge / aligned (joins cell centres) | identity |
| errorbar, label, center | inherit the host's (`on`) | inherit (stack → segment end) | inherit |
| area, band | — | ◇ identity | identity; ◇ stack |
| tile, wedge, step, censor, refline, difference | fixed | fixed | fixed |

Rules the matrix enforces, each with a reason shown in the builder:

- Stack is only for bars; the attached layers follow it.
- Points and lines are not offered with a stacked host. v1 dropped them silently (decision 217); v2 disables them with a reason.
- A graph has at most one `difference`, at most one `tile` (it owns the axis order) and at most one polar frame.
- A layer the table can no longer support is kept in the document and drawn as far as possible, with a warning. This is today's behaviour, e.g. "violin plots need raw data" (`extent.ts:156`).

The matrix lives in `packages/graph/src/layers/matrix.ts`. It returns `{ allowed, reason }` per option and is used by the builder, the Layers list, presets and a test that checks every preset's layers against it.

---

## 4. Every current graph type and option as layers

Notation: layers are listed **back → front**. Each is `id:geom·stat·position`, and `→host` means attached. The v1 default mark order front-to-back is `center, error, points, bar, line` (`theme.ts:128`), and XY's is `points, error, center, bar, line` (`theme.ts:219`), so back-to-front lists read `line, bar, points, error, center` (XY: `line, bar, center, error, points`). `look` = the v1 graphType.

### 4.1 Column family (frame `category`)

| v1 graph (graphType, preset or options) | Layers (back → front) | Graph-level / notes |
|---|---|---|
| `column.scatter`, preset `points` | `points:points·identity` (spread auto) · `error:errorbar·summary(mean,SD)→center` · `center:center·summary(mean)` | `look: column.scatter` |
| preset `pointsMedian` | as above with `median`, `IQR` | |
| preset `pointsOnly` | `points` only | v1: centre and error stat `'none'` → no layers |
| preset `pointsMean` | `points` · `center(mean)` | |
| presets `meanSd` / `meanSem` (column) | `error→center` · `center` | points hidden → no points layer |
| `column.bar`, presets `bars` / `barsSem` | `bars:bar·summary(mean)` · `error:errorbar·summary(mean,SD\|SEM)→bars` (direction above) | v1 theme `center.stat:'none'` still puts bars at the mean (`data.ts:348`) → the summary centre is `mean`, and no centre layer |
| preset `barsPoints` | `bars` · `points` · `error→bars` (both) | |
| bars from a baseline (`bar.baseline`, decision 218) | `bars.style.baseline` | Attached error bars point away from it (`extent.ts:216-225`) |
| `column.box`, preset `box` | `box:box·boxplot(whiskers, center median)` | Error bars are never drawn on box graphs (`column.ts:280`) → no error layer |
| preset `violin` | `violin:violin·density(smoothing, extent)` (median line) | Violin parts keep v1 ids `series/k/box/…`, `series/k/center` (`column.ts:166-170`) |
| preset `violinPoints` | `violin` · `points` | |
| preset `floating` | `box:box·range(center mean)` · `points` | Floating bars are the box drawer (decision 44), same ids |
| `column.beforeAfter` | `pairs:connector·identity` · `points:points·identity` (spread none, white fill from look) | Connectors in plane `pairs` with target `['style']` and **the first data set's error-line stroke** (`column.ts:499`); see §4.7 |
| `column.estimation`, preset `estimation` | `points` · `center(mean)` · `diff:difference·difference(pooled\|welch)` | Planes `estimation/guides`, `estimation`; floating `axes.y2` (§4.7); difference slots extend the category scale |
| grand mean (`style.grandMean`) | `grandMean:refline·summary(mean, by all)` | Plane `grandMean` as a bare node, target `['style','grandMean']` (`column.ts:417-435`) |
| nested, `layout: 'subjects'` | `points` position `dodge by subject`; shade / shape implied (`mark`) | The group centre and error stay pooled (decision 71) |
| nested `subjectMeans` | `subjectMeans:center·summary(mean, by subject)` | Ids `series/k/subjectMean/<sub>` |
| bar labels (`SeriesStyle.label`) | `labels:label·summary(stat)→<host>` | Host = bars, else the box, else points / centre |
| horizontal (`style.orientation`) | unchanged, graph-level | Drawn vertical then `flipNode` (`orient.ts:94`) |
| MV tables "as columns" | same as column | Text variables excluded (`data.ts:112`) |

### 4.2 Grouped and contingency (frame `grouped`)

| v1 | Layers | Notes |
|---|---|---|
| `grouped.bar`, interleaved (`bars`, `barsSem`) | `bars:bar·summary·dodge` · `error→bars` (cap 5, above) | `look: grouped.bar` |
| `barsPoints` | `bars` · `points:points·identity·dodge` · `error→bars` | |
| arrangement `aligned` | every layer `position: aligned` | `grouped.ts:103` |
| `stacked` | `bars:bar·summary·stack` · `error→bars` (segment ends); v1 points / line layers → `visible:false` | v1 never drew them (`grouped.ts:123,237`); kept so un-stacking restores them |
| `stackedPercent`, `stack.gap` | `stack {percent: true, gap}` | Labels inside only (`grouped.ts:343-345`) |
| `grouped.scatter` (`points`, `pointsMedian`, `pointsOnly`, `pointsMean`, `meanSd`, `meanSem`) | as column, position dodge | Centre width 0.45 from look |
| `points.replicates: 'mean'` | `points:points·summary(mean)` (mean symbol) | Ids `series/k/mean/<r>`. v1 draws it in the `center` order slot (`grouped.ts:300-319`) → migration maps `markOrder` 'center' to this layer |
| `connected` | all `aligned`; `line:line·summary(mean)` · `points·summary` · `error→points` | Ids `series/k/line/<k>` (`grouped.ts:137-144`) |
| `grouped.box` box / violin / floating (+ points) | `box` / `violin`, dodge, (+ `points`) | Error bars never drawn (`grouped.ts:269`) |
| single bars / boxes (`pointOverrides r<row>`) | unchanged | decision 80 |
| right Y axis | identity `yAxis`; stacked ignores it | decision 77 |
| contingency (`grouped.bar`, count axis title) | `bars:bar·summary(mean)·dodge` | One value per cell, so summary = value; new contingency graphs use `identity` (same pixels) |

### 4.3 XY (frame `xy`, `look: xy.scatter`)

| v1 option | Layers (back → front) | Notes |
|---|---|---|
| default / `meanSd` / `meanSem` | `error:errorbar·summary(mean,SD)` · `points:points·summary(mean)` | Points in front (`theme.ts:219`) |
| `each` | `points·identity`; the error layer is dropped (except X errors, see next row) | v1 skips Y error bars and envelopes with `each` (`xy.ts:331-333`) |
| X errors (`xFormat: numbersWithError`, decision 220) | Part of `error` (`style.x`); the error layer exists whenever not `each`, even with Y stat `none` | v1 draws X errors regardless of `error.stat` (`xy.ts:331`) |
| `line.show` (+ `gaps`) | `line:line·summary(mean)` | In the series plane |
| `spaghetti` | `subjects:line·identity (group replicate)` with `fade`, behind `line` | Ids `series/k/subject/<sub>/<k>` (`xyMarks.ts:110`) |
| `envelope` | `envelope:band·summary(mean,SD)` in plane `areas`; `error` keeps only X errors (Y stat none) | v1 replaces Y error bars (`xy.ts:333`) |
| `area` | `area:area·summary(mean)` (baseline) in plane `areas` | Group `areas` only when non-empty (`xy.ts:504`) |
| `histogram` (`bar.show`, `binWidth`) | `bars:bar·identity` (at X) | decision 84 |
| boxes at X (`box.show`) | `box:box·boxplot` at X | `xy.ts:289-317` |
| geometric (`geomean`, `geoSD`, `geoCI`) | `summary(center: geomean)` | decision 221 |
| labels | `labels:label→bars\|points` | `xy.ts:397-418` |
| fitted curves / bands / output points | `curveBands:band·identity` (plane `bands`) · `curves:line·identity` · `curvePoints:points·identity` (plane `curves`, drawn per series: line then points, as `xy.ts:131-203`) | Data `outputs` (§2.6) |
| functions | `functions:line·identity` (plane `curves`, after the outputs) | Ids `function/<i>/<k>` |
| output graphs (ROC, QQ, Bland-Altman, volcano, loadings) | output layers only, `include: []` | `OutputDecl.mark` → which layers show which series |

### 4.4 Survival (frame `xy`, `look: survival.step`)

`ciBand:band·km` (plane `bands`, hidden by default as v1 `band.show:false`) · `curve:step·km` · `censor:censor·km` (vertical tick lines, `survival.ts:114-126`). The km stat forces linear axes and percent Y (`survival.ts:60-65,72`). Ids are unchanged: `series/k/band`, `series/k/line/<k>`, `series/k/censor/<i>`.

### 4.5 Multiple variables: bubble (frame `xy`, `look: bubble.scatter`)

`bubbles:points·identity` with `aes {x, y, size, color}` (was `style.bubble.x/y/size/color`), `scales.size = {max, min}`, and `scales.color = {colors: [low, high]}` or categorical for a text variable. Larger bubbles are drawn first (a points style `order: 'size'`). The series key stays the Y variable (`bubble.ts:204,306`), so `pointOverrides[y]['r<row>']` is unchanged. Size and colour legends are **scale legends** (§5.5).

### 4.6 Parts of whole, heat maps

| v1 | v2 |
|---|---|
| `whole.pie` | frame `polar`; `slices:wedge·fraction` · `labels:label·fraction→slices` (inside / outside, digits, what); `style.polar {hole:0, startAngle, clockwise}`; colour by row (implied) |
| `whole.donut` | same; `look: whole.donut` gives hole 0.5 (`whole.ts:56`) |
| `whole.bar` | frame `category`; `segments:bar·fraction·stack(by row, percent)` · `labels→segments` (inside); Y 0–100 "Percent of total" (`factory.ts:161-173`) |
| `heatmap.cells` (grouped) | frame `matrix`; `cells:tile·cell(standardize)` · `values:label→cells` (plane `cellLabels`); `scales.color` (colours, reverse, min, max, midpoint); colour bar in plane `colorScale`; clustering in `cells.style.cluster` orders both axes and draws dendrograms (plane `dendrograms`) |
| `heatmap.cells` (MV) | same with `cells:tile·identity` over numeric variables |

### 4.7 What does not decompose cleanly, and the treatment

| Case | Why it is special | Treatment |
|---|---|---|
| Estimation plot's floating axis (decision 86; `estimation.ts:12-16`, `column.ts:362-367,450-474`) | The difference axis is the left scale shifted to the control mean, drawn only over its ticks; extra category slots | **Special geom plus graph feature.** The `difference` layer contributes slots to the category scale (scale training, §5.3) and requests a *floating secondary axis* (`axes.y2`, role `difference`, created and removed with the layer). A **composite preset** "Estimation plot" builds points + centre + difference. |
| Heat-map dendrograms and clustering (`heatmap.ts:174-177`) | Clustering reorders the categorical axes; dendrograms sit in the margin | **Graph feature owned by a layer.** Axis order is supplied by the single `tile` layer; dendrograms are an axis decoration drawn by the tile drawer. At most one tile layer per graph. |
| Before-after connectors (`column.ts:479-520`) | Join a row across data sets; stroke from the **first data set's error line** (`column.ts:499`), target `['style']` | **Special geom** `connector` (group = table row). The migration copies the resolved first-data-set `error.line` into `pairs.style.line` when the graph has one (from `seriesDefaults`, or `seriesOverrides[first]` when the source is a data table). A result-table source, whose first key is unknown at migration, keeps the default and is listed in the migration report. |
| Bubble mapping (decision 87) | Variables mapped to x / y / size / colour | **Aesthetic mapping** (MV only) + `scales` + scale legends. |
| `center.stat` double duty | Picks the summary and toggles the centre line | **Split.** The summary centre goes to the stat of every summary layer; the centre line's existence goes to the `center` layer. |
| Hidden suppressions (error bars on box types, XY `each`, envelopes; points and lines on stacks) | Rules in code | **Migration drops (box / each) or hides (stack) layers.** v2 disables such combinations with a reason instead. |
| Grouped mean symbol in the `center` order slot | markOrder kind ≠ mark | Order becomes by layer id; the migration maps kinds to ids per graph. |
| Pies: one per data set | Built-in panelling | A property of the polar frame (not a facet). |
| Survival linear axes and ×100 | Axis constraints from the stat | Declared by the `km` stat (axis constraints service). |
| Per-graphType theme defaults | Sizes and widths depend on "chart type" | Kept as `look` (§6.3); new graphs pick `look` from their preset. |
| Nested subjects side by side / shaded | A layout plus implied aesthetic | Position `dodge by subject` + implied shade / shape (nested tables only). |
| Legend glyph per type (`column.ts:411`, `grouped.ts:403`, `xy.ts:431-432`) | Glyph from graphType | Rule: bar / box / violin / wedge / tile swatch > line + symbol (§5.5). |

---

## 5. Rendering architecture

### 5.1 Pipeline

```
layoutGraph(ctx)                                      dispatch.ts:17 (scale wrapper kept)
  └─ layered = isV2(graph) ? graph : compileV1(graph)   stage 1: in memory, from @ps/model
     1. series      resolveSeries (data.ts:90) + output series + function series
     2. stats       per layer × series: StatFrame, memoized (WeakMap on ds / output / fn + stat key)
     3. scales      category slots trained from layers (data sets | rows | difference slots);
                    value extents = ∪ layer.extent() (+ baselines, refs) → linkedExtent (links.ts:126)
     4. positions   slot x per (series, category) from Position; stacks per layer across series
     5. geoms       draw(LayerCtx) → { planes: Map<plane, per-series nodes>, skyline: {x, top}[],
                    labelPoints, glyph, reach }
     6. assembly    frame skeleton (§5.4): planes in order, series plane interleaved series-major,
                    per-series order = seriesOverrides[k].order ⊕ layer order (was MarkLayers)
     7. services    brackets(skyline) · PointLabelLayer · legend · axes → composeGraph (compose.ts:71);
                    horizontal: flipNode (orient.ts:94) as today
```

Module layout (new, `packages/graph/src/layers/`):

- `engine.ts` (`layoutLayers`)
- `frames/{category,grouped,xy,polar,matrix}.ts`: scaffolding moved from `column.ts`, `grouped.ts`, `xy.ts`, `survival.ts`, `whole.ts`, `heatmap.ts`, `bubble.ts`
- `stats/*.ts`
- `geoms/*.ts`: the mark blocks moved verbatim from the same files, plus the existing `box.ts`, `xyMarks.ts`, `estimation.ts`, `labels.ts`, `points.ts`
- `positions.ts`
- `planes.ts`
- `extent.ts`: replaces the family branches of `layout/extent.ts` and `links.ts:107-114`
- `legend.ts`
- `matrix.ts`
- `presets.ts`

`compileV1` lives in `@ps/model` (`model/src/migrations/v1to2.ts`) because stage 2's migration must be the same function, and `model` depends on nothing internal (`CLAUDE.md` Rules). It embeds a **frozen copy** of the v1 theme's `show` / `stat` defaults per graphType that it needs to decide layer existence (e.g. `column.bar` points hidden, `theme.ts:172-177`). It never imports `@ps/graph`.

### 5.2 Stats: where they live, and the oracle rule

| Stat | Numerics | Transform | Oracle |
|---|---|---|---|
| summary (mean, median, geomean, SD, SEM, CI, range, IQR, MAD, MADn, geoSD, geoCI) | `@ps/stats` (existing) | `graph/layers/stats/summary.ts` ← `data.ts:246-396` moved | `plotstats` suite (existing, 10 fixtures) |
| boxplot, range | `quantile` type 6 (existing) | ← `data.ts:398-476` | `plotstats` |
| density | **moves** `violin.ts` `bandwidthNrd0` / `kernelDensity` into `@ps/stats/density.ts` | `stats/density.ts` | **new** suite `graphstats`: `bw.nrd0`, `density(…, kernel='gaussian')` evaluated exactly at the points. Today only hand-copied R values exist (`graph/test/charts.test.ts:101-107`). |
| km | `@ps/stats` KaplanMeier (existing, oracle `survival`) | ← `extent.ts:498-531` | existing |
| fraction | trivial | ← `whole.ts:93` | unit tests |
| difference | `tQuantile`, pooled / Welch (existing) | ← `extent.ts:62-117` | `ttest` suite (existing) |
| cell (+ z-scores, clustering) | `rowDistances`, `hclust` (`stats/src/gpl/hclust.ts`, oracle `cluster`) | ← `heatmap.ts:49-110` | existing |
| bin (stage 4) | FAQ 1660 widths shared with the Frequency distribution analysis (decision 63) | `stats/bin.ts` | `frequency` suite (extend) |

**Rule** (for CLAUDE.md, §9.3): any number a stat puts on a graph comes from `@ps/stats` with R oracle fixtures. Graph-side stat modules only group, order and reshape. Stat results are memoized per (normalized data set object, stat key), so bars + error + label sharing one summary compute it once (today `plotStats` runs once per series in `columnData`, `extent.ts:47-60`; the memo keeps that).

### 5.3 Shared services

| Service | Today | With layers |
|---|---|---|
| Category scale | Slots = series (`column.ts:118-120`) or rows (`grouped.ts:99-107`) | Trained from layers: data sets or rows, **plus slots contributed by a layer** (difference). Dodge width = `(slot × fill) / #dodged series` as `grouped.ts:104`. |
| Value extents | Family functions (`extent.ts:135-171, 277-326, 454`) | `∪ layer.extent(axis)` per geom (points shown, centre ± error, whiskers, density ends, stack ends, baselines, refline). Linked axes use the same function without text (`links.ts:70`). |
| Dodge / stack | Inline (`grouped.ts:104-107`), `stackCells` (`extent.ts:248-270`) | `positions.ts`. A stack is computed per layer across its visible series; attached layers read the segment. |
| Brackets | `touch()` tops per slot (`column.ts:124-127`), `tops` (`grouped.ts:110,367`), `layoutBrackets` (`annotations.ts:33-142`) | Every drawer returns a **skyline** (`{x, top}` in the vertical frame, including labels); brackets use the union, so they clear the tallest layer. The bracket code itself is unchanged. |
| Point labels | One `PointLabelLayer` (decision 122), fed by `pointNodes` | Unchanged: fed by points drawers (table, output and bubble points). `pointLabels` stays a data set identity field. |
| Legend | Per series with a family-chosen glyph (`legend.ts:109`, `xy.ts:423-487`) | Per series **across layers**: the glyph from the layers drawing it (bar, box or violin swatch > line + symbol), in layer order. Plus entries for output / function series not matched by colour (`xy.ts:434-457`), plus **scale legends** (bubble size, colour; heat-map colour bar). `layer.legend: 'hide'` drops a layer's contribution. |
| Orientation | `frameOf` / `flipNode` (`orient.ts:43-106`) | Unchanged; valid for `category` and `grouped` frames. |
| Right Y axis | `yAxis` per series (`yAxes.ts`) | Unchanged (identity); a stacked host puts its layer on the left. |
| Scale (`size.scale`) | `scaled.ts` | Unchanged (whole scene). |

### 5.4 Scene skeleton and element ids (the byte-identity contract)

The SVG writer emits `data-id` for every node with content and skips empty groups (`render/svg.ts:121-134`). Goldens therefore pin **ids, nesting, order and geometry**, but not targets. The engine reproduces each v1 family's skeleton through named **planes**:

| Frame (v1 family) | Plot-local groups, in order (empty ones vanish) |
|---|---|
| category (column) | `grandMean` (bare node), `estimation/guides`, `estimation`, `pairs`, `series`, `pointLabels` (`column.ts:436-449`) |
| grouped | `series`, `pointLabels` (`grouped.ts:413-435`) |
| xy | `bands`, `areas`, `curves`, `series`, `pointLabels` (`xy.ts:502-508`) |
| xy (survival) | `bands`, `series` (`survival.ts:143-146`) |
| xy (bubble) | `series` › `series/<yKey>`, `pointLabels` (`bubble.ts:305-307`) |
| polar / category (whole) | `series` (`whole.ts:430`) |
| matrix | `series`, `cellLabels`, `dendrograms`, `colorScale` (`heatmap.ts:291-296`) |

Within the `series` plane, each data set is a group `series/<key>` holding its layers' nodes in its order, then its labels. This is `MarkLayers.drawn()` (`theme.ts:299-301`) with layer ids in place of mark kinds; that is the **series-major** draw order v1 uses (`drawOrder: 'series'`, which every migrated graph gets, so stage 1 and 2 stay byte-identical). New graphs default to **layer-major** (`drawOrder: 'layer'`, the user's choice): the `series` plane holds one group per layer (`layer/<id>`) in list order, each holding that layer's marks for every data set in data-set order; ids keep the v1 part patterns (`series/<k>/bar/<row>` …) so selection and pointOverrides are unchanged, only the grouping differs. Per-data-set `order` applies only in series-major mode.

**Id rule.** A geom's marks keep their v1 ids: `series/<k>/bar/<row>`, `series/<k>/point/<row>/<i>`, `series/<k>/error/<row>/<i>`, `series/<k>/center`, `series/<k>/box/…`, `series/<k>/line/<k>`, `series/<k>/envelope/…`, `series/<k>/area/…`, `series/<k>/xError/…`, `series/<k>/slice/<row>`, `series/<k>/cell/<row>`, `curve/<i>/…`, `function/<i>/…`, `pairs/<row>`, `estimation/<k>/…`, `grandMean`.

A second layer of the **same geom** drawing the **same series** (impossible in v1) adds `@<layerId>` to the part: `series/a/point@means/3`. Existing graphs therefore keep every id, and new combinations get unique ones. `SceneNode` gains `layer?: LayerId` (not written to SVG) for selection and hover.

**Targets.** Stage 1 keeps v1 targets exactly; the shadow test (§8) compares them. Stage 3 switches marks to layer-scoped targets (still not in SVG, so goldens are unaffected):

| Element | v1 target | v2 target (stage 3) |
|---|---|---|
| A data set's marks in one layer | `['seriesOverrides', k, 'bar']` | `['layers', layerId, 'series', k]` |
| Data set identity (legend entry, colour) | `['seriesOverrides', k]` | unchanged |
| Single point / cell | `['pointOverrides', k, pt]` (selection) | unchanged |
| Output curve | `['extraSeries', i, 'line']` | `['layers', 'curves', 'series', seriesId]` |
| Function | `['functions', i, 'line']` | `['layers', 'functions', 'series', fnId]` |
| Chart-wide (`['style','heatmap']`, `['style','estimation']`, `['style','grandMean']`) | as is | `['layers', layerId]` |

### 5.5 Performance

- `compileV1` is cached per graph object (a WeakMap, like `axisExtent`'s cache, `links.ts:59`). v2 graphs skip it.
- Stat memo: see §5.2. Hover index (decision 79, `SceneSvg.tsx:256-275`) and hit testing are unchanged.
- Guards:
  - the existing large-input tests (`graph/test/largeArrays.test.ts`, 300k values);
  - a new CPU-time growth guard (`stats/test/timing.ts` `growthRatio`) for a 12-layer graph at 10k vs 100k values;
  - golden-set layout CPU time within 10% of the legacy path, measured in the shadow test (never wall-clock).
- Layer count is capped at 32.

---

## 6. Document and file format

### 6.1 Schema v2

- `CURRENT_SCHEMA_VERSION = 2` (`packages/model/src/project.ts:27`).
- `MIGRATIONS[1] = v1to2` (`packages/model/src/migrate.ts:10`), acting on raw JSON before zod (`migrate.ts:22-39`).
- It runs for everything that goes through `parseProject`: `.psproj` (`io/src/projectFile.ts:201`), `.pstemplate` (the same format), `.psmethod` (its embedded project, `engine/src/method.ts:105,159`) and recovery copies (Save's bytes).
- Older apps refuse v2 files with the existing "saved by a newer version" message (`migrate.ts:15-16`). That is acceptable for personal and lab use, and is stated in the release notes (open question Q7).

### 6.2 The migration (deterministic, total)

```
for each graph node (raw JSON):
  frame  ← FRAME_OF[graphType]          ('column.*'→category, 'grouped.*'→grouped, 'xy.*'|'survival.*'|'bubble.*'→xy,
                                          'whole.pie'|'whole.donut'→polar, 'whole.bar'→category, 'heatmap.*'→matrix)
  look   ← graphType
  layers ← compileV1(graph, V1_DEFAULTS[graphType])       // the same function stage 1 uses in memory
  seriesOverrides[k] ← pick(color, yAxis, pointLabels) + order ← mapMarkOrder(markOrder, layers)
  style.seriesDefaults ← same picks;  geom sections → layers[*].style / .series[k].style / .stat
  style.{arrangement, stack, nested, estimation, bubble, pie, grandMean, heatmap} → layers, aes, scales, polar
  extraSeries → outputs layers (order kept);  functions → functions layer
  delete graphType, extraSeries, functions
```

`compileV1` rules, as data-driven tables in `v1to2.ts`:

| v1 input | Output |
|---|---|
| A mark is shown by the resolved defaults (frozen theme → `seriesDefaults`) | A layer, with overrides that hide it becoming `series[k].hide: true` |
| A mark is hidden by default but shown by some override | A layer with `seriesHidden: true` and `series[k].hide: false` |
| Stat fields per section (`center.stat`, `error.stat`, `box.whiskers`, `violin.smoothing / extent`, `label.stat`, `points.replicates`) | The layer's `stat`; per-series differences go to `series[k].stat` |
| Style fields | `layer.style` (from `seriesDefaults`) and `layer.series[k].style` (from overrides) |
| Layer ids | Fixed names per role (`bars`, `box`, `violin`, `points`, `means`, `error`, `center`, `line`, `subjects`, `envelope`, `area`, `labels`, `pairs`, `diff`, `grandMean`, `subjectMeans`, `curves`, `curveBands`, `curvePoints`, `functions`, `curve`, `censor`, `ciBand`, `bubbles`, `slices`, `segments`, `cells`, `values`), so the output is deterministic and example fingerprints are stable |
| `markOrder` (per series) | `order`: kinds mapped to that graph's layer ids (`center` → `means` when replicates is `mean` on grouped dot plots) |

**Round trip.** `readProjectFile(writeProjectFile(p))` deep-equals `p` for v2, as today. A v1 file is migrated once on open and saved as v2. No field is dropped silently: the migration returns a **report** (e.g. the before-after connector edge case, §4.7), shown once as a notice after opening.

### 6.3 What happens to `graphType`

`graphType` is removed as a discriminator. Its information splits into:

- `frame`: what is drawn where;
- `layers`: what is drawn;
- `look`: which theme defaults apply. `look` uses the same 15 literals, so `theme.series[look]` (`theme.ts:170-248`) is reused byte-for-byte;
- `preset`: provenance, used by the builder only.

The code audit in stage 1 removes every drawing-side `graphType` branch (33 references across 34 files today; see the list in §9.1 of the stage plan). A test checks that `packages/graph/src/layers/**` never reads `look` except in the theme resolver.

### 6.4 Commands and undo

| Need | Mechanism |
|---|---|
| Edit a layer field | `node.set` with an **id path segment**: `path: ['layers', {id: 'bars'}, 'style', 'fill']`. `applyCommand`'s walker (`commands.ts:554-586`) resolves `{id}` to the array element with that `id`, the same checks as for other segments. Draft replays (decision 57) survive reordering because paths no longer depend on indices. |
| Add / remove / move / replace | New commands `graph.addLayer {id, layer, at?}`, `graph.removeLayer {id, layer}` (also removes attached layers, drops the id from every `order` and returns them for undo), `graph.moveLayer {id, layer, to}`, `graph.setLayers {id, frame, layers, look?, preset?}` (builder apply). Each builder OK or Layers edit is one undo step ("Change layers", "Add error bars"…). |
| Row edits (`remapGraphRows`, `commands.ts:321-405`) | Also visit `layers[*].series[*].stat` / `pointLabels.rows`. `pointOverrides` is unchanged. |
| Reuse (`engine/src/remap.ts:180+`), family (`family.ts:181`), apply, method, `removalSet` / `stripGraphRefs` (`commands.ts:432-475`), `nodeRefs` (`model/project.ts:60`) | One visitor `graphRefs(graph)` in `@ps/model` yields every node ref and data set key: seriesSource, `layers[*].data.series[*].ref` / `colorOf`, `layers[*].series` keys, `aes`, bracket ends and analyses, legend. All six callers use it, so none can miss a layer field. |
| Magic (`magic.ts:109-148`) | Copies `frame`, `look` and `layers` (styles, stats, positions) when "graph type" is ticked. It matches the target's layers by id, then by geom and position, and remaps `layers[*].series` by data set position (decision 30). Aes variables stay the target's own (as bubble today). |

---

## 7. UI and UX

### 7.1 The builder popup (replaces New graph, Graph type and Duplicate as…)

The layout follows the mockup the user approved on 2026-10-01 (graph builder, version 3): plot-style icons across the top, the layer table on the left, a live preview on the right.

```
┌─ New graph of “Weights” (grouped · 3 rows × 4 data sets) ─────────────────── Table: Grouped ┐
│ Presets  [Bars with points] [Scatter, mean ± SD] [Box with points] [Violin with box] …      │
│                                                                                           │
│ Raw values            Summaries                          Trends / Connections             │
│  (●)  (▭)  (◊)         (▇)  (─)   (I)   (43)              (╱)  (≈)  (◿)    (•-•)            │
│ Points Box Violin      Bars Mean  Error Values            Line Band Area   Join means       │
│                            line   bars                                                    │
├───────────────────────────────────────────┬───────────────────────────────────────────────┤
│ Layers, bottom to top          Summary     │ Preview                                       │
│ 1 ▇ Bars                  [Mean ▾]  ↑ ↓ ✕  │   ┌─────────────────────────────────┐         │
│     └ I Error bars        [SD ▾]    ↑ ↓ ✕  │   │   ▇ ▇ ▇    ▇ ▇ ▇    ▇ ▇ ▇        │         │
│ 2 ● Points                [All values ▾] ✕ │   │   ·:· ·:·  …                     │         │
│                                            │   └─────────────────────────────────┘         │
│ [ ] Horizontal   Groups [Side by side ▾]   │   (the graph as it will be, brackets too)    │
├───────────────────────────────────────────┴───────────────────────────────────────────────┤
│ Data sets ☑ WT ☑ KO ☑ Het ☐ Ctrl   Rows ☑ Day 1 ☑ Day 3 ☑ Day 7                            │
│ Make (•) One graph ( ) One per row ( ) One per data set                  [Cancel] [Create] │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Plot-style icons.** Round, flat icons, each a small picture of the geom, in the style of the R Graph Gallery's chart-type menu. They are grouped and tinted by family: raw values (points, box, violin, each replicate), summaries (bars, centre line, error bars, value labels), trends (line, band, area, step), connections (join means, before-after) and special frames (heat map, wedges, difference). The engine draws them from a tiny sample of the table's kind, so they match the real rendering and the user's palette.
  - Only geoms in the table's matrix row (§3) are shown.
  - Clicking an icon adds that layer, and clicking again removes it. A selected icon has an accent ring and a check badge.
  - Unavailable options stay visible, dimmed, with the reason in a tooltip and `aria-describedby`: "needs raw values", "not with stacked bars", "needs two or more data sets".
  - Icons of another frame (a heat map on a grouped table; bubble, heat map or columns on MV) are marked as frame choices: choosing one replaces the layer list, after a note.
- **Presets row.** One click fills the layer table with a whole look. A preset can be a text chip or a larger round icon drawn by the engine; that is decided in stage 3. Editing the table afterwards marks the preset "Custom" and keeps its highlight as provenance. The default is the table's natural preset (`defaultPresetFor`, `NewGraphDialog.tsx:37-41`).
- **Layer table (left).** One row per layer in drawing order, bottom to top (roadmap 33e: front first, the top row drawn in front, as in Illustrator or PowerPoint; decision 265). Each row has:
  - its small icon;
  - its name;
  - the dropdowns its stat and position need: summary (Mean / Median / Geometric mean; All values / Mean for points; SD / SEM / 95% CI / Range for error bars; whiskers for boxes);
  - ↑ / ↓ (and drag) to reorder;
  - ✕ to remove.

  Attached layers (§2.4: error bars, labels, centre lines) are indented under their host and move and delete with it; removing a host prompts. Graph-wide controls sit below the table: Horizontal (orientation) and Groups (side by side / stacked / 100%).
- **Live preview (right).** The graph laid out with `layoutGraph` on every change: a DraftStore for an existing graph, a temporary node for a new one. Debounced by 100 ms above 20k values.
- **MV tables.** A "Map variables" block (X, Y, Size, Colour; later Shape, Group) appears under the icons, only for multiple-variables tables.
- **Kept from NewGraphDialog.** Data sets, rows, Make (one per row / data set, share Y, place on a page) and the nested subject options (`NewGraphDialog.tsx:94-286`), in the bottom strip.

Entry points:

| Entry point | Behaviour |
|---|---|
| Graph toolbar button, Insert › New graph… | Builder on the current table |
| Format graph › Graph settings › "Change layers…" (replaces `GraphTypeSection`, `GraphSections.tsx:50-75`) | Builder over the existing graph (the draft), OK = one `graph.setLayers` step. Formats of layers that stay are kept (matched by id / geom). |
| Duplicate as… (`DuplicateDialog.tsx:37-80`) | The builder in "duplicate" mode: stacking and page options kept, the style list replaced by presets + checklist |
| `restyleGraph` / `retypeGraph` / `applyGraphPreset` (`presets.ts:318-390`, `factory.ts:215-257`) | Become `presetLayers(presetId, table)` + `graph.setLayers`. The per-family special cases (`showPointsForDotPlot`, `unstacked`, estimation `y2`) become matrix rules and layer-owned features. |

### 7.2 Format graph › Layers section

Appearance gets a left column (sketched back to front; since roadmap 33e it lists the front first, as the builder does, decision 265):

```
 Layers                         [+ Add ▾] [Duplicate] [Remove]
 ≡ 👁 ▣ Bars (mean)                          ← selected
 ≡ 👁    └ Error bars (SD)
 ≡ 👁 • Points (every value)
 ≡ ◌ ─ Line (mean)       (hidden)
 ───────────────────────────
 Data set: [All data sets ▾]  (as today's SeriesPicker, FormatDialog.tsx:442)
```

The right side shows the selected layer's fields. These are today's section components, re-hosted per geom, not rewritten, as decision 56 did:

| Geom | Section components |
|---|---|
| points | Symbols |
| bar | Bars and fill, Baseline |
| errorbar | Error bars, `ErrorBarsSection.tsx` |
| box | Box |
| violin | Violin, `ChartFields.tsx:269` |
| line | Lines / `XYLineFields` |
| label | Labels, `ChartFields.tsx:340` |
| tile | Heat map, `ChartSections.tsx:174` |
| wedge | Slices + Pie options |

A new **Stat** row at the top of each layer (Mean / Median / Geometric mean; error kind; whiskers) and a **Position** row (Side by side / Same position / Stacked / 100%) replace today's Centre and Arrangement sections (`GraphSections.tsx` `ArrangementSection`). "Drawing order" (`SeriesPanel.tsx:595`) becomes the list order; the per-data-set order moves to that data set's "Order" field. Colour and Y axis stay per data set, above the layer fields ("Data set: KO — Colour, Y axis, Point labels").

### 7.3 Canvas interactions

- **Click** on a mark selects *that layer's marks of that data set* (halo along those marks only; `selectionMatcher`, `SceneSvg.tsx:233-241`, matches the `['layers', id, 'series', k]` prefix).
- **Click again** on one of its marks selects the single point or cell, as now (`clickSelection`, `route.ts:261-282`).
- **Escape** steps back: point → layer × data set → nothing (then `escapeSelection`; now `stepOut` in `ui/src/selection/graphSelection.ts`).
- **Alt-click** (and the Layers list) selects the whole layer across data sets.
- **Double-click** opens Format graph › Appearance on that layer and data set (`formatTargetFor` gains `SeriesPick.layer`, `route.ts:11-16,46-107`).
- A legend entry selects the data set identity (all its layers).

Open question Q1 is whether the first click should instead select the data set across layers, as decision 61 does.

- **Context menu** on a mark: Format…, Hide this layer, Bring layer forward / backward, Remove layer, Add ▸ (error bars / labels on this layer, when allowed).
- Hover halos and the drill-down use the same index, keyed by `layer` + target.

### 7.4 Keyboard and accessibility

| Control | Keys and semantics |
|---|---|
| Builder presets | A `radiogroup` (arrow keys, Home / End) |
| Builder checklist | Checkboxes in tab order, each followed by its labelled `select`s. Disabled items keep focus and announce their reason. |
| Layers list | A `listbox`. ⌥↑ / ⌥↓ (Alt elsewhere) move the layer; Space toggles visibility; Delete removes (with undo); Enter opens its fields. Roadmap 47: multi-select (⌘- / Ctrl-click, Shift-click, Shift+↑ / ↓, ⌘A; `aria-multiselectable`), the actions acting on every selected layer (decisions 960–961). |
| Command registry | Every action is a command (decision 110): Format › Layers ▸ Add…, Move forward, Move backward, Hide / Show, Remove; Insert › New graph… opens the builder. |
| Preview | `role="img"` with an `aria-label` summarising its layers ("Bars of the mean with SD error bars and every point, 4 data sets"), regenerated from the layer list |
| Focus | Returns to the opener on close, as all dialogs do |

---

## 8. Staged implementation plan

### 8.1 Stage 1 (33a): the layer engine, byte-identical — **L**

Work:

1. `model/src/layers.ts` (types only, not yet in `GraphNode`) and `model/src/migrations/v1to2.ts` (`compileV1` + frozen v1 defaults), with no call site in the file path yet.
2. `graph/src/layers/**`, carved family by family from the layouts **by moving code verbatim**:
   - blocks become geoms: `column.ts:138-352`, `grouped.ts:113-370`, `xy.ts:129-420`, `survival.ts:74-130`, `whole.ts:218-420`, `heatmap.ts:187-300`, `bubble.ts:150-310`;
   - scaffolding becomes frames: scales, slots, compose calls.
3. `layoutGraph` routes each frame through `layoutLayers(compileV1(graph))` behind a per-frame switch. The legacy layouts move to `graph/src/legacy/` for the shadow test only. `axisExtent` (`links.ts:70-122`) goes through layer extents.
4. The UI is untouched: v1 targets are kept.

Acceptance:

- `pnpm check` green without `-u`: all 75 golden SVGs byte-identical, example fingerprints unchanged (`ui/test/exampleDocuments.test.ts`), `ANALYSES_VERSION` unchanged, `pnpm e2e` green in the three engines.
- **Shadow compile test** (`graph/test/shadow.test.ts`). For every golden case (`golden.test.ts:64-605`), every graph of every synthetic example (built through the Examples registry, as `exampleDocuments.test.ts` does), and the published examples when `source_data/` is present locally: `canon(legacyLayout(ctx)) ≡ canon(layoutLayers(compileV1(ctx.graph)))`.
  - `canon` is the whole scene as JSON: ids, **targets**, `point`, `labelOffset`, bboxes, prims, transforms, warnings, width / height / plot.
  - Axis mappings are sampled at 16 values.
  - Comparison is exact: no tolerance.
- **Property test** (fast-check, 500 runs, seeded). Random v1 graphs over `sampleTable(kind)` for every kind: graphType from `graphTypesFor`, any preset, random per-series overrides of `show` flags, stats, `markOrder`, `jitter`, `replicates`, orientation, arrangement / stack / gap, baselines, nested options, labels, point labels, right axis, and extra series from a fake result. Shadow must be equal.
- `axisExtent` equal on both paths for every golden (linked axes).
- CPU-time guard: golden-set layout within 10% of legacy; growth ratio guard at 10k / 100k values.
- A test that no module under `layers/` imports `GraphType` or reads `look` outside `theme`.

### 8.2 Stage 2 (33b): layers in the document, schema v1 → v2 — **M**

Work:

1. `GraphNode` v2 (§2.3); `CURRENT_SCHEMA_VERSION = 2`; `MIGRATIONS[1] = v1to2`.
2. The engine and model walkers use `graphRefs` (§6.4). New commands, and `node.set` id segments.
3. Creators become native. `createGraphFor`, `createGraphOfType`, `outputGraphsFor`, `outputSeriesFor`, `bracketsFromAnalysis` (`factory.ts`) return v2 via preset functions. The same applies to their callers: `App.tsx:390`, `NewTableDialog.tsx:128`, `ImportDialog.tsx:239,287,317`, `ExtractDialog.tsx:61`, `plotFunction.ts:22`, `AnalyzeDialog.tsx:197-211`, `graphActions.ts:85`, and the examples (`examples/synthetic/builder.ts:445`, 53 direct graph edits in `examples/**`).
4. The UI keeps its v1 behaviour, but its writes go to layer paths. `SeriesPanel`, `ErrorBarsSection`, `yAxis.ts` and `pointLabels.ts` get a layer-aware `set`; the paths listed in §5.4 are updated.
5. `bracketsFromAnalysis`' `graphType.startsWith('grouped.')` (`factory.ts:481`) becomes `frame === 'grouped'`. `workbooks.ts:57,105` and `resize.ts:213` use frame and outputs.

Acceptance:

- **v1 fixtures** committed under `model/test/fixtures/v1/`: every golden graph as a v1 project, the v1 JSON of every synthetic example (`EXAMPLE_JSON_DIR` before the change), hand-made exotic files (per-series `show` / `markOrder` overrides, stacks with points, before-after with a styled first data set, mixed extra series from two analyses, functions, output graphs), plus a `.pstemplate` and a `.psmethod`. For each: migrate → zod-valid → render → SVG byte-identical to the stage-1 golden or fixture render.
- `normalized(migrateProject(v1Example)) ≡ normalized(buildExample())` for every synthetic example. The fingerprint snapshots are updated in the same change, with this test showing the diff is exactly the migration.
- Round trip v2 write → read deep-equal. An older-version refusal test. Recovery copies of v1 open.
- Engine: every existing remap / family / apply / method / row-remap / removal test passes with v2 fixtures; new tests for layer refs, attached-layer removal and `order` cleanup; fast-check undo / redo round trips including the layer commands (decision 7 style).
- e2e green (dialog labels unchanged at this stage).

### 8.3 Stage 3 (33c): builder, Layers section, canvas selection — **L**

Work:

1. Builder (§7.1) replacing `NewGraphDialog` and `DuplicateDialog`'s style list.
2. "Change layers…" instead of `GraphTypeSection`.
3. The Layers section (§7.2).
4. Layer-scoped targets, `SceneNode.layer`, selection / hover / route changes (§7.3).
5. Commands in the registry.
6. Magic by layers.
7. Delete `presets.ts`'s graphType machinery.

Acceptance:

- Unit tests: matrix × presets (every preset valid for every table kind it lists), route and selection for layer targets, builder state reducer (pure, as `richText` is), the "Change layers" keep-formats rule.
- e2e in Chromium, WebKit and Firefox:
  - a grouped table → builder → Bars (Mean) + Points + Error bars (SEM) → graph (the user's example);
  - every preset per table kind (replacing `graphTypes.spec.ts`);
  - disabled options announce reasons;
  - keyboard-only creation;
  - Layers reorder / hide / remove / undo as one step;
  - canvas click → layer × data set halo → second click → point;
  - Duplicate with the builder;
  - heat map and bubble through frame choices.
- Goldens unchanged (targets are not in SVG). Any intended change is listed.

### 8.4 Stage 4 (33d): new combinations, retire legacy — **M**

New goldens (each also an e2e smoke check):

- violin + box + points;
- column line through means;
- grouped box + joined means;
- contingency 100% stacked;
- contingency heat map;
- XY stacked areas;
- XY step line;
- histogram from raw column data (`bin`, oracle `frequency`);
- stacked-percent labels;
- two points layers (each + mean symbol, `@` ids);
- MV scatter coloured by a text variable with lines by group (if Q4 allows `group`);
- band on grouped (time course kept as a grouped table).

Then delete `graph/src/legacy/` and the shadow test's legacy path. The v1 fixtures stay as migration tests.

Acceptance: the new goldens reviewed, all oracle suites green (`graphstats` added in stage 1), matrix documentation generated from `matrix.ts` into `DATA_MODEL.md` (a test keeps them equal).

### 8.5 Risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | Floating-point differences break byte identity (e.g. `x0 - w / 2` vs `x0 + (-w / 2)`) | Move code, don't retype it. Exact shadow comparison of whole scenes. Switch per frame, only when its shadow passes. |
| 2 | `compileV1` misses an exotic override combination | Data-driven rule tables; fast-check over per-series overrides; hand-made exotic fixtures; the migration report instead of silent loss |
| 3 | Theme defaults differ by chart type | `look` keeps `theme.series[look]` unchanged; replaced by per-geom defaults under context rules in roadmap 37 (Q3, decision 536) |
| 4 | Every reference walker (remap, family, apply, method, removal, rows) must learn layers | One `graphRefs` visitor in `@ps/model`, with a test that it visits every `NodeId` / `DataSetKey`-typed path of the zod schema (schema walk) |
| 5 | Undo paths break when layers move inside a draft | `{id}` path segments; property tests of undo / redo with the layer commands |
| 6 | UI churn (SeriesPanel 763 lines, GraphSections 708, route 287) | Re-host existing sections per geom (as decision 56 re-hosted panels); stage 2 keeps behaviour, stage 3 changes UX |
| 7 | Grammar generality overwhelms users of table-based tools | Presets first; the checklist only lists matrix-allowed geoms; explicit mapping only for MV |
| 8 | v2 files don't open in older builds | Clear message (existing); recovery and `.bak` untouched; note in release notes |
| 9 | Performance with many layers | Stat memo, layer cap, CPU guards |
| 10 | Scope creep into facets, free aes or smoothing | The non-goals in §1.3, and open questions that decide facets before roadmap 34 |

### 8.6 Rough effort

| Stage | Size | Code touched (est.) | New tests (est.) | Agent milestones |
|---|---|---|---|---|
| 1 engine | L | ~5.5k lines moved / refactored in `graph`, ~1.2k new (`compileV1`, planes, positions, extent) | shadow + property + stat oracle ~1.5k | 2–3 |
| 2 document | M | model ~0.8k, engine ~0.6k, creators and UI paths ~1k | fixtures + migration + engine ~1.2k | 1–2 |
| 3 UI | L | new builder ~1.2k, Layers ~0.6k, route / selection / commands ~0.5k, removal of old dialogs | unit ~0.5k, e2e ~12 tests | 2–3 |
| 4 combos | M | geoms / stats ~0.8k, legacy deletion −3k | ~12 goldens, oracle | 1 |

---

## 9. Architecture and documentation changes

### 9.1 ARCHITECTURE.md sections to rewrite

| Section | Change |
|---|---|
| §1 (DAG) | "Graph" box: `Graph (frame + layers) ──► Layout`; outputs feed output layers |
| §4 (plugin contract) | `outputs()` feed output layers (wording) |
| **§5 Graph engine** | Rewrite: frame + layers; the pipeline in §5.1; stats with the oracle rule; planes and the series-major assembly; id and target rules; the compatibility matrix; presets as functions |
| §6 Data model | "Graphs are a frame plus a list of layers (geom × stat × position); typed tables imply the mapping; multiple-variables tables map variables explicitly"; schema v2 |
| §7 Correctness | Add the shadow-compile test (while legacy exists), the v1 migration fixtures and the `graphstats` oracle suite |
| §8 Roadmap | Add 33 (below) and renumber the next set |
| §9 Risks | Replace "3. Graph editor depth" with "Graph grammar breadth vs table-based simplicity → matrix + presets" |

### 9.2 Decisions superseded or amended (from the log)

| # | Was | Now |
|---|---|---|
| 9 | Series follow the table; styles are sparse overrides over a theme | **Amended**: series still follow; styles are sparse per layer and per data set within it, with identity per data set |
| 20 | Curves are `ExtraSeries` linked on creation | **Superseded** by output layers (the series list moves into `layers[*].data`) |
| 25 | KM curves computed in the graph layout | **Restated**: the `km` stat (graph-side, `@ps/stats` numerics) |
| 27 | Contingency graphs reuse the grouped layout | **Restated**: contingency uses the `grouped` frame (matrix row) |
| 33 | Output graphs = XY graphs, no table series, outputs as extra series | **Amended**: `xy` frame with output layers only |
| 36 | Formatting as optional sparse overrides on the existing schema (no migration) | **Amended**: the sparse principle stays; layers are a schema migration (v2) |
| 44 | Floating bars are a `box.kind` of the box graph types | **Superseded**: `box` geom with `range` stat; box graph types removed |
| 59, 78 | "All data sets" writes `seriesDefaults` | **Amended**: writes `layer.style`; one data set writes `layer.series[k]` |
| 61 | `pointOverrides` keyed by table row / subcolumn | **Kept** (datum-level across layers) |
| 71 | Nested graphs are column graphs with `style.nested` | **Superseded**: points `dodge by subject` + implied shade / shape; subject means are a `center` layer |
| 77 | Right Y axis per data set (`SeriesStyle.yAxis`) | **Kept** as identity (all of a data set's layers) |
| 80 | Single bars / boxes reuse `pointOverrides r<row>` | **Kept**; per-layer mark overrides deferred (decision 234) |
| 81 | Drawing order as `markOrder` kinds | **Superseded**: layer order + per-data-set `order` of layer ids |
| 84 | Histograms are bars on the XY type (`bar.show`) | **Superseded**: `bar` geom (identity at X); `bin` stat added |
| 85 | Violins are a third `box.kind` | **Superseded**: `violin` geom + `density` stat (numerics moved to `@ps/stats` with oracle) |
| 86 | Estimation plots are a column graph type | **Superseded**: `difference` geom + floating secondary axis + composite preset |
| 87 | Bubble plots are a graph family | **Superseded**: points with MV aesthetic mapping + size / colour scales |
| 88 | Parts of whole as the `whole` family | **Superseded**: `wedge` on the polar frame; 100% bars as `bar·fraction·stack` |
| 89 | `graph.functions` | **Superseded**: a functions layer (same evaluation) |
| 215 | Orientation is a graph option (column and grouped) | **Kept** (category / grouped frames) |
| 217 | Stacked bars are an arrangement of `grouped.bar` | **Superseded**: position `stack` / `percent`, `gap`; attached error bars on segment ends |
| 218 | Bar baselines as a series style | **Restated**: bar geom style |
| 219 | XY time-course options as series styles | **Superseded**: line (gaps), line·identity by replicate (spaghetti), band (envelope), area layers; planes `areas` / `series` |
| 220 | X error bars from the table | **Restated**: the errorbar geom's X part |
| 222 | Heat maps as their own family | **Superseded**: `tile` on the matrix frame; clustering orders axes; colour scale graph-level |
| 226 | New graph Horizontal box, presets, Duplicate as… restyling | **Superseded** by the builder |
| 30 | Magic by data-set position | **Amended**: also by layer id / geom |
| 41 | Small multiples are ordinary graphs, not facets | **Kept** (Q4 resolved, roadmap 34d: linked separate graphs) |
| 56 | Format graph tabs | **Amended**: Appearance gains the Layers list |

### 9.3 New decisions

The log skips numbers (for example 163–169 and 211–214 are unused). New entries continue at **227**.

| # | Decision | Alternatives rejected |
|---|---|---|
| 227 | A graph is a **frame** (category, grouped, xy, polar, matrix) plus **layers** (geom × stat × position, sparse style, per-data-set overrides, data source) | Keeping graph types with more flags; a full ggplot grammar with free aesthetics |
| 228 | The table kind implies the mapping; explicit aesthetic mapping only for multiple-variables tables | Mapping for every table (breaks typed-table simplicity) |
| 229 | One compatibility matrix (`graph/src/layers/matrix.ts`) gates the builder, Layers, presets and validation; unsupported layers in a document are drawn as far as possible, with a warning | Rejecting documents; per-UI rules |
| 230 | Error bars, labels and centre lines are separate layers **attached** to a host (`on`): position, centre and skyline from the host | Options of the host geom (one dialog for the host); fully independent layers (ggplot: error bars would miss stacks and baselines) |
| 231 | Draw order is a graph setting: **layer-major** (all data sets' marks of a layer, layers in list order; ggplot) is the default for new graphs (user decision, 2026-10-01); **series-major** (a data set's layers together, per-data-set `order`) is kept for migrated v1 graphs so they render identically, and can be chosen in Format graph | Series-major only (v1); a free z-index |
| 232 | Scene ids keep v1 patterns; a second same-geom layer adds `@<layerId>`; `SceneNode.layer` carries the layer; targets become `['layers', id, 'series', key]` in stage 3 | Layer-prefixed ids (every golden changes) |
| 233 | `graphType` splits into `frame`, `layers`, `look` (theme-defaults family, the v1 value) and `preset` (provenance) | Keeping `graphType` as a discriminator; resolving defaults into documents (breaks "overrides, not values") |
| 234 | Datum overrides (`pointOverrides`) stay graph-level and unchanged; per-layer mark overrides deferred | Moving point formats into each layer (a second key space to remap) |
| 235 | `seriesOverrides` narrows to identity (colour, yAxis, pointLabels, order) and keeps its name | Renaming to `series` (churn across UI and engine) |
| 236 | Output and function series live in layers (`data: outputs \| functions \| layer`); extra series ids stay the series keys | A layer per analysis (reorders curves, changes ids) |
| 237 | Migration v1 → v2 is `compileV1` in `@ps/model` with frozen v1 defaults, deterministic layer ids, and a report of anything approximated | Migrating in `@ps/graph`; keeping v1 documents and compiling forever |
| 238 | Stage 1 proves the engine by shadow-comparing whole scenes (targets included) with the legacy layouts for every golden, every example graph and 500 generated graphs, exact equality | Golden SVGs alone (miss targets and hit-testing) |
| 239 | Graph statistics' numerics live in `@ps/stats` with oracle fixtures (`graphstats`: density; bins with `frequency`); graph-side stat modules only reshape | Keeping density in `graph/violin.ts` tested by hand-copied values |
| 240 | `node.set` accepts `{id}` path segments addressing array elements by id; layer commands `graph.addLayer / removeLayer / moveLayer / setLayers` | Index paths (break under reorder in drafts); a map of layers keyed by id (loses order) |
| 241 | One `graphRefs` visitor in `@ps/model` for every reference walker (remap, family, apply, method, removal, rows, `nodeRefs`), tested against a schema walk | Per-walker updates |
| 242 | A builder popup (presets, checklist, live preview) replaces New graph, Graph type and Duplicate as… styles; unavailable options stay visible with a reason | Hiding unavailable geoms; an "advanced" tab next to the old dialog |
| 243 | Canvas: first click selects a layer's marks of a data set, the second a point, Alt-click the whole layer (pending Q1) | The data set across layers |
| 244 | Estimation plots, heat-map clustering, before-after and bubble plots are **composite presets** over special geoms (difference, tile, connector) and graph features (floating axis, axis order, scale legends) | Keeping them as graph types |
| 245 | Scales: one `ColorScale` for heat maps and bubbles; a `SizeScale`; scale legends | Separate per-chart colour options |

### 9.4 DATA_MODEL.md changes

| Where | Change |
|---|---|
| §6.1 Node | Replace with `GraphNode` v2 (§2.3), `Frame`, `look` / `preset`; delete the `GraphType` union |
| New §6.1a Layers | `Layer`, `Geom`, `Stat`, `Position`, `LayerData`, `Aes`, attached layers, ids |
| §6.2 Style cascade | The four cascades of §2.5; `SeriesIdentity`; the per-geom style table |
| New §6.2a Compatibility matrix | Generated from `matrix.ts` (§3) |
| §6.4 brackets | "tops" → skyline from every layer |
| §6.4a–§6.4g | Keep as history, each field annotated "→ v2: layer X / stat Y" (the §4 mapping tables), so readers of old files can follow |
| §6.5 Scene graph | `layer?`; id rule with `@layerId`; v2 targets |
| §8.1 Commands | `graph.addLayer / removeLayer / moveLayer / setLayers`; `node.set` `{id}` segments |
| §9 Project file | "Migrations: v1 → v2 (roadmap 33): graphs to layers (§6.1a), deterministic, with a report"; templates and methods migrate through `parseProject` |
| §10 Correctness | `graphstats` oracle; migration fixtures |

### 9.5 CLAUDE.md additions

Under **Rules**:

> - Graphs are a frame plus a list of layers (geom × stat × position). Drawing code never branches on a table kind, preset or `look`: add or extend a geom, stat or position, with its entry in `graph/src/layers/matrix.ts`, theme defaults, legend glyph, extent, skyline and a golden. Numbers a stat draws come from `@ps/stats` with R oracle fixtures.
> - Migrations (`model/src/migrations/`) are frozen once released: never edit one, add the next. Every migration ships with fixtures of the old format that render identically after migrating.

Under **Tests** (while stage 1–3 legacy code exists):

> - `graph/test/shadow.test.ts` compares every graph's scene from the layer engine with the legacy layout (exact). Never loosen it; a difference is a bug in the layer engine.

### 9.6 Renumbered roadmap (next set)

| New # | Item | Was (proposed) | Why here |
|---|---|---|---|
| **33** | **Grammar-of-graphics graphs**: 33a engine (byte-identical), 33b layers in the document (v2), 33c builder, Layers and canvas selection, 33d new combinations and retiring the legacy layouts | — | The foundation every graph item below builds on |
| 34 | **Multiple-variables graphs**: colour / shape / size by variable on every MV geom, lines by group, jittered categorical X, and a decision on facets (Q4) | 39 | Layers + `aes` make it a builder feature instead of new families; it validates the mapping design early |
| 35 ✅ | **Results on graphs**: label and reference-line layers bound to analysis values (P, IC50, fit parameters, drop lines), inset result tables, output layers on category frames | 33 | Now "layers with an analysis source", not special cases. **Built** (roadmap 35, decisions 490–503): `data: { from: 'analysis' }` with the stat `result` on the label, refline and band geoms (templates with fields, lines, drop lines, bands), inset tables as annotations, the number at risk under survival graphs, brackets at one X and from a group to one, fits per group on graphs of variables; "output layers on category frames" are result layers there |
| 36 ✅ | **Axis extras**: per-layer secondary axes, X breaks and discontinuities, two-level category labels (grouped rows × data sets), log-scaled stats | 35 | Needs the scale training of 33. **Built** (roadmap 36, decisions 510–521) as the user scoped it: +/− treatment grids and two-level labels on category axes (keyed by category), broken axes with set piece lengths and marks on X and Y, listed ticks and text at values, lines and bands at typed values (result layers with a `values` source), scale bars and corner arrows; per-layer secondary axes and log-scaled stats deferred (decision 521) |
| 37 ✅ | **Preferences and styles**: saved layer stacks as user presets, default presets per table kind, per-geom theme defaults (retiring `look` if Q3 agrees). User presets and a default per table kind were brought forward into 33c (decisions 255–257) | 34 | User presets are just saved layer lists after 33. **Built** (roadmap 37, decisions 530–539): styles (fonts, lines, symbols, palettes, axis look, P values, figure widths) for projects and graphs with the user's edits kept, journal styles, the user's styles in a library and `.psstyle` files, Reset to style, Fit to column, Preferences; the theme table retired into per-geom defaults under context rules (Q3 below) |
| 38 | **Data manipulation** | 38 | Independent of graphs |
| 39 | **Import / interop**: pzfx graph definitions mapped onto layers, other formats | 37 | Mapping a .pzfx file's graphs is now a table from its graph types to layer lists |
| 40 | **Project organisation** | 36 | Independent |
| 41 | **Polish and desktop distribution** | 40 | Last before a release |
| 42 | **Consolidation**: an audit of `graph`, `model` and `ui` after 33–41 (dead code, docs, one helper where copies drifted, as audit step 3 / decisions 131–134) | — | Pays down the overhaul |

---

## 10. Decisions on the open questions (user, 2026-10-01)

1. **First click on a mark** selects that layer's marks of the data set; a second click selects the point; Alt-click the whole layer (decision 243).
2. **Draw order: by layer** for new graphs (all bars behind all points, as ggplot); migrated graphs keep by data set so they render identically; either can be chosen in Format graph (decision 231).
3. **Theme defaults:** keep `look` through roadmap 33; per-geom context rules in roadmap 37. **Resolved (roadmap 37, decision 536):** the per-chart-type table is per-geom defaults under context rules (`CONTEXT_RULES`), a style's values over every context; `look` stays in documents as the context's name (removing it would be a schema change, and migrated graphs' contexts can't all be derived from their layers), set from the layers by `lookFor` when they are built and read only by the style resolver `markDefaults`; nothing that draws branches on it. A test keeps the rules equal to the frozen v1 table, and every preset × table kind × context draws the same SVG.
4. **Facets: resolved (user, roadmap 34d) — linked separate graphs.** "One graph per level of a variable" (or per data set, or per row) makes a set of ordinary graphs (decision 41), each filtered to its level (`seriesSource.filter`), their axes linked through link groups (decision 40) or free, placed on a page in a grid with one legend; a new level in the table gets its graph. No facet type inside one graph (DECISIONS.md decisions 380–389).
5. **Error bars and labels** are separate layers attached to a host, indented under it in the builder and the Layers list (decision 230).
6. **The matrix is strict:** no expert switch.
7. **File compatibility is one-way:** older builds refuse v2 files with a message.

---

### Critical Files for Implementation

- `packages/model/src/graph.ts`
- `packages/graph/src/layout/column.ts` (with grouped.ts, xy.ts, survival.ts, whole.ts, heatmap.ts, bubble.ts: the code carved into geoms and frames)
- `packages/graph/src/theme.ts`
- `packages/model/src/migrate.ts` (with project.ts:27 `CURRENT_SCHEMA_VERSION`)
- `packages/ui/src/graph/NewGraphDialog.tsx` (with format/route.ts and inspector/SeriesPanel.tsx for stage 3)
