#!/usr/bin/env node
// Runs the end-to-end specs a change can affect (CLAUDE.md, Tests): the files changed since the
// merge base with main (or --base <ref>), plus uncommitted and untracked files, mapped to specs by
// the rules below. A change to shared code (the model, the engine, the app shell, the e2e setup,
// dependencies) or to a path no rule knows runs every spec. The full suite in all three browsers
// still runs once on main before a push; this is for checking a branch while it's built.
//
//   node tools/e2e-affected.mjs [--base <ref>] [--list] [-- <playwright args>]
//   node tools/e2e-affected.mjs --check   (every spec named exists; every spec has a rule)

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(import.meta.url), '..', '..')
const SPECS = join(ROOT, 'apps', 'e2e', 'tests')

const GRAPH = [
  'appearance',
  'axisExtras',
  // Roadmap 49a: aesthetics by data set or fixed (the Appearance table, recipes, cycles).
  'byGroup',
  'canvas',
  'cellsTables',
  'combinations',
  'densityPlots',
  // Roadmap 49c: dendrograms as layers (heat maps' trees, cuts, strips, a tree alone).
  'dendrogram',
  'examples',
  'export',
  'figureExport',
  // Roadmap 49d: fill and outline mapped separately (fill colours, a fill variable, dashes).
  'fillOutline',
  'format',
  // Decision 1212: the Format panel's Open in window, its pop-ups inside the modal dialog.
  'formatWindow',
  'graphBuilder',
  'graphTypes',
  'graphs',
  'groupOverlays',
  'largeTables',
  'layerOrder',
  // Roadmap 47: the list of layers' multi-select, Delete on layers and points, points formatted.
  'layerSelection',
  // Roadmap 49b: one layer at a time in the Format view, its ‹ › arrows and menu of layers.
  'layerSteps',
  'layouts',
  // Roadmap 47b: legend entries selected, moved, hidden and labelled; the legend's columns.
  'legendEditing',
  'mappedVariables',
  // Roadmap 46b: reference lines (identity lines, ± cut-offs, volcano thresholds).
  'referenceLines',
  'resultsOnGraphs',
  'splitGraphs',
  'styles',
  'userPresets',
  'visual',
]
const TABLE = [
  'cellsTables',
  'dataExport',
  'dataManipulation',
  'import',
  'importInterop',
  'largeTables',
  'mappedVariables',
  'splitGraphs',
  'tableEditing',
  'tables',
]
const ANALYSIS = [
  'analyses',
  'dataManipulation',
  'examples',
  'graphs',
  'groupOverlays',
  'resultsOnGraphs',
  'reuse',
]

