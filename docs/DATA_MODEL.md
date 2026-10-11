# Data Model

Scope: the document (tables, analyses, graphs, layouts, info sheets), the engine that edits it,
results, the project file and the R oracle. It began as the Phase 1 vertical slice (Column table →
descriptives / t-tests / Mann-Whitney / Wilcoxon → column graphs → save/load/export), designed so
the other table kinds slot in without reshaping what exists, and grew with each phase.

Type sketches are TypeScript; the real definitions are the zod schemas in `packages/model`
(`table.ts`, `analysis.ts`, `layers.ts`, `graph.ts`, `other.ts`, `project.ts`), with the types
inferred from them. Where a sketch and a schema differ, the schema is right.

---

## 0. Principles

1. **The document is plain, serializable data.** No class instances, no functions, no typed
   arrays, no cached/derived values inside it. Everything derived (results, graph layout, the
   dependency graph) lives outside the document.
2. **Stable IDs everywhere links exist.** Analyses and graphs reference columns by ID, never by
   index, so reordering or renaming never breaks a link.
3. **Store overrides, not resolved values.** Styles are sparse overrides over a theme; params are
   exactly what the user chose.
4. **Numbers are stored as numbers.** No strings of what the user typed; display formatting is
   separate metadata.
5. **Undo covers the document only.** Selection, zoom, open tabs, and results are not undoable.

---

## 1. Identity

```ts
type Brand<T, B> = T & { readonly __brand: B }
type NodeId     = Brand<string, 'NodeId'>      // tables, analyses, graphs, layouts, info sheets
type ColumnId   = Brand<string, 'ColumnId'>    // a data set column within a table
type SeriesId   = Brand<string, 'SeriesId'>      // an analysis output drawn on a graph
type AnnotationId = Brand<string, 'AnnotationId'>
type LayoutItemId = Brand<string, 'LayoutItemId'>  // an item on a layout page (roadmap 32)
type GroupId    = Brand<string, 'GroupId'>        // page items moved as one (roadmap 32)
type FolderId   = Brand<string, 'FolderId'>       // a navigator folder (roadmap 40)
type AssetId    = Brand<string, 'AssetId'>        // an image: 32 hex digits of its SHA-256 (§7)
type LayerId    = string                          // a graph layer: /^[a-z][A-Za-z0-9]{0,23}$/ (§6.1a)
```

- Generated with a short random ID (nanoid, 12 chars of `[0-9a-z]`; `model/src/ids.ts`). Never
  reused within a project. The schema accepts only `/^[0-9a-z]+$/` (`ID_PATTERN`), so an id can
  never be `__proto__` or a path; lookups by id still use own-property checks (`nodeById`), since
  `constructor` is a valid id. Asset and layer ids are the exceptions noted above.
- `DataSetKey` is a string that identifies a graphable/analyzable data set **within a node**:
  - for a table: the `ColumnId`
  - for an analysis: an output key declared by the plugin (e.g. `'curve:A'`, `'residuals:A'`)

```ts
interface DataSetRef { node: NodeId; key: DataSetKey }
```

`DataSetRef` is the single linking primitive used by analyses, graphs, and later layouts.

---

## 2. Project

```ts
interface Project {
  schemaVersion: 2           // CURRENT_SCHEMA_VERSION (model/src/project.ts); v1 files migrate (§9)
  meta: { title: string; created: string; modified: string; appVersion: string }  // ISO times
  settings: ProjectSettings
  nodes: Record<NodeId, DocNode>
  order: NodeId[]            // navigator order; section (Tables/Results/Graphs/…) derived from node.kind
  folders?: Folder[]         // roadmap 40: the navigator's folders (absent: none)
}

// Roadmap 40 (decisions 590–592): the user's folders. Sheets keep `order`'s order inside them.
interface Folder {
  id: FolderId               // [0-9a-z]+, unique among folders
  name: string
  parent?: FolderId          // a folder in a folder, one level only
  members: NodeId[]          // the sheets filed here; a sheet is in at most one folder
}

type DocNode = DataTable | AnalysisNode | GraphNode | LayoutNode | InfoNode

interface ProjectSettings {
  pValueStyle: 'GP' | 'APA' | 'NEJM'     // controls P summary / asterisks; GP (default): ns, *, **, ***, ****
  pValueDigits: number                    // 1–15, default 4
  defaultConfidenceLevel: number          // in (0, 1), default 0.95
  theme: string                           // the project's style: 'default', a built-in's id
                                          // ('journal-nature' …) or 'user:<name>' (roadmap 37)
  style?: FigureStyle                     // its values, copied in (absent: the app's own look)
}
```

Old files hold `theme: 'default'` and no `style`: the app's own look, byte for byte. A project's
style is copied into it (`style`), so the file looks the same on any machine, whoever made the
style; `theme` only names it (a `theme` naming a built-in with no `style` resolves to the
built-in). P-value style and digits stay project settings: a style that sets them writes them here
when it becomes the project's (§6.2b).

