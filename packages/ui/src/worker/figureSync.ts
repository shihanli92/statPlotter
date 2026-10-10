import {
  type AnalysisResult,
  type AssetId,
  assetRefs,
  type DataTable,
  type ImageAsset,
  type NodeId,
  type Project,
} from '@ps/model'

// The export worker's copy of the document (roadmap 42). Each request first brings the copy up to
// date with what changed since the last one, found by identity (the store and the engine share
// whatever didn't change): changed nodes, results and images, structured-cloned. A large table's
// per-row arrays go as columns of their own, each once while it stays in the document (an edit
// copies only the arrays it changes): numbers as a Float64Array and a null mask, transferred (a
// tenth of the cost of cloning them value by value), other arrays cloned. Columns are posted one
// message each, the main thread let go between them, so no step holds it for long.

/** Rows from which a table's per-row arrays are sent as columns. */
export const COLUMN_ROWS = 2048

/** A column: numbers (null where `nulls` is 1) or any other per-row array as it is. */
export type ColumnData =
  | { numbers: Float64Array; nulls: Uint8Array | null }
  | { values: readonly unknown[] }

/** Messages bringing the worker's copy up to date (a sync is columns, then the rest). */
export type SyncMessage =
  | { type: 'column'; id: number; data: ColumnData }
  | {
      type: 'sync'
      /** The project's own fields (`nodes` null), when one of them changed. */
      project: Record<string, unknown> | null
      /** Every node's id, in the document's order. */
      ids: string[]
      /** Nodes new or changed (tables' large arrays as column references). */
      nodes: [string, unknown][]
      /** Results new, changed or gone (null). */
      results: [string, unknown | null][]
      /** Images new to the worker. */
      assets: ImageAsset[]
      /** Images no longer placed. */
      dropAssets: string[]
      /** Columns no longer referenced. */
      dropColumns: number[]
    }

/** A column reference in a table sent to the worker. */
interface ColumnRef {
  $figureColumn: number
}

const isRef = (v: unknown): v is ColumnRef =>
  typeof v === 'object' && v !== null && '$figureColumn' in v

/** A numbers array as a Float64Array and a null mask; null when it holds anything else. */
function packNumbers(values: readonly unknown[]): ColumnData | null {
  const n = values.length
  const numbers = new Float64Array(n)
  let nulls: Uint8Array | null = null
  for (let i = 0; i < n; i++) {
    const v = values[i]
    if (typeof v === 'number') numbers[i] = v
    else if (v === null) {
      nulls ??= new Uint8Array(n)
      nulls[i] = 1
    } else return null
  }
  return { numbers, nulls }
}

function unpackColumn(data: ColumnData): readonly unknown[] {
  if ('values' in data) return data.values
  const { numbers, nulls } = data
  const out = new Array<number | null>(numbers.length)
  for (let i = 0; i < numbers.length; i++) out[i] = nulls?.[i] ? null : numbers[i]!
  return out
}

type Table = DataTable
type Sub = Table['dataSets'][number]['subcolumns'][number]

/**
 * A table with its per-row arrays mapped by `col` (`numbers`: an array of cells), every other
 * field and the fields' order kept.
 */
function mapColumns(t: Table, col: (a: readonly unknown[], numbers: boolean) => unknown): unknown {
  const sub = (c: Sub) => ({
    ...c,
    values: col(c.values, true),
    ...(c.excluded ? { excluded: col(c.excluded, false) } : {}),
    ...(c.limit ? { limit: col(c.limit, false) } : {}),
  })
  return {
    ...t,
    ...(t.rowTitles ? { rowTitles: col(t.rowTitles, false) } : {}),
    ...(t.rowTitlesRich ? { rowTitlesRich: col(t.rowTitlesRich, false) } : {}),
    ...(t.x ? { x: { ...t.x, subcolumns: t.x.subcolumns.map(sub) } } : {}),
    dataSets: t.dataSets.map((d) => ({
      ...d,
      subcolumns: d.subcolumns.map(sub),
      ...(d.text ? { text: col(d.text, false) } : {}),
    })),
  }
}