/** Path prefixes (first match wins) → the specs they affect; 'all' runs every spec, [] none. */
const RULES = [
  // Shared by everything the specs drive.
  ['packages/model/', 'all'],
  ['packages/engine/', 'all'],
  // The web app's build checks (unit tests of its output).
  ['apps/web/test/', []],
  ['apps/web/', 'all'],
  ['apps/e2e/tests/fixtures.ts', 'all'],
  ['apps/e2e/tests/helpers-', 'all'],
  ['apps/e2e/fixtures/', 'all'],
  ['apps/e2e/playwright.config.ts', 'all'],
  ['apps/e2e/package.json', 'all'],
  ['package.json', 'all'],
  ['pnpm-lock.yaml', 'all'],
  ['pnpm-workspace.yaml', 'all'],
  ['packages/ui/src/App.tsx', 'all'],
  ['packages/ui/src/context.tsx', 'all'],
  // The keys the views handle themselves (the navigator, the canvas, a page) and the shortcut
  // sheet that lists them.
  [
    'packages/ui/src/commands/viewKeys.ts',
    [
      ...GRAPH,
      'selection',
      'layoutObjects',
      'projectOrganisation',
      'shell',
      'accessibility',
      'navigatorSelection',
    ],
  ],
  ['packages/ui/src/commands/', 'all'],
  ['packages/ui/src/components/', 'all'],
  ['packages/ui/src/index.ts', 'all'],
  ['packages/ui/src/services.ts', 'all'],
  ['packages/ui/src/styles.css', 'all'],
  ['packages/ui/src/util.ts', 'all'],
  // Roadmap 42: the figure export worker (exports, copies, prints of graphs and pages).
  [
    'packages/ui/src/worker/figure',
    [
      'export',
      'figureExport',
      'layouts',
      'layoutObjects',
      'largeTables',
      'canvas',
      'shell',
      // Roadmap 47: a finished export ticks the checklist's last step.
      'gettingStarted',
    ],
  ],
  ['packages/ui/src/worker/', 'all'],
  ['packages/ui/package.json', 'all'],
  // Statistics and analyses.
  // Roadmap 34g: densities, hexbins, dot plots and the cytometry transforms are stats too.
  // Roadmap 46b: a volcano plot's classes (thresholds) are stats too.
  // Roadmap 49c: a dendrogram's cut (R's cutree) is stats too.
  ['packages/stats/', [...ANALYSIS, 'densityPlots', 'referenceLines', 'dendrogram']],
  ['packages/analyses/', ANALYSIS],
  ['packages/ui/src/analysis/', [...ANALYSIS, 'accessibility']],
  ['packages/ui/src/resultTables.ts', [...ANALYSIS, 'dataExport']],
  ['packages/ui/src/reuse/', ['reuse', 'analyses']],
  ['packages/ui/src/linkedSheets.ts', [...TABLE, ...ANALYSIS]],
  // Files, import and export.
  ['packages/io/src/import/', ['import', 'importInterop', 'largeTables', 'tables', 'files']],
  ['packages/io/src/columns.ts', ['files', 'recovery', 'largeTables']],
  ['packages/io/src/export/', ['dataExport', 'export', 'figureExport']],
  // Audit 3 (T3): numbers typed into cells, pasted and imported.
  [
    'packages/io/src/numbers.ts',
    ['tableEditing', 'cellsTables', 'tables', 'import', 'importInterop', 'dataExport', 'files'],
  ],
  ['packages/io/src/clipboard.ts', ['tableEditing', 'tables', 'dataExport', 'export']],
  ['packages/io/src/projectFile.ts', ['files', 'recovery', 'layoutObjects', 'examples']],
  ['packages/io/src/zip.ts', ['files', 'recovery', 'layoutObjects']],
  ['packages/io/src/assets.ts', ['files', 'layoutObjects']],
  ['packages/io/src/', ['import', 'dataExport', 'files', 'tables']],
  ['packages/ui/src/export/', ['export', 'figureExport', 'dataExport']],
  ['packages/ui/src/ImportDialog.tsx', ['import', 'importInterop', 'cellsTables', 'accessibility']],
  // Roadmap 39: dropped files, the .pzfx import dialog, missing codes and detection limits.
  ['packages/ui/src/import/', ['import', 'importInterop', 'cellsTables']],
  ['packages/ui/src/drop/', ['importInterop', 'layoutObjects', 'import', 'files']],
  ['packages/ui/src/LargeImportDialog.tsx', ['largeTables', 'import', 'cellsTables']],
  ['packages/ui/src/recovery.ts', ['recovery']],
  ['packages/ui/src/RecoveryDialog.tsx', ['recovery']],
  ['packages/ui/src/MigrationNotice.tsx', ['files', 'examples']],
  ['packages/ui/src/recent.ts', ['files', 'shell']],
  // Roadmap 43: the toolbar's split buttons offer the last graph types and analyses.
  ['packages/ui/src/recentChoices.ts', ['toolbar', 'shell']],
  // Graphs and layouts.
  [
    'packages/graph/src/render/',
    ['export', 'figureExport', 'visual', 'canvas', 'layouts', 'largeTables'],
  ],
  // Audit 3 (T3): every spec that draws a graph or edits one through the canvas, the Format
  // panel, the format bar or a page also runs on a change to how graphs are laid out and drawn.
  [
    'packages/graph/',
    [
      ...GRAPH,
      'selection',
      'formatPanel',
      'formatBar',
      'richText',
      'fontControls',
      'layoutObjects',
      'accessibility',
      'darkMode',
      'toolbar',
      'navigatorSelection',
      'gettingStarted',
    ],
  ],
  // Roadmap 46: the Format panel and dialog (graph view and pages), and every spec opening them.
  [
    'packages/ui/src/graph/format/',
    [
      ...GRAPH,
      'formatPanel',
      'selection',
      'accessibility',
      'darkMode',
      'toolbar',
      'formatBar',
      'fontControls',
      'layoutObjects',
      'richText',
      'tableEditing',
    ],
  ],
  [
    'packages/ui/src/graph/',
    [
      ...GRAPH,
      'selection',
      'accessibility',
      'darkMode',
      'toolbar',
      'formatBar',
      'formatPanel',
      // Roadmap 47: Match format and batch export of the sheets selected in the navigator.
      'navigatorSelection',
    ],
  ],
  // Roadmap 44: one selection model (the graph canvas now; pages in stage 2).
  [
    'packages/ui/src/selection/',
    [
      ...GRAPH,
      'selection',
      'accessibility',
      'darkMode',
      'toolbar',
      'layoutObjects',
      'formatBar',
      'formatPanel',
    ],
  ],
  [
    'packages/ui/src/layout/',
    [
      'layouts',
      'layoutObjects',
      'layerSelection',
      'figureExport',
      'examples',
      'canvas',
      'splitGraphs',
      'toolbar',
      'formatBar',
      'formatPanel',
      'legendEditing',
    ],
  ],
  // Roadmap 37: styles, Fit to column and Preferences.
  [
    'packages/ui/src/styles/',
    [
      'styles',
      'format',
      'layouts',
      'export',
      'figureExport',
      'accessibility',
      'darkMode',
      'navigatorSelection',
    ],
  ],
  // Roadmap 41: the app's colours, updates (in Preferences).
  ['packages/ui/src/theme/', ['darkMode', 'accessibility']],
  ['packages/ui/src/updates/', ['darkMode', 'styles']],
  [
    'packages/ui/src/richText/',
    ['richText', 'fontControls', 'format', 'formatWindow', 'layoutObjects', 'formatBar'],
  ],
  // Roadmap 45: the format bar (graph view and pages), the format painter.
  [
    'packages/ui/src/formatBar/',
    [
      'formatBar',
      'layerSelection',
      // Roadmap 47: the bar's groups folding into More ▾.
      'gettingStarted',
      'referenceLines',
      'formatPanel',
      'selection',
      'format',
      'formatWindow',
      'fontControls',
      'richText',
      'layoutObjects',
      'toolbar',
      'accessibility',
      'darkMode',
      'canvas',
      'layouts',
      'legendEditing',
    ],
  ],
  // Tables and the navigator.
  ['packages/ui/src/table/', [...TABLE, 'accessibility']],
  ['packages/ui/src/NewTableDialog.tsx', ['tables', 'shell']],
  ['packages/ui/src/samples.ts', ['tables', 'shell', 'examples']],
  [
    'packages/ui/src/Navigator.tsx',
    [
      'shell',
      'tables',
      'layouts',
      'reuse',
      'projectOrganisation',
      'accessibility',
      'toolbar',
      // Roadmap 47: several sheets selected, and what is done to them at once.
      'navigatorSelection',
    ],
  ],
  // Roadmap 40: folders, the Family view, search, thumbnails, info sheets, Gallery, merging.
  [
    'packages/ui/src/organise/',
    ['projectOrganisation', 'shell', 'styles', 'dataExport', 'navigatorSelection'],
  ],
  ['packages/ui/src/examples/', ['examples', 'shell', 'largeTables', 'gettingStarted']],
  // Roadmap 47: the getting-started checklist at the bottom of the navigator.
  [
    'packages/ui/src/onboarding/',
    ['gettingStarted', 'shell', 'tables', 'accessibility', 'darkMode', 'projectOrganisation'],
  ],
  ['packages/ui/src/paperExample.ts', ['examples']],
  // Any other UI source (a new file no rule knows yet).
  ['packages/ui/src/', 'all'],
  // Nothing the specs drive: docs, R / NIST fixtures, the desktop shell, tooling.
  ['docs/', []],
  ['tools/', []],
  ['apps/desktop/', []],
  ['.github/', []],
  ['.claude/', []],
]

