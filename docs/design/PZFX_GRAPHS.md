# Prism graphs in .pzfx files (roadmap 39)

What the binary section of a Prism XML project holds, as far as a time-boxed reading found it,
and what the importer takes from it. Decisions 570–573 (DECISIONS.md (not in the public repository)); the code is
`packages/io/src/import/pcff.ts` (records), `pzfxGraphs.ts` (fields) and `pzfxGraphMap.ts`
(native graphs).

This is not a published format. Everything here was inferred from Prism-made files: the 23 files
of the pzfx R package in `packages/io/test/fixtures/pzfx/` (Prism 7–8, one table and one graph
each, MIT licensed) and two of the user's own Prism 9.2 projects (several XY and grouped tables
with a graph each and a layout), read in place and never copied: no value, title or name of
theirs appears in the repository.

## 1. Where it is

`<GraphPadPrismFile>` ends with `<Template dt:dt="bin.base64">`: base64 of zlib data (a 2-byte
zlib header, deflate, Adler-32). Inflated, it starts with the 8 ASCII bytes `PCFFGRA4` and holds
the whole project as Prism keeps it: tables (again, without values), analyses, graphs, layouts,
info sheets, the colour schemes and an Apple print-settings plist (macOS files).

## 2. Records

After the magic the block is a sequence of records:

| Bytes | Field |
|---|---|
| 2 | tag, u16 little-endian |
| 4 | payload length n, u32 little-endian (absent for end markers) |
| n | payload |

- Tag bit 15 (`0x8000`) opens a container: the records that follow are its children until the
  end marker, the same tag with bit 14 set instead (`0x8012` … `0x4012`, no length).
- The low 14 bits name the record. The same name means the same thing at any depth.
- The block ends with the root container's end marker; one container (a final `0x8003`) is
  closed only by it. The reader closes whatever is open at the end and ignores an end marker
  that matches nothing.

Confidence: **high**. Every record of every file read (25 files, 35–215 KB inflated) parses to
the last two bytes with lengths that land exactly on the next tag.

## 3. The project

The root is container `0x0001`. Its children, in order:

| Name | What | Confidence |
|---|---|---|
| `0x00a1` | document header | — |
| `0x0002` | project settings (fonts, print setup with the plist) | — |
| `0x0039`, `0x00e1` | analyses (only in a file with one) | low |
| `0x0008` | a **table**, one per table, data and results alike, in creation order | high |
| `0x0012` | a **graph**, one per graph | high |
| `0x0035` | a layout | medium (one per layout in the two files that have one) |
| `0x0038` | an info sheet | high |
| `0x0003` | trailing settings | — |

Every named object has a `0x0009` child: its name, a NUL-terminated byte string (the ASCII
names read identically as UTF-8 and Windows-1252; no file had other characters, so their
encoding is **unverified**: the reader tries UTF-8, then Windows-1252).

### Tables (`0x0008`)

Payload: u16 table index. Children: `0x0009` name; `0x000f` one per column, in table order:
first the row-title column (empty name), then X when the table has one, then the Y columns. A
column's payload starts with its **u32 column id**, unique and consecutive across the whole
project (table 0 has ids 0…4, table 1 continues at 5). Confidence: **high** (every file).

Analyses' result tables are tables here too (the survival fixture has the data table and four
result tables) but not in the XML, so binary tables are paired with the XML's by name and by
their last columns' titles (`pairTables`); one left unpaired is a result table.

### Graphs (`0x0012`)

Payload: u16 graph index. Children, those read:

