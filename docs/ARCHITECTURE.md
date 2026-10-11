# Architecture

A scientific analysis & graphing application for the lab: typed data tables, a statistics engine,
publication-quality graphs, and live linking between them.

> Naming: the app is statPlotter; it uses no other product's name or UI assets. Reading `.pzfx`
> files for interoperability is fine.

## 1. Core idea: the project is a reactive DAG

```
DataTable ──► Analysis ──► ResultTable ──► Analysis   (chaining, e.g. normalize → fit)
    │             │
    └─────────────┴──► Graph ──► Layout ──► Export (PDF / SVG / PNG / TIFF / JPEG), print, clipboard
```

- Every node has a stable ID, typed input refs (`DataSetRef = { nodeId, datasetKey }`), and params.
- Analysis outputs are result sheets, machine-readable values, comparisons (for brackets),
  graphable outputs (fitted curves, bands, ROC curves…) and, for table-producing analyses, a
  data table that other analyses and graphs can use.
- A mutation marks downstream nodes dirty → recompute in a Web Worker (inline in tests) →
  results cached by `hash(inputs, params, ANALYSES_VERSION)`.
- All edits are commands that produce Immer patches → undo/redo. The Format dialog edits a draft
  of the document (`DraftStore`, shown in its preview), committed on OK as one undo step. The
  docked Format panel and the format bar write straight to the document, one undo step per
  change, quick repeats of one field on the same selection merged into one (`DocumentStore.dispatch`
  with a `coalesce` key, within `COALESCE_MS` = 1.5 s of the last part; decision 883); the panel's
  Revert undoes the steps it made while they are the last ones (`graph/format/panelSteps.ts`).