const NO_SPECS =
  /\.(md|txt)$|^(CLAUDE\.md|README\.md|LICENSE|NOTICE|biome\.json|tsconfig[^/]*\.json)$/

function specFor(path) {
  const own = path.match(/^apps\/e2e\/tests\/([^/]+)\.spec\.ts$/)
  if (own) return { specs: [own[1]], why: 'the spec itself' }
  if (NO_SPECS.test(path)) return { specs: [], why: 'no spec' }
  // A package's own tests never need a spec; its sources are matched by the rules.
  if (/^packages\/[^/]+\/test\//.test(path)) return { specs: [], why: 'unit tests' }
  for (const [prefix, specs] of RULES) {
    if (path === prefix || path.startsWith(prefix)) return { specs, why: prefix }
  }
  return { specs: 'all', why: 'no rule' }
}

const allSpecs = () =>
  readdirSync(SPECS)
    .filter((f) => f.endsWith('.spec.ts'))
    .map((f) => f.slice(0, -'.spec.ts'.length))
    .sort()

/** The specs `paths` affect: a sorted list, or 'all'. */
export function affectedSpecs(paths) {
  const picked = new Set()
  const reasons = []
  for (const path of paths) {
    const { specs, why } = specFor(path)
    if (specs === 'all') return { specs: 'all', reasons: [`${path} (${why})`] }
    for (const s of specs) picked.add(s)
    if (specs.length) reasons.push(`${path} → ${specs.join(', ')}`)
  }
  return { specs: [...picked].sort(), reasons }
}

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

function changedPaths(base) {
  const mergeBase = git('merge-base', base, 'HEAD')[0]
  return [
    ...new Set([
      ...git('diff', '--name-only', `${mergeBase}...HEAD`),
      ...git('diff', '--name-only', 'HEAD'),
      ...git('ls-files', '--others', '--exclude-standard'),
    ]),
  ].sort()
}

function check() {
  const existing = new Set(allSpecs())
  const named = new Set(RULES.flatMap(([, s]) => (Array.isArray(s) ? s : [])))
  const errors = [
    ...[...named].filter((s) => !existing.has(s)).map((s) => `rule names a missing spec: ${s}`),
    ...[...existing]
      .filter((s) => !named.has(s))
      .map((s) => `apps/e2e/tests/${s}.spec.ts: no rule in tools/e2e-affected.mjs runs it`),
  ]
  for (const e of errors) console.error(e)
  if (errors.length) process.exit(1)
  console.log(`e2e map: ${existing.size} specs, all mapped`)
}

function main(argv) {
  if (argv.includes('--check')) return check()
  const dash = argv.indexOf('--')
  const own = dash === -1 ? argv : argv.slice(0, dash)
  const passThrough = dash === -1 ? [] : argv.slice(dash + 1)
  const b = own.indexOf('--base')
  const base = b === -1 ? 'main' : own[b + 1]
  const { specs, reasons } = affectedSpecs(changedPaths(base))
  for (const r of reasons) console.log(`  ${r}`)
  const files = specs === 'all' ? [] : specs.map((s) => `tests/${s}.spec.ts`)
  if (specs !== 'all' && files.length === 0) {
    console.log(`No end-to-end spec is affected by the changes since ${base}.`)
    return
  }
  console.log(
    specs === 'all' ? 'Running every spec.' : `Running ${files.length} specs: ${specs.join(', ')}`,
  )
  if (own.includes('--list')) return
  const run = spawnSync(
    'pnpm',
    ['--filter', '@ps/e2e', 'exec', 'playwright', 'test', ...files, ...passThrough],
    { cwd: ROOT, stdio: 'inherit' },
  )
  process.exit(run.status ?? 1)
}

if (existsSync(SPECS) && process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
}