| Record | Field | Read as | Confidence |
|---|---|---|---|
| `0x0009` | the graph's name | the graph's name | high |
| `0x0013` | u16 at 14: **family** | 0 = XY (numeric X: XY tables, survival); 1 and 5 = X as categories (column, grouped; also XY tables drawn as grouped graphs) | medium: 0 seen only with numeric X axes, 1/5 only with category axes (axis ranges 1…k, k = categories) |
| `0x0013` | u16 at 32: id of the **title** text | the graph title | high (in every graph, it names the text holding the graph's title, also when that isn't text 0) |
| `0x0014` | u32 count, u32 table indices | the tables the graph draws | high (agrees with the data sets' columns everywhere) |
| `0x0015` | u32 count, u32 data set ids | **data set order** | medium (always the plot records' ids; in XY files the plot records come in reverse) |
| `0x0017` ×3 | axes X, Y, right Y: f64 at 0 and 8 the data's range, f64 at 16 and 24 the **axis range**, u16 at 48 the id of its **title** text (0xffff: none) | axis ranges and titles | high for the order and the title link (Prism's default titles "XTitle", "YTitle", "Y1Title" sit where expected); high for the range of numeric axes (round numbers around the data's range, the same 0…4000 on graphs of different data where the user set it); category axes hold positions 1…k |
| `0x0020` (inside `0x0018`) | graph objects: u16 at 0 kind (2 text, 8 axis, 9 data set, 10 frame, 12 legend entry, 14 …), u16 at 28 **flags** | bit `0x0200` (with `0x0002`) = **hidden** | medium-high: set on every unused right-axis title and on titles a user evidently removed, never on a drawn one |
| `0x002b` (in a text object) | u16 at 0 text id; child `0x002c` the **text** | titles | high |
| `0x0028` (in a data set object) | u16 at 0 data set id, u16 at 4 **column id**, u16 at 60 **symbol**, six RGBA **colours** at 68 | data set → table column; symbol; colours | column: high (ids line up with the table's columns in every graph); symbol: medium, see below; colours: medium |

**Symbols.** Codes 5, 1, 2 are what every file has for data sets A, B, C, which Prism draws by
default as a filled circle, square and up-triangle; they are read as `circle`, `square`,
`triangle`. Other codes seen (14, 15: on survival and line graphs) and every code not seen are
not mapped: those data sets keep this app's default symbol.

**Colours.** Six slots, each R, G, B and a byte that is `0xff` for "none". When a user colours a
data set, all six are that colour; Prism's black-and-white defaults have a black border (slot 0)
and a grey fill (slot 1: `#a0a0a4`, `#808080`). Read as: the one colour when they agree, else
the fill, else slot 0. Which slot is the bar fill, error bar or line is not known.

## 4. What is not decoded

- **The kind of graph** (bars, points, lines, scatter with mean, box…), stacking and spacing:
  several fields differ between graphs of different kinds (`0x0013` u16 at 16–22, `0x0028`
  u16 at 2–14, `0x009c`), but with no file showing the same table drawn two ways, which is which
  can't be told. Every imported graph uses its table's default preset.
- **Error bars** (SD, SEM, CI, direction): not found.
- **Log scales**: none of the files has one, so the flag isn't known. Ranges are applied to a
  linear axis and the report says the scale wasn't read.
- Fonts, sizes, tick intervals and formats (`0x0025`, three per axis), the legend, frame and
  axis offsets, rich text runs of titles (`0x002d`, `0x002e`), annotations and brackets.
- Layouts (`0x0035`) and analyses.

## 5. What the importer does

`readPzfx(xml, { graphs: true })` returns the tables exactly as before plus `graphs`
(`PzfxGraphImport`): per Prism graph, a native graph and a report line.

- A graph whose data sets are all columns of one imported table: that table's default graph
  (`createGraphFor`), then its name, the data sets in Prism's order (`seriesSource.include` when
  not all, or not in table order), the graph title and axis titles (null when hidden in Prism),
  the Y range, the X range when both Prism's and this graph's X are numeric, the colours
  (`seriesOverrides[key].color`) and the symbols (`layers[points].series[key].style.shape`). The
  result is validated (`GraphNode`); a graph that doesn't validate is the default graph.
- A graph of an analysis's results or of several tables: not imported (reported).
- Prism drew an XY table's X values as categories: the graph keeps a numeric X (the report says
  so).
- The block missing or unreadable: the table kind's default graph for every imported table, and
  the reason.

The import dialog's "Import graphs" is ticked when at least one graph decoded; unticked, the
import is what it was before roadmap 39 (a default graph per table). The report lists every
Prism graph: decoded (with what was matched and what is the default), default or skipped.

## 6. Verifying and extending

- `pnpm vitest run packages/io/test/pzfxGraphs.test.ts`: the record reader and decoder on
  synthetic blocks written by the test, and the Prism-made fixtures.
- To map another field, save the same Prism graph twice with one setting changed (a log Y axis,
  SEM error bars, bars instead of points), inflate both templates (base64 → zlib) and compare the
  records named above field by field. A field is mapped only when one change moves it and
  nothing else does.
- The user's two files: 9 graphs, all decoded (data sets, titles, Y ranges, colours; symbols on
  7), 2 layouts not imported.
