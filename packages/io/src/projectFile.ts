// The header reader alone: the whole graph package would weigh down the serializing worker.
import { imageInfo } from '@ps/graph/image'
import {
  AnalysisResult,
  APP_VERSION,
  ASSET_ID_PATTERN,
  type AssetId,
  assetRefs,
  type DocNode,
  ID_PATTERN,
  type ImageAsset,
  type MigrationNote,
  type NodeId,
  nodeById,
  type Project,
  parseProject,
  UnsupportedVersionError,
} from '@ps/model'
import { strFromU8, strToU8, type Zippable, zipSync } from 'fflate'
import { assetExtension, MAX_ASSET_BYTES, MAX_ASSETS_BYTES } from './assets.ts'
import {
  BINARY_TABLE_CELLS,
  ColumnFormatError,
  type PackedTables,
  packTable,
  tableCells,
  unpackTable,
} from './columns.ts'
import { MAX_ENTRY_BYTES, unzipLimited, ZipTooLargeError } from './zip.ts'

/**
 * Largest project file accepted, decompressed: large tables' columns (roadmap 34e) take a
 * table of a million rows of 60 variables to about 500 MB.
 */
export const MAX_PROJECT_BYTES = 2 * 2 ** 30

export const PROJECT_EXTENSION = 'psproj'
export const PROJECT_FORMAT = 'plotting-software-project'
/**
 * Project templates (roadmap 31): the same format with `template: true` in the manifest, the
 * tables without values and no results or view; opened as a new untitled project.
 */
export const TEMPLATE_EXTENSION = 'pstemplate'

export interface ResultCacheEntry {
  inputKey: string
  result: AnalysisResult
}

export interface ProjectFileContents {
  project: Project
  /** Cached analysis results; valid only where the input key still matches. */
  results: Map<NodeId, ResultCacheEntry>
  /** Opaque UI state (open tabs, selection…). */
  view: unknown
  /** A template (opened as a new, untitled project). */
  template: boolean
  /** Images placed on layout pages, by id (roadmap 32). */
  assets: Map<AssetId, ImageAsset>
  /**
   * What updating a file of an older format changed or left out (roadmap 33b: graphs drawn
   * differently, settings the old version ignored), to tell the user once; empty for a file of
   * the current format.
   */
  notes: MigrationNote[]
}

export class ProjectFileError extends Error {}

const FOLDERS: Record<DocNode['kind'], string> = {
  table: 'tables',
  analysis: 'analyses',
  graph: 'graphs',
  layout: 'layouts',
  info: 'info',
}

// Results may contain NaN/±Infinity, which JSON can't represent: they are written as tagged
// objects ({"$n": "NaN"}), so a genuine string "NaN" in a result stays a string. (Older files
// wrote bare "NaN" strings; those caches no longer validate and are simply recomputed.)
const NON_FINITE_TAG = '$n'
const encodeNonFinite = (_key: string, v: unknown) => {
  if (typeof v !== 'number' || Number.isFinite(v)) return v
  return { [NON_FINITE_TAG]: Number.isNaN(v) ? 'NaN' : v > 0 ? 'Inf' : '-Inf' }
}
const NON_FINITE: Record<string, number> = {
  NaN: Number.NaN,
  Inf: Number.POSITIVE_INFINITY,
  '-Inf': Number.NEGATIVE_INFINITY,
}
const decodeNonFinite = (_key: string, v: unknown) => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return v
  const keys = Object.keys(v)
  if (keys.length !== 1 || keys[0] !== NON_FINITE_TAG) return v
  const tag = (v as Record<string, unknown>)[NON_FINITE_TAG]
  return typeof tag === 'string' && Object.hasOwn(NON_FINITE, tag) ? NON_FINITE[tag] : v
}

const json = (v: unknown, replacer?: (k: string, v: unknown) => unknown) =>
  strToU8(`${JSON.stringify(v, replacer as never, 1)}\n`)

/**
 * The cached results a project file keeps: those of the project's analyses, but a result table of
 * more than `BINARY_TABLE_CELLS` cells (roadmap 38: a filter of a million rows is derived,
 * recomputed on opening, decision 556). Callers sending results to a worker to write the file
 * take these first (audit 2, P14), so large results are not copied there to be dropped.
 */