- **Style is stored separately from data.** Enables Magic (match another graph's format), style
  presets, and applying an analysis to other tables.

## 2. Stack

| Layer | Choice |
|---|---|
| Language | TypeScript, `strict` (TS 7) |
| Targets | Web (Vite build, deployed to Cloudflare Pages) and desktop (Tauri 2), one codebase |
| UI | React 19; the document store lives in framework-free `engine`, React subscribes; icons from `lucide-react` |
| Commands | One command registry (`ui/src/commands/`) behind the menu bar, icon toolbar, ⌘K palette, keyboard shortcuts, context menus and the desktop app's native menus |
| Data grid | In-house virtualized DOM grid (`ui/src/table`) |
| Stats | In-house TypeScript library (no dependencies), run in a Web Worker, validated against R and NIST |
| Graphs | In-house layout engine → scene graph → SVG; text measured with fontkit against bundled fonts |
| Export | SVG and vector PDF (in-house writer, font subsets via fontkit) from the scene, on the web and desktop alike; PNG / TIFF (in-house encoders) and JPEG from that SVG drawn on canvases in tiles; print from a print-only SVG; clipboard: SVG + PNG (+ PDF on macOS desktop); data and results as CSV / TSV / xlsx (in-house writer) and as HTML tables + text on the clipboard |
| Schemas | zod 4 (document / file format, analysis params, auto-generated param dialogs) |
| Import | In-house CSV, XLSX (via `fflate`) and `.pzfx` readers sharing a small XML parser |
| Tooling | pnpm workspaces, Vite, Vitest, Biome, GitHub Actions |

## 3. Repository layout

```
packages/
  model/      Document schema (zod), table kinds, IDs, normalization, formula language, migrations
  engine/     Command/patch store, undo/redo, drafts, compute engine (dirty tracking, hashing, worker jobs)
  stats/      Pure numerics: distributions, special functions, linalg, descriptive, tests, ANOVA,
              regression, nonlinear fitting, ODEs, survival, random numbers
    gpl/      Numerics translated from GPL sources (e.g. R's clowess, zeroin, pnt). Isolated; see §7
  analyses/   Analysis plugins (params schema + form, run, result sheets, graphable outputs)
  graph/      Graph factory and presets, layout engine, scene graph, SVG renderer, fonts, page layout
  io/         CSV/XLSX/pzfx import, CSV/TSV/XLSX/HTML export, clipboard text, project file
  ui/         React: app shell and commands, navigator, grid, analysis dialogs, results, graph
              view and Format dialogs, canvas editing, layouts, examples, worker runner
    analysis/   Analyze dialog, parameter forms, results view, job status
    commands/   The one command registry: menus, toolbar, ⌘K palette, shortcuts, native menus,
                the keys each view handles itself (`viewKeys.ts`)
    components/ Shared widgets: dialogs, menus, menu bar, toolbar, colour picker, toasts, help
    drop/       Files dropped on the window, routed to import, open or a page's image
    export/     Data and results exported (CSV / TSV / xlsx), tables on the clipboard
    graph/      The graph view: canvas (scene SVG, overlay, drags, snapping, hover), exports,
                Match format, split graphs, the graph builder (`builder/`), inspector panels
      format/   The Format dialog (a draft, one step on OK) and the docked Format panel (roadmap 46:
                straight to the document, one coalesced undo step per change, Revert through
                `panelSteps.ts`), their sections by element, search and routes; a layer's
                view with its ‹ › arrows through the layers (`LayerSteps.tsx`, roadmap 49b)
    formatBar/  The format bar under the graph and page views (roadmap 45), its groups folding
                into More ▾ when narrow (roadmap 47)
    examples/   Example projects and the Examples dialog's cards, their thumbnails drawn ahead
                of time (`thumbnails.json`, roadmap 47); `private/` (development builds only,
                found by `import.meta.glob`, left out of the public repository: roadmap 48)
    import/     The .pzfx import dialog, cell rules, large-file import
    layout/     Layout pages: the page view, its items, drags, arrange, the inspector dock
    onboarding/ The getting-started checklist under the navigator (roadmap 47)
    organise/   Folders, the Family view, search, thumbnails, info sheets, Gallery, merging and
                the navigator's selection (roadmap 40, 47)
    reuse/      Templates, methods, Apply to other data, duplicate a family, sheet notes
    richText/   The rich text editor (titles, labels, text boxes) and its toolbar
    selection/  One selection model (roadmap 44, decision 850): what is selected on the graph
                canvas, on a page and inside a graph on a page, as keys; picking in a box,
                same-kind selection, the selection menu
    styles/     Styles, Fit to column and Preferences (roadmap 37)
    table/      The virtualized grid, formula bar, find, sort, fill and the data dialogs
    theme/      The app's light / dark colour scheme (roadmap 41)
    updates/    The desktop app's update prompt (roadmap 41)
    worker/     Web Worker runners: analyses, the figure export worker, CSV reading, saving
apps/
  web/        Browser entry (Vite), File System Access / download platform, dev-only source_data plugin
  desktop/    Tauri shell: native menus, file dialogs and access, atomic save, macOS pasteboard (PDF/PNG/SVG),
              files opened from the system, updates (roadmap 41)
  e2e/        Playwright end-to-end specs of the production build (Chromium, WebKit, Firefox;
              roadmap 24), their fixtures and helpers; `pnpm e2e`
tools/
  check-deps.mjs     package dependency rules
  e2e-affected.mjs   the e2e specs a branch's changes can affect (`pnpm e2e:affected`); `--check`
                     (in `pnpm check:deps`) fails on a spec no rule runs
  release-config.mjs the desktop release's extra Tauri configuration (updater, signing) and the
                     tag-is-the-version check (release.yml; docs/RELEASING.md)
  publish-public.mjs a version's tree, checked for leaks and verified, as one commit to the public
                     repository (roadmap 48; docs/PUBLISHING.md)
  lint/              Biome GritQL plugins (decision 131's hot-loop rules; decisions 771, 772)
  oracle/            R scripts (renv) → JSON fixtures in oracle/cases/
  nist/              NIST StRD certified datasets fetcher
docs/              ARCHITECTURE.md (this), ROADMAP.md, DECISIONS.md, DATA_MODEL.md,
                   FEATURE_COVERAGE.md, RELEASING.md, PUBLISHING.md
.github/workflows/ ci.yml (checks + web build + deploy), desktop.yml (Rust tests, macOS and Windows),
                   release.yml (installers on version tags), e2e-nightly.yml, visual-baselines.yml,
                   codeql.yml (code scanning, in the public repository only)
```

**Dependency rule** (enforced by `tools/check-deps.mjs`, run in CI):

| Package | May depend on |
|---|---|
| `stats`, `model` | nothing internal |
| `engine` | `model` |
| `analyses`, `graph` | `model`, `stats` |
| `io` | `model`, `graph` |
| `ui` | everything above |

The engine never imports analyses: it runs them through the `AnalysisDef` interface defined in
`model`, and the app wires the registry in. Node built-ins only in `*.node.ts` files; React only in
`ui`. `stats`, `analyses`, `graph` run headless (tests, worker). Test files may import other
packages' test helpers (the checker scans `src` only).

## 4. Analysis plugin contract

Defined in `packages/model/src/analysis.ts`:

```ts
interface AnalysisDef<P> {
  id: string                          // 'ttest'
  version: number                     // params schema version; bump + migrateParams on change
  title: string; category: string; description: string
  form: readonly FormField[]          // the Analyze dialog's fields (custom editors by component id)
  accepts: readonly TableKind[]       // gates the Analyze dialog
  inputs: { min: number; max: number }
  numbersByDefault?: boolean          // the dialog ticks number variables only (PCA)
  usesData?(params: P): boolean       // false: simulations, power without pilot data
  params: ZodType<P>                  // validation + file format; all fields defaulted
  migrateParams?(raw, fromVersion): unknown
  run(input: readonly NormalizedDataSet[], p: P, context?: RunContext,
      progress?: Progress): AnalysisResult  // pure; progress(done, total): roadmap 42
  producesTable?: boolean             // result.table can feed other analyses and graphs
  outputs?(inputKeys, p): OutputDecl[] // graphable outputs and output graphs it declares
  graphResults?(p, { tableKind, dataSets }): ResultTemplate[]  // roadmap 35: ready labels, lines, bands
}
```

`AnalysisResult` carries status and diagnostics, result sheets, values, comparisons (for
brackets), graphable outputs and an optional produced table in one serializable object, since it
crosses the worker boundary. Shared helpers for building results live in `analyses/src/common.ts`.

A run that can take long reports how far it has got through `progress(done, total)` (roadmap 42,
decisions 820–824): every so many iterations, never changing what it computes. The worker throttles
the reports to about ten messages a second, the engine keeps the latest of each running job beside
the results (`progressOf`), and the results view shows a determinate bar and the time left.

Adding an analysis = one plugin file + R oracle fixtures + registration in `analyses/src/index.ts`.
A change that alters results bumps `ANALYSES_VERSION` (cache keys); refactors must not. A
committed fingerprint of a fixed corpus of runs holds it to that (`ui/test/analysesFingerprint.test.ts`,
decision 731).

## 5. Graph engine

```
GraphNode (declarative, style-only) → layoutGraph (axes, ticks, legends, brackets, point labels,
  text metrics; laid out at plot size ÷ size.scale, then the scene scaled)
  → Scene graph (primitives tagged with semantic IDs and StylePath targets, e.g. ['axes','y','title'])
  → Renderers: React SVG (interactive canvas) | SVG string (export, clipboard, print) → PNG / TIFF /
    JPEG | PDF (content stream, embedded font subsets)
```

- All geometry in **points** (1/72 in). Graph size is a physical size (the plot area; the total
  size is derived).
- **Text measured with fontkit against bundled Liberation fonts**, never the browser, so layout
  is identical on screen, in exports, in tests and across OSes. The app starts with Sans and loads
  the other families when first needed; text is never measured with a family not loaded yet
  (`FontsPending`, decision 781).
- Scene targets drive editing: click → target → the Format dialog and tab for that element;
  canvas drags write offsets (titles, tick labels, brackets, point labels, legend) and resize the
  plot from handles on every side.
- Layout pages place graphs (linked, not copied) with alignment, stacking and panel labels, and
  lines, shapes, text boxes, images and live tables (roadmap 32).
- **Graphs as layers (roadmap 33, [design](design/GRAPH_LAYERS.md)).** A graph is a *frame*
  (category, grouped, xy, polar, matrix) plus *layers* (geom × stat × position, sparse style,
  per-data-set overrides, data source), in the document since schema v2 (roadmap 33b; v1 files
  migrate with `compileV1`, `model/src/migrations/v1to2.ts`). `layoutGraph` lays it out with the
  layer engine (`graph/src/layers/`): a scaffold per frame (`frames/`; the xy frame has
  survival, mapped-variable and histogram variants chosen by the layers' stats), geom drawers
  carved from the v1 layouts (`geoms/`), stat modules that only reshape (`stats/`; numbers from
  `@ps/stats`), positions, planes assembled by data set (v1, `drawOrder: 'series'`) or by layer
  (the default for new graphs: every layer's marks, frame-drawn ones too, in the list's order),
  per-geom theme defaults under context rules and a style (`theme.ts`; `markDefaults`, the only
  reader of `look`, roadmap 37), axis extents and linked
  axes from the layers (`links.ts`) and a compatibility matrix (`matrix.ts`, generated into
  DATA_MODEL.md §6.2a). The v1 layouts were retired with 33d. New graphs come from native presets (`presets.ts`: a table to a frame, a look and layers,
  decision 248) through the graph builder (`ui/src/graph/builder/`), whose plot styles
  (`plotStyles.ts`) and engine-drawn icons (`icons.ts`) also feed the Format panel's list of
  layers; marks target their layer (`layers/targets.ts`, decision 250), and the panels read and
  write layers. Every walker of a graph's references goes through `graphRefs` (decision 241).
  Graphs of a multiple-variables table's variables (roadmap 34) map them to the axes
  (`GraphNode.mapping`); a data adapter (`mapped.ts`) feeds the category, grouped and matrix
  frames a series per level of a text variable, and the matrix has kinds by the axes' types.
  More variables map to the points' colour, shape, size and labels (roadmap 34b): one set of
  scales (`aesthetics.ts`) and each row's look and legend guides (`layers/looks.ts`) for XY,
  category and grouped graphs of variables, what each acts on in the matrix (`AES_GEOMS`).
  Groups get ellipses and convex hulls (`polygon`), paths in row order and vectors (`path`,
  `segment`) on XY graphs, and a grouped PCA's score plot is a graph of its table of scores
  (roadmap 34c). Small multiples are sets of ordinary graphs (roadmap 34d): one per level of a
  text variable (a live filter on the graph's rows in data resolution, `graphRows`), data set or
  row, linked axes, placed on a page's grid; the engine adds a graph for a new level in the same
  undo step as the edit (`splitFollowUps`). Hovering a mark shows its row or statistics
  (`hover.ts` `markInfo`). A points layer of many points (roadmap 34e) is one point cloud,
  an image on screen from our own rasteriser and vectors in exports, hit through a grid; group
  names sit at the groups' centres. A cells table (roadmap 34f: more than 20,000 rows, or set)
  is offered no layer of a mark per row (the matrix's `ROW_MARK_LAYERS`); builder previews of big
  tables draw a sample of the rows, the latest click only; a bar layer binning a variable
  (`aes.x`) is a histogram of variables, a data set per level of its colour variable
  (`binned.ts`, through `resolveSeries`). On screen (`GraphContext.screen`) a data set draws at
  most 1,000 per-row points in its column or group, statistics and exports every row; a graph's
  per-row points count together for drawing them as images (decisions 450–455). Continuous
  axes and colour scales may be cytometry scales (roadmap 34g: arcsinh with a cofactor, logicle;
  `transform.ts`): data stay raw, positions are linear in the transformed values, and densities of
  a graph of variables' points — hexagons (`hex`), contours and filled bands (`contour`), density
  images (`raster`), points coloured by their local density, histograms' bins — are computed in
  those coordinates; dot plots (`dotplot` on points and tiles) summarise number variables by the
  levels of a text variable on the matrix frame (`frames/dotplot.ts`). A heat map's trees are
  dendrogram layers (roadmap 49c: the tiles' clustering drawn beside the map, cut as R's `cutree`),
  and a dendrogram alone is the matrix frame without tiles (`frames/tree.ts`). Results on graphs
  (roadmap 35) are layers with an analysis source (`data: { from: 'analysis' }`, stat `result`:
  labels of an analysis' values from templates with fields, lines and bands at them, drop lines
  from fitted curves; `geoms/result.ts`, drawn by every frame with value axes), resolved against
  the analysis' latest result at each layout; inset results tables are annotations, the number at
  risk under survival curves a block of the frame's layout (`layout/riskTable.ts`); brackets
  stand at one X of XY graphs or span a group of bars to one.

## 6. Data model

- Table kinds: XY, Column, Grouped, Contingency, Survival, PartsOfWhole, MultipleVariables, Nested.
  Kind is fixed at creation; changing kind is an explicit conversion.
- Cells are `number | null` plus a separate **exclusion mask** (exclude, never delete);
  multiple-variables tables also have text and calculated (formula) variables.
- Y columns have **subcolumns** (replicates) or an **entry format** (mean/SD/N, mean/SEM/N, …),
  normalized at the model boundary so analyses see one shape.
- Graphs are a frame plus a list of layers (geom × stat × position); typed tables imply the
  mapping; multiple-variables tables map variables explicitly (schema v2, roadmap 33b).
- Project file (`.psproj`): zip of JSON (`manifest.json` + one file per node), `schemaVersion` +
  migration chain (v1 → v2: graphs to layers, with a report shown once after opening; v2 → v3,
  roadmap 49c: a heat map's dendrograms as layers of their own). Cached results are saved with the analyses version they were computed with;
  images placed on pages as `assets/<id>.png|jpg` (their bytes live beside the document);
  tables of more than 100,000 cells keep their columns in binary entries (roadmap 34e).
- The full schema and every field's meaning: [DATA_MODEL.md](DATA_MODEL.md).

## 7. Correctness & testing

- **R is the oracle.** `tools/oracle/r/*.R` emit JSON fixtures (inputs → expected outputs,
  committed); Vitest compares at rtol ≈ 1e-10 unless a case documents otherwise. NIST StRD
  certified datasets for regression, ANOVA and nonlinear fitting (all 27 nonlinear problems, both
  starts). Tolerances are never loosened to make a refactor pass.
- **Graphs:** golden SVG snapshots of every graph type and the main variants
  (`graph/test/golden.test.ts`) — any change to rendering shows up as a diff; update them only
  for an intended change.
- **Shadow compilation (roadmap 33a–33c):** while the v1 layouts existed, every golden graph,
  every example graph and 500 seeded random v1 graphs laid out to exactly the same scene through
  the layer engine as through the v1 layouts (ids, targets, points, bounds, primitives,
  warnings, axis mappings and extents). Retired with the v1 layouts in 33d. Numbers graph layers
  draw come from `@ps/stats` with oracle fixtures (suite `graphstats`: violin densities;
  `frequency`: histogram bins, checked against R's `cut()`; `ellipse` and `hull`: roadmap 34c's
  confidence ellipses and convex hulls, against ggplot2, car, MASS and `grDevices::chull`;
  roadmap 35's `atrisk`: the number at risk against `survival::summary.survfit`; roadmap 49c's
  `cutree`: a dendrogram's clusters against R's `cutree`;
  roadmap 34g's `cytometry` (flowCore's logicle, arcsinh), `density2d` (MASS::kde2d, contours
  against `grDevices::contourLines`), `hexbin`, `dotplot` (Seurat's DotPlot) and `pretty`).
- **Migration fixtures (roadmap 33b):** every golden graph, every synthetic example and exotic
  graphs as v1 documents written by the 33a code (`graph/test/fixtures/v1/`), with a template, a
  method and a project file: migrated, valid, unchanged by a save and reopen, and rendered
  byte-identically (the golden SVGs; the stage-1 SVGs' hashes); every example built now equals
  its v1 document migrated and draws the same scene.
- **The compatibility matrix** (`graph/src/layers/matrix.ts`) is DATA_MODEL.md §6.2a, generated
  (`graph/test/matrixDoc.test.ts` keeps them equal); every preset, and every plot style the
  builder offers added to it, passes the matrix.
- **Safety nets:** every analysis on empty / one-value / constant / too-few-data-set inputs must
  not throw; every graph type × table kind lays out cleanly; example projects build identical
  documents (key-sorted fingerprints); large inputs (300k values) don't overflow the call stack.
- **Engine:** property-based tests (fast-check) for undo/redo round-trips and recompute consistency.
- **Performance guards** compare this thread's CPU time at k·n and n (`stats/test/timing.ts`),
  never wall-clock bounds, so they hold on a loaded machine.
- **CI** (`.github/workflows/ci.yml`): dependency rules, Biome, typecheck, tests and the web build
  on every push and pull request; pushes to `main` that pass deploy to Cloudflare Pages.
  `desktop.yml` runs the Rust tests on macOS and Windows when the desktop shell changes;
  `release.yml` builds the installers for each version tag and attaches them to a GitHub Release
  ([RELEASING.md](RELEASING.md), roadmap 41).
- **End-to-end:** Playwright tests of the production build in Chromium, WebKit and Firefox
  (`apps/e2e`, `pnpm e2e`); CI runs Chromium before every deploy and all three nightly; any
  console error fails a test (roadmap 24).
- Licensing: the project is GPL-3.0-or-later (`LICENSE`, `NOTICE`; audit 3, decision 1141), so
  translating GPL-2-or-later / LGPL code (mainly R's C numerics) is acceptable, but **only inside
  `packages/stats/src/gpl/`**, each file with an SPDX line, with the source cited in each file
  header (R's C, Fortran and R code; the R packages MASS and nortest (GPL); survival's `findq`
  (LGPL)). Hexagonal binning was rewritten clean from the published algorithm outside `gpl/`
  (hexbin is GPL-2 only, which a GPL-3 release can't include; audit 3, T1). Code under a
  licence that doesn't allow GPL-3 (GPL-2 only, say) never enters the repository. The logicle
  transform (`stats/src/cytometry/transforms.ts`) follows Moore & Parks'
  reference implementation, distributed in flowCore under the Artistic License 2.0, not the GPL,
  so it stays outside `gpl/`; the About box credits each (audit 2, decision 789). `@ps/model` can't import it: its
  formula statistics (`formulaStats.ts`) are written from published definitions (Hyndman & Fan's
  quantiles, C's `%g`, `cut`'s documented labels), not translated (audit 2, decision 684).

## 8. Roadmap

The roadmap's phases and the Versions table (the version history: every `v…` tag) are in
[ROADMAP.md](ROADMAP.md), moved there in audit 2. "§8 Versions" means its
[Versions](ROADMAP.md#versions) table.

## 9. Risks

1. Stats correctness at breadth → oracle tests are mandatory for every analysis.
2. Nonlinear fit robustness → per-equation initial-value rules.
3. Graph editor depth → semantic scene IDs + Format dialogs routed by element.
4. Screen/export drift → fontkit metrics + single SVG pipeline.

## Decision log

The decision log is in DECISIONS.md (not in the public repository), moved there in audit 2: "decision N"
anywhere in the repository means its row N.

See [DATA_MODEL.md](DATA_MODEL.md) for the full data model.