**Folders** (roadmap 40, decisions 590–592) are optional project data beside `order`, which stays
the one order of sheets: a folder lists its members, the navigator shows them in `order`'s order,
and reordering never touches folders. `projectIssues` checks them (`folderIssues`: unique ids, a
parent that exists and has none, members that exist, each sheet in one folder at most). Folders
hold node ids, kept valid by the commands that remove, file, copy or merge sheets themselves (no
shared walker: `mapFolderMembers`, never called, went in audit 2, decision 764), not by
`graphRefs` (a folder is not a reference a graph makes, and nothing a graph draws depends on it):
`node.remove` drops removed sheets from their folders (the
folders stay, even empty); `node.add` files a new sheet in the folder it names (`folder`), else
in its source's folder (an analysis' table, a graph's table: what is made from a filed table is
filed with it); a duplicate goes in its original's folder; Duplicate family copies tables and
pages into their originals' folders and the rest follows the copied table; Import from project
recreates the other project's folders that hold imported sheets (new ids, names made unique).
In the by-kind navigator a folder shows in each section holding sheets of that kind (an empty
folder in every section, to drag sheets into), subfolders inside, then the sheets in no folder;
in the Family view folders hold whole families (a family is where its table is filed; Move to
folder there files the table's whole family). Which folders are folded is per user and per view
(browser storage), not in the document.

"Families" (a table plus everything downstream of it) are **derived** from the dependency graph,
not stored. `familyOf(project, table, layouts)` (`engine/src/family.ts`, roadmap 31) is what
removing the table would remove — its analyses, the analyses of their result tables, the graphs of
any of them and the analyses' own output graphs — plus the layouts whose graphs and live tables
(`pageSources`) all show the table or a member (`'whole'`), any of them (`'any'`) or none. Copied
pages keep their images (same asset ids), group ids and locks. Duplicate family, Apply to other tables, methods
and New graph like this copy (parts of) a family; see §8.1 "Reuse".

---

## 3. Data tables

### 3.1 One grid shape for all table kinds

Every table kind is the same grid: an optional X column, an optional row-title column, and
an ordered list of *data set columns*, each with N subcolumns. Table kinds differ in what X means,
which formats are allowed, and which analyses/graphs apply.

```ts
type TableKind =
  | 'column' | 'xy' | 'grouped' | 'contingency' | 'survival'
  | 'partsOfWhole' | 'multipleVariables' | 'nested'

interface DataTable {
  kind: 'table'
  id: NodeId
  name: string
  tableKind: TableKind                    // fixed at creation; conversion is an explicit command
  yFormat: YFormat                        // shared by all data set columns in the table
  rowCount: number                        // a whole number ≥ 0
  rowTitles: (string | null)[] | null     // null = row-title column hidden
  rowTitlesRich?: (RichText | null)[]     // formatted row titles (roadmap 28), spliced with the rows
  x: XColumn | null                       // XY and survival tables only; every other kind: null
  dataSets: DataSetColumn[]               // ordered; order = default graph/analysis order
  notes: string                           // free text (an "info" per table), default ''; edited above the grid (roadmap 31)
  columnWidths?: Record<string, number>   // grid widths in CSS px (24–1200; roadmap 29), by columnWidthKey
  cellsTable?: boolean                    // multiple variables: a cells table or not (roadmap 34f, §6.1h); absent = by its rows
  limits?: LimitRule                      // how cells at a detection limit are substituted (roadmap 39, §3.3a)
}

interface DataSetColumn {
  id: ColumnId                            // unique in the table
  title: string
  titleRich?: RichText                    // the title formatted (roadmap 28); absent when plain
  subcolumns: CellColumn[]                // length === yFormat roles length (or replicate count)
  subcolumnTitles?: (string | null)[]     // nested tables: subjects
  subcolumnTitlesRich?: (RichText | null)[]
  text?: (string | null)[]                // multiple variables: a text variable's values by row (§3.5)
  formula?: string                        // multiple variables: a calculated variable (§3.5)
  display?: NumberDisplay                 // how the grid shows the numbers (roadmap 29); display only
}

interface CellColumn {
  type: 'number'                          // reserved (default 'number'); text lives in DataSetColumn.text
  values: (number | null)[]               // length === rowCount; null = empty cell
  excluded?: boolean[]                    // length === rowCount when present; absent = none excluded
  limit?: ({ side: 'below' | 'above'; text: string } | null)[]   // roadmap 39 (§3.3a); absent = none flagged
}

interface XColumn {                       // used from Phase 2 (XY) onwards
  title: string
  titleRich?: RichText
  subcolumns: CellColumn[]                // [x] or [x, xError] depending on xFormat
  xFormat: 'numbers' | 'numbersWithError' | 'dates' | 'elapsed'
  display?: NumberDisplay                 // as DataSetColumn.display (roadmap 29)
}
```

**Invariants** (`tableIssues`, run by the schema's refinement on load and on every change the
store validates, §8.1):

- Every `values`/`excluded`/`limit`/`text`/`rowTitles`/`rowTitlesRich` array has length
  `rowCount`; `rowTitlesRich` only beside `rowTitles`.
- Every data set column has exactly as many subcolumns as `yFormat` implies; data set ids are
  unique within the table.
- The `yFormat` is one the table kind allows (`isYFormatAllowed`: column tables one replicate or a
  summary, then exactly one row; nested tables replicates only; contingency, survival, parts of
  whole and multiple variables one replicate; XY and grouped anything); at most 256 replicates
  (`MAX_REPLICATES`).
- XY and survival tables have an X column, with the subcolumns its `xFormat` needs; others none.
- `text` and `formula` only in multiple-variables tables, never both on one variable.
- All stored numbers are finite. Empty is `null`, never `NaN`.
- Row insert/delete is one command that splices *every* parallel array together.

**Formatted titles** (roadmap 28, decision 145). Data set, X, row and subcolumn titles may carry
a rich form beside the plain one: `titleRich`, `subcolumnTitlesRich`, `rowTitlesRich`. It is
stored only when formatted (`isFormatted`: sup/sub/bold/italic/underline/font), and always
spells the plain title, which analyses, results, exports, the clipboard, formulas and imports
keep reading unchanged. `titleRuns(title, rich)` is the one reader: the rich form when its plain
text is the title, else the plain title, so a plain edit that leaves a rich form behind can never
show stale text. `rowTitlesRich` has one entry per row (null = plain) and is spliced with the
rows; it exists only beside `rowTitles`. Older files have none of these (no schema change).

**Grid appearance** (roadmap 29, decisions 174–175). `display` (data sets and X) is a
`NumberDisplay` (§6.3: fixed decimals, scientific, ×10ⁿ, percent, thousands; `auto` with
`thousands` = the value as entered, grouped) and changes only what the grid shows: the cell
editor, copies (⌘C, Copy with titles), exports ("as displayed" included: a data table exports in
full), graphs and analyses keep every digit. `columnWidths` maps `columnWidthKey` — a data set's
id (each of its subcolumns), `'x'` or `'rowTitle'` — to a width in CSS pixels (24–1200); columns
without one size to their content. Removing a data set drops its width. Both optional, so older
files load unchanged (no schema bump).

**Why parallel arrays and not cell objects:** row splices stay trivial, JSON stays compact, and
Immer patches for a single-cell edit are a single-index replace. **Why not typed arrays:** Immer
can't patch them per-index, so a one-cell edit would store the whole column in undo history.
Typed arrays appear only in the normalized view (§4).

**Large tables (roadmap 34e).** A table of a million rows keeps these plain arrays. The store
freezes the document but arrays of 10,000 elements or more (`BIG_ARRAY`, `freezeDoc`): V8 keeps a
frozen array of numbers as boxed values (three times the memory, seconds to freeze). Nothing
writes them in place: an edit copies its own column once (its patch is the cell); row inserts
and deletes replace each per-row array whole (one patch each, not one per shifted cell; the
history keeps a large one's rows, §8.1). The schema checks per-row arrays (`values`, `excluded`,
`limit`, `text`, `rowTitles`) in one loop each and keeps them as they are (`CellValues`,
`TextValues`; zod's array schema copied them element by element), the first wrong element
reported at its index as before; the store skips those it checked already (§8.1).

### 3.2 Y formats

```ts
type YFormat =
  | { type: 'replicates'; count: number }           // Column tables: count = 1 (values stacked in rows)
  | { type: 'summary'; preset: SummaryPreset }       // pre-computed summaries entered by the user

type SummaryRole = 'mean' | 'sd' | 'sem' | 'cv' | 'n' | 'upper' | 'lower' | 'plusErr' | 'minusErr'
```

The file stores a preset name, never a free list of roles; roles (in subcolumn order) come from
`SUMMARY_PRESETS` in `model/table.ts`:

| Preset | Roles |
|---|---|
| `meanSdN` | `mean, sd, n` |
| `meanSemN` | `mean, sem, n` |
| `meanCvN` | `mean, cv, n` |
| `meanSd` | `mean, sd` |
| `meanSem` | `mean, sem` |
| `meanPlusMinus` | `mean, plusErr, minusErr` |
| `meanUpperLower` | `mean, upper, lower` |

For a **Column** table with a summary format, each data set is one row (one group = one column).

**Changing the format** (roadmap 31, decision 207): `table.setYFormat` converts the values
(`convertTable`, `engine/src/entryFormat.ts`; `canConvert` says which pairs convert):

- replicates → `meanSdN`, `meanSemN`, `meanCvN`, `meanSd`, `meanSem`: each row's replicates (a
  column table: each data set's stacked values, giving one row) summarized — mean, sample SD
  (n − 1; none for one value), SEM = SD/√N, CV = SD/|mean| (a fraction), N — excluded values left
  out; subcolumn titles dropped; row references past a column table's one row dropped;
- among those five: exact given N (SD = SEM·√N = CV·|mean|), values rounded to 15 significant
  digits; a spread that can't be derived (an SEM without N) is left empty and counted as lost; a
  cell stays excluded when the value it comes from was;
- `meanPlusMinus` ↔ `meanUpperLower`: upper = mean + plus, lower = mean − minus;
- not offered: summaries → replicates, the SD family ↔ ± errors / limits.

`Conversion.lost` counts entered values replaced or not carried over, which the dialog states
before OK. Replicate counts change with `table.setReplicateCount`.

### 3.3 Exclusion

Excluded values stay in the table (shown blue/italic), are ignored by every analysis and by graph
summary statistics, and are optionally drawn with a distinct style. Analyses report how many values
were excluded. Exclusion is per cell, stored in `CellColumn.excluded`.

### 3.3a Values at detection limits (roadmap 39)

Cells imported from text such as "<0.5", "≤ 0.5 ng/mL", ">ULOQ", "BLQ" or "below LOD" hold a
substitute number and a flag beside it (decisions 575–578; `model/src/limits.ts`):

```
CellColumn.limit?: ({ side: 'below' | 'above'; text: string } | null)[]   // by row; absent: none
DataTable.limits?: {                                                       // the rule
  below: { method: 'half' | 'limit' | 'sqrt2' | 'blank' | 'fixed'; value?: number }
  above: { method: 'limit' | 'blank' | 'fixed'; value?: number }
  lower?: { all?: number; columns?: Record<ColumnId, number> }   // limits of cells naming none
  upper?: { all?: number; columns?: Record<ColumnId, number> }   //   ("BLQ", "ULOQ+")
}
```

The value is the substitute (L/2, L, L/√2, empty, or a fixed number below; L, empty or a fixed
number above), L the number in the text or, for a word, the limit typed for its data set or for
all (none: empty unless the rule is a fixed value). The text is kept (at most 200 characters) so
`table.setLimits` (Edit › Limits…) substitutes again under another rule (`resubstitute`), in one
undo step; `rule: null` drops the rule and the flags, the values staying. Flags follow their rows
(inserts, deletes, sorts); a value typed over a flagged cell clears its flag; converting the entry
format drops them; X cells at a limit are substituted unflagged. Only Y subcolumns carry flags.
Analyses use the substituted numbers like any value; the results of an analysis of a flagged
table say how many and by which rule. The grid marks flagged cells (a corner, ‹ or ›, the text
in the tooltip). Graphs draw them as open symbols through single-point formats
(`pointOverrides[key]['r<row>s<sub>'].fill = none`, `graph/src/limitPoints.ts`): the graphs made
at import do, and Limits… turns it on or off for every graph of the table. Optional fields only:
no schema bump; older files read unchanged.

### 3.4 Contingency and survival tables (Phase 4)

Both use the same grid with one value per cell (`replicates`, count 1):

- **Contingency**: rows are groups (row titles shown by default), data sets are outcomes, cells
  are counts (non-negative integers). Analyses use every row with at least one value; a partly
  filled row is an error. `contingencyCounts(input)` in `model/normalize.ts` builds the matrix.
- **Survival**: one subject per row, the usual layout. X is the elapsed time (title
  "Days elapsed"); the subject's code goes in its group's column, all other groups blank.
  1 = event, 0 = censored by default (the analysis can use other codes). `survivalData(ds)`
  returns the subjects plus counts of rows with no usable time or an unknown code.

**Parts of whole** (roadmap 17): each data set is a whole (one pie), each row a part (a slice),
named by its row title (row titles are shown from creation); one value per cell (`replicates`,
count 1). Graphs take the parts of each whole as fractions of its total; negative values are left
out with a warning, and rows empty in every data set are not parts.

**Multiple variables** (Phase 6, roadmap 19): each data set is a variable, each row an
observation (one value per cell). Regression and PCA use complete cases across the chosen
variables. A variable is numeric, text (categorical) or calculated (§3.5).

### 3.5 Future kinds, reserved now

- **MultipleVariables** (roadmap item 19): a variable (`DataSetColumn`) may be a **text
  (categorical) variable**, `text: (string | null)[]` by row, or a **calculated variable**,
  `formula: string` (e.g. `=Weight/Height^2`) whose values are derived when the table is read and
  never stored. In both cases the numeric subcolumn stays empty, so every numeric code path is
  unchanged; analyses see `NormalizedDataSet.text` / `.formula`. Both are allowed in
  multiple-variables tables only (`tableIssues`). `CellColumn.type` stays `'number'`.
  - *Text variables*: `text[r]` is the cell's text, null when empty (a blank string is stored
    as null). Their normalized numeric data are all NaN; `counts.empty` counts empty cells. Rows
    are inserted / deleted in `text` with every other per-row array.
  - *Calculated variables* (`model/formula.ts`): the formula language is a safe in-house
    recursive-descent parser and interpreter (no `eval`). Variables by title without case
    (`Weight`, `Body_weight` for "Body weight", `[Weight (kg)]`); numbers; `pi`; text in quotes;
    `+ - * / ^` (power right to left, `-2^2 = -4`); comparisons `= <> < <= > >=` (also `==`,
    `!=`) giving 1 / 0; `and`, `or`, `not` between conditions (roadmap 38: looser than
    comparisons, `and` before `or`; a variable named so needs `[ ]`); the functions of the
    reference below (`FORMULA_FUNCTIONS`, 74 since roadmap 38). Text compares with text by `=` /
    `<>` only (trimmed, without case); text cells are read as their levels (trimmed). The result
    is a number, or text (roadmap 38: a **calculated text variable**, below). Evaluation is by row: a needed value that is empty or excluded gives no
    value (NaN); a result that isn't finite (ln of a negative, division by zero) gives none too
    and is listed in `invalidRows`. Whole-formula errors (syntax, unknown or ambiguous name, a
    type error, a circular reference, or using a calculated variable that has an error) leave
    the column empty with `error`. `tableFormulas(table)` returns `FormulaValues` by data set
    id, memoized per `dataSets` array and per variable while the variables it uses (and the
    titles) are unchanged; `normalizeDataSet` gives a calculated variable these values
    (`data.reps[0]`, `counts.empty` = rows without one). So analyses, graphs and the engine's
    input hashes see computed numbers, and an edit reruns only analyses whose inputs' values
    change.
  - *Function reference* (roadmap 38; `FORMULA_FUNCTIONS` in `model/src/formula.ts`, which
    the formula bar's ƒx reference and autocomplete read):

    | Kind | Functions |
    |---|---|
    | Maths | `ln log(x[, base]) log10 log2 exp sqrt pow abs sign round(x[, digits]) floor ceil int mod(x, y) clamp(x, lo, hi) min max sum mean logit expit asinh sin cos tan asin acos atan` |
    | Logic | `if(test, then, else) ifs(t1, v1, …[, otherwise]) case(x, m1, v1, …[, otherwise]) iferror(x, alt) coalesce(a, b, …) and or not isblank isnumber istext` |
    | Statistics (over the column, or within the groups of the trailing arguments) | `median(x[, g…]) sd(x[, g…]) var(x[, g…]) quantile(x, p[, type[, g…]]) rank(x[, ties[, g…]]) zscore(x[, g…])` |
    | By group (no group: the column) | `meanby medianby sumby countby sdby minby maxby (x[, g…])` |
    | Running down the rows | `cumsum(x) lag(x[, k]) lead(x[, k]) diff(x)` |
    | Text | `concat upper lower left(t[, n]) right(t[, n]) mid(t, start, n) len trim replace(t, find, with) contains startswith endswith text(x[, digits]) value(t)` |
    | Categories | `recode(x, "old", "new", …[, otherwise]) cut(x[, "(]"\|"[)"], b1, b2, …[, labels…]) cutwidth(x[, closure], n[, labels…]) cutquantile(x[, closure], n[, labels…])` |

    `min max sum mean` stay lists across the row's arguments (as before); the statistics take
    one variable over every row (`median(x)` is the column's median, `meanby(x)` its mean).
    Missing (empty, excluded) values are left out of every statistic (R's `na.rm = TRUE`); a
    row whose group value is blank, or whose own value a per-row result needs (`zscore`,
    `rank`), gets none. Quantiles are R's `quantile(type = 1…9)`, 7 by default; ranks R's
    `rank(ties.method = "average" | "min" | "max" | "first", na.last = "keep")`. Results a
    function leaves blank by design (`lag`'s first rows, a group of one value's SD, a `case` or
    `ifs` without a match, a value outside `cut`'s breaks) are blank, not invalid (#NUM).
    `iferror(x, alt)` gives `alt` where x has no value though every input of the formula is
    there; `coalesce` the first argument that isn't blank. Text functions treat a blank input
    as missing; `contains`/`startswith`/`endswith` ignore case, `replace` doesn't; `recode`
    matches levels exactly (trimmed, case kept, as graphs tell levels apart), `case` as `=`
    does. `cut` follows R's `cut(x, breaks, right, include.lowest = TRUE)`: right-closed
    `(a, b]` unless `"[)"`, the lowest (highest) end included, labels R's (`formatC(…, digits =
    3)`, C's `%g`: an exactly representable half rounds to even, 1.125 → 1.12; more digits until
    neighbours differ) written `(a, b]` with a space after the comma;
    `cutwidth` takes R's breaks for `cut(x, n)` (the range's ends moved out by a thousandth),
    `cutquantile` the type-7 quantiles 0, 1/n, …, 1; breaks that aren't distinct, or labels not
    one per interval, are column errors. Statistics are computed once per evaluation (each
    column's values, groups and sorted values cached), so a formula over a million rows stays
    O(n log n) (growth guards at 100k vs 1M rows, `model/test/formulaFunctions.test.ts`).
  - *Calculated text variables* (roadmap 38, decision 552): a formula whose result is text
    (`concat`, `recode`, `cut`, `if` with text branches…) gives `FormulaValues.text`;
    normalization gives it `NormalizedDataSet.text` (analyses see a text variable), the grid
    shows its text (read-only), and `resolvedTable(table)` — what `sourceTable` returns for a
    data table, and what split follow-ups read — carries the values as the column's `text`
    (without its formula), so graphs, levels, colours, shapes, splits and the builder treat it
    as a text variable. Derived, memoized per table object; a table without text formulas is
    itself. "Convert to values" makes it a text variable; Make numeric reads numbers from its
    text.
  - *Hashes*: `hashDataSet` adds the text values and the formula when present (absent, keys are
    as before).
  - *Info constants* (roadmap 40, decisions 595–597): `[Info: dilution]` and
    `[Sheet name: dilution]` read a numeric field of the project's info sheets, bound to the
    table when it is read (`withConstants`), live, renames followed; see §7 (Info sheets).
  - *Editing* (`ui/src/table`): text cells show left-aligned; the header marks text ("abc") and
    calculated ("ƒx", red with the error as its tooltip) variables. Typing text into a numeric
    variable offers to make it a text variable; pasting words into one does it (missing-value
    marks such as NA paste as empty), and pasting past the last column adds text variables for
    columns of words. A first pasted row of text is a header when a column has a number below it
    or none of its cells repeats below (categories repeat, names don't). Calculated cells are
    read-only, "#NUM" where the formula gives no number. A formula bar above the grid shows the
    focused variable's kind (numbers / text / calculated, switchable), its formula (edited in
    place; Enter or leaving the field applies it) and error or count of invalid rows, "Convert
    to values", and "+ Calculated variable" (a name and a formula). Typing `=…` over a
    variable's name in its header makes it calculated.
  - *Extract and rearrange* (`extractVariables`, `model/extract.ts`): numeric or calculated
    variables into a new column table (variables side by side, rows matched; or one variable
    split by the categories of a text variable) or grouped table (a second text variable's
    categories as rows, replicates side by side). A copy made by a dialog in the table view,
    with a graph; values in rows without a category are counted as left out.
  - *Data manipulation dialogs* (roadmap 38, decision 551; `ui/src/table/DataDialogs.tsx`,
    formulas from `variableFormulas.ts`), each adding calculated variables in one undo step:
    **Transform variables** (log10, log2, ln, log base K, √, 1/x, z-score, 0–1 or % of the range,
    rank, logit, arcsinh(x / cofactor), minus or divided by the mean or median; the statistics
    optionally within each group of a text variable: `zscore(x, g)`, `x - medianby(x, g)`,
    `(x - minby(x, g)) / (maxby(x, g) - minby(x, g))`…; titled "CD4 z by sample");
    **Recode levels** (a table of a text variable's levels → new levels, merging by sharing
    one; levels not listed kept or blank: `recode(type, "CD4 T", "T", …[, ""])`, read back to
    edit); **Bin a variable** (cut points, equal widths or quantiles, closure, automatic or
    custom labels: `cut`, `cutwidth`, `cutquantile`; a preview of the levels and counts). They
    follow their sources live and are renamed with them (decision 98); no new reference
    kind: formulas name variables by title, so nothing new is walked by `graphRefs`.
- **Nested** (Phase 13): a data set is a treatment group, its subcolumns are the subjects in it
  (mice, donors…; `DataSetColumn.subcolumnTitles` names them) and rows are replicate measurements
  of a subject. `yFormat` is replicates with count = the most subjects in any group (summary
  formats are not allowed).
  - *Normalization* is the replicate view unchanged: `data.reps[k]` is subject k's measurements
    by row (NaN = empty or excluded). A group with fewer subjects than the widest has trailing
    subcolumns that are all NaN; analyses and graphs skip subjects without values. Subject titles
    are not part of the normalized view (graphs read them from the column).
  - *Editing*: `table.setReplicateCount` adds or removes the last subject subcolumn of every
    group (values and titles of removed ones go, undoably); `table.setSubcolumnTitle` names a
    subject (null clears; an all-null title list is dropped). The grid shows subject names in its
    second header row ("Subject k" when untitled). Pasting at the top of the table reads a row of
    group titles and/or a row of subject names above the values (one header row with names over
    subcolumns other than the first is read as subject names).
  - *Import*: pzfx `Nested` tables import, with subject names from a Y column's
    `SubColumnTitles`.
  - *Analyses*: nested analyses treat every subcolumn with a value as one subject (empty
    subcolumns are ignored); rows only group a subject's replicates, so a subject's values need
    not share rows with other subjects'.

---

## 4. Normalized view (the boundary analyses and graphs consume)

Analyses and graph plotting never read `DataTable` directly. They receive a read-only normalized
view, built by `model/normalize.ts`, cached per column object identity (Immer structural sharing
makes untouched columns keep their identity, so this cache is nearly free).

```ts
interface NormalizedDataSet {
  ref: DataSetRef
  title: string
  rowCount: number
  rowTitles: (string | null)[] | null
  x: Float64Array | null                    // NaN = empty or excluded
  data:
    | { shape: 'replicates'; reps: Float64Array[] }                           // NaN = empty or excluded
    | { shape: 'summary'; mean; sd; sem; n; lo?; hi?   // all Float64Array; NaN = unknown
        preset?: SummaryPreset }                        // as entered (absent: e.g. made by an analysis)
  counts: { empty: number; excluded: number }
  text?: (string | null)[]                  // a text variable's values (its numeric data all NaN; §3.5)
  formula?: string                          // a calculated variable's formula (data: its values)
}
```

Conversion rules for summary formats (all → mean/SD/SEM/N). SEM is kept alongside SD so a graph
of entered Mean ± SEM plots the entered error bars even when N is unknown:

| Entered | SD | SEM | Notes |
|---|---|---|---|
| SD (+N) | as is | SD/√N | |
| SEM (+N) | SEM·√N | as is | without N → SD unknown; analyses needing SD are disabled |
| CV + N | \|CV·mean\| | SD/√N | CV stored as a fraction; UI accepts % |
| +err/−err, upper/lower | unknown | unknown | graphable only; absolute bounds in `lo`/`hi` |

Helpers exported from `@ps/model`: `finiteValues(arr)`, `pairedRows(a, b)` (drops a row if either
side is empty/excluded; paired tests pair **by row**).

---

## 5. Analyses

### 5.1 Document node

```ts
interface AnalysisNode {
  kind: 'analysis'
  id: NodeId
  name: string                       // default from plugin, e.g. "Unpaired t test of Data 1"
  analysisId: string                 // plugin id, e.g. 'descriptive', 'ttest', 'mannWhitney' (§5.2)
  pluginVersion: number              // params schema version for this plugin (a whole number ≥ 1)
  input: { source: NodeId; dataSets: DataSetKey[]
           atX?: number              // roadmap 35: only the values at this X (a column table's data sets)
           pools?: DataSetKey[][] }  // roadmap 35: each pool's data sets (2–64) as one, under its first's key; ≤ 32 pools
  params: unknown                    // validated by the plugin's zod schema
  notes?: string                     // free text above the results (roadmap 31); absent = none
}
```

- One analysis reads from **one** source node (a table or another analysis), selecting data sets.
- **Input modifiers** (roadmap 35, `modifyInput`, `model/src/analysisInput.ts`): `atX` keeps each
  data set's replicates at the rows whose X is that value, as a column table's data set (the run
  context's `tableKind` becomes 'column'; an error without X values); `pools` then puts each
  pool's data sets together under its first's key and place, titled "A + B + C" (their
  replicates as more subcolumns of the same rows: a column table's values, a grouped table's
  cells row by row; entered means can't pool). Both are part of the input key, so only edits of
  the values read rerun the analysis; remapping a pool keeps its members that have a match.
- If a referenced column is deleted, the analysis is kept and shows an "input missing" error;
  it is never auto-deleted.
- **Chaining** (Phase 13): an analysis whose plugin `producesTable` exposes `result.table`, and
  another analysis (or a graph) can use that analysis node as its source. The rules:
  - The source table is `sourceTable(project, id, results)` (`model/source.ts`): a data table
    itself, or the analysis' latest result table re-addressed under the analysis node's id and
    name (the plugin's own id is ignored; memoized per result object so normalization caches
    hold). Data set keys are the result table's column ids, which plugins keep stable.
  - The engine prepares analyses in dependency order (`analysisOrder`), so an analysis sees its
    upstream's state from the same pass. While the upstream computes, the downstream is `pending`
    with a `message` ("The analyzed result “…” is still computing.") and keeps its previous
    result; every finished job triggers another pass, which runs what now can run.
  - Its input key hashes the *normalized content* of the upstream table (plus the run context,
    which takes the result table's `tableKind` and X title), so it reruns exactly when that table
    changes — not when an upstream parameter changes without changing the table.
  - Errors: the upstream failed ("could not be computed: …"), its result has no table ("has no
    data table"), its table breaks table invariants ("is malformed"), a chosen data set is
    missing, or analyses form a cycle (refused by the document; a hand-edited file gets an error
    on every analysis in or below the cycle).
  - Removing an analysis removes the analyses and graphs of its table (as for data tables).

### 5.2 Phase 1 plugins

Phase 2 adds two members to the contract: `outputs(inputKeys, params)` declares the graphable
outputs (e.g. `curve:<columnId>`) before the analysis runs, so the UI links them into graphs of the
analyzed table as `ExtraSeries` when the analysis is created; and form fields may be
`{ kind: 'custom', component }`, rendered by UI-provided editors (the curve-fit dialog's equation
picker and parameter-constraint table).

The plugin contract (`AnalysisDef` in `model/src/analysis.ts`) also carries `category`,
`description`, and a declarative `form: FormField[]` (select / radio / checkbox / number fields
addressed by path into the params, with optional `showIf`). The UI renders every analysis dialog
from it.

One plugin per *dialog*, not per test variant: the dialog structure lab users know.

Phase 13 adds result tables and a run context. `run(input, params, context)` receives
`RunContext` (`tableKind` of the source, `xTitle`), so a plugin can build an output of the right
shape. A plugin with `producesTable` returns `AnalysisResult.table`: a `DataTable` (Transform,
Normalize, Remove baseline, Frequency distribution…) that other analyses and graphs can use as
their source, addressed by the analysis node's id. Its data set ids must be stable across runs
(derived from input keys and params), so references into it survive recomputation.

```ts
// 'ttest' — covers unpaired, Welch, paired, and summary-data input
interface TTestParams {
  design: 'unpaired' | 'paired'
  unpaired: { assumeEqualSD: boolean }            // false → Welch
  paired: { measure: 'difference' | 'ratio' }     // ratio = t test on log(ratio)
  tails: 'two' | 'one'
  confidenceLevel: number
  reportFTestVariances: boolean
}

// 'mannWhitney' / 'wilcoxon'
interface RankParams {
  pMethod: 'exactWhenPossible' | 'approximate'
  zeroHandling?: 'wilcoxon' | 'pratt'             // wilcoxon only: rows with difference = 0
  tails: 'two' | 'one'
  confidenceLevel: number                         // Hodges-Lehmann CI
}

// 'descriptive' — N, mean, SD and SEM are always reported; the flags add groups of rows
interface DescriptiveParams {
  quartiles: boolean                              // min, quartiles, max, range (default on)
  ci: boolean                                     // CI of the mean (default on)
  cv: boolean                                     // coefficient of variation (default on)
  geometric: boolean                              // geometric mean, SD factor, CI (default off)
  moments: boolean                                // skewness, kurtosis (default off)
  sum: boolean                                    // (default off)
  confidenceLevel: number
}
```

Every params schema has full defaults, so creating an analysis never needs user input and loading
an older file fills new fields.

Phase 4 plugins (one per dialog, as before; Friedman and Kolmogorov-Smirnov are separate
analyses, like Mann-Whitney, until repeated-measures ANOVA arrives):

| Plugin id | Tables | Reports |
|---|---|---|
| `survival` | survival | Kaplan-Meier table (percent survival, SE, CI), median survival + CI, log-rank, log-rank for trend (≥ 3 groups), Gehan-Breslow-Wilcoxon, hazard ratio (Mantel-Haenszel and log-rank) and ratio of medians (2 groups) |
| `contingency` | contingency | Fisher's exact (2×2; R×C when feasible) or chi-square (± Yates), chi-square for trend (k×2), relative risk, difference + NNT, odds ratio, sensitivity/specificity/PPV/NPV, expected counts, percentages |
| `normality` | column | D'Agostino-Pearson, Anderson-Darling, Shapiro-Wilk, Kolmogorov-Smirnov (Lilliefors P); normal, lognormal or both |
| `oneSample` | column | one-sample t test or Wilcoxon signed-rank test against a hypothetical value |
| `correlation` | column, xy | Pearson or Spearman r with CI and P, for every pair of columns (matched by row) or X vs each data set |
| `friedman` | column | Friedman test on complete rows, Dunn's comparisons (corrected or not) |
| `kolmogorovSmirnov` | column | two-sample Kolmogorov-Smirnov test |

Phase 6 plugins and options:

| Plugin id | Tables | Reports |
|---|---|---|
| `oneWayAnova` + `matched` | column | repeated-measures one-way ANOVA (Geisser-Greenhouse by default), mixed-effects model (REML) when values are missing, Friedman when nonparametric |
| `twoWayAnova` + `repeated` | grouped | two-way ANOVA with rows, columns or both repeated (subjects = replicate subcolumns), mixed-effects model when values are missing |
| `multipleRegression` | multiple variables | coefficients with CIs and VIF, R², adjusted R², Sy.x, AICc, overall F; actual vs predicted graph |
| `logisticRegression` | multiple variables | coefficients and odds ratios (profile or Wald CIs), LR test, pseudo R² (Tjur, McFadden, Cox-Snell, Nagelkerke), Hosmer-Lemeshow, ROC area, classification; curve for one predictor |
| `coxRegression` | multiple variables | coefficients and hazard ratios, LR / Wald / score tests, concordance |
| `pca` | multiple variables | eigenvalues, variance explained, component selection (parallel analysis, Kaiser, variance, fixed), loadings, eigenvectors, scores; scree and score plots |
| `roc` | column | sensitivity/specificity with CIs per cutoff, likelihood ratios, AUC with CI and P; ROC curve graph |
| `blandAltman` | column | bias, SD, limits of agreement (difference, ratio or % difference); Bland-Altman plot |

Phase 11 plugins and options (grouped-table statistics):

| Plugin id | Tables | Reports |
|---|---|---|
| `multipleT` | grouped (2 data sets) | one test per row: Welch (default), Student t with each row's pooled SD, t with one SD pooled over all rows ("consistent SD", = the two-way ANOVA MSE), paired, lognormal (t on log10; ratio paired t; values ≤ 0 left out of their row with a note, the row tested when two per group remain), Mann-Whitney, Kolmogorov-Smirnov, Wilcoxon; means / geometric means / medians, difference (first − second by default), SE, t, df, P, q value (the two-stage step-up of Benjamini, Krieger & Yekutieli: BH-adjusted P × (1 + Q)·m̂₀/m, m̂₀ from the first stage) or adjusted P, discovery / below threshold; summary, discoveries sheet; volcano plot (`volcano:flagged`, `volcano:other`) |
| `multipleOneWay` | grouped (≥ 3 data sets) | one ordinary / Welch / Brown-Forsythe ANOVA or Kruskal-Wallis test per row; comparisons within each row (each row a family) with the one-way methods (Tukey … Dunn) |
| `threeWayAnova` | grouped (4 data sets) | 2 × 2 × k ordinary ANOVA (rows; A, B vs. C, D; A, C vs. B, D), Type III; seven effects, % of total variation, effect sizes; comparisons of all cells, each vs. the first cell, or cells differing by one factor |
| `pStack` | column (1 data set) | a stack of P values: discoveries (BKY, BH, BY at Q) or below threshold (Holm-Šídák, Šídák, Bonferroni), q / adjusted P, BKY's estimated true nulls; ranked-P graph (`ranked`) |
| `rowStats` | grouped, XY, column | per row, for each data set or across all: mean, SD, SEM, N, CI, sum, min/max, median (summary cells combine exactly) |
| `fractionOfTotal` | column, grouped, contingency, XY | each value (each replicate subcolumn) ÷ its column, row or grand total; fractions or % |

Additions to existing plugins: effect sizes (one-way: η², ω², Cohen's f; two-way: η², partial η²,
partial ω², Cohen's f per source; t test: Cohen's d, Hedges' g, Glass's Δ, paired d_z), Newman-Keuls
in every all-pairs list (not with repeated measures), and the one-way post-test for linear trend
(`comparisons: 'trend'`, ordinary ANOVA only). The shared family helpers are
`correctFamily` / `FamilyMethod` (stats) and `familyParams` / `FAMILY_FIELDS` (`analyses/src/grouped.ts`).

Phase 13 plugins, statistics half (data processing, outliers, nested tables):

| Plugin id | Tables | Reports / produces |
|---|---|---|
| `transform` | XY, column, grouped, nested | table: Y (and, on XY tables, X) through the standard functions (Y × K, Y + K, powers, logs, 10^Y, e^Y, 1/Y, √Y, \|Y\|, trig in radians, logit, probit (+5), arcsin √Y, rank, z score, K − Y, K / Y, rounding, and Y with X); one K or a K per data set (`kByDataSet`) |
| `normalize` | XY, column, grouped, nested | table: (Y − 0%) / (100% − 0%) as % or fraction; 0% = smallest, first or entered; 100% = largest, last, entered, sum or mean (of the row means) |
| `removeBaseline` | XY, column, grouped, nested | table: difference, ratio, % difference or sum against a baseline data set, the first / last row(s), or pairs of data sets (A with B, C with D) |
| `frequencyDistribution` | column, grouped, XY, nested | XY table of bin centres: counts, relative % / fractions, cumulative; automatic or set width and first centre, upper limit, replicates each or averaged |
| `transpose` | XY, column, grouped | grouped (or column) table with a data set per row |
| `prune` | XY, column, grouped, nested | table of every Kth row, rows with X in a range, or the average of every K rows |
| `areaUnderCurve` | XY | per data set: total area, SE and CI (Gagnon), total peak area, net area, peaks (first/last/peak X, peak Y, area, %) |
| `identifyOutliers` | column | ROUT (Q) / Grubbs / iterative Grubbs per data set; outliers list and test details; table: the cleaned data (outliers blank) |
| `nestedT` | nested (2 data sets) | t, df, F, P, means, difference B − A with SE and CI; random effects (SD, variance), ICC, F test of subcolumns and likelihood-ratio χ², REML fit, data summary |
| `nestedOneWay` | nested | F, DFn, DFd, P and the same random-effect blocks; comparisons (Tukey, Šidák, Bonferroni, Holm-Šidák, Fisher, BKY; vs. control: Dunnett …) |

Roadmap 38 plugins (data manipulation, `analyses/src/dataManipulation.ts`; decisions 550,
557–559): tables derived from a table that follow it live, as every result table does
(decision 67: derived data, addressed by the analysis node, read-only, chained, graphed —
cells mode by rows, splits, results on graphs — and removed with their source by
`removalSet`). "Freeze as data table" (the results view) adds an editable copy of the table as
a data table node of its own (`frozenCopy`: a new id, "… (frozen)", one undo step); the copy
doesn't follow the source. Saving keeps the analysis (the derivation); a result table of more
than 100,000 cells isn't cached in the file (recomputed on opening, decision 556).

| Plugin id | Tables | Produces |
|---|---|---|
| `filterRows` | multiple variables, XY, column, grouped, contingency, survival, parts of whole, nested | the rows meeting `condition`, a formula over the analyzed data sets by title (a data set with replicates: the row's mean), `X`, `Row_title` and `Row` (1, 2, …) unless a data set has that title; built in the Analyze dialog's condition editor (variable, operator, value; AND within a group, OR between; or typed); same kind, data sets, X, row titles and replicates (summary data as they draw: ± error and upper / lower as mean, upper, lower; SEM entered as mean, SEM, N; else mean, SD, N; audit 2); rows the condition can't decide (a value missing) left out and counted |
| `aggregate` | multiple variables | one row per combination of the analyzed text variables (in the order they first appear; rows with a blank group left out), per analyzed number variable the chosen `stats`: mean, median, SD, SEM, n, min, max, sum, % above `threshold` (> it), % non-zero (≠ 0), from `@ps/stats`; titled "CD4 mean", "CD4 % > 1"; a multiple-variables table (groups as text variables) |
| `percentages` | contingency, parts of whole | each value as a % of its row total, its column total or the grand total (`of`); a table of the same kind (`fractionOfTotal` stays a results sheet) |
| `survivalTime` | survival | X (time) converted between days, weeks (7 days), months (365.25 / 12 days) and years (365.25 days); "Weeks elapsed" |

`transform` also accepts parts-of-whole tables (each part's value transformed; roadmap 38).
Swap X and Y is a command, not an analysis (§8.1).

**Result tables** (`producesTable`): `buildTable` (`analyses/src/resultTable.ts`) builds the
`DataTable`; the node id is a placeholder (the engine addresses the table by the analysis node).
Data set ids: the source data set's key when a data set comes from one input data set (so a graph
keeps its series when options change); `stableId(parts…)` — a 12-character FNV-1a hash — for data
sets combined from several (`pair`, keys) or made from a row (`row`, index). Cells that are not
finite become `null`; excluded source values are empty in the result. Summary tables come out as
`meanSdN` (or `meanSemN` when only SEM is known; Filter rows keeps error bounds and entered SEM,
decision 681); a transform that is not linear gives the
transformed means only. Every plugin also returns a results sheet saying what was done.

**Phase 14: curve fitting for lab assays** (`nonlinearFit`, `linearRegression`; new params all
defaulted, so older files load unchanged and plugin versions stay 1):

```ts
// nonlinearFit additions
interface NonlinearParams {
  equation: string                    // a built-in id, or 'user' (USER_EQUATION)
  userEquation: string                // the equation text when equation = 'user'
  constraints: Record<string, { kind: 'fit' } | { kind: 'constant'; value: number }
    | { kind: 'shared' } | { kind: 'dataSetConstant' }>   // data set constant = the data set's title
  initialValues: Record<string, number>                   // override automatic ones; user eqs default 1
  limits: Record<string, { min?: number; max?: number }>  // with the equation's own bounds
  fitMethod: 'leastSquares' | 'robust'
  outliers: 'none' | 'identify' | 'eliminate'             // ROUT
  routQ: number                                           // %, default 1
  interpolate: boolean
  diagnostics: { residuals; runsTest; replicatesTest; normality: boolean }
  hougaard: boolean
  covariance: boolean                                     // correlation matrix + dependency
  // …weighting, ciMethod, band, compareWith, confidenceLevel as before
}
// linearRegression additions: interpolate, diagnostics (same shape)
```

- **User-defined equations** (`parseEquation` in `@ps/stats`, re-exported by `@ps/analyses`):
  `parseEquation(text)` → `{ ok: true, parameters, variables, program }` (parameters in order of
  first appearance, `program.f`/`program.grad`) or `{ ok: false, message, position, line,
  column }`. The equation syntax: one `name = expression` per line, `;` comments, `\` continuation,
  intermediate variables, case-insensitive names, `IF`, comparisons, `AND`/`OR`/`NOT`, `MOD`,
  the usual elementary functions (`log` is base 10, `ln` natural). The parser compiles to a tape
  evaluated with forward-mode automatic differentiation (exact gradients, no `eval`).
  `resolveEquation(params)` gives the model the analysis fits (built-in or user). The form
  declares custom fields `nlfit.userEquation`, `nlfit.initialValues`, `nlfit.limits` for a
  future editor (unknown custom components render nothing today).
- **Built-in equations** (48): the new ones are written in their published form through the same
  language (`labEquations.ts`), so their gradients are exact too. A `ParamInfo.defaultConstraint`
  may now be `'shared'` or `'dataSetConstant'` (enzyme inhibition: `I` from the column titles,
  Vmax/Km/Ki shared); `CurveModel.initial(x, y, fixed)` receives the values of constant
  parameters.
- **Interpolation** (`interpolate: true`): unknowns are the rows below the last row with both X
  and Y. Every replicate Y is interpolated on its own (X, CI from where the confidence band
  crosses Y, "Extrapolated" / "Out of range"), with the mean of the interpolated Xs per row;
  X-only rows get Y with the band as CI. The **result table** (`result.table`, the plugin keeps
  `producesTable` unset so ordinary fits still analyze their data) is an XY table "Interpolated
  values": for each data set, one row per interpolated replicate (X = interpolated X, the data
  set's Y = the entered Y, row title = the unknown's row title or "Row n"), then one row per X
  unknown with every data set's interpolated Y. Data set ids = the source keys (`stableId`),
  X title from the run context.
- **Diagnostics**: a Diagnostics sheet (runs test, replicates test, the four normality tests on
  the residuals, correlation matrix and dependency per data set), Hougaard's skewness in the
  results, and a Residuals sheet plus graphable `residuals:<key>` outputs on an output graph
  `residuals` (points).
- **Robust fit / ROUT**: robust regression reports best-fit values and RSDR only; ROUT adds an
  Outliers sheet, "Number of outliers (removed)" in the Fit table and `outliers:<key>` values.

**Roadmap 18: statistics additions** (new params all defaulted; older files load unchanged and
plugin versions stay 1; `ANALYSES_VERSION` 1.2.0 because some existing results gained blocks —
contingency effect sizes, RM effect sizes — or lost one: no R² for lines through the origin):

| Plugin id | Tables | Reports / params |
|---|---|---|
| `contingency` + | contingency | `effectSize` (default on: phi for 2 × 2, else Cramér's V); `pairwise` 'none' / 'all' / 'control' with `pairwiseControl` (table row index as a string, custom field `row.pick`) and `pairwiseMethod` (Bonferroni default, Holm-Šídák, Šídák, none): sheet `pairwise` |
| `goodnessOfFit` | parts of whole, column | per data set: chi-square goodness of fit, or the binomial test (two categories, `test: 'binomial'` default) with one- and two-tailed P; `expectedAs` percentages / counts, `expected` by table row (custom field `gof.expected`; [] = equal) |
| `deming` | XY | slope, intercept, SEs and CIs (FAQ 1690), Y at `xForY` with SE/CI, F test of slope = 0; `errors` 'equal' or 'sd' with `sdX`, `sdY` (λ = (sdX/sdY)²); outputs `line:<key>` |
| `simpleLogistic` | XY (Y = 0/1) | β0, β1, X at 50%, odds ratios, Wald and LR tests, Tjur / Cox-Snell R², deviance, AICc, ROC area; row prediction sheet; outputs `curve:<key>` (on the table's graphs) and `roc:<key>` (graph `roc`) |
| `poissonRegression` | multiple variables | coefficients, rate ratios, LR test, pseudo R², deviance, dispersion φ, AICc; Wald or profile CIs; output graph `avp` |
| `linearRegression` + | XY | `throughPoint` with `pointX`, `pointY`; `replicates` 'each' / 'mean'; no R² for constrained lines; intersection of two lines whose slopes differ in the compare sheet |
| `nonlinearFit` + | XY | `weighting` also 'power' (`weightPower` K), 'x', 'x2', 'sd'; `replicates`; `weightingTest`; `compareParams` (sheet `compareParams`, value `compareP`; custom field `nlfit.compareParams`); `equationByDataSet` {key → {equation, userEquation}} (custom field `nlfit.equationByDataSet`); new equation `two-lines-crossing` |
| `normality` + | column | `qqPlot` (default off): outputs `qq:<key>` (points) and `qq:identity` on graph `qq` |
| `pca` + | multiple variables | `loadingsPlot` (outputs `loading:<key>` lines and `loadings` points, graph `loadings`), `biplot` (`biplot:scores`, `biplot:<key>`, graph `biplot`), `pcr` with `pcrY` (sheet `pcr`), `confidenceLevel`; roadmap 34c: optional `groupBy` (custom field `dataset.pickText`) and `ellipses` (a table of scores with the groups, §6.1e) |
| `fitSpline` | XY | `method` lowess / smoothingSpline / akima / cubicSpline / pointToPoint, `lowess` coarse / medium / fine, `knots`, `segments`, `table` (optional XY result table of the curves); outputs `curve:<key>` |
| `coxRegression` + | multiple variables | `survivalCurves` [{data set key → value}] (custom field `cox.curves`; missing predictors are 0), `baseline`: outputs `survival:<i>`, `survival:baseline` on graph `coxSurvival`; sheet `baseline` |
| `threeWayAnova` + | grouped (4 data sets) | `repeatedRows`, `repeatedCol1`, `repeatedCol2`, `sphericity` (GG default), `rmMethod` auto / anova / mixed; comparisons not offered with RM |
| `oneWayAnova` / `twoWayAnova` + | column / grouped | RM ANOVA fits also report η², partial η² (own error term) and Cohen's f |
| `powerAnalysis` | every kind, 0–64 data sets | `design` unpairedT / pairedT / oneSampleT / anova / proportions / correlation / logRank, `solveFor` n / power, `alpha`, `tails`, `power`, `n`, effect inputs, `fromData` (pilot columns); output graph `power` |
| `fractionOfTotal` + | also parts of whole | — |

The UI's `FormContext` gains `rows` (index and title of each table row) for the row-based
editors; the custom editors live in `ui/src/analysis/statsFields.tsx`.

**Roadmap 20: equations and simulation** (new params all defaulted; older files load
unchanged, plugin versions stay 1; `ANALYSES_VERSION` 1.3.0 because fits gained values):

| Plugin id | Tables | Reports / params |
|---|---|---|
| `nonlinearFit` + | XY | user equations with special and distribution functions, lines for particular data sets, implicit and differential equations (below); `initialRules` {name → {value, rule}} (custom field `nlfit.initialRules`); constraint kind `meanX` ("Data set constant (= mean X)"); 77 more built-in equations (126 in all); values `<param>:<key>:se`, `:lo`, `:hi` for fitted parameters |
| `nonlinearFitMV` | multiple variables | the XY analysis' options with `x`, `y` and an optional `group` variable (data set keys; custom fields `dataset.pick`, `dataset.pickNone`): one fit per distinct group value (numbers ascending, text in order of appearance), group values as data set titles (so a numeric one can be a data set constant); outputs `mv:points:<i>`, `mv:curve:<i>` for the first 12 groups on output graph `mvfit` |
| `simulateXY` | every kind, 0–64 data sets | table: X arithmetic / geometric (`xStart`, `xStep`, stop at `xEnd` inclusive) or the analyzed X; Y from `equation` / `userEquation` with `dataSets` [{title, values}] (custom field `sim.dataSets`) or the analyzed Y; `replicates`; random error (below); `seed` (custom field `sim.seed`, "New seed") |
| `simulateColumn` | every kind | table: `columns` [{title, n, mean}] (custom field `sim.columns`), `meanMode` entered / random (`meanOfMeans`, `sdOfMeans`), random error, `seed` |
| `simulateContingency` | every kind | 2 × 2 table: `total`, `design` crossSectional (multinomial) / prospective, experimental (row totals fixed) / caseControl (column totals fixed), `rowTitles`, `columnTitles` (custom field `sim.titles2x2`), `pRow1`, `pOutcome1`, `pOutcome2` / `pCases`, `pExposedCases`, `pExposedControls`, `seed` |
| `monteCarlo` | every kind | table: one row per simulation, one column per `tabulate`d result value (and "Hit"); `simulation` {analysisId, params} and `analysis` {analysisId, params, dataSets} (custom fields `mc.simulation`, `mc.analysis`: each edited with its own form), `simulations`, `seed`, `tabulate` (the result picker `mc.tabulate`, from a trial run), `hits` {combine both / either, ≤ 2 conditions value op number} (`mc.hits`), `hitDenominator` all / determined, `alpha`, `confidenceLevel`; values `hitFraction`, `hits`, `mean:<key>`, `sd:<key>` |

Random error (XY and column simulations, the usual list): `error` none / gaussian (`sd`) /
relative (`percent` of Y) / doubleGaussian (`doublePercent` of the points with `sd`, the rest
`sd2`) / poisson (Y the mean; blank below 0) / t (`df`, scaled by `sd`) / lorentzian (Cauchy
scaled by `sd`); then `outliers` randomly chosen values get a uniform amount between
`outlierLow` and `outlierHigh` added or subtracted.

- **User-equation language** (`parseEquation`, `stats/src/regression/userEquation.ts`):
  - Functions (`equationFunctions.ts`, values in `special/functions.ts`): gamma, gammaln
    (lngamma), beta, ibeta(a, b, x), igamma(a, x), igammac, erf, erfc, psi (digamma),
    besselj/y/i/k(n, x), hypgeometricm/u(a, b, x), hypgeometricf(a, b, c, x), zdist, zinv, zpdf,
    normdist, norminv, normpdf, tdist, tinv, tpdf, fdist, finv, fpdf, chidist, chiinv, chisqc,
    binomial, fact, perc, logit, probit, is_defined; an optional quoted tail ("left", "right",
    "two") for zdist, zinv, normdist, norminv, tdist. Partial derivatives are analytic where
    cheap, else central differences (shape arguments only).
  - Lines for particular data sets: `<C>`, `<~B>`, `<A:D>`, `<~A:D>`, `<A:J,3>`, `<~A:J,3>`,
    and lists `<A,C>`. Letters are positions among the analyzed data sets (the usual rule). Each
    data set has its own program (`program.forDataSet(k)`, `CurveModel.forDataSet`); the
    parameters are the union, in order of first appearance. `uses(j)` is whether that data set's
    Y depends on parameter j (a parameter only other data sets use is held at its initial value
    for this one: no SE, not counted in df; shown "(not used)"). `FitData.dataSet` tells the
    fitter which data set's program applies.
  - Implicit equations: Y used before any line assigns it; the last `Y = g(X, Y)` is solved.
  - Differential equations: `Y' = f(X, Y)` (also `dY/dX = …`); parameter `Y[0]` (listed first),
    X0 = 0 or a line `X[0] = …`. Y itself can't be assigned.
- **Rules for initial values** (`initialFromRule`, `INITIAL_RULES`): value (the number itself),
  ymin, ymax, ymid, xmin, xmax, xmid, xatymid, yatxmid, yrange, xrange, sign, slopexmin,
  slopexmid, slopexmax; a leading '/' divides by the quantity (`/xmid`). Typed initial values
  win over rules; without either a user-equation parameter starts at 1 (Y[0]: Y at the smallest
  X). Built-in equations of roadmap 20 are written with the same rules where they suffice.
- **Monte Carlo seeds**: simulation i uses `substream(seed, i)` (a hash), so simulation i is
  the same whatever the number of simulations.

**Graphs of analysis output.** An `OutputDecl` may carry `graph` (id, name, axis titles, fixed
ranges, square; roadmap 34c: `variables`, a graph of the analysis' result table, §6.1e) and `mark`
('line' | 'points' | 'linePoints'). Such outputs aren't linked into the
analyzed table's graphs; creating the analysis creates one XY graph per `graph.id` whose
`seriesSource.include` is `[]` and whose `extraSeries` are those outputs.

**Roadmap 19: statistics of multiple-variables tables** (new params all defaulted; plugin
versions stay 1; `ANALYSES_VERSION` 1.3.0 because multiple linear regression gained its ANOVA
table). Text variables arrive as `NormalizedDataSet.text` (§3.5); the helpers are
`analyses/src/mvVariables.ts` (reading, levels, reference levels, design) and `mvPredict.ts`
(prediction), the numerics `stats/src/regression/categorical.ts` (`termDesign`,
`linearAnovaTable`, `likelihoodRatioTerms`, `linearPredictor`) and `stats/src/anova/multifactor.ts`.

| Plugin id | Tables | Reports / params |
|---|---|---|
| `multipleRegression` / `logisticRegression` / `poissonRegression` / `coxRegression` + | multiple variables | `categorical` (numeric keys used as factors; text variables always are), `referenceRule` first / last / mostFrequent / leastFrequent, `referenceLevels` {key → level}, `interactions` [[key, key(, key)]]; coefficients named `Name[level]`, `A:B[level]`; a note naming the reference levels; linear: "ANOVA table (Type III sums of squares)" (Regression, each term, Residual, Total; always shown); logistic / Poisson / Cox with a categorical variable or an interaction: "Effect of each variable (likelihood ratio test)" |
| `multipleRegression` / `logisticRegression` / `poissonRegression` + | multiple variables | `interpolate` (rows with every predictor but no outcome), `predictions` [{key → number or level}]: sheet `interpolated` and a multiple-variables result table "Interpolated values" (predictors — text ones as text — predicted value, CI limits; `producesTable` stays unset, as nonlinear interpolation) |
| `coxRegression` + | multiple variables | `survivalCurves` values may be levels (custom field now `mv.predictions:time=0,event=1`; `cox.curves` is unused) |
| `multifactorAnova` | multiple variables | `y`, `factors` ([] = every other variable), `interactions` (null = every two- and three-way), `comparisons` none / mainEffects / simpleEffects / cells, `compareFactor`, `byFactor`, `method` tukey / sidak / bonferroni / holm-sidak / fisher, `family` perLevel / all; sheets `results` (summary, ANOVA table, effect sizes, data summary), `means` (EMMs per factor, observed cells), `comparisons`; values `p.<term>` |
| `survivalFromVariables` | multiple variables | `time`, `status` (numeric `eventCode` / `censoredCode`, or text `eventLevel` / `censoredLevel`), `groups` (curves per combination of levels); sheets as `survival`; result table: the survival table analyzed (X = time, one data set per group) |

Conventions:

- **Levels.** Text is trimmed; empty text is missing. A numeric variable used as a factor has a
  level per distinct value, labelled `String(value)`. Levels are ordered by first appearance in
  the table (the default "visual" order), keeping those present in the analyzed rows
  (complete cases over outcome(s) and predictors). A categorical predictor with one level is left
  out with a warning (a factor with one level is an error in multifactor ANOVA).
- **Reference level / coding.** Dummy (treatment) coding: L − 1 indicator columns, none for the
  reference level; automatic rules (first level by default, last, most or least frequent;
  ties to the earlier level) or a chosen level (a missing chosen level falls back with a
  warning). Interaction columns are products of the variables' columns (first variable slowest).
  Without an intercept the reference column is still dropped (R's `~ 0 + …` would give the first
  factor every level).
- **Term tests.** Least squares: Type III F, rise in residual SS when the term's columns are
  dropped (= `car::Anova(type = 3)` with contr.treatment, so a main effect in the presence of its
  interaction is tested at the other variable's reference level / zero); likelihood models: the
  likelihood-ratio χ² of the same nested fits; df = the rank the term adds.
- **Multifactor ANOVA.** Effect (sum-to-zero) coding, Type III SS by dropping the term's columns
  (= `car::Anova(type = 3)` with contr.sum); residual of the fitted model (within-cell SS only
  when saturated); η², partial η², Cohen's f, % of total. An interaction with an empty combination
  of levels is an error naming it (aliased columns). Marginal means are emmeans' equal-weight
  least-squares means with SE from MSE·(XᵀX)⁻¹; comparisons are their pairwise differences
  (t on the residual df): Tukey with k = levels compared (LA; LA·LB for cells and simple effects
  as one family), Šídák / Bonferroni / Holm-Šídák over the family's pairs, Fisher unadjusted.
- **Prediction.** g⁻¹(x·β) with a CI from the SE of x·β: t on the residual df (linear), z on the
  link scale then transformed (logistic, Poisson); aliased coefficients are left out. A point's
  blank numeric predictor takes the mean of its analyzed values, a blank categorical one the
  reference level (Cox curves: blank numeric = 0, as before). Rows or points with a level the model
  wasn't fitted with are skipped with a note.
- **Diagnostics.** Levels at which a logistic outcome never varies (separation), Cox levels with
  no events and Poisson levels whose counts are all 0 are named in a warning.

The UI's `FormContext.dataSets` entries gain `text` and `levels` (a text variable's values, or up
to 50 distinct numbers) for the editors in `ui/src/analysis/mvFields.tsx`, whose component ids
are `mv.<editor>:<roles>` (roles: the params naming the non-predictor variables, with fallback
positions, e.g. `y=0`); every such id the registered forms use is registered.

### 5.3 Results (derived, not in the document)

```ts
interface AnalysisResult {
  status: 'ok' | 'warning' | 'error'
  diagnostics: Diagnostic[]                       // "2 values excluded", "n < 3 in B", "ties: approximate P used"
  sheets: ResultSheet[]                           // what the user reads (tabs)
  values: Record<string, ResultValue>             // machine-readable, stable keys: 'p', 't', 'df', 'diff', …
  comparisons: Comparison[]                       // feeds significance brackets
  outputs: Record<DataSetKey, GraphableDataSet>   // curves, residuals, ROC curves…: drawn by outputs layers
  table?: DataTable                               // plugins with `producesTable` (§5.1 "Chaining", §5.2)
}

interface Diagnostic { level: 'info' | 'warning' | 'error'; message: string }

interface Comparison {
  key: string                                     // stable, e.g. `${colA}|${colB}`
  a: DataSetRef; b: DataSetRef
  rowA?: number; rowB?: number                    // grouped tables: the rows of the two cells compared
  p: number; pAdjusted?: number
  estimate?: { value: number; lo: number; hi: number; label: string }
}

interface GraphableDataSet {
  title: string; x: number[]; y: number[]; lo?: number[]; hi?: number[]
  rows?: number[]                                 // the analyzed table's row of each point
  rowTitles?: (string | null)[]                   // for point labels
  group?: string                                  // roadmap 35: the text variable's level it was fitted to
}

interface ResultSheet { key: string; title: string; blocks: ResultBlock[] }

type ResultBlock =
  | { type: 'keyValue'; title?: string; rows: { label: string; value: ResultValue }[] }
  | { type: 'table'; title?: string; columns: string[]; rows: ResultValue[][] }
  | { type: 'note'; text: string }

type ResultValue =
  | { kind: 'number'; v: number; digits?: number }
  | { kind: 'integer'; v: number }
  | { kind: 'pvalue'; v: number }                 // formatted by ProjectSettings.pValueStyle
  | { kind: 'pSummary'; v: number }               // ns / * / ** … derived at display time
  | { kind: 'interval'; lo: number; hi: number; level: number }
  | { kind: 'text'; v: string }
  | { kind: 'bool'; v: boolean }                  // "Significantly different?" Yes/No
```

Raw doubles are stored; formatting happens at display time. Changing the P value style in
settings re-renders every result and bracket without recomputation.

---

## 6. Graphs

> **Graphs as layers (roadmap 33).** Since schema v2 (roadmap 33b) a graph node is a *frame*
> plus *layers* (§6.1, §6.1a; design [GRAPH_LAYERS.md](design/GRAPH_LAYERS.md)). Files of
> schema v1 — a graph type plus a style bag per data set (`GraphNodeV1`, §6.1b) — are migrated
> when opened (§9). The sections after §6.2 describe options as v1 introduced them; §6.1b maps
> each onto layers.

### 6.1 Node

```ts
interface GraphNode {                                   // schema v2 (roadmap 33b)
  kind: 'graph'
  id: NodeId
  name: string
  frame: Frame                                          // the coordinate system (below)
  layers: Layer[]                                       // back to front (lists show them front first), at most 32 (§6.1a)
  look?: GraphLook                                      // theme defaults family: the v1 graph type's literals
  preset?: string                                       // provenance: the preset that built the layers
  drawOrder?: 'layer' | 'series'                        // absent = 'layer' (new graphs); migrated ones: 'series'
  seriesSource: { table: NodeId; include: 'all' | DataSetKey[]; rows?: number[]  // table: a data table or an analysis with a result table
                  filter?: { variable: DataSetKey; level: string } }  // one level's rows (`levelKey`: 'lv_<hex>'; §6.1f)
  seriesOverrides: Record<SeriesKey, SeriesIdentity>    // a data set's (output's, function's) identity, shared by its layers
  pointOverrides?: Record<SeriesKey, Record<PointKey, PointStyle>>  // single points / cells / slices (§6.4d)
  size: { plotWidth: Pt; plotHeight: Pt; scale?: number }  // plot-area size; total size derived by layout;
                                                        // scale (0.1–10, absent = 1): text, marks, gaps × scale (roadmap 23)
  axes: { x: AxisSpec; y: AxisSpec; y2?: ContinuousAxisSpec }  // y2: right Y axis (Phase 15); extras (grids, spans, breaks, ticks, scale bars): §6.1k
  annotations: Annotation[]
  legend: LegendSpec
  title: TextSpec | null
  titleOffset?: Offset                                  // the title dragged from its computed place
  style: GraphStyle                                     // graph-wide (§6.2)
  scales?: { color?: ColorScale; size?: SizeScale; shape?: ShapeScale }  // heat maps' colour; variables mapped to colour, size, shape (§6.1d)
  mapping?: VariableMapping                             // multiple variables: the variables on the axes and mapped to appearance (§6.1c, §6.1d)
  levels?: Record<DataSetKey, string[]>                 // the graph's order of text variables' levels (§6.1c)
  levelOrder?: 'appearance' | 'natural'                 // the order of levels `levels` doesn't list (§6.1h); absent = appearance
  links?: { x?: string; y?: string }                    // shared axes (§6.4b)
  split?: { set: string; by: 'level' | 'dataSet' | 'row'; variable?: DataSetKey }  // a split set's graph (§6.1f)
  riskTable?: RiskTable                                 // survival graphs: the number at risk (§6.1j)
  theme?: { id: string; style: FigureStyle }            // its own style, over the project's (§6.2b)
  notes?: string                                        // free text above the graph, never drawn (roadmap 31)
}

type Frame =
  | 'category'   // one slot per data set (column, nested, multiple variables as columns, 100% bars)
  | 'grouped'    // one cluster per row, data sets within (grouped, contingency)
  | 'xy'         // continuous X and Y (XY, survival, bubble plots, analysis outputs)
  | 'polar'      // a pie or donut per data set (parts of whole)
  | 'matrix'     // category × category tiles (heat maps)

interface SeriesIdentity {
  color?: ColorRef; yAxis?: 'left' | 'right'; pointLabels?: PointLabels
  order?: LayerId[]                                     // front to back: its layers when drawing by data set
}

/** The graph types of v1, kept as looks (`theme.series[look]`). */
type GraphLook =
  | 'column.scatter'      // dot plot with center line + error bars
  | 'column.bar'          // bar (+ optional points)
  | 'column.box'          // box & whiskers (+ optional points)
  | 'column.beforeAfter'  // paired lines between columns
  | 'column.estimation'   // groups + differences from the first on a floating axis (§6.4e)
  | 'xy.scatter' | 'grouped.bar' | 'grouped.scatter' | 'grouped.box' | 'survival.step'
  | 'bubble.scatter'      // multiple variables: X, Y, size, colour (§6.4e)
  | 'whole.pie' | 'whole.donut' | 'whole.bar'   // parts of whole (§6.4e)
  | 'heatmap.cells'       // grouped / multiple-variables tables: a coloured cell per value (§6.4g)
type Pt = number          // 1/72 inch
```

A graph's *frame* is chosen from its table kind; its *layers* decide what is drawn; `look` is
the graph's *defaults context*: chosen from its layers when they are built (`lookFor`: bars or
boxes make points smaller and error bars point up, grouped slots narrow caps, …) and kept, it
picks which context rules adjust the per-geom defaults (roadmap 37, §6.2b; read only by the style
resolver `markDefaults`, never by drawing code); `preset` only records where the layers came from. Where marks overlap, a graph
draws **by layer** (`drawOrder: 'layer'`, the default: every data set's bars, then every data set's
points, as ggplot) or **by data set** (`'series'`: each data set's layers together in its `order`,
else the list's: as v1 drew them); migrated graphs, and the examples, draw by data set so they look
exactly as before (decision 231). The Format panel’s Drawing order (the graph’s list of layers) chooses between them.

### 6.1a Layers

```ts
interface Layer {                                       // one member per geom (discriminated union)
  id: LayerId                                           // /^[a-z][A-Za-z0-9]{0,23}$/, unique in the graph
  geom: Geom
  stat: Stat                                            // the stats the geom allows
  position?: Position
  style?: <geom style>                                  // sparse, over the theme's look (§6.2)
  series?: Record<SeriesKey, { style?: <geom style>; stat?: StatParams; hide?: boolean }>
  name?: string                                         // shown in the Layers list (roadmap 33c)
  visible?: boolean                                     // false: kept with its formats, not drawn
  data?: LayerData                                      // absent = the graph's table
  on?: LayerId                                          // attached to a host: error bars, labels, centre lines
  aes?: { x?, y?, size?, color?, shape?, group?, label?, xend?, yend?: DataSetKey }  // multiple-variables tables only (label, shape: 34b; xend, yend: 34c)
  seriesHidden?: boolean                                // data sets drawn only where series[k].hide === false
  legend?: 'auto' | 'hide'
}

type Geom = 'points' | 'bar' | 'errorbar' | 'center' | 'box' | 'violin' | 'line' | 'step' | 'censor'
  | 'area' | 'band' | 'connector' | 'refline' | 'difference' | 'tile' | 'wedge' | 'label'
  | 'polygon' | 'path' | 'segment'                     // roadmap 34c (§6.1e)
  | 'hex' | 'contour' | 'raster'                        // roadmap 34g (§6.1i)
type Stat =
  | { kind: 'identity' }                                // each value; cells; outputs; functions
  | { kind: 'summary'; center: 'mean' | 'median' | 'geomean'; error?: ErrorStat; by?: 'series' | 'subject' | 'all' }
  | { kind: 'boxplot'; whiskers: Whiskers } | { kind: 'range'; center?: Center }      // boxes; floating bars
  | { kind: 'density'; smoothing: number; extent: 'truncated' | 'extended'; center?: Center | 'none' }
  | { kind: 'km' } | { kind: 'fraction' } | { kind: 'difference'; ci: 'pooled' | 'welch' }
  | { kind: 'cell'; standardize?: 'none' | 'row' | 'column' }
  | { kind: 'bin'; width?: number; measure?: 'count' | 'percent' | 'fraction' }  // histograms (33d)
  | { kind: 'ellipse'; type: 'norm' | 'mean' | 't'; level: number }  // 34c: a group's ellipse (0.01–0.999)
  | { kind: 'hull' }                                    // 34c: a group's convex hull
  | { kind: 'centroid'; center?: 'median' | 'mean' }   // 34e: a group's level name at its centre (§6.1g)
  | { kind: 'hexbin'; bins? } | { kind: 'density2d'; adjust?; n?; levels?; bins?; shares? }  // 34g (§6.1i)
  | { kind: 'dotplot'; threshold?; average?; scale? }   // 34g: a dot plot's statistics (§6.1i)
  | ResultStat                                          // 35: labels, lines, bands of results (§6.1j); 46b: y = a·x + b (§6.1l)
  | { kind: 'threshold' }                               // 46b: points classed by the graph's cut-offs (§6.1m)
type Position =
  | { kind: 'identity' } | { kind: 'dodge'; by?: 'series' | 'subject' } | { kind: 'aligned' }
  | { kind: 'stack'; percent?: boolean; gap?: Pt }      // bars; XY areas (by value, roadmap 33d)
type LayerData =
  | { from: 'table' }                                   // the graph's seriesSource (the default)
  | { from: 'outputs'; series: { id: SeriesId; ref: DataSetRef; colorOf?: DataSetKey }[] }  // was extraSeries
  | { from: 'functions'; functions: FunctionDef[] }     // was graph.functions
  | { from: 'layer'; layer: LayerId }                   // the same series as another layer
  | { from: 'analysis'; analysis: NodeId }              // roadmap 35: an analysis' results (§6.1j)
  | { from: 'values' }                                  // roadmap 36: lines and bands at typed values (§6.1k)
```

- **Series keys.** A layer's `series`, `seriesOverrides`, `pointOverrides` and `legend.hidden`
  name data sets of the source by their keys, and analysis outputs and functions by their ids
  (unchanged from v1's extra series and functions).
- **Attached layers** (`on`, decision 230) take their host's position (slot, dodge, stack
  segment), its summary centre and its top: error bars point away from bars' baseline, stacked
  bars put them on the segment, labels sit above the highest mark drawn under them. Removing a
  host removes them (`graph.removeLayer`, §8.1).
- **Per data set**, `series[k]` gives a data set its own style, stat parameters (or kind: one
  grouped data set's mean symbol among each replicate's points) or `hide`.
- **Integrity** (`layerIssues`, checked with the project's references): ids are unique; `on` and
  `data.layer` name another layer of the graph.
- **Scene ids** keep v1's patterns (`series/<k>/bar/<row>`…); a layer drawing a part another layer
  already drew for that data set adds `@<layer id>` (decision 232).
- Which geoms, stats and positions a table kind allows is one matrix (`graph/src/layers/
  matrix.ts`, decision 229), generated into §6.2a.
- **Drawing order.** By layer (`drawOrder` absent, new graphs) the `series` plane holds a group
  `layer/<id>` per visible layer in list order, with its marks of every data set and any it draws
  for the graph as a whole (before-after lines, the grand mean, differences, bands, areas,
  curves, heat-map values, slice labels; roadmap 33d, decision 260); by data set (`'series'`,
  migrated v1 graphs) v1's planes and per-data-set groups, a frame-drawn layer listed in front of
  every layer the groups draw having its plane over them (roadmap 33e, decision 268).
- **The list and the UI (roadmap 33e).** `layers` stays back to front (`layers[0]` drawn first,
  `graph.moveLayer`'s `to` counts from the back); every list in the UI (the graph builder's layer
  table, the Format panel's list of layers) shows it reversed, the front-most layer on top, and "up" means
  towards the front (decision 265). The list operations (`graph/src/layerList.ts`) move a layer
  with the layers attached just in front of it, never put an attached layer behind its host, and
  add a new mark (points, lines, error bars…) at the end (the front), a new fill (bars, boxes,
  bands, areas, the grand mean…) just behind the back-most mark, attached ones just in front of
  their host (decisions 266, 271; `GEOM_LAYER_KIND`). Several layers selected in the Format
  panel's list (roadmap 47: the view's whole-layer keys, decisions 960–961) move together keeping
  their order and stop at the ends (`layersMovedBy`), are dragged as one (`layersMovedTo`) and
  are ranged front first (`layersBetween`); hiding, duplicating and removing them is one undo
  step. Delete on the canvas removes a whole selected layer of any kind with what is attached to
  it or draws its data, asking first (decision 962).
  Every frame's marks follow the list when drawing by layer: `graph/test/zorder.test.ts`, generated
  from the matrix, checks every pair (decision 267).
- **Roadmap 33d additions.** Points of a `summary` on category graphs (mean symbols); a `line`
  of a summary on category graphs (one line through the data sets' centres); `band` of a summary
  on grouped graphs; `step` of a summary on XY graphs; area `position: { kind: 'stack' }` on XY
  graphs; `bar` with `{ kind: 'bin', width?, measure? }` on a column table's xy graph (its
  histogram: shared bins, `@ps/stats` `histogram`); a label `style.value` of `'percent'` (a
  cell's share of its row, grouped graphs); a `line` with `aes` (`group`: lines by group on a
  multiple-variables graph; absent group: the colour variable when it is text).

### 6.1b Schema v1 graphs and their migration

A v1 graph (`GraphNodeV1`, kept so v1 files can be read; since audit 2 (decision 676) the schema
as 33b released it, frozen in `model/src/migrations/v1schema.ts` and re-exported by `graph.ts`,
so the v2 node's growing common fields never change how a v1 file parses) is the node above
with `graphType` in place of `frame`, `layers`, `look`, `preset`, `drawOrder` and `scales`; a full
`SeriesStyle` per data set (§6.2) in `seriesOverrides` and `style.seriesDefaults`; analysis
outputs as `extraSeries: { id, ref, colorOf?, style? }[]`; `functions?: FunctionCurve[]`; and the
graph-wide chart options `style.arrangement`, `stack`, `nested`, `estimation`, `bubble`, `pie`,
`grandMean` and `heatmap`. The migration v1 → v2 (`compileV1`, §9) maps them:

| v1 | v2 |
|---|---|
| `graphType` | `frame` (`column.*` and `whole.bar` → category, `grouped.*` → grouped, `xy.*`, `survival.*`, `bubble.*` → xy, `whole.pie` / `donut` → polar, `heatmap.*` → matrix), `look` = the graph type, the layers its marks need |
| `SeriesStyle` sections | the style of the layers drawing them (`points` → points; `bar` → bar; `error` → errorbar; `center` → center; `box`, `violin` → box, violin; `line`, `spaghetti`, `envelope`, `area`, `band` → line, band, area; `label` → label), field by field (`styleSections`; `jitter` is `spread`) |
| `show` flags | a layer, with `seriesHidden` / `series[k].hide` where data sets differ |
| `center.stat`, `error.stat`, `box.kind` / `whiskers`, `violin.smoothing` / `extent`, `points.replicates`, `label.stat` | the layers' stats (`summary`, `boxplot`, `range`, `density`, …), per data set in `series[k].stat` |
| `markOrder` | the layer list's order, a data set's own as `seriesOverrides[k].order` |
| `color`, `yAxis`, `pointLabels` | `seriesOverrides[k]` / `style.seriesDefaults` (identity) |
| `extraSeries` | outputs layers `curves` (line), `curveBands` (band) and `curvePoints` (points), their styles per output id |
| `functions` | a `functions` line layer |
| `style.arrangement` / `stack` | positions `aligned` / `stack {percent, gap}` |
| `style.nested` | points `dodge by subject`, `subjects` style, a `subjectMeans` centre layer |
| `style.estimation`, `grandMean` | a `difference` layer (`diff`), a `refline` layer |
| `style.bubble` | points `aes`, `scales.size`, `scales.color` |
| `style.pie` | `style.polar`, wedge or stacked-fraction bar layers with labels |
| `style.heatmap` | a `tile` layer (`cells`: missing, border, clustering), `values` labels, `scales.color` |

Layer ids are fixed per role (`bars`, `box`, `violin`, `points`, `error`, `center`, `line`,
`subjects`, `envelope`, `area`, `labels`, `pairs`, `diff`, `grandMean`, `subjectMeans`, `curves`,
`curveBands`, `curvePoints`, `functions`, `curve`, `censor`, `ciBand`, `bubbles`, `slices`,
`segments`, `cells`, `values`), so the output is deterministic. The native presets and the graph
builder (roadmap 33c) use the same ids, so a migrated graph and a new one of a preset match layer
by layer; the formatting panels read and write layers (no v1 view since 33c).

**Series follow the table by default** (`include: 'all'`): add a column to the table and it
appears on the graph. Series order is table column order. Removing a series from a
graph switches `include` to an explicit list.

**Graphs of result tables** (Phase 13): `seriesSource.table` may be an analysis node whose result
has a table. `resolveSeries(project, graph, results)` (and every layout, through
`GraphContext.result`) resolves it with `sourceTable`, so the graph follows the latest result
live (the previous one while recomputing) and is empty until the first result exists. Graph types
and presets are those of the result table's kind; brackets from analyses of the result table
work as for data tables. Series keys are the result table's column ids.

**Nested data on column graphs** (Phase 13): `style.nested` (optional, sparse) draws a group's
subjects (subcolumns) `layout: 'subjects'` (one narrow column each, side by side, empty subjects
taking no room) or `'pooled'`, told apart by `mark: 'shade'` (darker → lighter shades of the
group colour), `'shape'` (symbols in turn from the data set's own) or `'none'`, with
`subjectMeans` adding a short line at each subject's mean. Absent means pooled and unmarked, as
before. The group's centre and error bars are computed from all its values pooled. Graphs made
for a nested table default to side by side and shaded, sized for the subjects; before-after is
not offered for nested tables.

### 6.1c Graphs of variables (roadmap 34a)

A multiple-variables table's variables go on a graph's axes straight from the table — no copy
by "Extract and rearrange" (which stays, for analyses of a rearranged table):

```ts
interface VariableMapping {                             // GraphNode.mapping (optional, no schema bump)
  x: DataSetKey; y: DataSetKey                          // variables of any type: the frame follows them
  color?: DataSetKey                                    // a text variable: groups within each category; a number (34b): each row's point coloured
  measure?: 'count' | 'percentOfX' | 'percentOfTotal'   // text × text: what each combination shows; absent = count
  shape?: DataSetKey; size?: DataSetKey; label?: DataSetKey  // roadmap 34b (§6.1d)
}
GraphNode.levels?: Record<DataSetKey, string[]>         // this graph's order of a text variable's levels
```

| X × Y | Matrix kind (§6.2a) | Frame | What is drawn |
|---|---|---|---|
| number × number | `multipleVariables` | xy | a point per row: `aes` on the points layer (§6.1a), no `mapping` |
| text × number | `mvTextNumber` | category; grouped with a text colour variable | the number variable by the text variable's levels: a category per level (a group per colour level within it) — every category geom and stat (points, bars, boxes, violins, centre lines, error bars, labels, joined means, grand mean, differences) |
| number × text | `mvNumberText` | the same, `style.orientation: 'horizontal'` | the same turned: the categories down the left |
| text × text | `mvTextText` | grouped (bars); matrix (heat map) | the rows of each combination of levels counted: bars by the X levels (side by side, stacked, 100% stacked), labels, or a heat map of the counts (X levels along the bottom) |

Without a mapping a multiple-variables graph is as before: the number variables as columns
(category), their heat map (matrix), or points mapped on an xy graph.

**The adapter** (`graph/src/mapped.ts`). For a mapped graph on a category, grouped or matrix
frame, `resolveSeries` returns `mappedSeries`, which the frames draw as any table's data sets:

- category: a series per category level — its rows' values, as a row slice (`GraphSeries.rows`
  are the table rows: points keep their rows' keys and labels);
- grouped: a cluster per category level, a series per colour level (or one, the number
  variable, without a colour variable), each cell its rows' values with their table rows
  (`GraphSeries.cells`, read by `seriesCellStats`; a cell's key is the first table row of its
  category level, a point's its own row); text × text: each cell's count or percent as the one
  value of a series per Y level;
- matrix (text × text): a series per X level, a row per Y level, each cell's count or percent.

A series' key is its level's (`levelKey`: `lv_` and the text's UTF-8 bytes in hex), so formats
(`seriesOverrides`, a layer's `series`, `legend.hidden`, point formats) follow the level
whatever its place, and the same level shares them on other graphs; `graphRefs` reports such
keys as `of: 'level'` (never remapped as data sets) and the mapping's and `levels`' variables
as roles `mapping` and `levels`. A level is a text cell's trimmed text; empty and excluded
cells have none. Results are cached per table object (documents are immutable: an edit is a new
table), mapping, the two variables' stored orders and the rows shown.

**Order of levels.** A text variable's levels are drawn — categories, colour groups and the
legend — in the graph's order (`levels[variable]`) for those it lists that are drawn, then the
others in the order they first appear in the table's rows shown (`orderedLevels`): new levels
after a stored order come last; levels gone from the table stay in the stored order
(`storedLevels`) for when they come back. Excluding a value doesn't reorder the categories; a
level whose rows are all left out isn't drawn. Colours follow the place, as data sets' do.
Order of levels… (the graph builder; the Format panel’s Order of levels, in the graph’s place) moves levels (↑ / ↓,
Alt+↑ / ↓, drag), sorts them A→Z (numbers in their order), by the mean of the number variable
(lowest first) or by count (most rows first, `sortLevels`), or resets to the table's order.
Roadmap 34f: the levels a graph stores no order of follow its `levelOrder` — the order they first
appear (absent, every graph made before) or natural order (graphs made from 34f on; §6.1h); Order
of levels… also sorts naturally, and its reset goes back to the graph's `levelOrder`.

**Left out.** A row without a level of a variable used, or (number variable) without a value
— empty, excluded or not computable — is left out; the graph's warnings say how many
(`mappedNotes`: "2 rows without a value of Change (empty or excluded) left out."); rows with
nothing in those variables aren't counted. A variable missing from the table, or both axes
numbers on a category frame, draw nothing, with a note.

**Orientation and axes.** `axes.x` stays the category axis. Number × text is drawn horizontal;
turning a text × number graph (the builder's Horizontal, the graph’s Arrangement and spacing) swaps `x`
and `y`, so the mapping always names the text variable's axis. A new graph's axes are titled
after its variables (`scaffoldFor`); text × text's value axis says "Count", "Percent of total"
or "Percent within <X variable>" (also for 100% stacked bars).

### 6.1d Variables mapped to appearance (roadmap 34b)

A graph of variables maps more variables to its points' appearance: on an XY graph (number ×
number) its mapped points layer's `aes` (`color`, `shape`, `size`, `label`), on a category or
grouped graph its `mapping` (same fields). `aesVariables(graph)` reads either; the scales
(`graph/src/aesthetics.ts`) and each row's look and the legend's guides (`graph/src/layers/
looks.ts`, through `LayerKit.looks`) are the same for both. What each acts on is the matrix's
(`AES_GEOMS`, `aesAllowed`; §6.2a): a text colour variable makes a category graph's groups (34a)
and colours an XY graph's rows (and its lines by group); a number colour variable, a shape (text),
a size (number) and labels (any variable) act on points of every row (identity), each its row's
(`pointNodes`' `aesRow`); summaries keep their data set's look. Text × text graphs map nothing
more (their colour is the Y variable).

```ts
interface ColorScale {                                  // GraphNode.scales.color (heat maps; colour by a number)
  colors?: ColorMapName | [RGB, RGB]                    // absent: light to dark blue (#c6dbef → #08306b)
  reverse?: boolean; min?: number; max?: number         // fixed range (absent: the data's)
  midpoint?: number                                     // diverging maps (absent: 0 inside the range, else its middle)
  outOfRange?: RGB                                      // 34b: values outside a fixed range (absent: the nearer end's colour)
  missing?: RGB                                         // 34b: rows without a value (absent: #b4b4b4)
  bar?: { show?; position?; title?;                     // heat maps: absent show = shown; colour by a number: true = a colour bar in the legend
          ticks?: number (2–12); format?: NumberDisplay }  // 34b
  transform?: 'linear' | 'log10' | 'arcsinh' | 'logicle'   // 34g: colours along a transformed scale (§6.1i)
  arcsinh?: { cofactor? }; logicle?: { T?; W?; M?; A? }  // 34g: its parameters
}
interface SizeScale {                                   // GraphNode.scales.size (diameters, pt)
  min?: Pt; max?: Pt                                    // absent: XY 4–30, category / grouped 3–14 (`sizeDefaults`)
  by?: 'area' | 'radius'                                // absent: area
  low?: number; high?: number                           // 34b: a fixed range of values (absent: the data's)
  outside?: 'clamp' | 'extend'                          // values outside it (absent: clamp)
}
interface ShapeScale { levels?: Record<SeriesKey, SymbolShape> }  // GraphNode.scales.shape: a level's symbol by its key
LegendSpec.reverse?: boolean                            // each group of entries reversed
LegendSpec.titles?: { color?; shape?; size?: string }   // headings (absent: the variable's name; '': none)
PointLabels.source: … | 'variable'; PointLabels.offset?: { dx; dy }  // labels from the label variable; their offset
```

- **Colour by a text variable**: its levels in the graph's order (`levels[variable]`, then the
  table's) take the palette's colours, a level's own colour being `seriesOverrides[levelKey].
  color` (as a grouped graph's groups'); a new level takes the next colour.
- **Colour by a number variable**: on its colour scale over the rows drawn; outside a fixed range
  clamped or in `outOfRange`; rows without a value in `missing` (an XY graph used to leave them
  out). The legend shows a colour bar (`bar.show: true`; the builder sets it with viridis for a
  new mapping) or, as bubble plots did, a few colour swatches.
- **Shape**: a level's symbol by its key in `scales.shape.levels`, else the sequence starting with
  the points' own symbol; rows without a level keep the points' symbol.
- **Size**: by area (area proportional to the value over the data's range when none is negative,
  the bubble plot's rule; over a fixed range, or with negative values, area linear from `min` to
  `max`) or by radius (diameter linear); values outside a fixed range clamped or extended. XY
  graphs leave out rows without a size (as before); category graphs draw them at the points' own
  size; a swarm spreads its points by their mean size.
- **Labels**: every data set without point labels of its own gets `{ source: 'variable', which:
  'all' }`: each point labelled with its row's value (numbers in the labels' `format`), placed
  apart (`repel`) or at `offset`; the rest of point labels (§6.4f) applies.
- **Legends**: after the data sets' entries, a guide per variable: sizes (a few round values),
  colour (the levels drawn, a few swatches or a colour bar), shape (the levels drawn, symbols in
  grey); colour and shape of one variable make one legend of coloured symbols, and a grouped
  graph shaped by its groups' variable shows each group's symbol in its entry. Headings are the
  variables' names (`legend.titles`); a grouped graph's groups are headed only when other guides
  follow or a heading is given (so 34a's graphs draw as before). A category graph of variables
  lists no categories (they are on its axis). `legend.reverse` reverses each group of entries.
- **Integer counts**: an axis or colour bar of counts (text × text counting rows; histogram
  counts) ticks at whole numbers (`Extent.integer`, `GraphSeries.counts`).
- **References**: `graphRefs` walks `mapping.shape`, `size`, `label` (role `mapping`) and the
  keys of `scales.shape.levels` (role `shapes`, `of: 'level'`, never remapped).
- **Order of levels** lists the variables mapped to shape (and to colour on XY graphs) after the
  categories and groups.

### 6.1e Group overlays, paths and vectors (roadmap 34c)

Three geoms (optional union members, no schema bump), drawn on XY graphs only: an XY table's data
sets, and a multiple-variables table's graph of variables (after its mapped points). A **group**
is an XY table's data set (its every value: each replicate at its X; entered means: each row's
centre), or on a graph of variables the levels of its colour variable when it is a text
variable, else of its shape variable, else every row (a path may name its own: `aes.group`).

```ts
{ geom: 'polygon', stat: { kind: 'ellipse', type, level } | { kind: 'hull' },
  style?: { draw?: 'outline' | 'fill' | 'both'; fill?: FillStyle; border?: StrokeStyle } }
{ geom: 'path', stat: { kind: 'identity' }, aes?: { group? },
  style?: { stroke?: StrokeStyle; arrow?: 'none' | 'end' | 'along'; head?: ArrowHead } }
{ geom: 'segment', stat: { kind: 'identity' }, aes: { xend, yend },
  style?: { stroke?: StrokeStyle; arrow?: 'none' | 'end' | 'both'; head?: ArrowHead } }
```

- **Ellipses** (`@ps/stats` `confidenceEllipse`, `ellipseOutline`; suite `ellipse`): `norm` the
  normal-theory data ellipse (mean, sample covariance, radius √(2 F(level; 2, n − 1)): ggplot2
  `stat_ellipse(type = "norm")`, `car::dataEllipse`), `t` the robust one (`MASS::cov.trob`'s
  centre and scatter, ν = 5, its iteration and tolerance; ggplot2's default `type = "t"`), `mean`
  the confidence region of the mean (Hotelling's T²: covariance / n, radius √(2(n − 1)/(n − 2) ·
  F(level; 2, n − 2))). The outline is ggplot2's: centre + radius · (cos θ, sin θ) · chol(shape),
  72 segments, clipped to the plot (the fill by Sutherland–Hodgman, the outline as a polyline).
- **Hulls** (`convexHull`; suite `hull`, against `grDevices::chull`): the corners clockwise.
- A group with fewer than three points, no spread in a direction (one X or Y value, or on a
  line), or reaching values a log axis can't show draws nothing; the graph's warnings say why
  ("Ellipse of “Low” not drawn: 2 points: needs 3 or more.").
- **Paths** join a group's points in table row order (XY tables: each row's centre), broken at
  rows that can't be drawn; arrowheads at the end of each run, or at the middle of every step
  (`along`). **Vectors** draw a row's arrow from (X, Y) to (X end, Y end), nothing for a row of
  no length; heads only where their tip is in the plot (`layout/arrows.ts`).
- **Colours**: an XY data set's; a graph of variables' group by its colour variable takes the
  colour legend's colour, otherwise the points'; a vector its row's (colour by a text or number
  variable). Theme defaults (`OVERLAY_THEME`): fill at 20% and a 1 pt outline in the group's
  colour, paths without heads, vectors with a filled triangle at the end.
- **Extents and legends**: ellipses and hulls widen the axes; vectors' ends count. An XY data
  set drawn by an ellipse or hull alone has an ellipse swatch, a path a line sample.
- **Matrix** (§6.2a): fills (`GEOM_LAYER_KIND`: ellipses and hulls go behind the marks) and
  marks (paths, vectors); on graphs of variables they need mapped points, vectors their ends.
- **Pair lines** (connector on grouped tables): each subject — a row's replicate index (graphs
  of variables: its table row) — joined across the data sets within the row, through its point
  where the first points layer placed it; no position of its own.
- **Builder**: plot styles Ellipses, Convex hulls (summaries), Path and Vectors (connections;
  a new vector layer ends at the table's first two number variables the points don't use), the
  chips "Scatter with ellipses" and "Trajectories" (multiple-variables tables with a text variable
  and two number variables). User presets keep vectors without their variables (their ends are
  the table's next number variables when applied).
- **References**: `graphRefs` walks `aes.xend` / `yend` (role `aes`).

**A PCA grouped by a variable.** `pca` params gain `groupBy?: DataSetKey` (a text variable among
those analyzed, left out of the PCA with any other text variable) and `ellipses?: boolean`, both
optional (absent: as before; saved analyses unchanged). Grouped, the result has a table
(multiple variables: `pc1`, `pc2`… (at least two), `group` — the variable's title and each
analyzed row's level), and the score plot and biplot are graphs of it
(`OutputDecl.graph.variables: { x, y, color?, ellipses? }`: `outputGraphsFor` makes a graph of the
analysis' table mapping X, Y and colour on its points, an `ellipses` polygon layer behind them,
the graph's other outputs — a biplot's vectors — drawn over them by the mapped XY frame).
`outputsWithoutGraph` keeps an edited analysis from making them twice; `missingEllipses` adds the
ellipse layer when "Ellipses per group" is turned on later.

### 6.1f One graph per level: split sets (roadmap 34d)

Small multiples are ordinary graphs (decision 41; GRAPH_LAYERS Q4 resolved): "One graph per…"
splits a graph into a **set** — one graph per level of a text variable, per data set or per row
(grouped and contingency tables) — each a copy of the graph (layers, look, formats, mapping,
size, axes, legend) with its own slice, titled with the slice's name (the original's title style),
named "<table> – <slice>". Optional fields only, no schema bump.

```ts
seriesSource.filter?: { variable: DataSetKey; level: string }  // `levelKey` of the level's text: 'lv_<hex>'
split?: { set: string; by: 'level' | 'dataSet' | 'row'; variable?: DataSetKey }
LayoutNode.grids?: { set: string; columns: int; x: Pt; y: Pt; dx: Pt; dy: Pt }[]
```

- **The filter** is live data resolution, not drawing: `graphRows(graph, table)` keeps the rows
  whose `variable` has the level (trimmed text, not empty, not excluded), after `rows` when the
  graph has a slice too; every frame, layer and stat reads rows through it (`resolveSeries`,
  `mappedData`, the XY points' `aes` rows, linked extents), so a row whose level changes moves to
  the other graph at once. A variable gone from the table leaves no rows, with a warning.
- **A set's slice**: a level split's graph its `filter.level`; a data set's its `include[0]`
  (formats of its data set, its colour pinned to the data set's place); a row's its `rows[0]`
  (`memberSlice`). `tableSlices(table, split, template)` lists a table's slices in the set's order:
  the levels in the graph's order of levels then as they first appear, number data sets with values
  in table order, rows with values.
- **Levels across the set**: a level split writes every other text variable the graph draws
  (categories, groups, colours, shapes) into each graph's `levels` in the whole table's order, so
  categories and colours match across the set.
- **Axes**: each continuous axis gets one link group across the set (decision 40), unless made
  free; the graph’s One graph per… (Format panel) shares or frees X and Y for the whole set.
- **One legend**: the last graph's; the others' hidden.
- **The page**: a new Letter page places the set (`alignedGrid`: plot areas aligned, equal plot
  sizes, fitted to the page) in the set's order, columns automatic (1, 2 up to 4 graphs, 3 up to
  9, then 4) and editable on the page (Page › One graph per…: re-fitted); `grids` records the grid:
  the first cell's top-left and the step to the next cell across (`dx`) and down (`dy`).
- **New slices follow the table** (`followSplitSets`, engine `splitFollowUps`): after a change to
  a set's table, each slice the table now has, the set has no graph of, and the table did not
  have before (a new level, a new data set with values, a row given values) gets a graph like the
  others (`memberOf`: a graph of the set without a legend, the set's legend left where it is;
  audit 3, G4: without the template's legend-only label of its own data set, which is wording),
  after the set's graphs in the navigator and in the set's order on each page with its grid
  (`placeOnGrid`: later graphs move on a cell, each keeping its place within its cell; the page
  grows taller when the grid passes its bottom). The store applies these commands in the same undo
  step as the edit. Slices the set leaves out on purpose, or whose graph the user deleted, get
  none; a slice whose rows are all gone keeps its (empty) graph until deleted. Sets of result
  tables don't add graphs (their tables change with results, not edits). Audit 2 (decision 675):
  levels of calculated text variables are read with the project's info fields bound (as graphs
  read them), an edit of the info sheets re-runs the follow-ups of tables whose formulas may
  name one, and a new graph goes in the folder of the set's graph it copies (not its table's).
  A set is not looked at again (its slices not read from every row) when what its slices read is
  the same objects before and after (`sameSlicesRead`: a level split's variable; a data set
  split's data sets; a row split's data sets, row count and titles; tables with calculated
  variables always looked at, but for a level split of a plain variable) and its graphs show the
  same slices (audit 2, decision 761): a cell edit of another column of a table of a million rows
  took 60–80 ms for a level split, now under 2 ms.
- **References**: `graphRefs` walks `filter.variable` (role `filter`, a data set key), the level
  (role `filter`, of kind `level`: never remapped) and `split.variable` (role `split`). A variable
  dropped by a remap drops the filter (every row) and the set. Copies (Duplicate, Duplicate family,
  Apply to other tables, methods) get fresh set ids (`Remap.links`), graphs and page grids alike;
  a duplicated graph is not in its set.
- **Apply to all graphs of the set** (`matchSetFormat`): Magic with sizes, axis ranges and titles,
  per-data-set formats by key (levels, rows; a set of data sets keeps each graph's own), each graph
  keeping its data, title text, links and its legend's visibility.

### 6.1g Large tables: point clouds, drawing order, group names (roadmap 34e)

Optional fields only, no schema bump.

```ts
PointsStyle.render?: 'auto' | 'vector' | 'image'   // on screen: an image above 20,000 points in the graph (auto)
PointsStyle.order?: 'table' | 'value' | 'random'    // the order the points are drawn in
{ geom: 'label', stat: { kind: 'centroid', center?: 'median' | 'mean' } }   // group names
LabelStyle.background?: 'none' | 'halo' | 'box'    // behind a group's name (absent: halo)
```

- **Point clouds.** A points layer of every row (a graph of variables' mapped points; an XY
  table's points) with more than `RASTER_THRESHOLD` (20,000) points, or `render: 'image'`, draws
  one `points` primitive (§6.5) in its place among the layer's marks instead of a node per point:
  centres, sizes, paint indices and table rows in typed arrays, in drawing order. The count and
  the setting decide; drawing never asks what the table is. Exports draw its symbols exactly as
  separate symbol nodes would (SVG byte for byte, PDF the same operators). The screen (graph
  canvas, layout pages, Format preview, builder preview) draws it as an image made by our own
  rasteriser (`render/pointRaster.ts`: each symbol a stamp of 4 × 4 samples per pixel, fill then
  stroke, blended in drawing order; deterministic, no browser canvas; PNG), at the screen's
  resolution (zoom × CSS pixels per point × device pixel ratio), once per cloud and zoom; a cloud
  laid out again with its points as they were, or all moved alike (a title moved, a drag's step),
  shows the image it had, moved (decision 1113), and an image's object URL is revoked shortly
  after no element shows it (decision 1112). Export ›
  "Points as image" (off by default; remembered) draws the clouds as images at the export's
  resolution (`pointsAsImages`); a vector export of more than 100,000 points says it will be large
  and slow to open. The count is the graph's (decision 451): when its per-row points, every
  points layer and data set together, are more than 20,000, each Automatic layer's symbols become
  clouds in their place (a run of symbols one primitive, the same ids and keys), so 51 columns of
  16,171 points draw 51 images, not 820,000 elements.
- **Points on screen** (decision 450; derived, never stored). Laid out for the screen
  (`GraphContext.screen`: the canvas, pages, the Format and builder previews), a data set draws at
  most `SCREEN_POINTS` (1,000) of its per-row points in its column, group or cell, and a heat map
  of every value at most 1,000 rows: an even sample in table order (row ⌊i·n / 1,000⌋). The scene
  says so (`Scene.sampled`, the largest data set's: "Showing 1,000 of 16,171 points per column on
  screen; exports and statistics use all"), and the view offers every point (session only).
  Statistics are of every row; exports lay out again without `screen`. XY graphs draw every
  point (as images when many) except in the builder's preview.
- **Hovering, selecting.** A cloud's points are hit through a uniform grid built once per
  primitive (`cloudIndex`, `cloudHit`: the last-drawn point under the pointer). A point gets a
  node of its own on demand (`cloudPointNode`: the id, point key, symbol and target its own node
  would have had, and `cloud: { node, index }`), so hover cards, Go to row, selection halos,
  `]` / `[` and point formats work as before.
- **Drawing order** (`drawOrder`): `table` as before (a graph of variables' sized points largest
  first); `value` by the colour variable's value (a number variable; else the size variable's),
  ascending, so the highest is on top, rows without a value first; `random` a shuffle with a
  fixed seed (the same every time). An XY table's points are shuffled by row (`value` keeps the
  table's order). The same for vectors and images.
- **Group names** (`label` × `centroid`, on graphs of variables' XY graphs, with mapped points):
  each group — a level of the text colour variable, else of the shape variable, else every row
  (named after the Y variable) — named at the median (or mean) of its points' X and Y
  (`groupCentre`, `@ps/stats` `median` / `mean`); centred there when the spot is free, else
  moved to the nearest free one (`placeLabels` with `centre`). Names never cover each other; they
  do cover points. Theme defaults (`CENTROID_THEME`): bold 10 pt with a white halo round the
  letters (`halo` on the text primitive: a stroke under the letters in SVG, PDF and on screen), or
  a white box, or nothing. No legend entry, no hover card, no effect on the axes (the centres lie
  among the points). The builder's plot style "Group names"; Format › Layers: the centre, what is
  behind each name, its size and weight.
- **Defaults for large tables.** A multiple-variables table of more than 10,000 rows starts new
  graphs as an XY graph of its variables (`defaultPresetFor`): the first two number variables,
  coloured by a group variable, 2 pt points, nothing mapped to size. New graphs group (categories,
  colours, ellipses) by the first text variable of at most 60 levels (`groupVariables`), never a
  column of cell ids. A swarm of more than 1,000 points (10,000 until audit 2, decision 750)
  crowded beyond its width spreads them evenly (`SWARM_MAX_POINTS`), where placing them one by
  one took quadratic time.

### 6.1h Cells tables, the 24-colour palette, natural order, histograms of variables (roadmap 34f)

Optional fields only, no schema bump.

```ts
DataTable.cellsTable?: boolean               // absent: a cells table above CELLS_TABLE_ROWS rows
GraphNode.levelOrder?: 'appearance' | 'natural'
// A histogram of a variable: a bar layer binning the number variable on X, by a text variable's levels
{ geom: 'bar', stat: { kind: 'bin', measure?, width? }, aes: { x: DataSetKey, color?: DataSetKey },
  position?: { kind: 'stack' } }
Command: { type: 'table.setCellsTable'; table: NodeId; on: boolean | null }   // null: automatic
```

- **Cells tables** (`isCellsTable`): a multiple-variables table with `cellsTable: true`, or of more
  than `CELLS_TABLE_ROWS` (20,000) rows unless `cellsTable: false`. Their graphs are offered only
  what scales with the rows: the matrix's layers of a mark per row (`ROW_MARK_LAYERS`, §6.2a: swarms
  and every-value points within categories, before–after lines, paths, vectors, lines by group, heat
  maps of every value) are refused by the builder's icons and chips, Format › Layers' Add and the
  appearance rows with the reason ("16,171 rows: too many points for a swarm. Use a violin or
  box."); labels from a variable at most 1,000 rows. Scatters (one point cloud, §6.1g), violins,
  boxes, bars, means ± error, counts and histograms are offered. New graphs start as an XY graph
  of the variables; a text variable on X makes violins with a box inside (preset `groupViolin`, a
  chip of cells tables), the variables as columns boxes. Layers of a mark per row already on a
  graph keep drawing; Format › Layers names them with the reason and a fix in one undo step
  (`rowMarkNotices`: remove the points over a box or violin, a violin in place of a swarm, joined
  means in place of before–after lines, else hide it). The table view's checkbox and View menu
  "Cells table (single-cell / cytometry)" set it, and importing: a multiple-variables table of
  more than `CELLS_PROMPT_ROWS` (5,000) rows asks in a popup (decision 456; the large-CSV import
  once the file is read) — "Treat as a cells table" (the default) or "Import as an ordinary
  table", or Cancel (nothing imported); up to 5,000 rows the import dialog's "Treat as a cells
  table" checkbox (off by default). A choice equal to what the rows give is stored as absent
  (`cellsTableSetting`), so it stays automatic: a table answered "ordinary" at 16,000 rows that
  grows past 20,000 (pasting, more rows) becomes a cells table by itself; one answered at 30,000
  stores `false` and stays ordinary.
- **Builder previews of big tables.** The graph builder lays its preview out of a sample of at
  most `PREVIEW_ROWS` (5,000) rows — evenly spaced in table order, the first among them, the same
  every time, kept per table object (`sampleTable`, `previewSource`; an analysis' result table too)
  — with a note ("Preview of 5,000 of 16,171 rows"); the graph made draws every row. On a table of
  more than 20,000 values only the last of quick changes is laid out, 120 ms after it
  (`LatestOnly`); the preview shows the one before, faded, meanwhile. A graph of more than 20 data
  sets of its own (variables as columns) previews the first 20, and its per-row marks share about
  5,000 ("Preview of 20 of 51 variables, 5,000 of 16,171 rows"; decision 452); a cells table's
  Columns start with its first 20 number variables (decision 453). Derived, never stored.
- **Palette.** Data sets and levels take the theme's categorical colours by place
  (`graphPalette`): the 8 Okabe–Ito colours (the palette, as before), then 16 more
  (`EXTRA_CATEGORICAL`), so a variable of up to 24 levels is told apart; then they wrap. Graphs of
  at most 8 data sets or levels draw as before; graphs of more (documents made before too) draw
  their 9th to 24th in the new colours. A graph's own palette (`style.palette`) still wraps.
- **Natural order** (`naturalCompare`): runs of digits by value (any length), the rest folded
  (accents dropped by NFKD, case ignored), digits before letters; texts equal so far by fewer
  leading zeros first, then by code point — a total order, the same on every machine (no locale).
  "C2" < "C10", "2" < "10", "apple" < "Banana", "7" < "07", "A" < "a".
- **Histograms of variables.** A bar layer with the `bin` stat and `aes.x` on an XY graph of a
  multiple-variables table bins that number variable over the graph's rows (`graphRows`: a split
  graph bins its level's), as one data set keyed by the variable, or one per level of the text
  variable `aes.color` keyed by `levelKey` in the graph's order of levels (`variableBins`); these are
  the graph's data sets (`resolveSeries`), so legends, Format's data sets, level colours, Order of
  levels… (sorted by the mean of X) and hover cards ("Bin 1,000 to 2,000", "Count 312") read them.
  The bins are the column histogram's (`histogram`, `@ps/stats`, oracle suite `frequency`): shared
  by the groups, automatic width (FAQ 1660) or `width`, measuring counts, percents or fractions of
  each group's values. Groups overlap (translucent, `OVERLAID_BINS`) or stack (`position: stack`:
  each bar on the groups before it, `XYRow.base`). A histogram draws binned bars only; it needs a
  number variable on X. Rows with a value but no level are left out and counted in the warnings.
  The builder's frame choice "Histogram" (from an XY graph it bins X by the colour variable),
  Map variables' X, Colour and Groups (overlaid or stacked); Format › Layers: what the bars show,
  the bin width, overlapping or stacked.

### 6.1i Cytometry axes and density plots (roadmap 34g)

Optional fields and union members only, no schema bump.

```ts
ContinuousAxisSpec.scale: 'linear' | 'log10' | 'log2' | 'arcsinh' | 'logicle'
ContinuousAxisSpec.arcsinh?: { cofactor?: number }          // asinh(x / cofactor); absent 5 (CyTOF; flow: 150)
ContinuousAxisSpec.logicle?: { T?; W?; M?; A?: number }     // flowCore's; absent 262144, 0.5, 4.5, 0
ColorScale.transform?: 'linear' | 'log10' | 'arcsinh' | 'logicle'   // a number colour variable's
ColorScale.arcsinh?; ColorScale.logicle?                     // its parameters
{ geom: 'hex', stat: { kind: 'hexbin', bins? }, aes: {},     // hexagons; bins across (absent 30)
  style?: { colors?, reverse?, log?, bar?, opacity?, border? } }
{ geom: 'contour', stat: Density2d, aes: {},                 // contour lines / filled bands
  style?: { draw?: 'lines' | 'bands' | 'both', stroke?, colors?, reverse?, bar?, opacity? } }
{ geom: 'raster', stat: Density2d, aes: {}, style?: { colors?, reverse?, bar?, opacity? } }
type Density2d = { kind: 'density2d'; adjust?: number; n?: number;   // bandwidth ×, grid (absent 1, 100)
                   levels?: 'pretty' | 'shares'; bins?: number; shares?: number[] }  // absent: pretty, 10; 50/75/90/95%
{ geom: 'points' | 'tile', stat: { kind: 'dotplot', threshold?, average?: 'mean' | 'expm1', scale? },
  aes: { group: DataSetKey } }                               // a dot plot (matrix frame)
PointsStyle.colorBy?: 'variable' | 'density'; PointsStyle.adjust?: number   // points coloured by density
```

- **Cytometry axes** (`graph/src/transform.ts`): data stay raw; positions are linear in the
  transformed value — arcsinh `asinh(x / c)`, logicle flowCore's `logicleTransform` (`@ps/stats`
  `logicle`, the scale's 0–M place; oracle suite `cytometry`). Zero and negative values are drawn
  (a log axis' positive-only rule doesn't apply). Ticks at 0 and ±10ⁿ, a decade left out where it
  stands closer than 0.6 of a decade to the one before (the decades squeezed into the linear region
  near zero: FlowJo's 0, 10³, 10⁴, 10⁵), thinned further while labels crowd; minor ticks at 2–9 ×
  10ⁿ where they stand apart. Automatic labels: 0, plain numbers below 1,000, 10ⁿ (−10ⁿ) above.
  The automatic range shows zero; a logicle axis at least its whole display (from the scale's
  bottom, data value `inverse(0)`, to T); ends past those, and an arcsinh axis' ends, rounded out
  to k · 10ⁿ. Manual ranges as set; tick intervals and breaks aren't used on these axes. Unusable
  logicle parameters fall back to flowCore's defaults (Format refuses them, saying why).
- **Densities of a graph of variables' points** (XY graphs with mapped points, shown or hidden;
  `graph/src/layers/geoms/density.ts`, numbers from `@ps/stats`): computed in the axes'
  transformed coordinates over the points drawn (`graphRows`: a split graph's level).
  - **Hexagons** (as `hexbin::hexbin`, reimplemented from Carr et al. 1987; oracle `hexbin`): `bins` across the points' X range, `shape`
    the points' span on screen (height over width), so hexagons are regular; each occupied cell a
    polygon coloured by its count on the layer's colour map (viridis; `log`: by log10 of it), cut
    to the plot; a colour bar headed "Count" in the legend.
  - **2D density** (`MASS::kde2d` with ggplot2's `stat_density_2d` bandwidths × `adjust`, an `n` ×
    `n` grid over the transformed range of every point drawn; exact while n · n² ≤ 10⁸, else the
    points linearly binned onto a grid four times finer first, oracle `density2d`).
  - **Contours** (one set per level of the text colour variable, else of every point): at
    ggplot2's levels (`pretty` of every group's densities' range, about `bins`) or at the levels
    enclosing `shares` of each group's points (the density at its points' (1 − p) quantile,
    Hyndman 1996); lines by marching squares (`contourLines`, as `grDevices::contourLines`) in the
    group's colour (or the layer's stroke); bands the regions at or above each level, closed along
    the grid's edges, stacked from the lowest (the whole grid isn't filled), on the colour map by
    level with one group (and a colour bar "Density"), each group's colour at 20% per level with
    several.
  - **Density image**: the grid's cells as an image (`image` primitive, a PNG of n × n pixels,
    each centred on its grid point), cut to the plot, in exports too; a colour bar "Density".
  - **Points coloured by density** (`colorBy: 'density'` on the mapped points; in place of a colour
    variable): each point's local density — the 100 × 100 grid's value bilinearly interpolated at
    it — on the graph's colour scale (absent: viridis with a colour bar, headed "Density"); draw
    order 'value' then puts the densest on top. Works with point clouds.
  - Densities widen no axis; they have no hover card. Their colour bars follow the layer's
    `legend: 'hide'`. Results are kept per table object and what they depend on.
- **Histograms of variables on cytometry axes**: on an arcsinh or logicle X axis the bins are the
  transformed values' (equal widths on the axis; a set width in transformed units), each bar's
  edges back in raw units (`XYRow.edges`, the hover card's bin). Log axes bin raw values as before.
  **One histogram per variable**: the builder's Make "One histogram per variable (N)" splits a
  histogram by data set (§6.1f): each graph bins its own variable (`aes.x` the slice's, its X axis
  titled after it); a new variable in the table gets one.
- **Dot plots** (matrix frame, `layers/frames/dotplot.ts`; numbers from `@ps/stats` `dotPlotStats`,
  oracle `dotplot`, Seurat's `DotPlot`): the graph's number data sets along the bottom, the levels
  of the layers' `aes.group` down the left (the graph's order of levels); a dot per crossing sized
  by the percent of the level's rows above `threshold` (absent 0; by radius, 0% none, 100% the
  cell's size; `scales.size` applies), coloured by the average — the mean, or log1p(mean(expm1))
  for log-normalised data — z-scored across the levels per variable and clipped to ±2.5 unless
  `scale` is false, on the colour scale (absent: Seurat's light grey to blue). A tile layer of the
  same stat paints the averages behind (a matrix plot). Legends: "Percent expressed" sizes and a
  colour bar "Average (scaled)" (headings from `legend.titles.size` / `color`). A dot plot draws
  only dot plot layers; the group needs a text variable.
- **References**: a dot plot's `aes.group` is walked as an aes key (`graphRefs`); densities map
  nothing of their own. User presets keep the layers (a dot plot groups by the table's first group
  variable when applied).
- **Builder**: chips "Density" (hexagons, the points kept hidden) and "Dot plot" on cells tables;
  plot styles Hexagons, Density contours, Filled contours, Density image (summaries), Average
  tiles, and the frame choice Dot plot; Map variables' "Colour the points by their local density";
  presets `densityContours` and `pointDensity` (not chips). All summarise the rows, so cells tables
  offer them (§6.2a).

### 6.1j Results on graphs (roadmap 35)

Optional fields and union members only, no schema bump (decisions 490–503).

```ts
LayerData |= { from: 'analysis'; analysis: NodeId }      // an analysis' results (stat 'result')
Stat |= ResultStat                                       // on 'label', 'refline' and 'band' layers
interface ResultStat {
  kind: 'result'
  fields: Record<FieldName, { ref: ResultRef; format?: FieldFormat }>   // FieldName: /^[A-Za-z][A-Za-z0-9_]{0,31}$/
  template?: RichLabel          // labels: text with {fields}; '{{' / '}}' are braces
  place?: { at: 'corner'; corner: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' }
        | { at: 'data'; x: number; y: number }       // axis values (category axes: the index)
        | { at: 'curve' }                            // beside its data set's fitted curve's end
  show?: 'plot' | 'legend' | 'both'                  // labels: absent = plot; legend = appended to the entry
  at?: FieldName                                     // lines: the value
  lo?: FieldName; hi?: FieldName                     // bands: the ends
  axis?: 'x' | 'y'                                   // lines and bands: absent = across at Y values
  drop?: 'x' | 'y' | 'both'                          // lines at an X: from the curve's point to the axes
  per?: 'analysis' | 'dataSet'                       // absent = once; dataSet: each data set analyzed, in its colour
}
type ResultRef =
  | { from: 'value'; key: string }                   // AnalysisResult.values[key]
  | { from: 'cell'; sheet: string; block?: string; row: string; column?: string; end?: 'lo' | 'hi' }
  | { from: 'comparison'; key: string; what?: 'p' | 'estimate' }
interface FieldFormat {                              // sparse
  digits?: number; decimals?: number                 // significant digits (absent 3); fixed decimals win
  p?: 'project' | 'exact' | 'below' | 'scientific' | 'stars'   // P values; absent = 'below'
  below?: number                                     // 'below': "< 0.0001" under it (absent 0.0001)
  ns?: boolean                                       // 'stars': "ns" when not significant (absent true)
  unit?: string; axisUnit?: 'x' | 'y'                // a unit; or the axis title's ("Dose (µM)" → µM)
}
BandStyle.color?: ColorRef                           // a result band's fill (absent: its data set's, else grey)

GraphNode.riskTable?: {                              // survival graphs (layers of the km stat)
  show: boolean
  times?: number[]                                   // absent: the X axis' major ticks
  title?: string                                     // absent: "Number at risk"; '' none
  names?: boolean                                    // absent: the groups' names before their rows
  text?: Partial<TextStyle>
}

Annotation |= {                                      // an inset table of an analysis' results
  type: 'table'; id; analysis: NodeId; sheet: string
  rows?: ItemRange; columns?: ItemRange              // body rows and columns shown (as page tables)
  place?: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' | 'right' | 'anchor'   // absent topRight
  anchor?: { space: 'plot' | 'data'; x; y }          // 'anchor': its top-left corner
  text?: Partial<TextStyle>; grid?: 'all' | 'rows' | 'none'; gridStroke?: StrokeStyle
  headerBold?: boolean; digits?: number; background?: FillStyle; behind?: boolean
}
Bracket.x?: number                                   // XY graphs: compared at this X (a time point)
Bracket.group?: DataSetKey[]                         // data sets pooled with `a` against `b`

AnalysisNode.input.atX?: number                      // only the values at this X (§5.1)
AnalysisNode.input.pools?: DataSetKey[][]            // data sets pooled before the analysis (§5.1)
GraphableDataSet.group?: string                      // a fit per group's level (an output's)
OutputDecl.onGraphsOf?: { x; y: DataSetKey }         // also on graphs of the variables mapping X and Y
AnalysisDef.graphResults?(params, { tableKind, dataSets }): ResultTemplate[]
interface ResultTemplate {                           // an analysis' ready result (not stored)
  id: string; title: string; kind: 'label' | 'line' | 'band'
  stat: Omit<ResultStat, 'kind'>
  offer?: string                                     // the analysis dialog's "Show … on the graph"
  frames?: ('category' | 'grouped' | 'xy')[]
}
```

- **Values are live**: a field resolves against the analysis' latest result at each layout
  (`resolveResultRef`, `model/src/results.ts`); nothing is copied into the document. A cell is
  found by its sheet's key, its block's title (or the start of it; absent: the first block with
  the row), its row's label (a table row's first cell as shown) and its column's title; drawn per
  data set, `{key}` (value and comparison keys) and `{dataSet}` (block, row, column) are the data
  set's key and title. A value gone reads "—" with a warning; while the analysis computes, "…".
- **Templates** (`parseTemplate`, `fillTemplate`): a field takes the format of the template's
  text around its opening brace; its own formatting (a raised exponent) goes over it; "P = {P}"
  reads "P < 0.0001" when the value is below its threshold. An unknown field reads "—".
- **Per data set**: each data set of the graph the analysis analyzed (or, for an analysis of a
  table's variables, each level whose title a field is found for), in its colour (unless the
  label's text has one); `series[key].hide` leaves one out.
- **Placement**: corners stack inwards (list order, then data sets), data positions stack per
  data set, labels beside curves move apart (`placeLabels`) off the points and curves. Lines and
  bands widen the value axes to their values. Drop lines run from the analysis' fitted curve of
  the data set (its output, interpolated linearly) to the plot's bottom and left edges.
- **Legends**: result lines and bands have entries (the layer's name, else its field), sorted by
  name; drop lines start without one (`legend: 'hide'`). Labels shown in the legend append
  " (…)" to their data set's entry (an analysis' label: its first analyzed data set's).
- **The number at risk**: counts from `@ps/stats` `numberAtRisk` (subjects with time ≥ t; oracle
  suite `atrisk`) at the X axis' major ticks (values rounded to 12 significant digits) or at
  `times`, under the X axis' title, a row per group in its colour; the graph's height grows.
- **Inset tables**: `resultSheetCells` lays a sheet out as the results view does; `tableItem`
  (the page tables' renderer) draws it, text 8 pt, over a background (white unless set); a table
  right of the plot takes room before a legend there.
- **Brackets at one X** stand right of the two data sets' points at that X (vertical, stacked
  outwards); **from a group to one** a line spans the group under the bracket from its centre.
  Their analyses read the values at that X (`input.atX`) or the pooled group (`input.pools`).
- **References** (`graphRefs`, decision 501): `{ kind: 'analysis', node, path }` for a result
  layer's `data.analysis` and a table's `analysis`; `{ kind: 'resultKey', key, path }` for value
  and comparison keys; a bracket's `group` with the bracket. `mapGraphRefs`' `analysis` maps or
  drops (a dropped analysis takes its layers, the layers attached to them or drawing their data,
  and its tables); `resultKey` maps keys (given the layer's analysis; null drops the field, which
  then reads "—": decision 672). Removing an analysis strips them (decision 35).

### 6.1k Axis extras (roadmap 36)

Optional fields and union members only, no schema bump (decisions 510–521; `model/src/axisExtras.ts`).
An axis without them draws exactly as before (every earlier golden byte-identical).

```ts
// A category of a category axis by key, never by position (decision 511):
type CategoryKey = string
  // a series key: a data set's id or a level's key (lv_…) — a category frame's slot, a bar's series
  // '@<row>': a grouped table's group (its table row; follows row inserts, deletes and reorders)
  // '<group>/<series>': a bar within a group ('@2/a', 'lv_4c6f77/lv_46')
CategoricalAxisSpec += {
  treatments?: TreatmentGrid                 // a +/− grid under the categories
  spans?: CategorySpans                      // labels spanning categories (two-level labels)
}
interface TreatmentGrid {
  rows: { title: RichLabel; cells: Record<CategoryKey, string> }[]   // ≤ 24 rows; a cell: '+', '-' (or −),
                                                                    // '' or short text (≤ 40); missing = blank
  show?: boolean                             // absent: shown
  by?: 'group' | 'bar'                       // grouped frames: a cell per group (absent) or per bar
  symbols?: 'plusMinus' | 'dots' | 'check'   // '+'/'-' as + / − (absent), ● / ○, ✓ / blank
  text?: Partial<TextStyle>                  // absent: the axis' tick labels'
  rowSpacing?: Pt                            // absent: a line's height + 3
  lines?: StrokeStyle                        // between rows; absent: none
  titles?: 'start' | 'end'                   // row titles before the first category (left / top) or after
  names?: 'hidden' | 'above'                 // the category names: hidden under the grid (absent) or kept
}
interface CategorySpans {
  show?: boolean                             // absent: shown
  auto?: boolean                             // absent true: grouped frames' groups span their bars
                                             // (the bars named under them by data set or level)
  rename?: Record<CategoryKey, RichLabel>    // the data's spans renamed by their group's key
  list?: { label: RichLabel; keys: CategoryKey[]; level?: 1 | 2 | 3 }[]
                                             // typed spans: over the categories (a group's key: its
                                             // bars); level absent: the row after the data's spans
  mark?: 'line' | 'bracket' | 'none'         // over each span (absent: a line)
  line?: Partial<StrokeStyle>; text?: Partial<TextStyle>; gap?: Pt
}
ContinuousAxisSpec += {
  pieces?: ({ value: number; unit: 'fraction' | 'pt' } | null)[]   // a broken axis' pieces' lengths,
                                             // low end up; null: the rest shared in proportion
  breakMark?: { style?: 'slash' | 'zigzag' | 'gap'; size?: Pt }   // absent: '//' at both edges, 4 pt
  tickValues?: { major: number[]; minor?: number[] }              // ticks at these values
  tickText?: { value: number; text: RichLabel }[]                 // text at values ("Monomer" at 1);
                                             // without tickValues the ticks are at these values alone
  scaleBar?: {                               // a bar `length` data units long
    length: number; label?: RichLabel        // absent: the length and the axis title's unit
    place?: 'bottomLeft' | 'bottomRight' | 'topLeft' | 'topRight' | { x: number; y: number }
    show?: boolean; line?: Partial<StrokeStyle>; text?: Partial<TextStyle>
  }
}
GraphStyle.frame |= 'arrows'                 // corner arrows: UMAP-style axes
GraphStyle += {
  arrows?: { length?: number; unit?: 'fraction' | 'pt'; corner?: 'bottomLeft' | …; line?: Partial<StrokeStyle> }
}
LayerData |= { from: 'values' }              // lines and bands at typed values (stat 'result')
ResultRef |= { from: 'number'; v: number }   // a typed number
ResultStat += { lineLabel?: 'start' | 'end' }   // lines and bands: the template drawn at an end
```

- **Category axes** (`layout/categoryExtras.ts`). Every frame with a category axis hands the axis
  plan its categories' places (`CategoryLayout`: groups, and a grouped frame's dodged bars, by
  key); `planCategoricalAxis` sizes the extras and `drawAxis` draws them outward from the names,
  before the axis title — the grid's rows, then the spans level by level — in either orientation
  (turned: the grid's rows are columns left of the names, their titles reading upwards above the
  plot). They are part of the axis' depth and overhang, so the margins, exports and layout pages
  hold them. A cell or span whose key names no category shown isn't drawn (a slice, a removed
  data set); a new category has blank cells. `graphRefs` reports every key (`kind: 'category'`:
  cells and renamed spans by record key, typed spans by list entry) and `mapGraphRefs` maps a
  group's row by `row` and a data set by `key` (role `categories`); levels' keys are their text.
- **Seeding** (`graph/src/treatments.ts`, the editor only proposes): `parseCombination` reads a
  name as treatments — "TNF+CHX", "TNF + zVAD", "WT TNF", "TNF−" / "TNF −" (absent), "−/+"
  (signs by position), any minus or dash, hyphens inside a word kept ("Z-VAD-FMK"), a lone letter
  or number staying with its word ("Drug A"), controls ("Ctrl", "Vehicle", "DMSO"…) naming none;
  `seedFromNames` makes a row per treatment ('+' where named, '-' elsewhere; spellings matched
  ignoring case and hyphens), a text row of first words taking turns ("WT …", "KO …"), or rows by
  position; null when the names aren't combinations. `seedFromVariables` (graphs of variables):
  a row per other text variable, each category's (bar's) one value of it, yes/no as +/−.
- **Broken axes** (`scale.ts` `pieceScales`): pieces with a length take it (a fraction of the
  whole axis, or points), the others share what is left in proportion to their spans; lengths
  that can't be met fall back to proportional pieces. Several breaks per axis on linear and log
  axes of every frame (X and Y of XY frames, the value axis of category and grouped frames, either
  orientation). Marks: `drawAxis`, by `breakMark` (a zigzag joins the line's ends across the gap).
- **Listed ticks** replace automatic and interval ticks (`planContinuousAxis`; `continuousDomain`
  doesn't thin automatic ticks then); values off the axis (outside its range, ≤ 0 on a log axis,
  in a break) are left out. Text at a value is that tick's label on any scale (log, arcsinh,
  logicle included).
- **Scale bars and corner arrows** are drawn by `composeGraph` (`layout/axisExtras.ts`) for every
  frame with continuous axes: a scale bar spans `length` data units from where it stands (on a log
  axis, the data units there), its label outside the L two bars make in a corner; corner arrows
  leave out the X and Y axes' lines, ticks and labels and draw their titles beside the arrows
  (`isEmbeddingPair`: new graphs of UMAP_1 by UMAP_2 and the like from the builder use them).
- **Typed lines and bands** are roadmap 35's result layers with `data: { from: 'values' }`: the
  same geoms, stat, matrix entries, extents, legend entries (named by their label, else their
  numbers; inserted with the legend hidden) and drawing in the list's order; they read no analysis
  and are drawn once.

### 6.1l Identity and reference lines (roadmap 46b)

Optional fields only, no schema bump (decisions 930–934; `graph/src/layers/geoms/sloped.ts`).

```ts
ResultStat += {
  slope?: FieldName                          // a refline along y = slope·x + intercept (with
  intercept?: FieldName                      // `slope` set, `at`, `axis`, `drop` are unused);
}                                            // intercept absent = 0
// Insert › Identity line (y = x): a refline of typed values
{ id: 'identity', geom: 'refline', data: { from: 'values' }, legend: 'hide',
  stat: { kind: 'result', fields: { slope: { ref: { from: 'number', v: 1 } },
                                    intercept: { ref: { from: 'number', v: 0 } } },
          slope: 'slope', intercept: 'intercept', template: 'y = x' } }   // lineLabel: shown at an end
```

- **Drawn edge to edge** on graphs with two continuous axes (XY frames, survival curves, a graph
  of variables' XY frame; elsewhere a warning): over each visible piece of the X axis, where its Y
  is in a visible piece of the Y axis, so it stops at the plot's edges and at axis breaks (on
  either axis), and a line missing the plot draws nothing. Straight where both axes are linear
  (or both log and the intercept 0), else 64 points per stretch along the X axis' transformed
  units (log, arcsinh, logicle). It never widens the axes.
- **Look**: the theme's reference line (`theme.refline`: dashed grey, a style's data line width)
  under `style.line`; a label (`lineLabel`, the template's text: the equation by default) level,
  beside the line at its start or end, inside the plot; a legend entry when `legend` isn't
  'hide' (named by its label, else its equation; the sample rises with the slope). The layer list
  names it "Identity line (y = x)" or "Reference line (y = 2x − 1)".
- **Values**: typed (`{ from: 'number' }`), or any `ResultRef` (an analysis' slope and intercept,
  per data set in its colour) — the result line's machinery throughout (fields, warnings, "—").

### 6.1m Lines at ± a value and volcano thresholds (roadmap 46b)

Optional fields and union members only, no schema bump (decisions 940–948; `graph/src/layers/geoms/
threshold.ts`, `ui/src/graph/inspector/Volcano.tsx`). A graph without them draws exactly as before.

```ts
ResultStat += {
  mirror?: boolean          // lines and bands at ± the value c of `at`: a line at −c and one at +c,
                            // a band between them; `lo` / `hi` not read
  outside?: boolean         // a mirrored band shades beyond ±c to the axis' ends (two bands)
}
ResultRef |= { from: 'cutoff'; which: 'fold' | 'sig' }   // one of the graph's cut-offs (read by the graph)
Stat |= { kind: 'threshold' }                            // on 'points' layers: the Significance layer
PointsStyle += { classes?: { up?: ColorRef; down?: ColorRef; ns?: ColorRef } }  // absent: red, blue, grey
GraphNode.cutoffs?: {                                    // shared by the Significance layer and the lines
  fold: number                                           // |fold change| ≥ fold (≥ 0)
  sig: { p: number } | { value: number }                 // a P value (drawn at −log10 p), or the axis' value
  foldAxis?: 'x' | 'y'                                   // absent: the fold change along X, significance up Y
  values?: 'negLog10' | 'p'                              // what the significance axis holds (absent: −log10 P)
}                                                        // absent: { fold: 1, sig: { p: 0.05 } }
```

- **± lines and bands** are roadmap 36's typed lines and bands (`data: { from: 'values' }`) with
  `mirror`: one value to edit. Lines: ids `result/<layer>/all/line` (+c) and `…/mirror/line` (−c),
  their labels `…/lineLabel` and `…/mirror/lineLabel` (the label's numbers negated at −c); 0 draws
  one line, a negative value the same two; a log axis only +c. Bands: `…/band` between −c and +c,
  or `…/band/0` (beyond +c) and `…/band/1` (beyond −c) with `outside`, labelled on the first. The
  axes widen to ±c. Legend: "±1" ("beyond ±1"), else the layer's name or label. Audit 3 (G6): a
  band's end (any band's) where the axis shows nothing — inside an axis break, at or below 0 on a
  log axis — is taken to the nearest edge of what it shows within the band, so the part seen is
  drawn (a band wholly unseen draws nothing).
- **The Significance layer** (`threshold`): every point the layer reads — the table's data sets
  (each replicate; entered means: the row's centre), another layer's analysis outputs (`data: {
  from: 'layer' }`) or a graph of variables' mapped points (XY graphs; it needs them, no `aes` of
  its own) — classed by `@ps/stats` `thresholdClass`: up when the fold change ≥ c and the
  significance ≥ s, down when the fold change ≤ −c and the significance ≥ s, else not
  significant; at a cut-off counts as significant; a missing value is left out (not drawn or
  counted). Significance is −log10 P (`values: 'p'`: P ≤ the cut-off); P = 0 (underflowed) and
  −log10 P = +∞ are the most significant (`negLog10P` counts P = 0 as 2^−1074), and a point beyond
  the end of the significance axis is drawn at the plot's edge on the significant side (audit 3,
  G8). Drawn in the class'
  colour (not significant first), with the layer's symbol, size, border and render option
  (clouds when many); ids `series/<key>/point@<layer>/<row>[/<k>]`, `curve/<i>/point@<layer>/<i>`;
  target the layer; the axes reach every point it draws, over mean points too (audit 3, G7).
  Legend: "Up (n)", "Down (n)", "NS (n)" (`legend/threshold/<layer>/<class>`, counts over every
  data set it draws), unless the layer's legend is hidden; a data set (output)
  only it draws has no entry of its own. Matrix (§6.2a): points × threshold on XY tables and
  graphs of variables (XY), and on analysis outputs.
- **The cut-offs** are the graph's (`cutoffValue`, `cutoffValues`), read live by the layer and by
  lines whose value field is `{ from: 'cutoff' }`; `resolveResultRef` returns null for them (they
  aren't in a result). One edit of `cutoffs` (with the lines' axes when `foldAxis` changes:
  `cutoffsCommands`) is one undo step moving the lines and re-colouring the points. They name
  nothing outside the graph: `graphRefs` has nothing to walk. Removing the base points removes a
  Significance layer reading them (as every layer drawing another's data).
- **Insert › Volcano thresholds…** (`volcanoCommands`, one step): the cut-offs; a line at ±
  the fold change's ("Fold change cut-off", `foldCut`) and at the significance's ("P cut-off",
  `pCut`) unless the graph has them; with colouring, a Significance layer (`sig`, unless it has
  one) in front of the base points (the mapped points, else the front-most points layer), their
  fill and border grey (`#c8c8c8`), the legend shown with their entries hidden. A graph of
  variables maps the chosen fold change and P variables as X and Y.
- Lines and bands at values or results on an analysis' own XY graph (its outputs) are allowed by
  `checkLayers` whatever the table's kind (decision 947).

### 6.1n Legend editing (roadmap 47b)

The legend's entries are reordered, hidden and labelled on the legend alone, and laid out in a
grid of any number of columns at every position. Optional fields of `LegendSpec` (no schema
version change; absent, a legend draws as before):

```ts
interface LegendSpec {
  show: boolean
  position: 'right' | 'top' | 'inside'
  inside?: { x: number; y: number }                     // 'inside': top-left corner, plot fractions
  text?: Partial<TextStyle>; border?: StrokeStyle; background?: FillStyle
  columns?: number                                      // ≥ 1, at every position (absent: top = one row, else one column)
  fill?: 'rows' | 'columns'                             // 47b: across each row first (absent) or down each column
  hidden?: string[]                                     // entry keys left out
  reverse?: boolean                                     // each group reversed (not a group `order` lists)
  order?: string[]                                      // 47b: entry keys in the legend's order, within each group
  labels?: Record<string, RichText>                     // 47b: legend-only labels by entry key
  titles?: { color?; shape?; size?: string }            // headings of mapped variables' guides
}
```

- **Entry keys** are what `hidden` always held: a data set's key, an analysis output's or a
  function's id, `@<layer>/<class>` (a Significance class), `@<layer>` (a result line or band),
  `category/<row>` (a pie's, by table row: `categoryEntryKey`), a guide's level
  `<prefix>/<aes>/<levelKey>` (`aes`, `bubble`, `dotplot`…; a number variable's swatches
  `<prefix>/color/<k>` by place), `group/<levelKey>` (a bubble plot's groups). Audit 3 (G1, G2):
  never a level's place, so a label, hidden entry or order follows its level when the levels are
  reordered or a new one comes; the scene's node ids stay by place. `graphRefs` walks `order[i]`
  and `labels`' keys with `hidden[i]` (role `legend`), and `mapGraphRefs` maps and prunes them
  alike (a data set renamed or removed, an output dropped; keys mapped onto one listed once in
  `order`; a pie's category keys moved with their rows by row edits, a deleted row's dropped,
  as single slices' formats are). Keys naming nothing
  (a removed layer's class, an unknown key) are kept and ignored. Match format keeps the target's
  own `order`, `labels` and (audit 3, G5) `hidden` (they name its entries; labels are wording).
- **Groups**: the data sets' group (data sets, curves, functions, Significance classes, result
  lines, pie categories; `DATA_SET_GROUP`) and each guide of a mapped variable (its heading's key),
  a density layer's bar, a bubble plot's groups. `order` orders within each group: its listed
  entries in its order, then the others in their own order (an entry added later comes last),
  in the places the group's entries had — headings, colour bars and "… more" / "Missing" lines
  (`LegendEntry.fixed`) and other groups stay where they are. Reordering is the legend's alone:
  never the drawing order of marks, data sets or table columns. `reverse` applies to groups
  `order` doesn't list (`reversedEntries`, the frames' one test); the panel's Reverse box turns
  listed groups' order over too.
- **Labels** replace an entry's own label (not a fixed entry's) as rich text measured with
  fontkit like any; result values shown in the legend (`LegendEntry.suffix`) follow either.
- **Where**: the frames assemble their entries (tagged with `group`, `fixed`, `suffix`); the
  legend's layout (`legendBlock`) orders them (`orderedEntries`), leaves out the hidden, labels
  them (`labelledEntry`), caps them at 100, and lays the grid out: `columns` (clamped to the
  entries), `rows = ⌈n / columns⌉`; filled across the rows, or down the columns with
  `⌈n / rows⌉` columns (5 in 4 asked: 3 columns of 2). Each entry's node carries
  `legendEntry: { key, group }`; the scene lists every entry (`Scene.legend`: key, group, own
  label, hidden, fixed), hidden ones too and when the legend is off, for the editors.

### 6.2 Style cascade

```
geom style:   markDefaults(theme, graph)[section]          →  layer.style  →  layer.series[key].style
stat:         layer.stat                                   →  layer.series[key].stat
identity:     theme                                        →  style.seriesDefaults  →  seriesOverrides[key]
datum:        (the layer's resolved mark)                  →  pointOverrides[key][pointKey]
```

`theme` is the graph's style resolved (§6.2b); `markDefaults` gives the per-geom defaults under
the context rules of the graph's `look`. A layer style field falls back to the section it came
from (`styleSections`), so a migrated graph resolves to v1's values. "All data sets" in Format graph writes `layer.style`, one
data set `layer.series[key].style` (decisions 59 / 78 with the layer as the extra key).

**New layers' looks** (audit 3, RFR-5 and RTA-12; `newLayerLooks`, `graph/src/newDefaults.ts`):
the layers a new graph is made with (`newGraphNode`: presets, the builder) and the layers Change
layers or Duplicate as… brings (`withLayers`: those the graph doesn't keep) are written with the
looks a new graph starts with — bars of the table's data solid in their data set's colour
(`fill`, the theme's are 35%), the table's points over bars white with a black border (`fill`,
`border`), and lines through each replicate unfaded (`fade: 0`) unless a line at the mean is
drawn too (a fade written so is taken back when one comes). Fields the layer has are kept. The
theme's defaults are unchanged, so graphs already made — v1 documents migrated, graphs saved
before — draw as they did; the synthetic examples are built with the theme's looks
(`presetGraph(…, { looks: 'theme' })`), as their v1 documents draw.

```ts
interface GraphStyle {                                  // graph-wide (v2)
  seriesDefaults?: { color?; yAxis?; pointLabels? }     // every data set's identity defaults
  text?: Partial<TextStyle>; palette?: RGB[]; frame?: 'axes' | 'box' | 'none' | 'arrows'  // arrows: roadmap 36 (§6.1k)
  arrows?: CornerArrows                                 // roadmap 36: the corner arrows' length, corner and line
  background?: FillStyle; plotBackground?: FillStyle; bracket?: BracketStyle
  categoryGap?: number; orientation?: 'vertical' | 'horizontal'   // category and grouped frames
  polar?: { hole?: number; startAngle?: number; clockwise?: boolean }  // pies and donuts
}
```

Per-geom styles are v1's `SeriesStyle` sections, moved (design §2.2): points (shape, size, fill,
border, `spread` (was `jitter`), excludedStyle, subjects), bar (fill, border, width, binWidth,
baseline), errorbar (direction, capWidth, line, x), center (line, width), box (fill, border,
width, capWidth, centerLine, outlier symbol), violin (fill, border, width, quartiles,
quartileLine, centerLine), line (stroke, gaps, fade), area / band (opacity, baseline, gaps),
connector and refline (line), difference (guides, symbol, line, capWidth), tile (missing, border,
cluster), wedge (fill, border), label (value, position, format, text, content, digits).

The v1 series style, which v1 files hold (read only by the migration, §6.1b; no view reads it
since 33c):

```ts
interface SeriesStyle {
  color?: ColorRef                                      // { palette: number } | { rgb: '#rrggbb' }
  points?: Partial<{ show: boolean; shape: SymbolShape; size: Pt; fill: FillStyle; border: StrokeStyle; jitter: 'auto' | 'none' | number; excludedStyle: 'hide' | 'hollow' }>
  bar?: Partial<{ fill: FillStyle; border: StrokeStyle; width: number }>   // width = fraction of category
  box?: Partial<{ whiskers: 'minmax' | 'tukey' | 'p1p99' | 'p025p975' | 'p5p95' | 'p10p90'; fill: FillStyle; border: StrokeStyle }>
  center?: Partial<{ stat: 'mean' | 'median' | 'geomean' | 'none'; line: StrokeStyle; width: number }>  // width: fraction of the column
  error?: Partial<ErrorSpec>
}

interface ErrorSpec {
  stat: 'SD' | 'SEM' | 'CI' | 'range' | 'IQR' | 'MAD' | 'MADn' | 'geoSD' | 'geoCI' | 'none'
  direction: 'both' | 'above' | 'below'
  capWidth: Pt
  line: StrokeStyle
  x?: boolean                                           // XY: X error bars (roadmap 30)
}
```

`points.jitter` places the points of a column or grouped cell: `'auto'` is a swarm (each point at
the free position nearest the centre line, symbols touching but not overlapping, ties fanned out
alternately) compressed to fit the column; a number is the swarm's half-width limit in points;
`'none'` puts them in one vertical line. A points layer’s section calls this "Arrangement". The
presets "Points only" and "Points with a line at the mean" set `center.stat` / `error.stat` to
`'none'` as needed.

XY graphs (`graphType: 'xy.scatter'`) add three SeriesStyle groups: `points.replicates`
(`'mean'` with error bars, or `'each'`), `line` (connecting line or curve stroke) and `band`
(shading of an output's lo/hi band). Fitted curves are `ExtraSeries` referencing an analysis output;
`ExtraSeries.colorOf` names the data set whose colour the curve takes by default.

A `ColorRef` is `{ palette: i }`, `{ rgb }`, or `{ series: true }` (the owning series' colour, used
e.g. for error bars and bar fills). Default colour for series *i* is palette entry *i*, resolved
against the theme palette, so changing theme recolours every graph that hasn't pinned explicit
colours. Style templates ("Magic", Phase 5)
copy `style` and `seriesOverrides` by position.

Error bars and centre lines on a column graph are computed from the normalized data set by
`plotStats` (`graph/src/data.ts`, using `@ps/stats`), not taken from an analysis. When the table is in
summary format, the entered mean/SD/N are used directly.

### 6.2b Styles (roadmap 37)

A *style* is a named, partial set of graph defaults (`model/src/figureStyle.ts`), plain data:

```ts
interface FigureStyle {                                 // every field optional
  name?: string; description?: string
  font?: FontId                                         // every text's (a role's own font wins)
  text?: Partial<Record<'title' | 'axisTitle' | 'tickLabel' | 'legend' | 'annotation' | 'bracket'
                        | 'resultLabel', Partial<TextStyle>>>
  lines?: Partial<Record<'axis' | 'tick' | 'errorBar' | 'dataLine' | 'barOutline' | 'bracket', Pt>>
  symbolSize?: Pt; barFillOpacity?: number              // 0–1: translucent bars and boxes
  palette?: RGB[]                                       // categorical colours, in order
  colorMap?: ColorMapName                               // default continuous colour (heat maps, densities)
  axes?: { frame?: 'plain' | 'offset'; tickDirection?; tickLength?: Pt; minorTickLength?: Pt }
  pValue?: { style?: 'GP' | 'APA' | 'NEJM'; digits?: number }
  legend?: { position?: 'right' | 'top' | 'inside' }    // new graphs' legends
  columns?: { single?: Pt; oneAndHalf?: Pt; double?: Pt }  // figure widths, for Fit to column
}
```

**Resolution.** `effectiveStyle(settings, graph)` layers the graph's own style (`graph.theme`)
over the project's (`settings.style`) field by field (`mergeStyles`: a role's text by its fields,
a palette whole); `themeOf(style)` turns it into the theme layouts read (`graphTheme(project,
graph)`): the app's defaults (`DEFAULT_THEME`) with the style's fonts and sizes per role (title →
`graphTitle`, axis titles, tick labels, legend, annotations → `text`, brackets → `bracket.label`,
result and point labels → `pointLabel`), line widths (axis line, `tickWidth`, bracket line; error
bars, centre lines, data lines and curves, bar and box outlines in every context), symbol size,
bar fill opacity (translucent fills only: parts of whole stay solid), palette (the 16 extra
categorical colours follow it), colour map and tick marks. The empty style is `DEFAULT_THEME`
itself, so graphs without a style draw exactly as before. Pages' own text (text boxes, panel
labels) takes the project's style.

**Precedence ("keep my edits", decision 531):** a value the graph sets itself > the graph's style
> the project's style > the app's defaults. "Set by the user" is an explicit value in the
document: an absent field follows the style. Format dialogs write only what changed (text fields
sparse; an axis line's or bracket line's width alone, `sparseStroke`); a layer's line (`stroke`,
`line`, `border`) is one value in the schema, so editing its colour makes its width the user's
too. Two settings every graph holds — a continuous axis' `frame` and `legend.position` — are the
user's when they differ from what the graph's style gives (`styleRequired`: plain / right by
default); a style change moves those still at the old style's value (`moveRequired`), and new
graphs take the project's (`node.add` with `fresh`). Values presets write into new graphs' layers
(small points of large tables) count as the graph's own.

**Reset to style** (`resetToStyle`, decision 533) clears what styles set: the fonts of the title,
axis titles, tick labels, legend, base text, text annotations and bracket labels; axis and tick
line widths and tick marks; bracket lines; the graph's palette; symbol sizes, line widths and bar
fills of its layers (`STYLED_LAYER_FIELDS`) and result labels' text; axis frames and the legend's
place set to the style's. Titles' wording, ranges, sizes, data sets' colours and the rest stay.

**Retiring `look` (decision 536; GRAPH_LAYERS Q3).** The per-chart-type table v1 wrote by hand
(`theme.series[look]`) is now per-geom defaults (`base`) under *context rules*
(`CONTEXT_RULES`: what differs on graphs of each context — bars or boxes make points smaller and
error bars point up, grouped slots narrow caps and widen bars, XY puts symbols in front of error
bars and histogram bars touch, survival curves are thicker, bubbles translucent, parts of whole
solid with white borders, a donut's hole), a style's values over every context. `look` stays in
documents (removing it is a schema change, and migrated graphs' contexts can't all be derived from
their layers): it is the context's name, read only by `markDefaults` (pies' hole included, no
longer a branch). The table is reproduced exactly (`graph/test/fixtures/v1ThemeTable.ts`), and
every preset on every table kind draws the same SVG in every context under the default style.

**Built-in styles** (`BUILTIN_STYLES`, decision 532): Default (the empty style) and four sized
after journals' figure guidelines as remembered (not checked against the current pages), named
descriptively, described as approximate and not endorsed:

| Id | Name | Text (title / axis titles / the rest) | Lines (data) | Columns (mm) |
|---|---|---|---|---|
| `journal-nature` | Journal: Nature-style (7 pt, 89/183 mm) | 8 bold / 7 / 6 | 0.5 (0.75) | 89 / 120 / 183 |
| `journal-cell` | Journal: Cell-style (7 pt, 85/174 mm) | 8 bold / 7 / 6 | 0.5 (0.75) | 85 / 114 / 174 |
| `journal-science` | Journal: Science-style (7 pt, 55/120/183 mm) | 8 bold / 7 / 7 | 0.5 (1) | 55 / 120 / 183 |
| `journal-pnas` | Journal: PNAS-style (7 pt, 87/178 mm) | 8 bold / 7 / 6 | 0.5 (0.75) | 87 / 114 / 178 |

All sans (Liberation Sans, Arial's metrics), symbols 3.5 pt, ticks out 2.5 pt (minor 1.5),
axes touching.

**Fit to column** (decision 535; `fitToWidth`, `fitPageToWidth`): a graph's `size` set so the
whole graph is the column wide at `size.scale` 1 (scale dropped: text, symbols and lines at the
style's point sizes), the plot keeping its proportions or its height; a page made the column
wide, its items placed in proportion (positions, text boxes' widths, lines, shapes, images ×
the ratio, never text), each graph item at scale 1 and its graph refitted to its place. Styles
without widths use 85 / 114 / 174 mm.

**Applying** (`applyStyleCommands`, one undo step): to graphs, each gets `theme` (none when it is
the project's); to the project, `settings.theme` and `style` (and the style's P values) change and
graphs follow (their own styles dropped, or kept: "the project's style only").

### 6.2a Compatibility matrix

Which geoms, stats and positions a table kind allows (decision 229): the builder, the Layers
list's Add menu, presets and the graph's warnings all ask `graph/src/layers/matrix.ts`
(`geomAllowed`, `frameAllowed`, `positionAllowed`, `checkLayers`), and refusals carry their
reason. Graphs of a multiple-variables table's variables are kinds of their own by the types of
the variables on their axes (roadmap 34a, §6.1c; `matrixKindOf(table, graph)`: `mvTextNumber`,
`mvNumberText`, `mvTextText`), so the builder offers only what draws for the axes chosen. The text below is generated from it (`matrixMarkdown`, `graph/src/layers/matrixDoc.ts`);
`graph/test/matrixDoc.test.ts` keeps them equal (`UPDATE_DOCS=1` rewrites it).

<!-- matrix:start (generated from graph/src/layers/matrix.ts; do not edit) -->

Frames per table kind:

| Table kind | Frames (the usual one first) |
|---|---|
| Column | category, xy |
| XY | xy |
| Grouped | grouped, matrix |
| Contingency | grouped, matrix |
| Survival | xy |
| Parts of whole | polar, category |
| Multiple variables | category, xy, matrix |
| Nested | category |
| Variables: text × number | category, grouped |
| Variables: number × text | category, grouped |
| Variables: text × text | grouped, matrix |

Stats each geom allows per table kind (— = not offered):

| Geom | Column | XY | Grouped | Contingency | Survival | Parts of whole | Multiple variables | Nested | Variables: text × number | Variables: number × text | Variables: text × text |
|---|---|---|---|---|---|---|---|---|---|---|---|
| points | identity, summary | identity, summary, threshold | identity, summary | identity | — | — | identity, summary, dotplot*, threshold | identity, summary | identity, summary | identity, summary | — |
| bar | summary, bin* | identity, summary | summary | summary | — | fraction | summary, bin* | summary | summary | summary | summary |
| errorbar | summary | summary | summary | — | — | — | summary | summary | summary | summary | — |
| center | summary | — | summary | — | — | — | summary | summary | summary | summary | — |
| box | boxplot*, range* | boxplot* | boxplot*, range* | — | — | — | boxplot*, range* | boxplot*, range* | boxplot*, range* | boxplot*, range* | — |
| violin | density* | — | density* | — | — | — | density* | density* | density* | density* | — |
| line | summary | summary, identity | summary | — | — | — | summary, identity | summary | summary | summary | — |
| step | — | summary | — | — | km | — | — | — | — | — | — |
| censor | — | — | — | — | km | — | — | — | — | — | — |
| area | — | summary | — | — | — | — | — | — | — | — | — |
| band | result | summary, result | summary, result | result | km, result | — | result | result | summary, result | summary, result | result |
| connector | identity | — | identity | — | — | — | identity | — | — | — | — |
| refline | summary, result | result | result | result | result | — | summary, result | summary, result | summary, result | summary, result | result |
| difference | difference | — | — | — | — | — | difference | — | difference | difference | — |
| tile | — | — | cell | cell | — | — | identity, cell, dotplot* | — | — | — | cell |
| wedge | — | — | — | — | — | fraction | — | — | — | — | — |
| label | summary, result | summary, identity, result | summary, cell, result | summary, cell, result | result | fraction | summary, cell, centroid, result | summary, result | summary, result | summary, result | summary, cell, result |
| polygon | — | ellipse, hull | — | — | — | — | ellipse, hull | — | — | — | — |
| path | — | identity | — | — | — | — | identity | — | — | — | — |
| segment | — | — | — | — | — | — | identity | — | — | — | — |
| hex | — | — | — | — | — | — | hexbin* | — | — | — | — |
| contour | — | — | — | — | — | — | density2d* | — | — | — | — |
| raster | — | — | — | — | — | — | density2d* | — | — | — | — |

- A stat marked * needs raw values: it is refused for entered means (mean / SD / N formats), as are before-after lines.
- Analysis outputs and functions draw lines, points and bands (identity) on any xy graph.
- Bins (histograms) need an xy graph; a column table’s xy graph is its histogram and draws binned bars only.
- A histogram (roadmap 34f: a multiple-variables table’s too) draws binned bars only (analysis outputs and functions aside); a multiple-variables table’s bins the number variable mapped to X (`aes.x`), as one data set or one per level of a text variable mapped to colour (`aes.color`), overlaid or stacked.
- A multiple-variables table’s xy graph maps variables: points (a row each), lines by group, and (roadmap 34c) paths, ellipses and hulls by group and vectors (a row each); or it is a histogram of one.
- Ellipses and convex hulls (polygon), paths (rows joined in table order) and vectors (segment, from X, Y to the X end and Y end variables) are drawn on XY graphs only: an XY table’s data sets each, a graph of variables’ groups (the colour or shape variable’s levels), after its mapped points; vectors need X end and Y end variables.
- Connectors (before-after lines) on grouped tables join each subject (replicate) across the data sets within a row (pair lines).
- Densities of a graph of variables’ points (roadmap 34g) are drawn on its XY graph after its mapped points, in the axes’ transformed coordinates (arcsinh, logicle): hexagons coloured by the points in each (hex × hexbin), contour lines or filled bands of the 2D density per group of the colour variable (contour × density2d) and the density as an image (raster × density2d). They summarise the rows: cells tables offer them.
- Dot plots (roadmap 34g) are grids of a multiple-variables table’s number variables (along X) by the levels of a text variable (`aes.group`, down Y): dots sized by the percent of each level’s rows above a threshold and coloured by their average (points × dotplot), or the averages as tiles (tile × dotplot); a dot plot draws nothing else. They summarise the rows: cells tables offer them.
- Graphs of variables (roadmap 34a) are kinds of their own by the types of the variables on X and Y. Multiple variables: number × number (its xy graph), or every number variable as a column or a heat-map column. Text × number: the number variable by the text variable’s levels, a category each, or with a text variable mapped to colour a group each within them (grouped); number × text is the same turned (categories down the left). Text × text: the rows of each combination of levels counted (bars by the X levels, side by side or stacked, or a heat map), as counts or as percents of the X level or of the total.
- Bands join the rows of grouped graphs; a grand mean and differences are drawn on category graphs only.
- Lines on a category graph join the means across the categories.
- Positions: grouped graphs place points, bars, boxes, violins, lines, bands, error bars, labels and centre lines side by side (dodge) or at the row’s centre (aligned); on category graphs only the subjects of nested groups stand side by side; elsewhere marks sit at their slot or X.
- Only bars and XY areas stack (areas by value, not as percents); attached layers (error bars, labels) take their host’s position.
- Stacked bars draw no points or line layers; stacked areas no points, line, step, errorbar, band, path, polygon layers of the table.
- Heat maps (matrix) draw tiles and the values of their cells; pies (polar) slices and their labels; tiles, slices, cell values and shares of the whole (fraction) are drawn on nothing else (shares also as 100% bars).
- A graph has at most one difference layer, one tile, slice or 100% bars layer (with at most one labels layer, attached to it: their values and labels sit nowhere else) and one layer of mapped points; lines by group need mapped points.

Variables mapped to appearance (roadmap 34b), by the layers they act on (— = not offered; Multiple variables: its XY graph):

| Mapped to | Multiple variables | Variables: text × number | Variables: number × text |
|---|---|---|---|
| Colour (text variable) | points, line, polygon, path, segment, contour | every layer (the groups) | every layer (the groups) |
| Colour (number variable) | points, segment | points | points |
| Shape (text variable) | points | points | points |
| Size (number variable) | points | points | points |
| Label (any variable) | points | points | points |

- Shape, size, labels and colour by a number variable act on points of every row (identity), each its row’s; a text colour variable makes the groups of a category graph (the grouped frame) and colours an XY graph’s rows and its lines by group.
- On XY graphs (roadmap 34c) a text colour variable also colours each group’s ellipse, hull and path, and colour by either type each row’s vector; (roadmap 34g) it splits density contours into one set per group, each in its colour. Points can also be coloured by their local density (`colorBy`), on the colour scale in place of a variable.
- Text × text graphs count rows: their colour is the Y variable; nothing else is mapped.

Cells tables (roadmap 34f): a multiple-variables table of more than 20,000 rows, or set to be one, offers no layer drawing a mark per row within categories or joining every row (their cost and clutter grow with the rows); scatters of the rows (one point cloud), summaries, histograms and counts scale:

| Layer (stats) | Frames | Kinds | Too many | Instead |
|---|---|---|---|---|
| points (identity) | category, grouped | Multiple variables, Variables: text × number, Variables: number × text | too many points for a swarm | Use a violin or box. (Format offers a violin) |
| connector (identity) | category, grouped | Multiple variables, Variables: text × number, Variables: number × text | too many lines for before–after lines | Join the means instead. (Format offers joined means) |
| path (identity) | XY | Multiple variables | too many rows to join in a path | Use ellipses, hulls or group names. |
| segment (identity) | XY | Multiple variables | too many arrows for vectors | Use a scatter coloured by a variable. |
| line (identity) | XY | Multiple variables | too many rows to join in lines by group | Use ellipses, hulls or group names. |
| tile (identity, cell) | heat map | Multiple variables | too many rows for a heat map of every value | Count two text variables, or use violins. |
| label (cell) | heat map | Multiple variables | too many values to label | Count two text variables, or use violins. |

- Labels from a variable are offered on cells tables of at most 1,000 rows (group names instead).
- Such layers already on a graph keep drawing; Format › Layers says why they are slow and offers the summary in their place (or hides them).

<!-- matrix:end -->

### 6.3 Axes and text

```ts
type AxisSpec =
  | { type: 'categorical'; labels: 'dataSetTitles'; line: StrokeStyle; tickLabels: TextStyle; title: TextSpec | null; rotation: 0 | 45 | 90 }
  | { type: 'continuous'; scale: 'linear' | 'log10' | 'log2' | 'arcsinh' | 'logicle';  // 34g: cytometry scales (§6.1i)
      arcsinh?: { cofactor? }; logicle?: { T?; W?; M?; A? };
      range: 'auto' | { min: number; max: number };
      ticks: 'auto' | { interval: number; start?: number; minor: number };
      format: NumberDisplay; line: StrokeStyle; tickLabels: TextStyle; title: TextSpec | null;
      frame: 'plain' | 'offset'; breaks: AxisBreak[] }   // roadmap 36 extras: §6.1k

type RichText = { text: string; sup?: boolean; sub?: boolean; italic?: boolean; bold?: boolean;
  underline?: boolean; font?: FontId; size?: Pt; color?: ColorRef }[]  // text may hold '\n'
type FontId = 'sans' | 'serif' | 'mono' | 'narrow'    // Liberation Sans, Serif, Mono, Sans Narrow
interface TextSpec { content: RichText; style: TextStyle; align?: 'left' | 'center' | 'right' }
type RichLabel = string | RichText                    // plain labels stay strings (roadmap 28)
interface TextStyle { font: FontId; size: Pt; color: ColorRef; bold: boolean; italic: boolean }
```

Rich text is designed in from the start: axis titles need units like "Concentration (µM)" and
powers of ten. Fonts are referenced by `FontId` from the bundled set, so text measurement is
deterministic.

Roadmap 28 (decisions 144–150):

- **Line breaks** are '\n' inside runs, allowed in graph and axis titles, text boxes and layout
  text. `layoutText` lays out a line per break, a pitch apart (the base font's ascent − descent +
  line gap); `ascent` is the first line's, `descent` reaches the bottom of the last, so anchors,
  rotation, boxes and the room axis titles take follow. Lines line up by the horizontal anchor
  (centred titles) or, in text boxes, by `TextSpec.align` (default left).
- **Underline** is a run flag, drawn as filled rects in the text layout (`TextLayout.underlines`,
  at the regular face's underline position and thickness, one per line's stretch of underlined
  runs), after the `<text>` and turned with it.
- **Labels** that used to be strings accept runs too (`RichLabel`): a bracket's manual label,
  `PointStyle.label` and `FunctionCurve.title`. Writers store a string when the text is plain
  (`toLabel`); readers use `labelRuns` / `labelPlain`.
- **Graphs use formatted table titles**: legend entries (data sets, pie categories), category
  labels (data set titles, row titles, estimation-plot differences), pie labels and titles,
  slice graphs' titles and the X title a new XY graph takes. Point labels taken from row titles
  or text variables stay plain.

Roadmap 28b (decisions 151–155):

- **Run font, size and colour**: a run's `font` (now also `'mono'` and `'narrow'`), `size` (points,
  absolute) and `color` (a `ColorRef`) override the element's `TextStyle` for that run; absent
  fields take it. Optional, so older files load unchanged and older apps drop them (no schema
  bump). `mergeRuns` joins only runs equal in all of them. `bold` / `italic` are stored only
  where they differ from the element's style: `bold: false` is a regular run in a bold title.
- **Layout**: a run is measured at its own size and a script at 0.7 of its run's size; lines of
  the style's size sit a pitch apart as before, a line with larger (or only smaller) runs takes
  the room of its largest run above and below its baseline. Underlines take the run's size and
  colour. `PositionedRun` / `TextRect` carry `color` from the layout and `fill` (CSS, only when it
  differs from the text's) from `placeText`; a graph's scale scales run sizes.
- **Where they show**: everywhere graph text is drawn (titles, text boxes, layout text, legends,
  category labels, pie labels, brackets, point labels). Table titles keep them in their rich
  form; the grid shows only font and colour, at its own size.

### 6.4 Annotations and live significance brackets

```ts
type Annotation =                                       // each may also carry `behind?: boolean`
  | { type: 'bracket'; id: AnnotationId; a: DataSetKey; b: DataSetKey;
      rowA?: number; rowB?: number                      // grouped graphs: the rows of the two bars (below)
      label: { source: 'analysis'; analysis: NodeId; comparison: string; show: 'stars' | 'p' | 'both' | 'number' }
           | { source: 'manual'; text: RichLabel };
      level: 'auto' | number                            // 'auto' = stacked by the layout engine
      offset?: Pt                                       // dragged up (negative) or down from its computed height
      x?: number                                        // roadmap 35: XY graphs, at this X (§6.1j)
      group?: DataSetKey[] }                            // roadmap 35: pooled with `a` against `b` (§6.1j)
  | { type: 'text'; id: AnnotationId; anchor: { space: 'plot' | 'data'; x: number; y: number }; content: TextSpec
      border?: StrokeStyle; background?: FillStyle }
  | { type: 'line'; id: AnnotationId; space: 'plot' | 'data'; from: { x; y }; to: { x; y }; stroke: StrokeStyle
      arrow: 'none' | 'end' | 'both'; heads?: LineEnds } // heads: roadmap 32 (§7)
  | { type: 'table'; id: AnnotationId; analysis: NodeId; sheet: string; … }   // roadmap 35 (§6.1j)
```

Grouped tables (Phase 3) compare *cells*: `Comparison.rowA/rowB` and the bracket's `rowA/rowB`
name the rows of the two bars (same data set and different rows for "within each column"; same row
and different data sets for "within each row"). Grouped graphs (`grouped.bar`, `grouped.scatter`)
lay out one cluster per row and one bar per data set, and accept only cell brackets; column graphs
accept only whole-data-set brackets.

A bracket that references an analysis comparison **updates live** when data changes, and makes the
graph depend on that analysis in the DAG. Inserting or deleting table rows moves cell brackets
(`rowA/rowB`, and the row indices in grouped-ANOVA comparison keys `row{r}:…` and
`col{key}:{ra}|{rb}`) in the same undo step; a bracket on a deleted row is removed. Removing an analysis strips its
brackets and curves (extra series) from other graphs; only its own output graphs (no table series,
every extra series from it) are removed with it.

### 6.4a Formatting (Phase 7)

All formatting fields are optional sparse overrides; absent means today's theme default, so older
files render unchanged. Lengths are points.

- **Axes** (`AxisSpec`, both kinds): `show`, `line` (stroke), `tickStyle` {direction out/in/
  cross/none, length, width, minorLength}, `showLabels`, `tickLabels` (text), `grid` {major,
  minor strokes}, `titleGap`. Continuous only: `reverse`, `anchor` (where it crosses the other
  axis; category index on column/grouped graphs), `rotation` of tick labels, `breaks`
  ({from, to, gap}; linear axes, data inside a break hidden), number `format` (auto / fixed /
  scientific / power10 / percent, `digits`, `thousands`, `prefix`, `suffix`; auto switches to
  power10 below 1e-4 or from 1e7).
- **Graph** (`GraphStyle`): `text` (base style for every text), `frame` (axes / box / none),
  `background`, `plotBackground`, `bracket` (line, label, step, gap, tick), `categoryGap`
  (gap = value × a group's width).
- **Legend**: position right / top / inside (`inside` = top-left as plot fractions), `text`,
  `border`, `background`, `hidden` (entry keys); roadmap 47b: `columns` at every position, `fill`,
  `order` and `labels` (§6.1n).
- **Annotations**: text (`anchor` in plot fractions or data values; optional box) and line /
  arrow (`space`, `from`, `to`, `stroke`, `arrow` none/end/both), besides brackets.
- **Centre and error bars** (per series, or for every series via `style.seriesDefaults`):
  centre `mean` / `median` (bar height or centre line; `none` hides a dot plot's line) for column
  and grouped graphs; error bars SD, SEM, 95% CI, range, IQR, MAD (median absolute deviation)
  or MAD × 1.4826 (≈ SD for normal data), drawn around the chosen centre, or none. Switching the
  centre re-pairs the spread (median → IQR, mean → SD) in the UI; any combination can be set.
- **Rich text**: titles and text are `RichText` runs, typed in the rich text editor (roadmap 28:
  literal typing, a toolbar and shortcuts for bold, italic, underline, superscript, subscript
  and symbols; roadmap 28b: the selection's font, size and colour, grow / shrink, text box
  alignment and Clear formatting); the small typed syntax of Phase 7 (decision 38) is retired.
- **Editing on the canvas**: the scene carries `axes` (data ↔ point mappings, respecting log,
  reverse and breaks) and bounding boxes with style targets for titles, axes, legend (and entries)
  and annotations. Dragging the legend moves it inside the plot; dragging text / lines moves them
  in their own space; double-clicking a title, text box or legend entry edits it in place (roadmap
  47b: a legend entry's legend-only label, `legend.labels`; its data set keeps its name).
- **Format panel and dialogs (Phase 12; roadmap 46)**: formatting happens in the Format panel
  docked beside the canvas (live, one undo step per change) or, from its Open in window, in a
  modal dialog that edits a draft shown in its preview and commits once (§8.1). Double-click (text
  excepted), Format…, right-click › Format… or Enter on the selection show the element's place
  (roadmap 46 stage 2, decisions 910–919): a data set, curve or function (every layer drawing it,
  the part clicked open), a layer (Alt-click, the layer list), a point, an axis (its tick labels,
  its title at the Title section), the graph title, the legend, a bracket, a text box, line or
  arrow; the frame, plot area and background → the graph's place. Each opens on its Common
  settings, the rest in sections remembered per kind of element; tabs remain only between the
  axes.
- **Single points** (`pointOverrides`, Phase 12): `graph.pointOverrides?: Record<DataSetKey,
  Record<PointKey, PointStyle>>`. A `PointKey` names where the plotted value comes from:
  `r<row>s<sub>` (table row, replicate subcolumn) for individual values (column scatter points,
  grouped replicates, XY "each replicate"), `r<row>` for a mark drawn per row (XY and grouped
  mean symbols). `PointStyle` is sparse: `color`, `shape`, `size`, `fill`, `border`, `hide`
  (not drawn; still counted in statistics), `label` (short text beside the point; `RichLabel`).
  Row indices
  are table rows (a row slice doesn't renumber them) and are remapped by `table.insertRows` /
  `table.deleteRows` like row slices and bracket cells (a deleted row's formats are dropped).
  Limitations: bars and boxes have per-mark formats on grouped graphs only (§6.4d; a column
  graph's bar or box is its whole data set); box-plot outliers have none; moving data between
  subcolumns or reordering rows by editing values keeps the key on the cell position, not the
  value; a key whose row or replicate no longer exists is kept but draws nothing.
- **Selection** on the canvas: the first click on data selects the data set (its marks and
  legend entry are haloed along their geometry); a click on a point of the selected data set
  selects that point (`['pointOverrides', dataSet, key]`); Escape steps back. Scene nodes of
  points carry `point` (their key) for this. Roadmap 47: Delete hides selected points (`hide`;
  the table untouched); the format bar writes several selected points' `color`, `border` (a
  bar's or box's `bar.border` / `box.border`), `shape` and `size`, and the Format panel shown
  for one of several selected points writes its edits to each, every point's border (or fill)
  composed from what it draws with, only the field edited changed (decisions 962, 964, 965).
- **The legend** (roadmap 47b, decisions 980–999): the first click on any part of it selects the
  whole legend (`['legend']`), a click on an entry once the legend (or an entry) is selected that
  entry (`['legend', 'entries', <key>]`); Escape steps back to the legend. An entry formats what
  it stands for (its data set's identity, a Significance class's or result line's layer, else the
  legend) and moves within its group (drag, Alt+arrow keys: `legend.order`), hides (Delete:
  `legend.hidden`) and takes a legend-only label (double-click: `legend.labels`).

### 6.4b Slices, shared axes and small multiples (Phase 8)

- **Row slices:** `seriesSource.rows` lists the table rows a graph shows, in order (with
  `seriesSource.include` for data sets, a graph can show any sub-table). `resolveSeries` returns
  row-sliced data sets; brackets on rows outside the slice aren't drawn. The engine keeps slices
  pointing at the same rows through row inserts/deletes.
- **Shared axes:** `links.x` / `links.y` are group ids. Every graph in a group with an automatic
  continuous range plans that axis from the union of the members' data extents (an extent-only
  pass, no text layout), so the range stays in sync as data change; members with a manual range
  keep it and don't contribute.
- **Presets** (roadmap 33c, decision 248): `GRAPH_PRESETS` (`graph/src/presets.ts`), each a
  function from a table (kind, entry format, nesting) to a frame, a look and a layer list
  (`presetLayers`); `presetGraph(table, id)` makes a new graph of one (`newGraphNode`: the
  frame's scaffold of axes and legend). Scatter with mean ± SD or median & IQR, points only,
  points with mean, bars ± SD / SEM, bars with points, mean ± SD / SEM, box, box with points,
  violin (with points, with box), floating bars, before–after, estimation, mean ± SD joined,
  stacked bars (and 100%), heat map, every replicate, spaghetti, mean with SD band, histogram,
  survival curves, pie, donut, 100% stacked bars, bubble plot, XY mean ± SD joined;
  `presetsFor(kind)` lists those for a table kind and `defaultPresetFor` picks a new graph's (a
  frequency distribution's result: the histogram). The builder shows only `BUILDER_PRESETS[kind]`
  as chips (decision 254; `builderDefaultFor` its starting chip), after the user's own presets
  (§9.4). Each draws what the 33b preset of the same id drew. `withLayers(graph,
  change, table)` changes a graph's layers keeping the formats of the layers that stay
  (`keepFormats`, decision 249: matched by id and geom, else by geom; style, per-data-set
  formats, name and legend entry kept; stat, position and data the new list's), with a new
  frame's axes and the difference axis when a difference layer comes or goes.
- **Small multiples:** (roadmap 34d: sets of split graphs, §6.1f, made by `splitGraphs`, which
  uses this for data sets and rows) `sliceGraphs(table, 'row' | 'dataSet', base)` makes one graph per row
  (grouped/contingency) or per data set, each a copy of the base restricted to its slice, with a
  shared Y group; the graph builder can place them on a layout page, `arrangeAligned` lining up
  plot areas by grid row and column (one legend, on the last graph).
- **Several views of one data set, stacked:** "Duplicate as…" copies a graph in another style
  (e.g. bars → scatter) and can put both on a new page; on any page, shift-selected graphs can be
  stacked vertically or placed side by side. Stacking equalizes plot widths (vertical) or heights
  (horizontal) so categories / scales coincide, lines up plot areas, optionally shares the Y range,
  and optionally hides the repeated inner axis labels (and a repeated title below the top graph).
  Panel letters sit just outside each graph's top-left corner when the page has room.
- **Layout editing:** `layoutPage` reports each graph's plot area on the page. Dragging snaps the
  grabbed graph's plot edges / centre (then outer edges) to other graphs' plot areas, the page
  margins and centre, or an even 6 pt gap beside a neighbour, with guide lines (Alt disables);
  resizing snaps to another graph's plot width or edges. Selection: click, Shift/Cmd-click, or
  drag a box on the page; the selection moves together and arrow keys nudge it. With two or more
  graphs selected, the view toolbar offers Align left, Align tops, Stack, Side by side and Same
  size (the shared Y range applies only to views of the same table).

### 6.4c Published-figure styles (Phase 9)

Driven by rebuilding a published paper's figures from its source data (Stucchi et al., Nature
Immunology 2026; see `packages/ui/src/paperExample.ts`).

- **Floating bars:** `SeriesStyle.box.kind` is `'box'` (quartiles, whiskers, line at the median)
  or `'floating'` (a bar from the minimum to the maximum, line at the mean or median). Both box
  graph types use it: `column.box` and the new `grouped.box` (interleaved, like `grouped.bar`).
  Presets "Box and whiskers" and "Floating bars (min to max), line at mean, with points" apply to
  column and grouped graphs.
- **Joined means on grouped graphs:** `line.show` on `grouped.scatter` / `grouped.bar` joins each
  data set's centres across rows (a time course kept as a grouped table), broken at empty cells.
  Preset "Mean ± SD, joined across rows".
- **Axis label power:** continuous axes' `labelPower` n labels ticks with value ÷ 10ⁿ (axes titled
  "(×10⁴)"); ticks, ranges and data stay in data units. The X / Y axis tab can append "(×10ⁿ)" to the
  axis title.
- **P values that round to 1** read ">0.9999" (GP), ">.999" (APA), ">0.99" (NEJM).

### 6.4d Formatting follow-ups (Phase 15)

All fields optional and sparse; older files render unchanged (no migration).

- **Right Y axis:** `axes.y2` is a continuous axis spec (the schema rejects a categorical one);
  its presence draws a right Y axis on XY and grouped graphs (other graph types ignore it). A
  data set is plotted against it when its `SeriesStyle.yAxis` (override, else the graph's series
  defaults) is `'right'` and the graph has a right axis; without one it stays on the left. A
  curve (`ExtraSeries`) follows its own `style.yAxis`, else the data set in `colorOf`. The right
  axis has its own range, ticks, scale, breaks, number format and title (`axes.y2.title`);
  `anchor` is ignored (it is always at the plot's right edge). Its automatic range comes from the
  data on it alone; the left axis' extent (and so shared `links.y` ranges) leaves those data
  out, and the right axis is never linked. The legend is unchanged and sits beyond the right
  axis. Magic copies the right axis' formats (ranges and title text by option as for the other
  axes); a target keeps its own right axis when the source has none. Scene: `axes.y2` mapping,
  nodes `axis/y2/…` with target `['axes', 'y2']`.
- **Single bars and boxes** (grouped graphs): a per-row key `r<row>` in `pointOverrides` is also
  that row's cell of the data set: `color` recolours all of the cell's marks (bar or box, error
  bar, centre, mean symbol), `hide` leaves them out (the values still count; replicate points,
  which have their own keys, stay), and `bar` / `box` (`{ fill?, border? }`) format the bar or
  box alone. The cell's marks carry `point: 'r<row>'` in the scene (outliers don't), so the
  click-again drill-down and halos work as for points; keys move with row inserts / deletes.
- **Drawing order:** `SeriesStyle.markOrder` lists kinds of mark front to back (`'center'` —
  centre line, or a grouped dot plot's mean symbol —, `'error'`, `'points'`, `'bar'` — bars and
  boxes with their whiskers and median —, `'line'`); kinds left out follow in the theme's order,
  which reproduces the earlier drawing: centre, error bars, points, bars, lines on column and
  grouped graphs; points in front of error bars on XY graphs. Data sets draw in their order on
  the graph (later ones on top). Text, line and bracket annotations take `behind: true` to be
  drawn (and hit) under the data instead of over it.
- **Centre line length:** the theme default `center.width` is 0.3 of the column (column scatter)
  and 0.45 of a data set's slot (grouped scatter), a short line over the points; nested data
  with subjects side by side keep a line across the subjects unless a width is set.

### 6.4e Chart types (roadmap 17)

All fields optional and sparse; older files render unchanged (no migration). Decisions 84–89.

- **Histograms (XY bars):** `SeriesStyle.bar.show` draws a bar from the baseline (zero, or the
  axis' bottom) to each point of an XY data set, `bar.binWidth` wide in X units (absent: the
  smallest spacing of the X values of the data sets with bars) times `bar.width` (default 1 on
  XY graphs, so bins touch). The X extent includes the bars' edges. Bars are single marks under
  `r<row>` (colour, hide, `bar` fill / border). Preset `histogram`; a new graph of a Frequency
  distribution's table starts from it.
- **Bar labels:** `SeriesStyle.label` = `{ show, stat: 'value' | 'mean' | 'median' | 'n' | 'sd'
  | 'sem', position: 'above' | 'inside', format: NumberDisplay, text: Partial<TextStyle> }`.
  'value' is the bar height / centre drawn. Column graphs label each data set, grouped graphs
  each cell, XY graphs each row; 'inside' applies to bars tall enough for the text. Labels
  above the plot widen the top margin; brackets stack above them.
- **Violins:** `box.kind: 'violin'` on `column.box` / `grouped.box`, with `SeriesStyle.violin`
  = `{ extent: 'truncated' | 'extended', smoothing (0.1–10, bandwidth multiplier),
  quartiles: boolean, quartileLine: StrokeStyle }`. Gaussian kernel density, bandwidth R's
  `bw.nrd0` × smoothing; 'extended' tails reach 3 bandwidths past the data. The centre line
  (`center.stat` median / mean / none) and quartile lines span the violin at their value. Needs
  raw data (a warning otherwise). Presets `violin`, `violinPoints`.
- **Estimation plots:** `column.estimation`; `GraphStyle.estimation = { ci: 'pooled' | 'welch',
  guides: boolean }`. The first data set shown is the control; each other data set gets a slot
  after the groups with its mean difference and CI (confidence level from the project settings)
  on the right axis, whose zero is the control mean and whose unit is the left axis'. The right
  axis is formatted through `axes.y2` (title, ticks interval, format, fonts; its range and
  breaks are ignored); a linear left axis is needed. Scene ids `estimation/<key>/diff`,
  `estimation/<key>/ci/<k>` (target: that data set), guides target the difference layer
  (`['layers', 'diff']`; v1: `['style', 'estimation']`).
- **Bubble plots:** `bubble.scatter` (multiple-variables tables); `GraphStyle.bubble = { x, y,
  size, color (data set keys), maxSize, minSize (pt), colors: [low, high] }`. A row is drawn
  when it has every variable used; area ∝ size (linear in area when a value is negative); the
  colour runs from `colors[0]` at the smallest colour value to `colors[1]` at the largest.
  Bubbles are points `r<row>` of the Y variable's data set. Magic keeps the target's variables.
  A text colour variable (roadmap 19) colours by category instead: categories in order of first
  appearance take the palette's colours, and the legend lists the categories drawn. A new
  bubble plot takes the first three numeric variables as X, Y and size, and the first text
  variable (else the fourth numeric one) as colour. Text variables are left out of every other
  graph's series (`resolveSeries`).
- **Parts of whole:** `whole.pie`, `whole.donut`, `whole.bar`; `GraphStyle.pie = { hole
  (0–0.95; donut default 0.5), startAngle (° clockwise from 12 o'clock), clockwise, labels:
  'none' | 'percent' | 'value' | 'category' | 'categoryPercent' | 'valuePercent',
  labelPosition: 'inside' | 'outside', digits }`. One pie (or bar) per data set; the legend
  lists the categories. Slice colour = palette[category position]; slice and segment fill /
  border come from `SeriesStyle.bar` (theme: solid, white 1 pt border). Single slices:
  `pointOverrides[dataSet]['r<row>']` with `color`, `bar`, `hide` (the slice is left out, its
  share stays) and `PointStyle.explode` (0–1 of the radius). Stacked bars: Y axis 0–100
  ("Percent of total"), percent labels inside segments where they fit.
- **Plot a function:** `graph.functions: FunctionCurve[]`, `FunctionCurve = { id, equation
  (built-in id | 'user'), userEquation?, params: Record<name, number>, from?, to?, points?
  (default 200; log-spaced on a log X axis), title?: RichLabel, style?: SeriesStyle }` (XY
  graphs).
  Evaluated in the layout over [from, to], else the X axis' range; values where the equation is
  undefined leave gaps; a missing parameter counts as 0 with a warning; parse errors are
  warnings. Scene ids `function/<i>/<run>`, target `['layers', 'functions', 'series', id]`
  (v1: `['functions', i, 'line']`); legend key = the function's id.

### 6.4f Point labels (roadmap 22)

Optional and sparse; decisions 117, 121–123.

- **`SeriesStyle.pointLabels`** = `{ source: 'none' | 'rowTitle' | 'x' | 'y' | 'variable' (34b, §6.1d), which: 'all' |
  'threshold' | 'rows', thresholds?: { value: 'x' | 'y', test: 'abs' | 'above' | 'below', limit
  }[] (≤ 4), combine?: 'and' | 'or' (default and), rows?: table rows, format?: NumberDisplay
  (X / Y labels), text?: Partial<TextStyle>, repel?: boolean (default on), leader?:
  Partial<StrokeStyle> (default 0.5 pt in the label's colour; width 0 = none), max? (1–1000,
  default 100), offset?: { dx, dy } (34b: each label's centre from its point) }`. Resolved as a whole object: the data set's own, else `seriesDefaults`'. On an
  extra series (`extraSeries[i].style.pointLabels`) it labels an analysis output's points.
- Text: the row title of the point's table row (nothing when it has none), or its X / Y value in
  `format`. Which: every drawn point, those passing the thresholds (`abs`: \|v\| ≥ limit; `above`:
  ≥; `below`: ≤; a condition on X fails without an X), or the chosen table rows. `max` keeps the
  most extreme: largest \|Y\| (then \|X\|) with thresholds, otherwise farthest from the plot
  centre in plot-normalised units. Hidden, excluded and off-plot points have no label.
- A point's own `PointStyle.label` wins and always shows (not counted in `max`);
  `PointStyle.labelOffset` = the label box's centre minus the point's centre (points), set by
  dragging; such a label stays there and the others avoid it.
- `pointLabels.rows` follow `table.insertRows` / `table.deleteRows` (data sets, series defaults
  and extra series), like row slices and `pointOverrides`.
- Analysis outputs may carry `GraphableDataSet.rows` / `rowTitles` (each point's table row and
  its title); their points are keyed `r<row>` under the extra series' id in `pointOverrides`
  (label, label offset). `OutputDecl.pointLabels` sets an output graph's default labels.
- Drawn on XY (scatter, lines, curve points), bubble, column and grouped graphs wherever single
  points are drawn, as a `pointLabels` layer over the data. Scene: a text node per label, id
  `pointLabel/<series>/<point>`, target `['pointLabel', series, point]`, with `point` and
  `labelOffset` (as above, so the point is at the bbox centre minus it); a leader line node
  `…/leader` with the same target when the label was moved away.

### 6.4g More graph types (roadmap 30)

All fields optional and sparse; older files render unchanged (no migration, no schema bump).
Decisions 215–226.

- **Orientation** (`GraphStyle.orientation`: 'vertical' | 'horizontal'; column and grouped
  graphs): horizontal draws the categories down the left (first at the top) and the values along
  the bottom. `axes.x` stays the category axis and `axes.y` the value axis wherever they are drawn
  (Format axes › X axis formats the category labels on the left); a grouped graph's right Y axis
  and an estimation plot's difference axis (`axes.y2`) run along the top. Brackets stand right of
  the data with level labels; a bracket's `offset` is still "up" (negative) or "down" in the
  vertical sense, so dragging right makes it more negative; `tickLabelOffset` moves labels away
  from their axis (left for X, down for Y, up for the top axis). Scene axis mappings stay
  geometric (`scene.axes.x` maps the values of a horizontal graph).
- **Stacked grouped bars** (`GraphStyle.arrangement: 'stacked'`, `grouped.bar` only; other grouped
  types draw side by side): one bar per row, the data sets' centres piled in data set order
  (positive up from 0, negative down from 0). `GraphStyle.stack = { percent?, gap? }`: segments as
  percents of the row's total (the sum of the centres' sizes) and `gap` points between segments
  (taken from both segments' inner ends). Error bars sit on each segment's end (scaled by the same
  factor in percent stacks); points and joining lines are not drawn, bar labels only inside
  segments large enough, right Y axis assignments ignored (all on the left axis). Brackets
  between cells of one row become labels over the stack.
- **Bar baselines** (`SeriesStyle.bar.baseline`): column, grouped and XY bars start at this value
  (clamped to the axis; on a log axis a value ≤ 0 is the axis' start), going up or down from it;
  the automatic Y range includes it. With a baseline, 'above' / 'below' error bars point away
  from it (a bar below the baseline gets its error bar downwards). Not used by stacked bars.
- **XY lines** (`SeriesStyle.line.gaps`): break the line at a row that has an X but no value
  (default: join across, as before). `SeriesStyle.spaghetti = { show, stroke, fade }`: a line
  through each replicate subcolumn across X (a subject followed over time), in the data set's
  colour faded towards white by `fade` (default 0.5), behind the mean line; the Y range includes
  every value. `SeriesStyle.envelope = { show, opacity }`: the error (`error.stat`) as a band along
  the line instead of error bars (broken with the line when `gaps`). `SeriesStyle.area = { show,
  opacity, baseline? }`: the area between the line and `baseline` (0 by default) filled. Areas and
  envelopes of every data set are drawn behind all data sets (layer `areas`).
- **X error bars**: XY tables whose X column has errors (`xFormat: 'numbersWithError'`) draw
  horizontal error bars (± the X error, capped) at each mean; `error.x: false` hides them
  (`GraphSeries.xErr`, derived; the X extent includes them).
- **Boxes at each X** (`SeriesStyle.box.show`, XY replicate data): a box and whiskers of each
  row's replicates at its X, 0.6 of the closest X spacing wide (4–24 pt), whiskers per
  `box.whiskers`; the legend shows a box swatch.
- **Geometric error bars**: `center.stat: 'geomean'` (column and grouped graphs) and error bars
  `geoSD` (geometric mean ×/÷ the geometric SD factor) and `geoCI` (the CI of the geometric
  mean), drawn around the geometric mean whatever the centre; XY graphs plot the geometric mean
  when either is chosen. Undefined (not drawn) unless every value is positive.
  `PlotStats.gmean / gsdf / gciLo / gciHi` (derived).
- **Whiskers**: also the 1st–99th and 2.5th–97.5th percentiles (`p1p99`, `p025p975`; type 6
  quantiles as the quartiles).
- **Grand mean** (`GraphStyle.grandMean = { show, line }`, column graphs): a line across the plot
  (dashed grey by default) at the mean of every value shown (entered means weighted by N);
  included in the Y range; target `['layers', 'grandMean']` (v1: `['style', 'grandMean']`).
- **Heat maps** (`heatmap.cells`; grouped tables: rows × data sets, the mean of each cell;
  multiple-variables tables: rows × the numeric variables shown). `axes.x` and `axes.y` are both
  categorical (data sets along the bottom, rows down the left, no ticks by default); no axis
  lines unless `style.frame` is set; no legend. `GraphStyle.heatmap = { colors, reverse, min, max,
  midpoint, missing, standardize, clusterRows, clusterColumns, distance, linkage, dendrogram,
  labels: { show, format, text }, colorBar: { show, position, title }, border }`:
  - `colors`: viridis (default), magma, inferno, plasma, cividis, greys, blues, greens, reds,
    purples (sequential) or blueRed, purpleGreen, brownTeal (diverging); `reverse`;
  - `min` / `max`: fixed ends of the scale (values beyond take the end colours), else the data's;
    diverging maps are centred on `midpoint` (absent: 0 when the range spans it, else the range's
    middle) and symmetric about it;
  - `missing`: colour of cells without a value (default #e0e0e0); `border`: lines between cells;
  - `standardize`: 'row' / 'column' shows z-scores ((value − mean) / SD over the row's or
    column's values; NaN, drawn as missing, when the SD is 0);
  - `clusterRows` / `clusterColumns`: rows / columns ordered by hierarchical clustering of the
    values shown (`stats` `rowDistances` + `hclust`, R's `dist` / `1 − cor` and `hclust` merge
    order, heights and order; `ward` = R's "ward.D2"), with `distance` ('euclidean', 'pearson')
    and `linkage` ('complete', 'average', 'ward'); the rows' dendrogram stands right of the map,
    the columns' above it, `dendrogram` points deep (default 36); at most 2,000 rows or columns
    are clustered, and a matrix with an undefined distance is left in table order (warnings);
  - `labels`: values in the cells (in `format`, black or white by the cell's luminance), where
    they fit;
  - `colorBar`: the colour scale (shown by default) right of the map (upright, high at the top)
    or below it, drawn as 64 bands with ticks at round values and a title ("z-score" when
    standardized).
  Cells are scene nodes `series/<key>/cell/<row>`, dendrograms `dendrogram/rows|columns/<k>`, the
  scale `colorScale/…`, all targeting `['style', 'heatmap']` (the heat map layer's place).

### 6.5 Scene graph (derived)

```ts
interface SceneNode {
  id: string            // semantic ID: 'series/<key>/point/12', 'axis/y/tickLabel/3', 'annotation/<id>'
  target: StylePath     // which spec path to edit when selected, e.g. ['seriesOverrides', key, 'points']
  prim: Path | Rect | Circle | Text | Group | Points   // Points: a cloud of symbols (§6.1g)
  bbox: Box             // for hit testing / selection handles
  point?: PointKey      // a single plotted point (and its label)
  labelOffset?: { dx, dy } // point labels: label centre − point centre (§6.4f)
  layer?: LayerId       // the graph layer that drew the mark (roadmap 33a; not exported)
  cloud?: { node, index } // a point of a point cloud, made for hovering it (roadmap 34e)
  legendEntry?: { key, group } // a legend entry's node (roadmap 47b, §6.1n)
}
// Scene.legend?: LegendItem[] — every legend entry in its order, hidden ones too (roadmap 47b)
```

A second layer drawing a part another layer already drew for a data set adds `@<layer id>` to
the part (`series/a/point@each/0/1`); compiled v1 graphs keep every id. Targets name layers
(roadmap 33c, decision 250): a layer's marks of a data set `['layers', id, 'series', key]`, a
layer without data sets (grand mean, a heat map's cells, before-after lines, a difference axis)
`['layers', id]`, a single point `['pointOverrides', key, point]`, a legend entry the data set's
identity `['seriesOverrides', key]` (what the entry formats; roadmap 47b selects an entry by its
own key, `['legend', 'entries', key]`, from its node's `legendEntry`). `layoutGraph` assigns them after the engine's layout
(`layerTargets`; the engine itself draws with v1's targets). On the canvas
(decision 243) a click selects the clicked layer's marks of the data set, a second click on one
of them the point, Alt-click the whole layer, Escape steps back; a double-click opens Format
graph › Appearance on that layer and data set.

Clicking a scene node → `target` → the Format dialog and tab for that path →
edit command that writes an override.

**Hover cards** (roadmap 34d): `markInfo(project, graph, node)` reads a mark's layer and data set
from its target and its row from its `point`: a single value (a stat `identity` mark, a label, a
tile) gives its whole table row — every variable of a multiple-variables table (calculated ones
computed), else the row's title, X, the value and its replicate — and `goTo` (the table, the
row, and for other tables the value's data set and replicate); a summary (bars, centre lines,
error bars, boxes, violins; a cell's on grouped and XY graphs) gives what the graph draws by the
layer's stat (the centre, the error of the graph's error bars, n; quartiles and whiskers; minimum
and maximum), and counts of two text variables the count or percent. Nothing is stored.

---

## 7. Other nodes

```ts
interface InfoNode {
  kind: 'info'; id: NodeId; name: string
  fields: { label: string; value: string }[]     // label/value pairs; numbers are formula constants
  notes: string                                   // plain text (what search and export read)
  notesRich?: RichText                            // roadmap 40: the notes formatted, spelling `notes`
}
```

**Info sheets** (roadmap 40, decisions 594–597): the navigator's Info section (after Data Tables),
Insert › Info sheet ▸ Blank / Experiment / Assay / Animal study (`INFO_TEMPLATES`: e.g. Date,
Investigator, Notebook ref, Protocol, Cell line / strain, Reagent lot), an editor of label/value
fields (add, remove, move up, add a template's fields) and rich-text notes (roadmap 28's editor;
`notesRich` kept only when formatted). Commands: `info.setField` (one field's label and/or value;
a new label renames formulas' references to it), `info.setFields` (the list: added, removed,
reordered), `info.setNotes`. An info sheet exports as CSV, TSV or Excel (Field, Value, then its
notes by line) and joins File › Export ▸ All data and results; it can be duplicated, searched,
merged and filed in folders like any sheet.

**Info constants in formulas.** `[Info: dilution]` is the field labelled "dilution" of the first
info sheet (navigator order) that has one; `[Sheet name: dilution]` that sheet's. Labels and sheet
names match as variables do (case and runs of spaces ignored); a variable whose title is the whole
bracketed name wins (a variable "[Time: h]" stays the variable). Numbers only (`numberFromText`:
"1.5", "1,5", "1e3"); an empty or non-numeric field, a missing field, or `Info:` with no sheet
holding the label is the formula's error ("no info sheet has a field “dilution”"); a prefix naming
no info sheet stays an unknown variable. The values are the project's, never stored with the table:
`infoConstants(project)` (one object per content of the info sheets, so it is stable) is bound to a
table by `withConstants(table, constants)` — the table itself when no formula holds a colon, else a
memoized shallow copy that `tableFormulas` evaluates with them (`constantsOf`). `sourceTable`
(graphs, the builder, exports), the engine's job preparation (`resolveSource`), the grid and its
formula bar, and Convert to values all read bound tables (Convert to values and Change variable type
with the same memoized `infoConstants`, made from the sheets as the command sees them, and the
formulas evaluated once per variable converted: audit 2, decision 762), so the constants are live: a new value
changes the normalized data, so the hashes, so the analyses rerun; tables naming none are untouched
(results, hashes and `ANALYSES_VERSION` unchanged). Renames follow: renaming a field rewrites
`[Info: old]` where that field is the one it names and `[Sheet: old]`; renaming a sheet rewrites
`[Old sheet: …]` (`renameInfoInFormula`). The formula bar's ƒx reference lists the constants
(`constantList`).

```ts

// Phase 5: a page arranging live graphs and free text.
interface LayoutNode {
  kind: 'layout'; id: NodeId; name: string
  page: { width: Pt; height: Pt }                 // PAGE_SIZES: letter, a4 (portrait; swap for landscape)
  items: LayoutItem[]                             // drawing order; graph items lettered in this order
  panelLabels: { show: boolean; style: 'A' | 'a' | '(A)' | '(a)'; size: Pt }
  notes?: string                                  // free text above the page, never drawn (roadmap 31)
  grids?: { set: string; columns: int; x: Pt; y: Pt; dx: Pt; dy: Pt }[]  // split sets' grids (§6.1f)
}
// Every item may also carry `locked?: true` and `group?: GroupId` (roadmap 32).
type LayoutItem =
  | { type: 'graph'; id: LayoutItemId; graph: NodeId; x: Pt; y: Pt; scale: number }  // top-left corner
  | { type: 'text'; id: LayoutItemId; x: Pt; y: Pt; content: TextSpec   // the text's top-left
      width?: Pt                                   // wrap lines at word boundaries to this width
      border?: StrokeStyle; background?: FillStyle; padding?: Pt }   // a box round it (pad 4 pt)
  | { type: 'line'; id; from: { x; y }; to: { x; y }; stroke: StrokeStyle; heads?: LineEnds }
  | { type: 'shape'; id; shape: 'rect' | 'ellipse'; x; y; w: Pt; h: Pt; radius?: Pt
      stroke?: StrokeStyle; fill?: FillStyle }     // absent: none
  | { type: 'image'; id; asset: AssetId; x; y; w: Pt; h: Pt
      crop?: { x; y; w; h }                        // the part shown, fractions of the picture (0–1)
      freeAspect?: boolean; border?: StrokeStyle }
  | { type: 'table'; id; x; y
      source: { kind: 'table'; node: NodeId }      // a data table, or an analysis' result table
            | { kind: 'results'; node: NodeId; sheet: string }   // a results sheet by key
      rows?: { from: int; to?: int }; columns?: { from: int; to?: int }   // 0-based, inclusive
      text?: Partial<TextStyle>                    // default: the theme's text at 9 pt
      grid?: 'all' | 'rows' | 'none'; gridStroke?: StrokeStyle; headerBold?: boolean }

interface LineEnds { start?: ArrowHead; end?: ArrowHead }
interface ArrowHead { shape: 'triangle' | 'open' | 'bar' | 'circle'; size?: number }  // × arrowSize(width)
```

`layoutPage()` (graph package) lays out every graph with the graph engine and places it with a
scene-node `transform` (translate + scale), so pages stay live and export through the same SVG
pipeline (PDF, SVG, PNG, TIFF, JPEG and printing). Removing a graph removes it from layouts; the layouts stay.

**Page objects (roadmap 32).** `layoutPage` also draws text boxes (wrapped by `wrapText`, lines
aligned within `width`; an item without `width`, border or background lays out exactly as before),
lines with their heads (`lineWithHeads`, shared with graph line annotations), rectangles (rounded
by `radius`, clamped) and ellipses, images and live tables, and reports each item's box
(`PageScene.items`: bounds for hit tests, handles and snapping; lines reach round their heads).
Two more context entries feed it, as `result` feeds graphs: `asset(id)` (the image's bytes, from
the asset store; missing → a dashed "Missing image" box and a warning) and `table(source)` (the
cells: `io`'s `pageTableGrid` from the table as the grid shows it or the results sheet as
displayed; an error → a box saying why). Leading rows of titles and column titles are a table's
header, always shown; `rows` counts the rows after them. Removing a table or analysis removes the
page tables that show it (`node.remove`), as it removes graph items. A group is the items sharing
a `group` id, kept adjacent in `items`; locked items are left out of picking on the page.

**Line annotations on graphs** keep `arrow: 'none' | 'end' | 'both'` and add `heads?: LineEnds`
only when `arrow` can't say it (`annotationEnds`); `lineEndsOf` reads either (older files: filled
triangles as `arrow` says).

**Assets.** Image bytes are not in the document. An image item names an asset by `AssetId`: the
first 128 bits of the SHA-256 of its bytes, in hex (so identical images are stored once). The
bytes, their format (PNG or JPEG) and pixel size (read from the header) are an `ImageAsset` in the
engine's `AssetStore`, beside the document like results: it only grows while a project is open
(undo and redo can always bring an image back), is replaced when another project is opened, and a
file gets only the assets the document refers to (`assetRefs`). Scene `image` primitives hold the
`ImageAsset`; SVG exports embed it as a data URL (a nested `<svg>` whose viewBox is the crop), the
canvas as an object URL, the PDF writer as an image XObject (JPEG as is; PNG decoded to RGB with
its alpha as a soft mask).

**Match format ("Magic").** `matchGraphFormat(project, target, source, options)` copies styles,
text, legend and axis formats; by option also size, graph type (if the target's table offers it),
per-data-set formats by position, axis ranges/ticks/scales, and axis title text. Data, wording of
titles and annotations stay the target's; so do its legend entries' order, labels and hidden
entries. With the graph type, a copied Significance layer brings the source's cut-offs
(`cutoffs`, audit 3, G3). Format graph › Graph settings applies it one way (this graph ←
another) or the other (every other graph ← this one) as one undoable step.

---

## 8. Engine: commands, undo, recompute

### 8.1 Commands

Commands are **serializable data** (`Command`, `engine/src/commands.ts`), applied by one pure
reducer (`applyCommand`), under Immer's `produceWithPatches` except for the fast paths below (cell
edits, single row inserts and deletes). Anything random (new ids) is made by the caller and
carried in the command, so replaying a log reproduces the document. Every command type
(`COMMAND_TYPES`, `engine/src/store.ts`, with its default undo label) is listed here, which a test
checks (`engine/test/dataModelDoc.test.ts`):

```ts
type Command =
  // The project and its sheets
  | { type: 'project.setSettings'; settings: Partial<ProjectSettings>; clear?: 'style'[] }  // clear: drop the style
  | { type: 'node.add'; node: DocNode; at?: number; fresh?: boolean; folder?: FolderId | null }
  | { type: 'node.remove'; id: NodeId }                                 // and what depends on it (`removalSet`)
  | { type: 'node.rename'; id: NodeId; name: string }
  | { type: 'node.move'; id: NodeId; to: number }                       // roadmap 40: reorder
  | { type: 'node.replace'; node: DocNode }                             // same id and kind
  | { type: 'node.set'; id: NodeId; path: (string | number | { id: string })[]; value: unknown }  // undefined removes
  // Folders (roadmap 40)
  | { type: 'folder.add'; folder: { id: FolderId; name: string; parent?: FolderId }; at?: number; members?: NodeId[] }
  | { type: 'folder.rename'; id: FolderId; name: string }
  | { type: 'folder.remove'; id: FolderId }        // its sheets to the folder it was in (or none); its folders to the top
  | { type: 'folder.move'; id: FolderId; parent: FolderId | null; at?: number }
  | { type: 'folder.file'; ids: NodeId[]; folder: FolderId | null }
  // Info sheets (roadmap 40, §7)
  | { type: 'info.setField'; id: NodeId; index: number; label?: string; value?: string }
  | { type: 'info.setFields'; id: NodeId; fields: { label: string; value: string }[] }
  | { type: 'info.setNotes'; id: NodeId; notes: string; rich?: RichText }
  // Data tables
  | { type: 'table.setCells'; table: NodeId; edits: { col: ColumnId | 'x'; sub: number; row: number; value: number | null }[] }
  | { type: 'table.setText'; table: NodeId; edits: { col: ColumnId; row: number; value: string | null }[] }
  | { type: 'table.setVariableType'; table: NodeId; ids: ColumnId[]; to: 'number' | 'text' }
  | { type: 'table.setFormula'; table: NodeId; id: ColumnId; formula: string | null }
  | { type: 'table.setExcluded'; table: NodeId; cells: CellAddr[]; excluded: boolean }   // CellAddr: { col, sub, row }
  | { type: 'table.setLimits'; table: NodeId; rule: LimitRule | null }   // roadmap 39 (§3.3a)
  | { type: 'table.insertRows'; table: NodeId; at: number; count: number }
  | { type: 'table.deleteRows'; table: NodeId; rows: number[] }
  | { type: 'table.setRowTitle'; table: NodeId; row: number; title: string | null; rich?: RichText }
  | { type: 'table.showRowTitles'; table: NodeId; show: boolean }
  | { type: 'table.setCellsTable'; table: NodeId; on: boolean | null }   // roadmap 34f; null: automatic (§6.1h)
  | { type: 'table.addDataSet'; table: NodeId; id: ColumnId; at?: number; title?: string }
  | { type: 'table.removeDataSets'; table: NodeId; ids: ColumnId[] }
  | { type: 'table.swapXY'; table: NodeId; dataSet: ColumnId; id: ColumnId }   // roadmap 38
  | { type: 'table.renameDataSet'; table: NodeId; id: ColumnId; title: string; rich?: RichText }
  | { type: 'table.renameX'; table: NodeId; title: string; rich?: RichText }
  | { type: 'table.moveDataSets'; table: NodeId; ids: ColumnId[]; to: number }
  | { type: 'table.permuteRows'; table: NodeId; order: number[] }
  | { type: 'table.setDisplay'; table: NodeId; cols: (ColumnId | 'x')[]; display: NumberDisplay | null }
  | { type: 'table.setColumnWidths'; table: NodeId; widths: Record<string, number | null> }
  | { type: 'table.setSubcolumnTitle'; table: NodeId; id: ColumnId; sub: number; title: string | null; rich?: RichText }
  | { type: 'table.setReplicateCount'; table: NodeId; count: number }
  | { type: 'table.setYFormat'; table: NodeId; format: YFormat }       // converts the values (§3.2)
  // Analyses (made with node.add, re-pointed with node.replace)
  | { type: 'analysis.setParams'; id: NodeId; params: unknown }
  | { type: 'analysis.setInput'; id: NodeId; dataSets: DataSetKey[] }
  // Graph layers (roadmap 33b)
  | { type: 'graph.addLayer'; id: NodeId; layer: Layer; at?: number }
  | { type: 'graph.removeLayer'; id: NodeId; layer: LayerId }
  | { type: 'graph.moveLayer'; id: NodeId; layer: LayerId; to: number }
  | { type: 'graph.setLayers'; id: NodeId; layers: Layer[]; frame?: Frame; look?: GraphLook; preset?: string }

interface HistoryEntry {
  label: string
  commands?: Command[]          // kept by a DraftStore only (it replays them)
  patches: DocPatch[]; inverse: DocPatch[]   // Immer's, or rows of a large array (RowsPatch)
  cells: number                 // about how many values the patches hold (the history's bound)
}
```

- Multiple-variables tables (roadmap 19): `table.setText` writes text cells of text variables
  (rows past the end grow the table). `table.setVariableType` converts: numbers → their text;
  text → the number it reads as (`numberFromText`), other text cleared; a calculated variable →
  its current values (as numbers or text). `table.setFormula` makes a variable calculated (its
  numbers and text cleared; a formula that doesn't parse is refused, unknown names are kept
  and shown as the column's error) or, with null, freezes the values it gives ("Convert to
  values"). Values written from formulas keep 15 significant digits (`tidyNumber`).
  `table.setCells` refuses numbers in text and calculated variables. `table.renameDataSet`
  rewrites references to the old title in other variables' formulas (`renameInFormula`).
  Roadmap 38: converting a calculated text variable to values leaves a text variable.
- Swap X and Y (roadmap 38, decision 553): `table.swapXY` makes an XY table's data set
  `dataSet` its X column (values, exclusions, title, rich title, number display, grid width)
  and the old X a data set with the caller's new id `id`, in the data set's place; X's format
  becomes plain numbers. Refused (`swapXYProblem`, a reason the dialog shows) for tables with
  replicates or summary data and X with error values. Everything that named the data set names
  the new one (audit 2, decision 671: `remapNode` with keys `{dataSet → id}`): analyses of the
  table and of the result tables computed from it (input data sets, pools, parameters naming the
  key), graphs of any of them and graphs drawing their outputs or results (series, identities,
  layers, aesthetics, mapping, levels, filters, split sets, bracket ends, groups and comparison
  keys, output keys such as `line:<id>`, result keys such as `slope:<id>`), so a graph of it draws
  the same pairs with X and Y swapped; graphs keep their axes' formats. One command, one undo
  step.
- Deleting columns (`table.removeDataSets`; audit 2, decision 671): the same walk drops the
  deleted data sets wherever they are named (decision 241): from lists and records (series,
  identities, layer series, aesthetics, levels, legend, analysis inputs, pools of which two
  members are left, parameter lists and records), a mapping without its X or Y goes (the graph
  shows the table's variables), a filter or split set by one goes, a bracket naming one goes, an
  output of one goes with its series. A single parameter field naming one keeps it (the analysis
  reports it missing), and a result field reading a comparison of one reads "—" (as any value gone
  from results). Undo is exact. A graph of a
  multiple-variables table's variables swaps with Format › Swap X and Y (`swapMappedXY`): its
  mapping's (or its layers' `aes`) X and Y, the axes' formats and shared-axis groups; a number
  by a text variable turns (orientation), as Format graph's Orientation does.
- Titles (roadmap 28): `table.renameDataSet`, `table.renameX`, `table.setRowTitle` and
  `table.setSubcolumnTitle` take the plain `title` and optional `rich` runs; the rich form is
  kept only when formatted and spelling `title` (merged), and removed otherwise, so a plain
  rename (paste, import, formula follow-ups) clears it. Row inserts and deletes splice
  `rowTitlesRich`; hiding row titles drops it; fewer subcolumns trim `subcolumnTitlesRich`.
- Reordering (roadmap 29): `table.permuteRows` puts row `order[i]` at row `i` in every per-row
  array (values, exclusions, text, row titles and their rich forms) for the first `order.length`
  rows (a permutation of them; later rows stay). Sort, Move rows and dragging row numbers are all
  this one command. `table.moveDataSets` moves a block of data sets to an index among the others
  (X and row titles have fixed places; the one-data-set `table.moveDataSet`, never dispatched, went
  in audit 2, decision 764).
- Everything that names table rows by index follows row inserts, deletes and permutations
  (`remapRows`): graph row slices (`seriesSource.rows`, which keep showing the same rows in the
  same order), `pointLabels.rows`, `pointOverrides` keys, bracket `rowA` / `rowB` and the row
  indices inside comparison keys, and analysis parameters declared in `ROW_PARAMS`
  (`model/rowParams.ts`): contingency `pairwiseControl` (a row index as text; a deleted control
  row falls back to '0') and goodness-of-fit `expected` (a value per row, which moves with its
  row; inserted rows hold null, read as "not entered"). Only analyses whose input is the table
  itself are remapped; analyses and graphs of a result table computed from it are not (their rows
  are the result's). `analyses/test/rowParams.test.ts` checks that every parameter edited by a
  row editor (`row.pick`, `gof.expected`) is declared. Result layers (roadmap 35) reading a
  comparison key of an analysis of the table follow its rows too, on any graph (audit 2,
  decision 672: `mapGraphRefs`' `resultKey` gets the layer's analysis); a field reading a deleted
  row's comparison goes (it reads "—"). Reuse maps their rows as it maps brackets'.
- Reuse (roadmap 31, decisions 200–203): copies and re-pointed nodes are made by
  `remapNode(node, remap)` (`engine/src/remap.ts`) and added with `node.add` (or `node.replace`
  when an analysis changes table), one undo step per operation. `Remap` holds node ids to replace,
  a map of data set keys (source table's → target's, null = no match) and the rows the target has.
  Keys are replaced in inputs, series lists and overrides, point formats, extra series (and their
  `colorOf`), bracket ends, the legend and bubble variables, and inside output and comparison keys
  (runs of `[0-9a-z]`, plus the row indices of `row…` / `col…` / `cell…` keys); parameters by
  exact string values and record keys; rows (slices, labelled rows, point keys, bracket rows,
  `ROW_PARAMS`) only for nodes reading the table itself. What has no match is left out and
  reported per sheet. Duplicate family maps node ids only (data set ids are scoped to their
  table, so the copy keeps them) and gives shared-axis groups new ids. `dataSetMap(from, to,
  match)` pairs data sets by position or by title (trimmed, ignoring case, repeats in order).
- Graph layers (roadmap 33b, decision 240): a `node.set` path may name an array element by
  its id (`['layers', { id: 'bars' }, 'style', 'fill']`), so paths stay right when layers move
  (draft replays included); setting under an id the list doesn't have is refused, removing under
  it is nothing. `graph.addLayer` inserts a layer (its id unique and well formed),
  `graph.removeLayer` removes it with the layers attached to it (`on`) or drawing its data
  (`data.layer`) and drops them from every data set's `order`, `graph.moveLayer` moves it to place
  `to` of the list (0: the back; the UI's front-first rows are translated, §6.1a), `graph.setLayers` replaces the list (and frame, look, preset when given; orders keep only
  layers still there). Each is one undo step ("Add layer", "Delete layer", "Move layer", "Change
  layers"; audit 3, A10: Delete is the one verb for taking layers off a graph).
- **Layer paths only** (roadmap 33c). The formatting panels, the scene's targets, the builder and
  the canvas write layer paths (`['layers', { id }, 'series', key, 'style', …]`) and identity
  paths (`['seriesOverrides', key, 'color' | 'yAxis' | 'pointLabels' | 'order']`); 33b's v1 paths
  and their translation in the store are gone. `editCommands(id, graphEdits(before, after))`
  (`engine/src/graphEdits.ts`, `model/src/graphEdits.ts`) turns a changed graph into commands:
  `node.set` per changed path, `graph.setLayers` when layers come or go. Layer commands from the
  UI: Format › Layers ▸ Change layers… (the builder over the graph; OK is one "Change layers"
  step), Add… (Format graph › Appearance › Layers), Move forward / Move backward ("Bring layer
  forward" / "Send layer backward"), Hide / Show ("Hide layer" / "Show layer"), Delete ("Delete
  layer"), each one step; the same from a mark's context menu, which also adds error bars or
  labels on its layer. Inside a Format dialog they are draft edits, one "Format graph" step on
  OK.
- **References** (decision 241): every walker of a graph's references — node references and
  removal, reuse remapping, families, methods, row edits, data export — goes through
  `graphRefs` / `mapGraphRefs` (`model/src/graphRefs.ts`): the source, outputs (with their
  `colorOf`), series keys in identities, layers, point formats, aesthetics and the legend,
  brackets, and rows (slices, labelled rows, point keys). Dropping an output drops its id
  everywhere and an outputs layer left empty with the layers drawing its data. A test walks the
  schema to check it visits every node and series reference.
- **Organising** (roadmap 40). Sheets move with `node.move` (several at once: `moveSheetCommands`
  — before or after a sheet, relative order kept; Move up / down: `stepSheetCommands` among the
  sheets shown beside it), one undo step per drag or key press ("Move sheet", "Move up", "Move
  down"); folders with the `folder.*` commands ("New folder", "Move to folder", "Delete
  folder"…). The Family view is derived (`familyTree`, `engine/src/organise.ts`): info sheets,
  then each data table with its analyses — chained through result tables and derived tables
  (roadmap 38) — and the graphs of the table and of the results (split sets, 34d, grouped as their
  set), then layouts with the graphs they place as links; every node at home once.
- **Search** (roadmap 40, `searchProject`, `engine/src/search.ts`): sheet names, notes, info
  fields' labels and values, column, X and variable titles, graph titles, axis titles, text items
  on pages and analyses' plugin titles; never cell values (nor row titles), so it costs the same
  whatever the tables' sizes (a CPU-growth guard, 100k vs 1M rows). Case and accents are ignored;
  a query of several words also matches a text holding them all. Each match scores exact (100),
  prefix (80), word start (60), anywhere (40) or all the words (30), weighted by where it is
  (names 1.5, titles 1.2, notes 1); sheets are ranked by their best match (plus a little per
  other match), then navigator order, and each match carries a snippet and where to jump (a
  column, an info field…).
- **Import from project** (roadmap 40, `mergeSelection` / `mergePlan`, `engine/src/merge.ts`): the
  picked sheets of another project, the families of picked tables (with "families", default on),
  the graphs picked pages place, and everything any of them reads (`nodeDependencies` closed
  upward, and the info sheets a table's formulas read: `infoReads`, audit 2, decision 673), added
  with new ids through `remapNode` (so `mapGraphRefs` for graphs; shared-axis
  groups and split sets get new link ids); a name taken by a sheet of the same kind gets " (2)"
  (formulas naming a renamed info sheet follow); graphs keep the other project's style as their
  own where the projects' styles differ (a graph of a project in the app's own look takes this
  project's); images placed on imported pages go into the asset store first; the other
  project's folders holding imported sheets are recreated. An imported table's `[Info: x]` read
  from an imported sheet where this project also holds a field `x` (its sheets come first) names
  the imported sheet (`[Experiment (2): x]`), reported in the import's message
  (`MergePlan.warnings`). One undo step.
- Serializable commands can be logged, tested as data, replayed as macros, and later synced.
- `store.dispatch([...commands], label)` applies several commands as one undo step (e.g. an
  analysis made with its graph: two `node.add`s). Without a label the step takes the first
  command's (`LABELS`).
- Modal editors (the Format dialogs) work on a `DraftStore`: a scratch store over the current
  document that applies and validates commands like the real one without notifying it.
  `draft.commit(label)` replays the commands still in effect as one undo step on the document
  (nothing if they cancel out); dropping the draft is Cancel.
- **Validation.** A dispatch applies its commands (and the split-set follow-ups they cause, §6.1f)
  to make the next document, then checks it before committing it; a problem throws
  `CommandError` and leaves the document, and the history, as they were (reducers also refuse
  what they can't apply: a missing node, an unknown setting, a bad id). The check covers the
  nodes the patches touch, the settings when they changed (strictly: no unknown keys), and,
  unless the batch only edits cells (`table.setCells`, `table.setText`, `table.setExcluded`,
  with no follow-ups: their reducers check every value they write, so only the table's shape is
  checked, `tableIssues`), the whole project's references (`projectIssues`: ids match their keys, the
  navigator order, references to existing nodes of the right kind, layers, folders, no cycles).
  Every other node touched is checked as stored (`storedNodeIssues`; audit 2, decision 677):
  the schema's issues, fields the schema would fill with a default (files are read with their
  defaults filled, so code reads every field: `node.set … undefined` on `LayoutNode.panelLabels`
  is refused), and analysis parameters that are not plain JSON (NaN, infinities, undefined,
  class instances). Per-row arrays the node held before the change, and those a row insert or
  delete made from them, are not checked element by element again where they stand as the same
  kind of array (`storedNodeIssues(node, known)`, `rowArraysOf`, `withKnownRowArrays`; audit 2,
  decision 760): the store's state is valid (a parsed file, a new project, or checked changes) and
  nothing writes those arrays in place, so a rename or a column width of a table of a million
  rows checks none of its cells (280 ms before), while an array moved to another kind's place, or
  any new one, is checked. Commands storing a caller's value (`node.add`, `node.replace`,
  `analysis.setParams`, `analysis.setInput`, `node.set`, layer commands, info fields and notes,
  project settings)
  store a copy (nodes `copyDoc`, sharing per-row arrays of `BIG_ARRAY` or more, as nothing writes
  them in place; other values `copyData`, a full copy), so later
  commands of a batch never write into the caller's object (decision 674).
- **Undo history** (audit 2, decision 670): at most 200 steps (`HISTORY_STEPS`), and the oldest
  steps go while the steps' patches hold more than 1.5e8 values (`HISTORY_CELLS`, about 1.2 GB of
  numbers; `patchCells` counts array elements, a large array by its length; the newest step always
  stays). Row inserts and deletes of large tables count little (below). A `DraftStore` keeps every
  step with its commands; the document's store keeps no commands.

- **Large tables** (roadmap 34e, decision 401). The store's Immer doesn't freeze (`docImmer`);
  `freezeDoc` freezes each new part of the document, arrays of `BIG_ARRAY` (10,000) elements or
  more left out (V8 boxes a frozen array's numbers). Cell edits (`table.setCells`,
  `table.setText` within the rows) skip Immer (`cellEditPatches`): the ordinary reducers run on
  copies of the touched columns and the objects above them, and the patches are made from the
  edited cells alone — Immer's, compared for equality in a test — or, for most of a column (a fill
  down), one patch of the whole column. Undo and redo apply patches copying only along their paths
  (`applyDocPatches`; Immer's `applyPatches` deep-copied every value it inserted). Row inserts and
  deletes build each per-row array anew (one patch each); in the history (audit 2, decision 670)
  an array of `BIG_ARRAY` or more replaced by itself with elements taken out or put in is held as
  the rows that changed, both ways (`compactRowPatches`: `{ op: 'removeRows' | 'insertRows', path,
  runs, values? | fill? }`), not as the arrays before and after (four one-row deletes of a table of
  a million rows and 32 columns held 1.1 GB; now next to nothing). A cell edit of a table of a million
  rows costs the same whatever its other columns (a CPU-growth guard). A single `table.insertRows`
  or `table.deleteRows` skips Immer too (`rowEditPatches`, audit 2, decision 760): the reducer
  runs on shallow copies of the table down to its subcolumns and of every graph and analysis (it
  replaces their row-naming fields whole), the patches are what differs from the document (fields
  replaced, added or removed; a large per-row array as its rows, the command's runs, without
  comparing the arrays), and nodes left alone stay shared. The same document as under Immer
  (compared in a test); a delete of three rows of a table of a million rows and 32 columns took
  1.9 s and takes about 0.15 s, an insert 1.8 s and about 0.25 s. Other row commands (a paste
  growing the table, a sort) and batches go through Immer and `compactRowPatches`.

### 8.2 Separate stores

| Store | Contents | Undoable | Saved |
|---|---|---|---|
| Document | `Project` | yes | yes |
| Results | `AnalysisResult` per analysis + status | no | as a cache (§9) |
| View | the open sheet, selection, zoom, scroll, open dialog | no | the open sheet only (`view.json`: `{ selected }`) |
| Assets | images placed on pages (`AssetStore`, §7) | no (kept while open, so undo can restore an image) | the referenced ones (`assets/`) |

### 8.3 Recompute

No explicit dirty flags. After every committed change:

1. Rebuild the dependency graph from node references (tiny; nodes are few).
2. For each analysis in topological order compute (`prepareJob`, `engine/src/compute.ts`)
   `inputKey = hash(analysisId, the plugin's current version, engineVersion, params after migration
   and parsing, run context, input modifiers (§5.1), normalized referenced data sets)`, where
   `engineVersion` is the registry's: `ANALYSES_VERSION` (`analyses/src/index.ts`).
   Only the *referenced* columns are hashed, so editing column C never reruns a t-test on A vs B.
   Data set hashes are memoized per normalized data set (WeakMap), itself cached per column.
3. If `inputKey` hits the results cache → done. Otherwise enqueue a worker job.
4. Downstream analyses wait for upstream results (their input key includes the hash of the
   upstream result table's normalized content; see "Chaining" in §5.1).
5. Stale job results (key no longer current) are discarded. While recomputing, the UI keeps showing
   the previous result, marked as updating, to avoid flicker.
6. Long jobs (curve fitting, Phase 2+) get cancellation by terminating and respawning the worker.

Graph layout runs on the main thread, memoized on (graph node, resolved series data, referenced
results, theme).

---

## 9. Project file

A zip container, `.psproj` (`PROJECT_EXTENSION`; a template is `.pstemplate`, §9.2; both
placeholders until the product is named), written by `writeProjectFile` and read by
`readProjectFile` (`io/src/projectFile.ts`):

```
manifest.json      { format, template?, schemaVersion, appVersion, meta, settings, order, folders? }
tables/<id>.json
tables/<id>/<n>.col  a large table's per-row arrays (below)
analyses/<id>.json
graphs/<id>.json
layouts/<id>.json
info/<id>.json
results/<id>.json  cache: { inputKey, result }
view.json          { selected }: the sheet open when saved
assets/<id>.png    images placed on layout pages (roadmap 32), stored (not deflated)
assets/<id>.jpg
```

`format` is `'plotting-software-project'` (`PROJECT_FORMAT`; anything else is "Not a project
file"); `template: true` marks a template; `appVersion` (also in `meta`) is the version that
saved it. No engine version is written: it is part of each result's `inputKey` (§8.3), so a
result cached by another version of the analyses simply misses and is recomputed. Entries carry
the save's time, so a save is reproducible.

- **Large tables (roadmap 34e).** A table of more than 100,000 cells (`BINARY_TABLE_CELLS`: rows
  × per-row arrays, every one counted: values, exclusions, limit flags, text variables, row titles
  and their formatting) keeps all its per-row arrays in binary entries beside its JSON
  (`tables/<id>/<n>.col`, deflated at level 1: number mantissas barely compress), the JSON naming
  each with `{"$col": "<n>"}` (`packTable` / `unpackTable`, `io/src/columns.ts`). Smaller tables
  stay JSON, so ordinary projects still open in older versions. All numbers little-endian:

  ```
  header   "PSC1" · kind (u8: 1 numbers, 2 flags, 3 text, 4 limits, 5 rich) · 3 zero bytes ·
           n (u32, the table's rowCount)                                       12 bytes
  numbers  null bitmap (⌈n/8⌉ bytes; bit i, least significant first: row i empty) · zero
           padding to a multiple of 8 bytes · n × float64 (empty: 0)          values
  flags    bitmap (bit i = true)                                               exclusions
  text     m (u32) · m × (byte length u32 · UTF-8) · code width w (u8: 1, 2 or 4) · zero
           padding to a multiple of w · n × code (uint w; 0 empty, k the k-th)  text, row titles
  limits   as text; each word is the side ("<" below, ">" above) followed by    limit flags
           the original text ("<<0.5": below, "<0.5"); 0 = not flagged
  rich     as text; each word is a row's `RichText` as JSON; 0 = plain          rowTitlesRich
  ```

  Limits and rich columns came with audit 2 (M6): before, a large table's limit flags and
  formatted row titles stayed JSON arrays, and about 21 flagged columns of a million rows made
  the table's JSON pass the 256 MB entry limit (saved, then refused on opening). Files of that
  form still read (the reader takes an array or a reference in every place). A column's n must be
  the table's `rowCount`, which must be a whole number of at most 2²⁵ (`MAX_COLUMN_ROWS`: a column
  of numbers of more rows can't fit in an entry); anything else is refused as corrupt before a
  row is allocated (audit 2 X7).

  No format version bump: the document is unchanged (a table read back equals the one written,
  every bit of every number, −0 included) and the reader takes either form. Versions before this
  one can't read a file with binary columns and call it invalid ("…values: expected array");
  bumping `schemaVersion` would have made every file, small ones included, unreadable to them. A
  missing or damaged column makes the file corrupt ("Corrupt project file: tables/<id>.json:
  column 3 is missing."). A project file may decompress to 2 GB (`MAX_PROJECT_BYTES`; a table of
  a million rows of 60 variables takes about 500 MB), each entry still 256 MB at most. Save and
  recovery copies of a project with a large table are made in the serializing worker (Save once
  the location is chosen: `Platform.saveProject` takes a function), its columns encoded on the
  main thread (one loop each) and transferred, not structured-cloned.
- **Images** (`assets/`): written for the assets the document refers to, so images no longer
  placed anywhere are dropped on save. Read back only when referenced, their bytes a PNG / JPEG
  whose type matches the extension and whose id is 32 hex digits; anything else is skipped (its
  items show "Missing image"). Limits: 25 MB per image (checked from the declared size before
  inflating), 200 MB of images per file, 20,000 pixels a side; insertion refuses larger ones with
  a message, as it refuses SVG (scripts), TIFF (browsers can't show it) and other formats.
  No schema bump: files without the new item kinds open in older apps.

- **Results are a cache, not a source of truth.** On open, a cached result is used only if its
  `inputKey` matches; otherwise it is recomputed. This gives an instant open and readable files
  for outside tools.
  A matching key doesn't make a result true (anyone can compute a key for any result), so the
  results a file held are shown at once and then recomputed when the app is next idle
  (`ComputeEngine.seed(…, { fromFile: true })`, `verifySeeded`, audit 2 X8), upstream analyses
  first: one that comes out the same stays as it is; one that differs (or now fails) replaces it,
  and the app says "Results recomputed: N differed from the saved file." Results of the file no
  analysis shows are dropped from the cache.
- The engine's cache keeps at most 500 results (`MAX_CACHE`), and drops results no analysis
  shows, oldest first, while the cached results hold more than about 256 MB (`MAX_CACHE_BYTES`,
  an estimate walked once per result: `estimateBytes`; audit 2, decision 763); the newest result
  and those shown always stay (what shows them holds their memory anyway). The results a file
  keeps (`resultsForFile`: the project's analyses', no result table past `BINARY_TABLE_CELLS`)
  are taken before they go to the worker that writes a Save or a recovery copy, so a result table
  of a million rows is not structured-cloned there only to be dropped (4–7 s for 1M rows × 32
  columns in Node).
- JSON can't encode `NaN`/`±Infinity`; in results they are written as `{"$n": "NaN"}`,
  `{"$n": "Inf"}`, `{"$n": "-Inf"}` (a tag, so result text reading "NaN" stays text). Older files
  used bare strings; such caches fail validation and are recomputed. Document numbers are always
  finite (invariant).
- Archives are refused (readable error) when their entries declare more than 256 MB each or
  512 MB in total when decompressed; the same limits apply to .xlsx import. Before anything is
  allocated, an archive is also refused when it lists more than 100,000 entries, an entry
  declares more than 1,100 times its compressed size (+ 1 KB; deflate can't pass ~1032:1), or
  the entries' compressed sizes add up to more than the file. Entries come back in an object
  without a prototype (an entry `__proto__` is skipped), so names read from inside a file (a
  workbook's relationship targets) only ever find entries.
- One import (a workbook, or a .zip of CSV and Excel files) has one budget (`ImportBudget`):
  20 million cells (`MAX_IMPORT_CELLS`) for its sheets' padded grids, taken as each sheet's
  bounding box is known and before its grid is made, and the 512 MB of inflated bytes, which the
  workbooks inside a .zip inflate from what the archive left. A workbook part that several
  `<sheet>`s name is read once, for the first. A CSV on its own isn't capped (a large one is read
  in columns, below), but its padded grid, once past 20 million cells, may be at most
  `MAX_PADDING` (4) times the cells its text holds (`checkPadding`, decision 720: one long line
  over many short ones is refused before it is padded); one inside a .zip takes its padded grid
  from the budget too.
- **Migrations:** `manifest.schemaVersion` runs a chain `v1 → v2 → …` on raw JSON before zod
  validation (`model/src/migrate.ts`; a step is frozen once released). Each plugin has its own
  `pluginVersion` + `migrateParams`, so analysis params evolve independently of the file format.
  After validation, `parseProject` repairs what an earlier version wrote wrongly
  (`model/src/repairs.ts`; the schema is unchanged, so not a migration): a result field `df`
  reading the results sheet's 'Number of pairs' row on a layer drawing a t test's results (the
  paired t test's ready "t, df and P" label before audit 2) reads its 'df' row.
  A file of a newer format is refused: "This project was saved by a newer version of the app
  (file format v3; this version reads up to v2). Open it in the newer version."
- **v1 → v2 (roadmap 33b): graphs to layers** (`model/src/migrations/v1to2.ts`). Each graph node
  is checked against the v1 schema (an invalid one fails as v1 validation did, at its path) and
  compiled (`compileV1`, with its data table when that is its source) into frame and layers
  (§6.1b) drawn by data set. It is deterministic and depends on nothing that changes later: the v1
  theme defaults that decide what is drawn and where each layer field comes from are copied into
  it. It returns notes (`readProjectFile` → `notes`, shown once after opening):
  `approximated` — drawn differently from v1, v1's quirk replaced by the layers' consistent
  behaviour: points drawn on grouped bars as mean symbols now count in the Y axis range; every
  replicate of entered means: the range reaches only what is drawn (v1's also reached error bars
  it didn't draw); functions' points, never drawn, no longer get a legend symbol; and a
  before-after graph of a result table whose first data set's error line is unknown; `dropped` —
  settings v1 itself ignored (formats of marks a graph type doesn't draw, kept by v1 after a type
  change; chart options of another family). Templates (the same format), methods (their
  embedded project, `readMethod` → `parseProject`) and recovery copies (Save's bytes) migrate
  the same way. Once saved, older apps refuse the file with their newer-version message.
- **Saving never leaves a half-written file.** Desktop (`save_project_file`,
  `apps/desktop/src-tauri/src/save.rs`): the bytes, first parsed with `readProjectFile`, are
  written to `name.psproj.tmp` in the same folder, flushed and read back byte for byte; the
  previous file is kept as `name.psproj.bak` (a hard link to it, else a copy; an older `.bak` is
  replaced); then the temporary file is renamed over the original (atomic on one volume). A
  failure at any step removes the temporary file and leaves the original as it was. Browser:
  File System Access `createWritable()` writes to a swap file that replaces the file only on
  `close()`; the download fallback always creates a new file. Nothing ever writes into the user's
  file except Save.
- **Recovery copies** (`ui/src/recovery.ts`) are exactly what Save would write, kept in private
  storage while a project has unsaved changes — never next to the user's file:

  ```
  record  { format: 1, session, fileName, path, tables (≤ 3 names), tableCount, sheetCount,
            time, appVersion, size }
  copy    the project file's bytes (+ on the web, the File System Access handle if kept)
  ```

  Web: IndexedDB database `plotting-software-recovery` (stores `records` and `copies`, keyed by
  session, written in one transaction). Desktop: `<app data>/recovery/<session>.psproj` and
  `<session>.json`, each written to `.tmp` and renamed, the copy before the record. One slot per
  page load (the session, a UUID), held with a Web Lock `ps-recovery:<session>` for the page's
  life; a slot whose lock is free is orphaned and offered at the next start. Written 5 s after
  edits stop, at most every 30 s while editing, when the page is hidden or loses focus, and as it
  goes away (below); cleared after a save, when another project replaces this one and on a clean close. At most 10
  orphans are kept, none older than 30 days; unreadable records are deleted. A copy includes the
  images the project places (as Save writes them), rewritten with each copy: stored entries cost a
  checksum and a copy per image in the serializing worker, and the slot stays one all-or-nothing
  write (decision 187).

  **When copies are written** (decision 280):

  | Moment | Serialized | Written to |
  |---|---|---|
  | 5 s after edits stop, at most 30 s after the first unwritten one | worker | storage |
  | page hidden, window blurred, with a copy due | worker if loaded, else main thread | storage |
  | `beforeunload` with unsaved changes, `pagehide` (unless the latest edit's copy is stored or buffered) | main thread, synchronously | localStorage buffer, and storage (write started in the handler) |

  The buffer is `localStorage['ps.recovery.buffer:<session>']` = `{ record, bytes }` (bytes in
  base64; copies over 1.5 MB, or past the quota, aren't buffered). It is dropped once the
  session's storage write completes or the slot is cleared, and at the next start buffered copies
  of pages with no lock are moved into their slots (unless the slot holds a newer copy). The
  storage write started as the page unloads is best effort: Firefox completes IndexedDB's on
  reload and navigation, Chromium and WebKit abort it; the desktop's file commands are
  asynchronous. So an edit made just before leaving is kept wherever the buffer takes the copy
  and `pagehide` or `beforeunload` runs; otherwise the slot holds the last copy stored, which
  lacks at most the edits of the last 5 s (30 s of continuous editing).

  A project with a large table (roadmap 34e: a table of more than 100,000 cells, `large`) is
  copied in the worker only — also when hidden while the worker loads, and as the page goes away
  when a copy is due (best effort) — its columns encoded on the main thread and transferred. No
  copy is made on the main thread as the page goes away (seconds for a million rows, and far
  larger than the buffer): its slot keeps the last copy stored.

### 9.1 Import

`@ps/io` (`src/import/`), pure TypeScript (browser, worker, Node). `importFile(name, bytes)`
dispatches on the extension; errors are `ImportError`s with a user-facing message; anything
imported imperfectly is reported in `warnings` rather than silently changed.

| Format | Reader | Result |
|---|---|---|
| `.csv` `.txt` `.tsv` | `readCsv` (RFC 4180; BOM; UTF-8/UTF-16/Windows-1252; sniffs tab, `;`, `,`, or one column) | one `Sheet` |
| `.xlsx` `.xlsm` | `readXlsx` (fflate + in-house XML parser) | one `Sheet` per worksheet |
| `.pzfx` (XML project) | `readPzfx` | finished `DataTable`s |
| `.xls`; binary projects (`.pzf` and the like) | — | `ImportError` saying how to re-save |

A `Sheet` is a rectangular grid of `number | string | boolean | null`. XLSX cells keep cached
values (formulas → their last result, errors → `null`); date-formatted numbers stay serial day
numbers and are counted in `dateCells`, except dates whose format shows them as a plain number
(a day and a month joined by "." or ",", e.g. `d.m`): 27.9 typed in a day.month locale is stored as
27 September and shown as "27.9", so it reads as 27.9, what the sheet shows and a copy gives
(`dateDisplayedAsNumber`, counted in `datesAsNumbers`). Merged cells are not expanded. A worksheet
is read as its text is scanned (`visitWorksheet` on `scanXml`, the tokenizer `parseXml` builds its
trees with: the same checks and errors), not as a tree of every cell (audit 2, decision 765); the
small parts (workbook, relationships, styles, shared strings) are still parsed to trees. Decimal separator
(`readCsv`'s `decimal`, default auto; the import dialog offers delimiter and decimal overrides):
a `;`-delimited file uses
a decimal comma unless its numbers use a decimal point; other text (and clipboard pastes) uses a
decimal point unless some cell can only be a decimal comma (`1,5`, `0,125`, `1.234,5`) and none
uses a decimal point. In decimal-comma data `1.500` is 1500. Comma thousands (`1,250`) need a first
group without a leading zero. A header without a comma above lines of `int,int` is read as one
decimal-comma column. `sheetToTable(sheet, opts)` then builds a table from a block of the
sheet: optional header row (data set titles; a replicate group takes its first column's title),
first column as data / X / row titles, and `replicates` consecutive columns per data set (XY and
grouped). Data cells that aren't numbers become empty (counted warning); `NA`, `N/A`, `#N/A`,
`NaN`, `null`, `.` count as empty without a warning.

**Several tables on one sheet.** Journal source-data files (and many lab workbooks) stack small
tables on one sheet: a title line, a header row, the values, a blank row, the next table; some
sit side by side with their own titles. `findBlocks(sheet)` returns each table's title and range
(header + values; blocks without numbers are skipped), splitting side-by-side tables at empty
columns under separate titles. `guessBlock(sheet, range)` suggests settings: text in the first
column → grouped with row titles; a numeric first column under an X-like title (time, dose…) →
XY; otherwise column; a header when text sits over numbers; and the replicate count from the
header's title spacing (the widest data set, the last one included). `sheetToTable` places data
sets at their header titles when those don't fall on fixed-width boundaries, so data sets of
different widths import correctly (narrower ones get empty replicates). The import dialog lists
the tables, previews the chosen one, and can import all of them (of the sheet, or of every sheet
in the file, leaving out tables over 100 columns or 5000 rows), each with a graph, in one step.

**Block layouts (Phase 10).** `findBlocks` reads each block's structure with `parseBlock`
(`layout.ts`) and attaches a `layout`: which rows hold values, the label column (row titles, X,
or none), and exactly which columns belong to each data set. Tables are then built from that
layout (`sheetToTable` with `layout`); changing any setting in the dialog imports the plain range
instead. What it reads, from real source-data files:

- title lines directly above the header, a caption, or a measure name left of the values
  ("Fig.1c – IFN-β protein level", "P-TBK1/TBK1") as the table title; generic labels over the row
  titles ("Genotype") only as a fallback;
- a group row over replicate labels ("Experiment 1…", "Triplicate #2", "Image 3", "P1"), or a
  super-header over data set names ("uninfected · Vector");
- data sets of any width (spans between titles), numeric titles (doses), empty data sets dropped,
  repeated titles numbered;
- statistics are recognised by position first: rows labelled as tests ("P value…", "Statistical
  test") or summaries ("Mean", "SD", "SEM") end the block only when nothing but such rows follows
  (a row titled "SD", a rat strain, among the others stays data); columns labelled as tests, and
  text-only columns, are left out only right of all the values (mean | SD column pairs stay data);
- unlabelled numbers left of the titles (time points) as row titles; numbers under an X-like title
  (time, days, dose…) as X;
- one row of values → a column table of each data set's cells; rows without a header → one data
  set per row; replicate-like row labels → a column table with those rows;
- survival as a days column with 0/1 codes per group, or as (time, event) column pairs;
- side-by-side tables split at empty columns when each has its own header.

**Accounting for every number.** Heuristics can misread a layout nobody anticipated, so each
import says where the numbers of its source went. `SheetBlock.area` is the block with the rows
after its values (up to the next blank row); `sheetToTable` and `longToTable` record which cells
they read as values or X and which as titles, and return an `account` (`accountFor`): the values
read, and the numbers left out, grouped into whole rows or columns named by their label ("column Z
“P-value WT vs MUT” (3)", "rows 8–9 “Mean” (6)"). This check uses no word lists, so any misread
shows as numbers left out. The dialog shows the table the settings give ("Imports as": data sets,
replicates, row titles, first rows), the account, and strikes the left-out cells through in the
sheet preview; "Use the detected layout" switches to plain range import and back. Bulk imports
report left-out numbers per table after importing. Across the seven source-data papers used in
development, the numbers left out are all P values.

**Long data.** `detectLong` recognises one-value-per-row data (R/pandas exports: a header naming
every column that holds data, text grouping columns, numeric columns; R's unnamed row-number
column is skipped) and suggests the value, group and subject columns. `longToTable` builds a column table (one factor; subjects as rows, for
matched tests) or a grouped table (two factors; replicate k = subject k), with optional row
filters. The dialog offers it as "One value per row". `.zip` archives import every CSV/XLSX inside
as sheets.

**Published-data examples.** The Examples dialog's papers (`ui/src/examples/published/`) are
built through this importer at run time from the local `source_data/` folder (decision 83), or,
for the CC BY papers that embed their data (Johnston, Tawk, Chen, Swaminathan: decisions 1010,
1050, 1160), from CSV copies of the deposited tables served to the importer the same way: each
panel names its file, sheet and block (or long-format columns and filters) and is imported with
the detected settings, as the dialog would. The table's `notes` record the source, what the import
left out, any edit made after it, the legend's test, and the P values printed in the figure next
to the app's.

**Multiple variables (roadmap 19).** `sheetToTable` with `tableKind: 'multipleVariables'`
(`variablesToTable`, `import/variables.ts`) reads a plain range: a header row of variable names,
the first column as data or row titles, every other column a variable. A column is a text
variable when at least half of its filled cells (missing-value marks aside) are not numbers
(`isTextColumn`); numbers in it keep their text. Other columns are numeric, stray words
imported as empty with a counted warning. The import dialog offers it as a table type, and, for
sheets detected as long data, as "Every column a variable" (a data frame kept as it is).

**Large CSV files (roadmap 34e).** A delimited text file of 8 MB or more (`LARGE_CSV_BYTES`) is
imported by a dialog of its own (`LargeImportDialog`): the start of the file previewed (its first
256 KB: the delimiter and decimal separator, both changeable, and each column's type as read
there), the table's name, the first row as names, the first column as row titles, and the
columns to import, each Auto (the type detected), Number or Text. Import streams the file (a
`Blob`, never read whole: `Platform.openData`) in a worker (`csvRead.worker.ts`), decoded in
chunks (UTF-8, or UTF-16 by its BOM; Windows-1252 when it isn't UTF-8, as `decodeText`) straight
into columns (`CsvColumnReader`, `io/src/import/csvColumns.ts`): each column a `Float64Array` of
numbers and, from its first word on, dictionary codes of its words, about 8 bytes a cell. It shows
progress (bytes read, rows) and Cancel terminates the worker. The columns become the
multiple-variables table `readCsv` and `sheetToTable` make of the same text (`columnsToTable`:
the same text variables, missing-value marks, row titles and warnings; tests compare the two on
every case, in chunks of any size), except that the decimal separator comes from the preview
rather than every cell. No graph is made (a million rows' first graph is the user's to choose).
Instead of a fixed cap (xlsx keeps its 20 million cells, a workbook's or archive's in all), a CSV import is limited by the memory
its table would take (`MAX_IMPORT_BYTES`, 1.5 GB, estimated as it reads: 8 bytes a number cell,
12 with words, the words' text): "This file is too large to import: its table would take more than
1.6 GB of memory (at most 1.5 GB). Import fewer columns (untick them in the list), or split the
file."

**Columns of many levels (roadmap 34e, decision 416).** A text column of more than 200 distinct
values (`MAX_IMPORT_LEVELS`) is left out of an import by default, with the reason beside it
("16,171 distinct values: left out (tick to import)"): in the import dialog's "Every column a
variable" (each column ticked or not, `SheetImportOptions.include`; `manyLevelColumns`) and in
the large-CSV dialog (counted in the preview's rows, and after reading for columns not ticked by
hand, with a warning). Ticking it imports it. A sheet detected as long data with more than three
number columns (a data frame of variables) opens as "Every column a variable". Kept text variables
of more than 200 levels (`MANY_LEVELS`) are counted in pickers ("cell (text) (16,171 levels)")
and never a default group, colour, shape or split; past 1,000 (`MAX_MAPPED_LEVELS`) they can't be
mapped to an axis, colour, shape or groups. Legends list 50 levels of a mapped variable and 100
entries at most, Order of levels and Format's lists 100, then "… and N more".

**Your data (roadmap 34e).** The Examples dialog's "Your data" section builds examples from the
user's own files in source_data the same way (`examples/private/local.ts`): "Single-cell T cells (local
data)" reads `sc/tcells.csv` through the large-CSV import (`csvSettings`, `CsvColumnReader`,
`columnsToTable`), the per-cell id column and text columns of more than 200 distinct values left out and cluster ids as text, and draws the graphs
the synthetic "Single-cell T cells" example draws (`examples/singleCell.ts`).

**Paste transposed.** The table view's "Paste transposed" (⇧⌘V) swaps rows and columns of the copied
cells before the usual paste rules.

**One sub-table per data set.** Lab sheets often store a grouped table as stacked sub-tables: rows
with a text row title and values, under a line naming the data set (" | WT", then " | CD4Cre"),
sometimes under a measure title ("% Foxp3+", or in column A of the naming line).
`findStackedGroups` (`stacked.ts`) merges consecutive sub-tables with the same row titles
(compared without case or spaces) into one block with `parts`; a new measure title starts the
next table. A lone column-A line right above the rows names the data set when it resembles the
group's other names (a shared word or a 4+ character shared start), and is a measure title
otherwise. A table that repeats the previous one's data sets unnamed takes their names.
`sheetToTable` with `parts` builds the grouped table, matching rows by title.

**pzfx mapping.** Tables are read in file order; `<Title>` names the table. Analyses, layouts
(a binary section in the file) and info sheets are not imported (one warning each); graphs are,
when asked for (below).

| .pzfx | Here |
|---|---|
| `XY`, `OneWay`, `TwoWay`, `Contingency`, `Survival`, `Nested` | `xy`, `column`, `grouped`, `contingency`, `survival`, `nested` |
| `MultipleVariables` | `multipleVariables`; a Y column whose cells are mostly words becomes a text variable (not yet checked on a real .pzfx file) |
| `PartsOfWhole` | skipped (warning) |
| `SubColumnTitles` of a nested Y column | `subcolumnTitles` (subject names) |
| formatted titles: `<B>`/`<Bold>`, `<I>`, `<U>`, `<Sup>`, `<Sub>` (any case), `<Font Face="Symbol">` letters, `<BR/>` | `titleRich` / `rowTitlesRich` / `subcolumnTitlesRich` runs (Symbol letters as Greek, in the plain title too; breaks as spaces in titles); sizes, colours and faces dropped |
| `replicates` (`Replicates="n"`) | `replicates`, count n |
| `SDN`, `SEN`, `CVN` / `SD`, `SE` | `meanSdN`, `meanSemN`, `meanCvN` / `meanSd`, `meanSem` |
| `CV` (mean, CV) | `meanCvN` with N empty (warning) |
| `low-high` (mean, +error, −error) | `meanPlusMinus` |
| `upper-lower-limits` | `meanUpperLower` |
| CV values (percent) | divided by 100 (a fraction here) |
| X `numbers` / `error` | `numbers` / `numbersWithError` |
| X `date` | the file's numeric X (time since the first date, in the table's units); the dates become row titles when there are none (warning) |
| `<d Excluded="1">` | value kept, `excluded` mask set |
| `<d/>`, text in a number cell | `null` (text: counted warning) |
| `3,5` (decimal comma), `1.` | 3.5, 1 |
| sticky notes (`FloatingNote`) | table `notes` |

A column table with side-by-side replicates or several rows of summary data (which the model
doesn't allow) becomes a grouped table (warning). The row count is the longest column. Display
decimals (`Decimals`) are not imported. Tests compare every table of the `pzfx` R package's
example .pzfx files cell by cell against `pzfx::read_pzfx`
(`tools/oracle/pzfx_fixtures.R` → `packages/io/test/fixtures/pzfx/*.expected.json`).

---

**Graphs in .pzfx files (roadmap 39, decisions 570–573).** `readPzfx(xml, { graphs: true })` (and
`importFile(name, bytes, { graphs: true })`) also reads the `<Template>` section: base64 of zlib
data, `PCFFGRA4` then tagged records (u16 tag, u32 length, payload; bit 15 opens a container, bit 14
closes it; `io/src/import/pcff.ts`). What decodes reliably is used (`pzfxGraphs.ts`, the evidence in
[design/PZFX_GRAPHS.md](design/PZFX_GRAPHS.md)): each graph's name, its data sets (their column ids,
unique across the file, give the table and column) in the file's order, the graph title and axis
titles with their hidden flag, the axis ranges, whether X is numeric, each data set's colour and its
symbol (circle, square, triangle). `graphsFromPzfx` (`pzfxGraphMap.ts`) makes each a native graph:
the table's default graph (`createGraphFor`) with those set (titles hidden in the file removed; X's
range only when both X axes are numeric) and validated. Not decoded, so left to the defaults and
listed in the report: the kind of marks (bars, points, lines), error bars, log scales, fonts, sizes,
ticks and the legend. Binary tables are paired with the XML's by name and Y column titles; a graph
of an analysis's results or of several tables is not imported (reported); a section that can't be
read gives every table its default graph and says why. The result (`PzfxGraphImport`): the graphs
with their tables, a report line per graph in the file (`decoded` with what was matched and what is
the default, `default`, `skipped`), counts and layouts. The tables are exactly what `readPzfx` reads
without graphs.

The import dialog for .pzfx files (`PzfxImportDialog`) shows the tables and graphs found; "Import
graphs" is ticked when at least one decoded. Ticked, the file's graphs are made (and no others),
then the report; unticked, every table gets its default graph and the warnings are as before.

**Missing codes and detection limits (roadmap 39, decisions 574–575).** The import dialog's
"Missing values and detection limits": missing-value codes besides `MISSING` ("-999, ND, not
done": matched trimmed, ignoring case; a numeric code also matches the number), starting from
Preferences' list (`AppPreferences.missingCodes`), and "Values at detection limits" (ticked when
the sheet has any) with the rule of §3.3a and, for cells naming no limit, a limit for all or per
column (by header title). Both apply to the sheet before anything reads it (`prepareSheet`): codes
become empty cells, limit cells unique stand-in numbers (about 1.2345 × 10³⁰⁰, far from any
data), so block, layout, long-data and variable detection see them as numbers and every reader is
unchanged; the built table is finished by `finishCellRules` (stand-ins in number cells replaced
by the substitute and flagged, in titles and text by the original text; the rule's per-column
limits keyed by title turned into data set ids) with a note in the warnings. Without rules the
sheet and the import are exactly as before. The large-CSV dialog shows the same fields and
applies them as its reader reads (`CsvColumnsOptions.rules`: codes empty, limit cells the same
stand-ins) and `columnsToTable` finishes the table with `finishCellRules`, so a file imports the
same either way (audit 2, decision 692); pzfx text cells don't take them yet.

**Dropping files (roadmap 39, decisions 579–580).** Files dropped on the window are handled one
after another by their extension (`ui/src/drop/`): a project (.psproj) opens as File › Open does
(asking about unsaved changes; only the first of several, after the others); CSV, TSV, TXT, XLSX,
XLSM and ZIP open the import dialog (large CSV files their own, with the 5,000-row cells prompt as
from the menu); .pzfx the .pzfx import dialog; images dropped on a layout page are placed where they
fall (roadmap 32), elsewhere a prompt puts them on a page (one of the project's or a new one) or
ignores them; .pspreset and .psstyle files go into the user's library. A file that opens a dialog
waits for it to close; several files end with a summary. An overlay names what the drop will do (by
the items' MIME types when known, and by where it is).

### 9.2 Templates (roadmap 31)

A template is a project file (`.pstemplate`) whose manifest has `template: true`, written from
`templateOf(project)`: every data table cleared by `clearTableValues` (values, exclusions and text
cleared; kind, format, rows, row / data set / X / subcolumn titles, formulas, number formats,
column widths and notes kept), analyses, graphs and layouts as they are, no results and no
`view.json`; the images its pages place are written as in project files (`assets/`, roadmap 32)
and put in the asset store when it is opened. `readProjectFile` returns `template`. New from template opens it as a new project
(fresh `meta`, no file), so Save asks where. Kept per user (`Platform.templates`, a `Library` of
named files): desktop `<app data>/templates/<name>.pstemplate` (written to `.tmp` and renamed);
web IndexedDB database `plotting-software-library`, store `templates` (`{name, modified, bytes}`
by name; the 50 most recent saved or opened).

### 9.3 Methods (roadmap 31)

A method (`.psmethod`, JSON; `engine/src/method.ts`) keeps a table's analyses and graphs (and the
layouts showing only them) without data, to apply to tables of the same kind:

```
{ format: 'plotting-software-method', version: 1, name, description, created, appVersion,
  table: NodeId,          // the table it was made from, inside `project`
  project: Project }      // that table cleared (§9.2) and its family, nothing else
```

Curves and brackets a graph took from outside the family are removed when it is made, so every
reference is inside; image items are left out of its pages (`methodImages` counts them for the
dialog), so a method never names an asset it doesn't hold. `readMethod` checks the envelope with zod (a `version` above 1 is refused as
made by a newer app), then the project with `parseProject` (the project file's migrations and
validation; analysis parameters migrate by `pluginVersion` as in project files) and that the
table is there. `applyMethod(method, doc, targets, {match, find})` is `applyToTables` with the
method's project as the source. Kept per user (`Platform.methods`): desktop
`<app data>/methods/<name>.psmethod`; web the same IndexedDB database, store `methods` (all kept);
Export… / Import… write and read the files to share.

### 9.4 Graph presets (roadmap 33c)

A user preset (`.pspreset`, JSON; `model/src/presetFile.ts`) is a graph's layers as a recipe
(decision 255), made by `presetRecipe(graph, tableKind)`:

```
{ format: 'plotting-software-preset', version: 1, name, created, appVersion,
  recipe: {
    tableKind,                    // the kind it was made for
    frame, look?,
    layers: Layer[],              // 1–32, back to front; no `series`, `seriesHidden` or outputs;
                                  // `aes: {}` where the layer maps variables (the table's defaults)
    orientation?: 'horizontal', drawOrder?: 'series',
    scales?: { color?, size? },   // colour maps and sizes, no value ranges (nor levels' symbols)
    variables?: { x, y: 'number' | 'text'; color?: 'number' | 'text'; measure?;  // a graph of variables (34a)
                  shape?: 'text'; size?: 'number'; label?: 'number' | 'text' } },  // 34b; XY graphs too
  order?, isDefault? }            // the library's own (not in exported files)
```

Not kept: titles, axes and their ranges, annotations and brackets, labels, point formats, the
data sets' identities and their own formats or stats, layers drawing analysis outputs or
functions (and layers on them). `readPreset` checks the file with zod (`PresetRecipe` validates
each layer as the document does, and the layers' references, `layerIssues`); a `version` above
1 is refused as made by a newer app, anything else that isn't a preset with the reason.
Names: 1–60 characters, none of `/ \ : * ? " < > |`, not starting with a dot, unique ignoring
case (`presetNameProblem`); an import that clashes takes "Name (2)". In `@ps/graph`,
`presetFits(recipe, kind, table?)` (every layer allowed by the matrix in its frame; variable
mappings only for multiple-variables tables; a graph of variables only where the table has
variables of the types it keeps) decides where a preset is offered, `recipeLayers(recipe, table,
name)` makes its layers for a table (`preset: 'user:<name>'`; a graph of variables maps the
table's first variables of the kept types, `recipeMapping`, roadmap 34a), and
`defaultUserPreset` finds a kind's default (decision 257). A preset of a graph of variables keeps
the types of its variables, never the variables; an older app reading one drops `variables`
(zod strips it) and offers the layers as a graph of the variables as columns. Kept per user (`Platform.presets`, decision 256):
desktop `<app data>/presets/<name>.pspreset`; web the same IndexedDB database (version 2), store
`presets`, falling back to memory (`resilientLibrary`) where IndexedDB fails. The order of the
list and the default flag are written into each stored file; renaming writes the new name and
removes the old file.

### 9.5 Styles and preferences (roadmap 37)

A user style (`.psstyle`, JSON; `model/src/styleFile.ts`):

```
{ format: 'plotting-software-style', version: 1, name, created, appVersion,
  style: FigureStyle,             // §6.2b
  order? }                        // the library's own (not in exported files)
```

Checked like presets (zod, a newer `version` refused, the reason for anything else); names as
presets' (`styleNameProblem`, up to 80 characters; an import that clashes takes "Name (2)"). Kept
per user (`Platform.styles`, decision 537): desktop `<app data>/styles/<name>.psstyle`; web the
library database (IndexedDB, version 3), store `styles`; memory where storage fails. Projects and
graphs hold copies of a style's values (`StyleChoice`), so editing or deleting a user style never
changes a project.

The user's preferences (`AppPreferences`, `model/src/preferences.ts`; `Platform.settings`, entry
`preferences`: desktop `<app data>/settings/preferences.json`, web the same database's `settings`
store): new projects' style, P-value style and digits and confidence level (`createProjectWith`;
projects that exist keep their settings), the unit of sizes in the Format and page panels (in,
mm, pt; absent: inches), new pages' size (Add to page, a split set, Duplicate and stack, a
dropped image's new page: `newPageSpec`), the Export dialog's format and resolution (its defaults:
one chosen in the dialog wins for the rest of the session, decision 690), and (roadmap
39) the missing-value codes the import dialog starts with (`missingCodes`). Roadmap 41 adds the
app's colours (`colorScheme`: `light` or `dark`; absent: the system's; graphs, pages and their
previews stay on white paper in both), and for the desktop app's updates whether to check at start
(`checkUpdates`, absent: on; at most once a day), the version the user chose to skip
(`skippedVersion`) and when updates were last checked for (`lastUpdateCheck`, ms since 1970).
Read leniently (`parsePreferences` keeps what is valid).

## 10. Correctness: R oracle for Phase 1

```
tools/oracle/
  renv.lock, renv/                   pinned R + package versions
  cases/<suite>/<case>.json          { input, params, tol? } (hand-written or by gen_cases*.R)
  gen_cases*.R                       write generated cases
  r/<suite>.R                        reads cases, computes expected values (helpers: lib.R)
  run.R                              regenerates the fixtures (`pnpm oracle [suite]`)
packages/stats/test/fixtures/<suite>/<case>.json
                                     { name, input, params, expected, tol?, source: { r, packages } }
```

Fixtures are committed, so CI and day-to-day tests don't need R; `pnpm oracle` regenerates them
locally. Comparison: `|actual − expected| ≤ atol + rtol·|expected|`, with rtol 1e-10 for closed
forms, 1e-8 for special-function P values, and exact for exact permutation P values.

| Quantity | R reference | Notes |
|---|---|---|
| Mean, SD, SEM, CI of mean | `mean`, `sd`, `t.test()$conf.int` | |
| Quartiles / percentiles | `quantile(type = 6)` | **Verify** against reference software |
| Skewness, kurtosis | `e1071::skewness/kurtosis(type = 2)` | **Verify** against reference software |
| Geometric mean & CI | via `log` + `t.test` | |
| Unpaired t / Welch | `t.test(var.equal = TRUE/FALSE)` | |
| F test for variances | `var.test` | |
| Paired t, pairing r | `t.test(paired = TRUE)`, `cor.test` | ratio → on `log` |
| t test from mean/SD/N | closed form, cross-checked with `BSDA::tsum.test` | |
| Effect size R² (η²) | `t² / (t² + df)` | |
| Mann-Whitney U, P | `wilcox.test`; `coin::wilcox_test(distribution = "exact")` for exact P with ties | |
| Hodges-Lehmann + CI | `wilcox.test(conf.int = TRUE)` | |
| Phase 14 curve fits (`curvefit` suite) | `nls` with `deriv()` gradients (via `nonlinear.R`), `deriv3()` Hessians, `lm`/`predict` | rtol 1e-10 for fits; 1e-9 interpolated X; 1e-8 ROUT; 1e-6 Hougaard |
| Wilcoxon signed-rank | `coin::wilcoxsign_test(zero.method = "Wilcoxon" / "Pratt")` | |
| Roadmap 18 (`contingency_extra`, `deming`, `poisson`, `nlweights`, `qq`, `pcr`, `smoothing`, `coxcurves`, `rmthreeway`, `rm_effect_sizes`, `power`; new cases in `linear`, `logistic`, `curvefit`) | `chisq.test`/`fisher.test` + `p.adjust`; closed-form Deming checked by `optimize`/`prcomp`; `glm(poisson)`; `nls` with `weights`/1/f^(K/2) residuals, `deriv3` Hougaard, `pspearman`; `qnorm`; `prcomp` + `lm`; `lowess`, `splinefun`, `ns`, Akima from the paper; `survfit(coxph, stype = 1)`; `car::Anova` (idata), REML (`ref_rm.R`) + `lmer`; `aov(Error())`; `power.t.test`/`power.anova.test`/`power.prop.test` | rtol 1e-10, except Hougaard 1e-6 (central differences), Deming offset case 1e-9 (R's sums of squares at 1e6 offset), Cox Breslow tied case 1e-9 (survfit's KP iteration) |
| Roadmap 30 (`plotstats`, `cluster`) | geometric mean / SD factor / CI via `log` + `t.test`, `quantile(type = 6)` whiskers, Tukey whiskers from type 6 quartiles; `dist` / `1 - cor(use = "pairwise.complete.obs")`, `hclust` (complete, average, ward.D2) merge, height and order, row and column z-scores | rtol 1e-10; merge and order exact (ties included) |
| Roadmap 34g (`cytometry`, `density2d`, `hexbin`, `dotplot`, `pretty`, `contour`; cases from `gen_cases_cytometry.R` and `gen_cases_density.R`: data values from −2·10⁵ to 10⁶ and zero, six logicle parameter sets, cofactors 5 and 150; two clusters of 150 and 2,000 points, a skewed cloud, a ridge, five points, wider limits, bandwidth multipliers 0.5–2, grids 25–100, X's quartiles equal and both variables' (IQR 0: `bw.nrd0` × 4; audit 2); hexbin lattices of 10–50 bins, shapes 0.6–1.4, given bounds and a regular lattice of ties; 300 cells × 5 genes × 6 groups with missing values, thresholds 0 and 1, one and two groups, a constant gene, levels without cells (first, middle, last; one level left among empty ones; audit 2); 12 ranges for pretty; grids whose cells are saddles (one cell with its corners' mean above and below the level, a checkerboard of peaks and dips, 3xy tilted; audit 2), written by hand in `cases/contour`) | `flowCore::logicleTransform` and `inverseLogicleTransform` (Bioconductor, in the renv project) and `asinh`; `ggplot2:::precompute_2d_bw` + `MASS::kde2d`; the binned estimate reimplemented in base R (its binning checked against `KernSmooth:::linbin2D`); bilinear interpolation, `quantile(type = 7)`; `pretty(range(z), 10)`; `grDevices::contourLines` (suite `contour`: R's lines compared in order, so how a saddle's crossings join counts); `hexbin::hexbin` + `hcell2xy`; dot plots reimplemented in base R as Seurat 5's `DotPlot` computes them (checked once against `Seurat::DotPlot`'s plot data outside the renv project) | rtol 1e-10; logicle also atol 1e-12 × M near the scale's zero (inverse: 1e-14 × T; the largest error measured is 1.8e-15 × T); densities and contour points atol 1e-14 × the largest density / 1e-12 × the grid's span; hexbin cells and counts exact; scaled averages atol 1e-12 |
| Roadmap 35 (`atrisk`: five cases — events and censorings at the times asked, times out of order and past the last subject, every subject censored, 120 and 40 subjects at a graph's ticks) | `survival::summary(survfit(Surv(time, event) ~ 1), times, extend = TRUE)$n.risk`, checked against the subjects with time ≥ t | exact (rtol 1e-10) |
| Roadmap 34c (`ellipse`, `hull`; cases from `gen_cases_ellipse.R`: 30 rows, iris setosa, n = 3 and 4, heavy tails, a 1e6 offset, levels 0.68–0.99) | ellipses: `stats::cov.wt` / `MASS::cov.trob` / `colMeans` + `cov / n` with `qf`, the outline `(cos, sin) %*% chol(shape)`, checked in the script against `ggplot2:::calculate_ellipse` (norm, t), `car::ellipse` (Mahalanobis radius of every point) and `car::dataEllipse` (norm); hulls `grDevices::chull` | rtol 1e-10 (outline points also atol 1e-10 × the ellipse's size); cov.trob's iteration count exact; hull corners exact as a clockwise cycle (R's first corner isn't documented: compared from R's first) |
| Roadmap 38 (`formula`, `aggregate`; cases from `gen_cases_datamanip.R`: 30 random values, ties with missing values, one and two values and an even n at eleven probabilities; ranks of 13 values with ties and missing ones and 40 random ties; 60 values in three samples with missing values and missing groups, groups of one value; 50 values cut at breaks right- and left-closed, into 4 and 3 equal widths, 4 and 5 quantiles, labels needing more digits, breaks exactly halfway at the third digit (audit 2: 1.125, 0.3125, 1125…), constant data into equal widths (5, 0 and −2.5: the range widened by |x| / 1000, else 1 / 1000; audit 2); 80 cells in three samples × two conditions with zeros and missing values, groups of one value) | `quantile(type = 1…9, na.rm = TRUE)`; `rank(ties.method = "average" / "min" / "max" / "first", na.last = "keep")`; `ave()` (mean, median, sum, count, sd, var, z-scores by group; NA for rows without a group), the column's `mean`/`median`/`sd`/`var`; `cut(x, breaks / n / quantile(type = 7), right, include.lowest = TRUE)` codes and labels; `tapply` per group of mean, median, sd, sd/√n, length, min, max, sum, % above a threshold, % non-zero | rtol 1e-10; labels and codes exact. The formula suite runs the formula language itself (`model/test/formulaFunctions.test.ts`), the aggregate suite the plugin (`analyses/test/dataManipulation.test.ts`) |
| Roadmap 19 (`catreg`, `multifactor`, `mvsurvival`; cases from `gen_cases_mvtables.R`, run through the plugins on tables with text variables) | `lm` / `glm` / `coxph` with factors (`relevel`, contr.treatment), `car::Anova(type = 3)` (F; LR χ² cross-checked against tight `glm.fit` / `coxph` refits without each term's columns), `predict` (confidence / link + se.fit), `survfit(newdata, stype = 1)`; multifactor: `lm` with contr.sum + `car::Anova(type = 3)`, `emmeans` means and t ratios with the `ref_integrals.R` / `ref_padjust.R` references for Tukey / Šídák / Holm-Šídák; `survfit` / `survdiff` | rtol 1e-10 throughout |
| Audit 3 (`nested`: `t_large_high_icc`, 6 subcolumns of 500 replicates; `oneway_large_ragged`, 7 subcolumns of 220–500 with 40 values missing; both ICC 0.999) | above 1,000 values `nested.R` fits the single random intercept level by level (W_c⁻¹ = I − ρ/(1 + n_cρ)·11ᵀ, Newton on the analytic gradient and Hessian) instead of `reml_dense`, whose N × N criterion is too noisy there for its stopping rule; checked against `reml_dense`'s dense criterion (1e-12) and β at the optimum, `lmer`, `nlme::lme`, `lmerTest` and, balanced, the ANOVA of the subject means | rtol 1e-10; the cross-checks against lme4 / lmerTest at 1e-4 (lme4 stops 2e-5 from the optimum, where the criterion is flat to 1 ulp) |
| Audit 3, S8 (hard cases: `ttest` `missing_unpaired`, `missing_unpaired_welch`, `missing_paired`; `oneway` `missing_k3`, `extreme_p`; `survival` `extreme_p`; `mannwhitney` `separated_n30_n35_exact`, `separated_n40_n45_normal`; `twoway` `zero_variance_cell_2x3`; `linear` `duplicate_x`, `n2`) | as their suites; empty cells are `null` in the case (NA in R): left out of their group (a paired test: the pair), as `t.test()` / `lm()` do | the empty-cell cases also run through the analyses on tables with empty cells (`analyses/test/oracleMissing.test.ts`); P values from 1e-12 down to 1e-33 at the suites' tolerance; n = 2 regression: NaN SEs, CIs, F and P (no residual df) |

**Migration fixtures** (roadmap 33b, `graph/test/fixtures/v1/`, written by the 33a code): every
golden graph as a v1 project, every synthetic example's v1 document, hand-made exotic v1
projects (per-data-set show flags and drawing orders, stacks with points, before-after with a
styled first data set, curves from two analyses, functions, output graphs, horizontal graphs, a
clustered heat map, a bubble plot, the three behaviour changes), a template, a method and a
project file, with the SHA-256 of every graph's stage-1 SVG. Each migrates to a valid v2
project that saves and reopens unchanged and renders byte-identically (goldens against their
SVGs, the rest against the hashes; until roadmap 33d each also laid out as the v1 layout of its
v1 graph, the shadow comparison, except the behaviour changes the migration reports). Every
example built now is its v1 document migrated (`ui/test/v1Examples.test.ts`).

Required edge cases per test: n = 2, unequal n, ties, all-equal values (SD = 0), zero differences
(Wilcoxon), large offset + tiny variance (1e9 + noise, numerical stability), empty and excluded
cells (tested at the normalization layer).

Numerics needed in `stats` for Phase 1: `lgamma`, regularized incomplete beta (t and F CDF and
quantiles), normal CDF/quantile (AS 241), and exact rank-sum/signed-rank distributions, including
with ties (shift algorithm).

---

## 11. Open items

- **Roadmap 40, derived and not saved**: thumbnails of graphs and pages (rendered in idle time,
  cached per node and version in memory, not in IndexedDB: decision 603; an XY graph of a big
  table from a sample of its rows, decision 1111), which folders are
  folded and the navigator's view and thumbnails toggle (per user, browser storage). Roadmap 47:
  the sheets selected in the navigator (several, beside the open one) are the navigator's state
  only, never in the document or the file (decision 950).

- **Verify against real output of established lab software** (run a handful of datasets through
  it once and commit them as `fixtures/reference/`; "the reference software" below is that
  software, "the guide" its documentation). Current choices, all matching R unless noted:
  - Quartiles: R type 6. Skewness/kurtosis: e1071 type 2 (G1, excess G2). Geometric stats: natural log.
  - Exact P for rank tests when nA + nB ≤ 100 (Mann-Whitney) / ≤ 100 non-zero pairs (Wilcoxon);
    two-sided exact P with ties uses coin's |S − E| rule, which isn't always 2× one-sided.
  - Hodges–Lehmann CI follows `wilcox.test` (its root-finder gives e.g. 1.99997 rather than 2 with
    ties); other software may report a different interval.
  - Mann-Whitney U reported as min(uA, uB); Wilcoxon W = Σ positive ranks − Σ negative ranks.
  - One-tailed P assumes the observed direction was predicted (decision 18).
  - With a one-tailed P, the CI (and Hodges-Lehmann estimate) stays the usual two-sided one (t
    tests, Mann-Whitney, Wilcoxon, one-sample tests), which we take to be what lab software reports;
    R's one-sided run would give [x, ∞). Correlation still reports R's one-sided CI.
  - F test for variances: F = larger / smaller variance; P = 2·min(cdf, sf).
  - Degenerate data: SD = 0 gives t = ±∞, P = 0; all-zero Wilcoxon differences give P = NaN.
- **Regression conventions to verify against reference software** (Phase 2):
  - Relative (1/Y²) and Poisson (1/Y) weights use the curve's Y, not the data's; weighted R² is
    1 − SS_w / Σw(y − ȳ_w)² with weights at the curve.
  - R² through the origin is centred (can be negative); NIST/R use the uncentred form. Linear
    regression no longer shows R² for constrained lines (roadmap 18).
  - A parameter that ends on a bound is treated as fixed (no SE/CI; excluded from df and AICc).
  - Inhibition variable-slope curves use the form (LogIC50 − X)·HillSlope, so falling curves
    have HillSlope < 0.
  - Global fits: per-data-set df counts a shared parameter fully.
  - "Ambiguous" = condition number of the scaled Jacobian > 1e10 (the guide uses dependency >
    0.9999).
  - Fieller X-intercept CI is undefined (—) when the slope isn't significant, and through the origin.
  - Prediction bands add s²/w(ŷ) for nonlinear fits; linear fits assume unit weight.
  - Profile CI endpoints that never cross the threshold report the bound or ±∞.
  - Intercepts are compared only when slopes don't differ (P ≥ 0.05).
- **Curve-fitting conventions to verify against reference software** (Phase 14):
  - Interpolation: unknowns are the rows below the last X–Y row (the guide's rule); Y-only rows
    higher up are ignored as before. The curve is searched from the smallest to the largest X of
    the standards (first crossing, so the lower X of a bell), then below, then above, up to half
    the standards' X range beyond each end (our reading of "half the length of the X axis"). CI
    of an interpolated X = where the *confidence* band crosses Y (the guide's computational
    pages; one checklist says prediction band); blank when the band doesn't cross within that
    range. Y from X: the confidence band at X, blank beyond the range. Mean X = mean of the
    replicates' interpolated Xs that exist (N shown). No CIs with robust or ambiguous fits.
    Poles (e.g. X = −Km) are not taken for crossings.
  - Runs test: exact one-tailed P (Swed–Eisenhart distribution; the guide doesn't say exact or
    normal); residuals of exactly 0 are dropped; only for data sets with one Y per X.
  - Replicates test: lack-of-fit df = number of X values − parameters (Draper & Smith; the guide's
    wording differs); only unweighted, non-global fits.
  - Hougaard's skewness: SAS/Ratkowsky formula with second derivatives by central differences of
    the analytic gradient; weighted fits hold the weights at the solution (roadmap 18).
  - Dependency = 1 − 1/(R⁻¹)ᵢᵢ from the parameter correlation matrix (algebraically the guide's
    definition); for a global fit the correlation matrix shown is the first data set's block.
  - Robust fit: IRLS to the Lorentzian fixed point from the least-squares fit, weights ignored;
    ROUT judges outliers on residuals weighted at the robust curve with RSDR recomputed from them
    (unweighted cases only in the oracle); candidates are the ⌊0.3N⌋ largest residuals, as for
    column ROUT.
  - Bell-shaped dose-response: with both Hill slopes positive (our initial values) Plateau2 is
    the plateau at low X and Plateau1 at high X; the guide's recommended signs differ.
  - Two sites — Fit logIC50 follows an older edition of the guide (the current page prints the Fit
    Ki model); FractionHi, PercentFast, Frac are not bounded by default (PercentFast is 0–100 as for
    two phase decay). Default constants the user must set: F = 50 (ECanything), HotNM = HotKdNM = 1
    (Fit Ki), HotNM = 1 and Koff = 0.1 (association), Et = 1 (kcat).
  - User equations: `pi` is a constant (undocumented in the guide); operator precedence is the
    usual one (the guide publishes none). Roadmap 20 added the rest (below).
  - Initial values: our own rules per built-in equation; user equations start at the entered
    values, else their rules (roadmap 20), else 1.
- **Equation and simulation conventions to verify against reference software** (roadmap 20):
  - Tails: zdist is the standard normal CDF (the guide's Excel equivalent NORMSDIST, its function
    reference's "cumulative probability", and its cumulative-Gaussian equations need it), zinv its
    inverse, normdist the CDF, norminv the lower-tail quantile; tdist, fdist, chidist are upper
    tails, chisqc the lower, tinv two-tailed, finv and chiinv upper. The guide's "P value
    (one-tailed)" wording for zdist/normdist would suggest the upper tail instead.
  - arctan2 keeps its (y, x) order (the function reference: ARCTAN2(1, 0) = π/2); the
    guide's table writes arctan2(x, y) with Excel's ATAN2(x, y).
  - ibeta(a, b, x) = I_x(a, b), igamma(a, x) = P(a, x) (the guide gives no argument meanings
    beyond Excel's GAMMADIST(x, a, 1, TRUE)); Bessel orders must be integers (NaN otherwise);
    hypgeometricu is defined for x > 0, hypgeometricf for x ≤ 1.
  - Implicit equations: Newton from the previous solution at the same X, else from Y = 0, g(X, 0),
    1, then bracketing; with several roots, the one continuation keeps. How the reference software
    solves them is undocumented.
  - Differential equations: Dormand–Prince 5(4) at rtol 1e−12 (the reference software's
    integrator is undocumented); X[0] as an equation line (the guide sets X0 in the equation
    definition); `dY/dX =` is accepted though the guide's syntax refuses it; systems of ODEs are
    not supported (nor in the reference software).
  - Per-data-set lines: a parameter that a data set's Y doesn't use is held at its initial value
    for that data set; the reference software's handling isn't documented.
  - Rule vocabulary: the guide never publishes the whole list; we offer the documented rules (and an
    early version's YMAX − YMIN, XMAX − XMIN) plus division; "Mean of column titles" is left out.
    Slope rules use one mean Y per distinct X as "points".
  - Built-in equations: "EC50 shift, X is concentration" uses EC50Control·EC50Ratio (the guide
    prints +); the damped sine's missing parenthesis is closed; "Two sites — Fit logIC50" as in
    Phase 14; Homologous binding's nonspecific term is Bottom (as the equation prints) and HotnM
    a data set constant; association with two or more concentrations takes Hotnm from the column
    titles; default constants the user must set: Baseline = 0 (absolute IC50), Vol = 0.1 ml and
    SpecAct = 100 cpm/fmol (depletion), Hot = 50000 cpm, KdnM = 1 (competitive depletion),
    RadioligandNM = HotKDnm = 1 (allosteric), K1 = 1e8, K2 = 0.1, L = 1 (kinetics of competitive
    binding), Time0 = 10, NS = 0 (association then dissociation), Et = S = Km = 1 (Morrison),
    N = 100 (cumulative Gaussian counts). Classic equations are included only where their form
    differs from a modern one; the classic Gaussian, Hyperbola and Padé (1,1) approximant (no
    equation printed in the guide) are left out.
  - Operational model partial agonist: KA and tau fit per partial agonist, EC50 for data set A
    only; Effectmax, Basal, n shared.
  - Simulations: the reference software's random numbers (Numerical Recipes RAN3/GASDEV) aren't
    reproduced — ours follow the same distributions; the arithmetic series includes the first X ≥
    the end; a geometric series needs a first X > 0 and a ratio > 1; outliers are drawn among values
    that aren't blank; the t and Lorentzian errors are scaled by the SD entered; contingency designs
    fix margins as described (its dialog wording is our only source).
  - Monte Carlo: summaries (mean, SD, SEM, 2.5th/50th/97.5th percentiles by R type 6, fraction of P
    values below α) are ours — the reference software leaves them to further analyses of the table;
    the CI of the fraction of hits is Wilson/Brown.

- **Checked against a published paper** (Phase 9): `packages/analyses/test/published.test.ts`
  reproduces P values printed in Stucchi et al., Nature Immunology 2026 (CC BY source data)
  through the analysis plugins — two-way ANOVA with Tukey or Šídák over all cells, within rows or
  within columns (one family or per row), unpaired t tests, one-way ANOVA with Tukey. Of 144
  printed values, 135 match at the printed precision, 3 match if the paper truncated, and 6 no
  standard test reproduces (e.g. Fig. 1a prints <0.0001 where R's TukeyHSD and we give 1.3e-4).
  A second paper (Contreras-Castillo et al., Nature Immunology 2026), with every table built by the
  importer: of 68 printed values 40 match the legend's test, 6 match another standard test, and 22
  none (spot checks in R agree with us); its weight curves are analysed in a way the legend doesn't
  state.
- **ANOVA conventions to verify against reference software** (Phase 3):
  - Two-way "compare every cell with every other" ("regardless of rows and columns"):
    one family of all R×C cells, Tukey's k = R·C, Šídák over R·C(R·C − 1)/2 comparisons;
    Dunnett's control is the first cell. Not offered with repeated measures.
  - Two-way comparisons: family = each row (column) by default, per the guide (version 8 on) ("one
    family per row … recommended"); "one family for all comparisons" widens Šidák/
    Bonferroni/Holm/Fisher/FDR only — Tukey/Dunnett stay per row because the reference software's
    pooling of their distributions across rows is undocumented.
  - Main-effect comparisons use least-squares marginal means with n_eff = k² / Σ 1/n.
  - Additive-model (no interaction) comparisons: fitted vs observed cell means (oracle covers only
    the interaction model).
  - Games-Howell / T3 / T2 report t (as the guide does); Tukey reports q.
  - Brown-Forsythe ANOVA denominator df: original formula, not Mehrotra's.
  - Kruskal-Wallis P from chi-square (other software may give exact P for small samples).
  - BKY q-value capping at 1; significance is `p < alpha`.
- **Grouped-table conventions to verify against reference software** (Phase 11):
  - Multiple t tests: rows whose test can't be computed (too few values, SD 0 — the guide counts
    "only rows where t tests could be computed") are listed as not analyzed and left out of the
    family; with the consistent SD a row with one value per group is still tested. Which rows
    enter the guide's pooled SD is not documented (here: every row with a value in each group).
  - Default order of subtraction (first − second) and whether the reference software's multiple
    Mann-Whitney reports the difference of medians (as here) or the Hodges-Lehmann estimate.
  - Discoveries: the FDR procedure at Q, so p on the boundary counts (≤); significance: adjusted
    P < α. BKY's estimated true nulls = m − r₁ at Q/(1 + Q).
  - Multiple one-way ANOVAs: each row is its own family; a row missing a data set is skipped.
  - Three-way ANOVA: factor names, the order the reference software lists the seven effects, and
    Tukey's k for "all cells" (here k = 4·rows). The "each mean in row 1 vs. the one below" family
    is missing.
  - Effect sizes: partial ω² (Olejnik & Algina) is ours (the guide lists η², partial η², f); Cohen's
    d with Welch's test uses the pooled SD; Hedges' J exact; Glass's Δ uses column A as control;
    paired d uses the SD of the differences (d_z).
  - Newman-Keuls: our step-down P (the reference software reports none) and q = √2·diff/SE.
  - Test for trend: slope unweighted, SS/P weighted by n (per the guide's wording); nonlinear
    variation shown from four groups.
  - Row statistics from summary data combine cells into the statistics of the pooled values;
    fraction of total treats each replicate subcolumn as a column and uses entered means for
    summary data.
- **Data processing, outliers and nested conventions to verify against reference software** (Phase
  13):
  - Transform: X is transformed with the original (not transformed) X used by Y = f(X, Y)
    functions; rank ties get the average rank, rank and z score use all values of the data set
    (every replicate); rounding K is truncated to an integer and rounds half away from zero on
    the number as written in decimal, as spreadsheets (round(1.005, 2) = 1.01; audit 2);
    arcsin √Y is ours (not in the guide's list); Y + random, user-defined equations, X ↔ Y
    interchange and the linearizing plots (Scatchard, Lineweaver-Burk …) are not offered.
  - Summary data: SD/SEM scaled for linear transforms; other transforms keep the means only
    (the reference software can also convert to an asymmetric CI and transform its ends).
  - Normalize: with replicates, 0% / 100% come from the row means (as the guide says); "sum"
    and "mean" are of the row means; the entered 0% / 100% apply to every data set.
  - Remove baseline: replicate handling (baseline row mean vs. the matching replicate) and the
    exact list of column-math operations the reference software offers.
  - Frequency distribution: our reading of FAQ 1660's "nice" width (6.24 → 6.2, 3.7 → 3.5) and
    the automatic first bin centre (not documented); relative frequencies divide by the values
    tabulated, not by all values; no exact (unbinned) cumulative distribution yet.
  - Area under the curve: which regions count towards "Total Area" when peaks below the baseline
    are excluded (here: regions above only); net area over the counted peaks only; the SE uses the
    full-range trapezoid weights even when the curve crosses the baseline; a point exactly on the
    baseline ends a peak; the "fewer than N points" rule counts data points strictly off the
    baseline.
  - Grubbs: the P value shown is the Bonferroni bound matching the critical value (the guide
    gives only critical values); the tested value is the one farthest from the mean; default
    α 0.05.
  - ROUT on column data: the robust fit is started at the median; the RSDR percentile is type 6;
    "the 30% largest residuals" is ⌊0.3N⌋ (at least one); P < Q·j/N (strict). The guide publishes
    no numeric worked example, so these are checked only against our own R reimplementation
    (`tools/oracle/r/outliers.R`) and on clear-cut data (masking pair found, none in Gaussian data).
  - Nested: containment df (subcolumns − groups; SAS's default for FAQ 2105's code); which test of
    the nested factor the reference software shows (here both the classical F test of subcolumns
    within groups and the REML likelihood-ratio χ², df 1); ICC = σ²_sub / (σ²_sub + σ²_res); no R²
    reported; one value per subcolumn is fitted without the random effect.
- **Survival and contingency conventions to verify against reference software** (Phase 4):
  - Kaplan-Meier: Greenwood SE; asymmetric CI = log-log (as the guide says); at S = 0 we report SE 0
    and CI [0, 0] (R gives NA). Median CI: Brookmeyer-Crowley with the complementary log-log
    transform (as the guide does from version 10.5), whatever the curve's CI method; check curves
    that reach 0 or sit flat at ½ on a CI curve.
  - Gehan-Breslow-Wilcoxon: weight = number at risk, hypergeometric covariance (SAS "Wilcoxon");
    the guide only cites Machin eq. 10.2. Check 3+ groups, and the trend test ((c'U)²/c'Vc, scores
    1..k).
  - Hazard ratio and median ratio are shown group 2 / group 1 first, then the reciprocal.
  - Yates' correction is not capped at |O − E| (the guide says so; R caps it).
  - Odds-ratio CI: Baptista-Pike taken as the interval matching Fisher's sum-of-small-P test
    (limits on a jump, e.g. [[7,3],[2,8]] gives 0.99999998). RR: Koopman score; difference:
    Newcombe hybrid score *with* continuity correction (the guide's recommendation).
  - Wilson/Brown proportion CIs: Poisson lower bound for x = 1, 2 (x = 3 when n > 50); check n = 50
    and x = n ≤ 2.
  - NNT when its CI passes through infinity (shown as two open ranges).
- **Normality / nonparametric / correlation conventions to verify against reference software**
  (Phase 4):
  - Spearman CI: Fisher z with SE √(1.06/(n − 3)) (Zar); no CI for n ≤ 10. Exact P for n ≤ 17
    (all n! pairings, ties included), t approximation above; one-sided exact P.
  - Two-sample KS: exact when C(n₁+n₂, n₁) < 60 000 (the guide's size list says (2, 346), the
    formula gives (2, 344)); large samples use the Numerical Recipes formula with Stephens'
    correction.
  - Friedman statistic is tie-corrected (as `friedman.test`); exact P when (k!)ⁿ ≤ 1e9. Dunn after
    Friedman: z on mean ranks, SE √(k(k+1)/(6n)), no tie correction, P × number of comparisons.
  - Anderson-Darling P formula (D'Agostino & Stephens 1986, as nortest); reports A²*.
  - D'Agostino-Pearson: which skewness/kurtosis the reference software shows beside K² (we keep √b1
    and b2 − 3).
  - KS normality: P above 0.10 is shown as "> 0.10"; Shapiro-Wilk P for n = 4–11.
- **Repeated measures / mixed-effects conventions to verify against reference software** (Phase
  6):
  - Mixed-model F-test denominator df: we use containment (SAS PROC MIXED's default for the
    published SAS code); Satterthwaite is available in the stats API. The key open item.
  - Geisser-Greenhouse for mixed fits: the guide applies it but doesn't say how ε is estimated with
    missing values; we report uncorrected mixed-model F tests.
  - Random effects when both factors are repeated: subject, subject × row, subject × column
    (the published SAS/R code).
  - Comparisons: pooled MS_residual when sphericity is assumed, paired t (df n − 1) per comparison
    with GG (one-way); pooled error terms (two-way); df for comparing groups at one time point;
    Dunnett after the paired option and after mixed fits (approximate correlation structure).
  - Two-way Subjects F (MS_subjects / MS_residual); mixed-model "matching effective?" χ² df;
    whether ε is shown when sphericity is assumed; main-effects-only RM designs are fit as mixed
    models.
- **Regression conventions to verify against reference software** (Phase 6):
  - Logistic: Hosmer-Lemeshow with 10 equal-size groups (boundaries ⌊g·n/10⌋, ties in row order),
    df = 8; AUC SE (Hanley-McNeil with data Q1/Q2) and CI (± z·SE, clipped to [0, 1]); AICc; VIF;
    models without an intercept (null model p = ½).
  - Profile-likelihood CIs (logistic and Cox) on the same data as the reference software.
  - Cox ties: the guide uses the exact method and switches to Efron when ties are many (threshold
    undocumented); we offer Efron (default) and Breslow. Cox pseudo R² is not reported.
  - Multiple linear without an intercept: centred R², F test against Y = 0.
  - What the reference software shows for separation, divergent Cox fits, and collinear designs.
- **PCA / ROC / Bland-Altman conventions to verify against reference software** (Phase 6):
  - ROC: area CI truncated at 1; which threshold rows appear with ties, and their order; SE with
    heavy ties.
  - Bland-Altman: ratio and % difference limits computed without logs; limits use 1.96 exactly
    (as the guide's sample output shows).
  - PCA: eigenvector signs (we make each eigenvector sum positive); parallel-analysis percentile
    definition (type 6) and whether components are kept past the first that fails.
- **Statistics additions to verify against reference software** (roadmap 18):
  - Contingency: the guide documents no comparisons within larger tables; ours test each
    pair of rows on its own 2 × c table with the main test and correct with Bonferroni (default),
    Holm-Šídák or Šídák; the control is a chosen row. Phi is unsigned (|ad − bc|/√…) and uses the
    uncorrected χ²; Cramér's V likewise.
  - Observed vs. expected: expected totals must match to 0.1% (percentages to 100, counts to N)
    and are then rescaled; the one-tailed binomial P goes in the direction observed (as the
    guide's example).
  - Deming: SEs per FAQ 1690 (r = S_xy²/(S_xx S_yy)); the P value of slope = 0 is the t test
    from that SE (equal to the correlation's); λ = (SD_X/SD_Y)²; no R².
  - Simple logistic: CIs profile likelihood by default (as multiple logistic); X at 50% without
    a CI; ROC from the fitted probabilities.
  - Poisson: which CIs the reference software uses (Wald here), and its dispersion φ (Pearson χ²/(n
    − k) here); AICc from the full likelihood (with −log y!).
  - Linear regression through a point: the intercept is y₀ − slope·x₀ (no SE), the X intercept
    x₀ − y₀/slope; no R² for any constrained line (as the guide's linear regression).
  - Nonlinear: 1/X and 1/X² use the X of the point; with 1/SD² each replicate takes its row's SD (a
    row with fewer than two different values is an error), summary data their entered SD; the
    prediction band with 1/X, 1/X² uses the weight at the band's X and is replaced by the confidence
    band with 1/SD²; Hougaard's skewness of weighted fits holds the weights at the solution (the
    guide computes it from version 8, method undocumented); the weighting test uses Spearman's P
    (exact for n ≤ 17); "compare one parameter" shares it (global fit) in the null model; different
    equations per data set are separate fits (no parameter shared across equations).
  - Two intersecting lines: initial values ours (crossing at the middle of the X and Y ranges,
    each data set's own slope).
  - QQ plot: percentiles (i − 0.5)/n, the data's mean and SD; lognormal when only lognormality is
    tested.
  - PCA: biplot scaling ("the loadings are scaled to 90% of the PC scores") read as the largest
    loading coordinate becoming 90% of the largest absolute score on PC1/PC2; PCR's
    back-converted coefficients get SEs from the linear map (the guide shows estimates).
  - Fit spline/LOWESS: the guide's coarse / medium / fine spans (ours 2/3, 1/3, 0.1), its knot
    placement for smoothing splines (ours: equally spaced, natural cubic, least squares),
    robustness iterations of LOWESS (3, as R), and the curve of interpolating splines through the
    mean Y at each X.
- **Multiple-variables statistics to verify against reference software** (roadmap 19):
  - Regression ANOVA table: Type III by dropping a term's dummy columns (treatment coding), so main
    effects involved in an interaction are tested at the reference level (or at 0 for a continuous
    partner); the reference software may code or centre differently. Whether it shows a Regression
    row, and which per-variable test logistic / Poisson / Cox report (ours: likelihood ratio).
  - Level order and labels of numeric variables used as factors (`String(value)`, first
    appearance); frequency ties in the most/least-frequent rules (earlier level); models without
    an intercept keep dropping the reference column.
  - Prediction: CIs of predicted probabilities and counts on the link scale (Wald); blank numeric
    predictors of a point take the mean (the reference software's Interpolation tab offers other
    choices).
  - Multifactor ANOVA: default terms (every two- and three-way interaction, as the guide lists
    what is tested); Tukey's k for simple effects as one family (LA·LB) and for cells; EMM
    weighting (equal); no Dunnett or Newman-Keuls; which of η², partial η², Cohen's f, % of total
    the reference software shows per term.
  - Survival from variables: group titles (levels joined by ", ") and order (levels in table
    order, first variable slowest); a text status with no censored value chosen counts every other
    value as censored; one status variable only (the reference software allows several).
  - Cox curves: the Kalbfleisch–Prentice baseline at predictors 0 matches the guide's description
    ("the product of alpha values"); Breslow-type baselines would differ with ties.
  - Three-way RM: effect names and order; containment df with missing values (sequential rank
    contribution); GG ε per stratum; no multiple comparisons yet.
  - RM effect sizes: partial η² against each effect's own error term; η² over the total SS.
  - Power: two-sided t-test power counts both tails; proportions without continuity correction;
    correlation by Fisher's z; log-rank by Schoenfeld with equal allocation.
- **Second pass (deferred precision work):** R's `ptukey`/`qtukey` and `mvtnorm` are the limiting
  factor in the studentized-range and Dunnett oracles (documented looser tolerances, each backed by
  an independent high-precision reference); regenerate the dunnett/multcomp/twoway fixtures with
  the faster references (10–30 min per suite) and tighten where possible.
  The Phase 11 suites that reuse these references are slow too: `threeway` (Tukey over 120 cell
  pairs) takes ~30 min, `multiple_oneway` ~20 min.
- `packages/stats/src/gpl/` currently holds R's `uniroot` (zeroin) and the `wilcox.test` Hodges–Lehmann CI
  code, needed for bit-exact HL intervals, the Lilliefors test (nortest's large-P fits), R's
  L'Ecuyer-CMRG generator (PCA parallel analysis reproduces R's simulations exactly), the
  Kaplan-Meier median rule from survival's `findq` (LGPL), R's `lowess` (clowess), noncentral
  t (`pnt`), `hclust` and the `dist` / `cor` row kernels (clustered heat maps), `pretty`
  (contour levels) and MASS's `cov.trob` (t ellipses). Replace them before any non-GPL
  distribution. Hexagonal binning (`stats/src/smoothing/hexbin.ts`) is a clean reimplementation
  from Carr et al. (1987), checked against the hexbin package's output only (audit 3, T1). The logicle scale
  (`stats/src/cytometry/transforms.ts`) is not among them: it follows Moore & Parks' reference
  implementation, under the Artistic License 2.0, not the GPL.
- Product name → file extension (placeholder: `.psproj`).