/** The inverse of `mapColumns` on what the worker receives: references back to arrays. */
function resolveColumns(t: Table, column: (id: number) => readonly unknown[]): Table {
  const col = (a: unknown) => (isRef(a) ? column(a.$figureColumn) : a)
  return mapColumns(t, col) as Table
}

const isLarge = (t: { rowCount?: unknown }) =>
  typeof t.rowCount === 'number' && t.rowCount >= COLUMN_ROWS

/** What a request reads: the document, the analyses' results, the images. */
export interface SyncSource {
  project: Project
  result?: (id: NodeId) => AnalysisResult | undefined
  asset?: (id: AssetId) => ImageAsset | undefined
}

/** The main thread's side: what the worker holds, and the messages bringing it up to date. */
export class SyncSender {
  private nodes = new Map<string, unknown>()
  private results = new Map<string, AnalysisResult>()
  private assets = new Set<string>()
  private rest: Record<string, unknown> | null = null
  private columnIds = new Map<readonly unknown[], number>()
  /** Columns each node ('n…') or result ('r…') refers to. */
  private uses = new Map<string, number[]>()
  private nextColumn = 1

  /**
   * Posts what changed since the last sync: columns first (each its own message, `pause` awaited
   * between them), then one `sync` message. Resolves once all is posted.
   */
  async sync(
    src: SyncSource,
    post: (msg: SyncMessage, transfer: Transferable[]) => void,
    pause: () => Promise<void> = async () => {},
  ): Promise<void> {
    const { project } = src
    // Columns are posted as they are found, between the steps; their ids stand in the tables.
    const encode = async (key: string, t: Table): Promise<unknown> => {
      if (!isLarge(t)) {
        this.uses.delete(key)
        return t
      }
      const used: number[] = []
      const arrays: { a: readonly unknown[]; numbers: boolean }[] = []
      mapColumns(t, (a, numbers) => {
        arrays.push({ a, numbers })
        return a
      })
      const ids = new Map<readonly unknown[], number>()
      for (const { a, numbers } of arrays) {
        let id = this.columnIds.get(a)
        if (id === undefined) {
          id = this.nextColumn++
          const packed = numbers ? packNumbers(a) : null
          const data: ColumnData = packed ?? { values: a }
          const transfer =
            'numbers' in data
              ? [data.numbers.buffer, ...(data.nulls ? [data.nulls.buffer] : [])]
              : []
          post({ type: 'column', id, data }, transfer as Transferable[])
          this.columnIds.set(a, id)
          await pause()
        }
        ids.set(a, id)
        used.push(id)
      }
      this.uses.set(key, used)
      return mapColumns(t, (a) => ({ $figureColumn: ids.get(a)! }) satisfies ColumnRef)
    }

    const { nodes: _, ...own } = project
    let rest: Record<string, unknown> | null = null
    const was = this.rest
    if (
      !was ||
      Object.keys(own).length !== Object.keys(was).length ||
      Object.entries(own).some(([k, v]) => was[k] !== v)
    ) {
      rest = { ...project, nodes: null }
      this.rest = own
    }

    const ids = Object.keys(project.nodes)
    const nodes: [string, unknown][] = []
    for (const id of ids) {
      const node = project.nodes[id as NodeId]!
      if (this.nodes.get(id) === node) continue
      this.nodes.set(id, node)
      nodes.push([id, node.kind === 'table' ? await encode(`n${id}`, node) : node])
    }
    for (const id of [...this.nodes.keys()])
      if (!Object.hasOwn(project.nodes, id)) {
        this.nodes.delete(id)
        this.uses.delete(`n${id}`)
      }

    const results: [string, unknown | null][] = []
    for (const id of ids) {
      const r = src.result?.(id as NodeId)
      if (this.results.get(id) === r) continue
      if (r) {
        this.results.set(id, r)
        results.push([id, r.table ? { ...r, table: await encode(`r${id}`, r.table) } : r])
      } else {
        this.results.delete(id)
        this.uses.delete(`r${id}`)
        results.push([id, null])
      }
    }
    for (const id of [...this.results.keys()])
      if (!Object.hasOwn(project.nodes, id)) {
        this.results.delete(id)
        this.uses.delete(`r${id}`)
        results.push([id, null])
      }

    const placed = assetRefs(project.nodes)
    const assets: ImageAsset[] = []
    for (const id of placed) {
      if (this.assets.has(id)) continue
      const a = src.asset?.(id)
      if (!a) continue
      this.assets.add(id)
      assets.push(a)
    }
    const dropAssets = [...this.assets].filter((id) => !placed.has(id as AssetId))
    for (const id of dropAssets) this.assets.delete(id)

    const live = new Set([...this.uses.values()].flat())
    const dropColumns: number[] = []
    for (const [a, id] of this.columnIds)
      if (!live.has(id)) {
        this.columnIds.delete(a)
        dropColumns.push(id)
      }

    post({ type: 'sync', project: rest, ids, nodes, results, assets, dropAssets, dropColumns }, [])
  }
}