export function resultsForFile(
  project: Pick<Project, 'nodes'>,
  results: ReadonlyMap<NodeId, ResultCacheEntry> | undefined,
): Map<NodeId, ResultCacheEntry> {
  const out = new Map<NodeId, ResultCacheEntry>()
  for (const [id, entry] of results ?? []) {
    const table = entry.result.table
    if (table && tableCells(table) > BINARY_TABLE_CELLS) continue
    if (nodeById(project.nodes, id)?.kind === 'analysis') out.set(id, entry)
  }
  return out
}

/**
 * The project as a file: the manifest, a JSON file per node, cached results, the view and the
 * images its pages place (`assets/<id>.png|jpg`, stored uncompressed: they are compressed
 * already). Only assets the document refers to are written, so images no longer placed anywhere
 * are dropped on save; a referenced asset missing from `assets` is left out (its items show a
 * placeholder).
 */
export function writeProjectFile(
  project: Project,
  options: {
    results?: Map<NodeId, ResultCacheEntry>
    view?: unknown
    now?: Date
    /** Marks the file as a template (the caller clears its tables: `templateOf`). */
    template?: boolean
    assets?: ReadonlyMap<string, ImageAsset>
    /**
     * Large tables already packed (`packProject`, e.g. on the main thread before a worker
     * zips them); others are packed here.
     */
    packed?: PackedTables
  } = {},
): Uint8Array {
  const now = options.now ?? new Date()
  const modified = now.toISOString()
  const files: Zippable = {
    'manifest.json': json({
      format: PROJECT_FORMAT,
      ...(options.template ? { template: true } : {}),
      schemaVersion: project.schemaVersion,
      appVersion: APP_VERSION,
      meta: { ...project.meta, modified, appVersion: APP_VERSION },
      settings: project.settings,
      order: project.order,
      // Roadmap 40: the navigator's folders, when there are any.
      ...(project.folders ? { folders: project.folders } : {}),
    }),
  }
  for (const node of Object.values(project.nodes)) {
    // A large table's columns go in binary entries beside its JSON (roadmap 34e); they barely
    // compress (number mantissas), so they are deflated lightly.
    const packed = node.kind === 'table' ? (options.packed?.get(node.id) ?? packTable(node)) : null
    files[`${FOLDERS[node.kind]}/${node.id}.json`] = json(packed ? packed.json : node)
    if (packed)
      for (const [name, bytes] of packed.columns)
        files[`tables/${node.id}/${name}.col`] = [bytes, { level: 1 }]
  }
  for (const [id, entry] of resultsForFile(project, options.results))
    files[`results/${id}.json`] = json(entry, encodeNonFinite)
  if (options.view !== undefined) files['view.json'] = json(options.view)
  for (const id of [...assetRefs(project.nodes)].sort()) {
    const a = options.assets?.get(id)
    if (a) files[`assets/${id}.${assetExtension(a.mime)}`] = [a.bytes, { level: 0 }]
  }
  // Entries carry the save's time (not the clock at each entry), so a save is reproducible.
  return zipSync(files, { level: 6, mtime: now })
}