/** The worker's side: the document as last synced, the columns it refers to. */
export class SyncReceiver {
  private columns = new Map<number, readonly unknown[]>()
  private nodes = new Map<string, unknown>()
  private results = new Map<string, AnalysisResult>()
  private assets = new Map<string, ImageAsset>()
  private rest: Record<string, unknown> | null = null
  private ids: string[] = []
  private current: Project | null = null

  /** Applies a message; true when the document (or its results or images) changed. */
  apply(msg: SyncMessage): boolean {
    if (msg.type === 'column') {
      this.columns.set(msg.id, unpackColumn(msg.data))
      return false
    }
    const column = (id: number) => {
      const c = this.columns.get(id)
      if (!c) throw new Error(`column ${id} was not sent`)
      return c
    }
    const table = (t: unknown) => {
      const tt = t as Table
      return isLarge(tt) ? resolveColumns(tt, column) : tt
    }
    if (msg.project) this.rest = msg.project
    for (const [id, node] of msg.nodes)
      this.nodes.set(id, (node as { kind?: string }).kind === 'table' ? table(node) : node)
    const keep = new Set(msg.ids)
    for (const id of [...this.nodes.keys()]) if (!keep.has(id)) this.nodes.delete(id)
    for (const [id, r] of msg.results) {
      if (r === null) this.results.delete(id)
      else {
        const res = r as AnalysisResult
        this.results.set(id, res.table ? { ...res, table: table(res.table) } : res)
      }
    }
    for (const a of msg.assets) this.assets.set(a.id, a)
    for (const id of msg.dropAssets) this.assets.delete(id)
    for (const id of msg.dropColumns) this.columns.delete(id)
    const changed =
      !!msg.project ||
      msg.nodes.length > 0 ||
      msg.results.length > 0 ||
      msg.assets.length > 0 ||
      msg.dropAssets.length > 0 ||
      msg.ids.length !== this.ids.length ||
      msg.ids.some((id, i) => this.ids[i] !== id)
    this.ids = msg.ids
    if (changed || !this.current) {
      if (!this.rest) throw new Error('no project was sent')
      const nodes: Record<string, unknown> = {}
      for (const id of msg.ids) nodes[id] = this.nodes.get(id)
      this.current = { ...this.rest, nodes } as unknown as Project
    }
    return changed
  }

  get project(): Project {
    if (!this.current) throw new Error('no project was sent')
    return this.current
  }

  result = (id: NodeId): AnalysisResult | undefined => this.results.get(id)
  asset = (id: AssetId): ImageAsset | undefined => this.assets.get(id)

  /** Columns held (tests). */
  get columnCount(): number {
    return this.columns.size
  }
}