export function readProjectFile(bytes: Uint8Array): ProjectFileContents {
  let entries: Record<string, Uint8Array>
  let assetBytes = 0
  try {
    entries = unzipLimited(bytes, () => true, {
      entry: MAX_ENTRY_BYTES,
      total: MAX_PROJECT_BYTES,
      entryFor: (name) => {
        if (!name.startsWith('assets/')) return undefined
        return MAX_ASSET_BYTES
      },
    })
    for (const [name, b] of Object.entries(entries))
      if (name.startsWith('assets/')) assetBytes += b.length
  } catch (e) {
    if (e instanceof ZipTooLargeError) {
      throw new ProjectFileError(`This project file is too large to open: ${e.message}`)
    }
    throw new ProjectFileError('Not a project file (the file is not a valid archive).')
  }
  const has = (name: string) => Object.hasOwn(entries, name)

  const text = (name: string) => strFromU8(entries[name]!)
  const parse = (name: string, reviver?: (k: string, v: unknown) => unknown): unknown => {
    try {
      return JSON.parse(text(name), reviver as never)
    } catch {
      throw new ProjectFileError(`Corrupt project file: ${name} is not valid JSON.`)
    }
  }

  if (!has('manifest.json')) throw new ProjectFileError('Not a project file (no manifest).')
  if (assetBytes > MAX_ASSETS_BYTES)
    throw new ProjectFileError(
      `This project file is too large to open: its images take more than ${MAX_ASSETS_BYTES / 2 ** 20} MB.`,
    )
  const manifest = parse('manifest.json') as Record<string, unknown> | null
  if (typeof manifest !== 'object' || manifest === null || manifest.format !== PROJECT_FORMAT) {
    throw new ProjectFileError('Not a project file.')
  }

  const nodeFolders = new Set(Object.values(FOLDERS))
  // Null prototype: a node file named `constructor.json` is an ordinary key, not an alias of
  // Object.prototype's member.
  const nodes: Record<string, unknown> = Object.create(null)
  const results = new Map<NodeId, ResultCacheEntry>()
  for (const name of Object.keys(entries)) {
    const [folder, file, ...rest] = name.split('/')
    if (!file || rest.length || !file.endsWith('.json')) continue
    const id = file.slice(0, -'.json'.length)
    if (folder && nodeFolders.has(folder)) {
      // Validation would silently skip a `__proto__` key, so check file names up front.
      if (!ID_PATTERN.test(id))
        throw new ProjectFileError(`Invalid project file: bad node file ${name}.`)
      const raw = parse(name)
      try {
        // A large table's columns from its binary entries (roadmap 34e).
        nodes[id] =
          folder === 'tables'
            ? unpackTable(raw, (n) =>
                Object.hasOwn(entries, `tables/${id}/${n}.col`)
                  ? entries[`tables/${id}/${n}.col`]
                  : undefined,
              )
            : raw
      } catch (e) {
        if (e instanceof ColumnFormatError)
          throw new ProjectFileError(`Corrupt project file: ${name}: ${e.message}.`)
        throw e
      }
    } else if (folder === 'results' && ID_PATTERN.test(id)) {
      // A cache: anything unreadable is simply recomputed.
      let raw: { inputKey?: unknown; result?: unknown } | null
      try {
        raw = parse(name, decodeNonFinite) as typeof raw
      } catch {
        continue
      }
      if (typeof raw !== 'object' || raw === null) continue
      const result = AnalysisResult.safeParse(raw.result)
      if (typeof raw.inputKey === 'string' && result.success) {
        results.set(id as NodeId, { inputKey: raw.inputKey, result: result.data })
      }
    }
  }

  // Migrate + validate the assembled document; throws a readable error on failure.
  let project: Project
  const notes: MigrationNote[] = []
  try {
    project = parseProject(
      {
        schemaVersion: manifest.schemaVersion,
        meta: manifest.meta,
        settings: manifest.settings,
        order: manifest.order,
        ...(manifest.folders !== undefined ? { folders: manifest.folders } : {}),
        nodes,
      },
      notes,
    )
  } catch (e) {
    if (e instanceof UnsupportedVersionError) throw new ProjectFileError(e.message)
    const issues = (e as { issues?: { path: PropertyKey[]; message: string }[] }).issues
    const detail = issues
      ?.slice(0, 3)
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ')
    throw new ProjectFileError(`Invalid project file${detail ? `: ${detail}` : '.'}`)
  }

  for (const id of results.keys()) {
    if (nodeById(project.nodes, id)?.kind !== 'analysis') results.delete(id)
  }

  return {
    project,
    results,
    view: has('view.json') ? parse('view.json') : undefined,
    template: manifest.template === true,
    assets: readAssets(entries, assetRefs(project.nodes)),
    notes,
  }
}

/**
 * The images in a project file that its pages place: `assets/<id>.<png|jpg>` entries whose bytes
 * are the image their extension says. Unreferenced or unreadable ones are skipped (an item whose
 * image is missing shows a placeholder).
 */
function readAssets(
  entries: Record<string, Uint8Array>,
  wanted: ReadonlySet<AssetId>,
): Map<AssetId, ImageAsset> {
  const out = new Map<AssetId, ImageAsset>()
  for (const [name, bytes] of Object.entries(entries)) {
    const m = /^assets\/([^/]+)\.(png|jpg)$/.exec(name)
    if (!m || !ASSET_ID_PATTERN.test(m[1]!) || !wanted.has(m[1] as AssetId)) continue
    try {
      const info = imageInfo(bytes)
      if (assetExtension(info.mime) !== m[2]) continue
      const id = m[1] as AssetId
      out.set(id, { id, mime: info.mime, width: info.width, height: info.height, bytes })
    } catch {}
  }
  return out
}
