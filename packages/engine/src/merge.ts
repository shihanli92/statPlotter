import {
  type AssetId,
  type DocNode,
  effectiveStyle,
  type FolderId,
  INFO_PREFIX,
  infoReads,
  infoSheets,
  type NodeId,
  newFolderId,
  newNodeId,
  nodeById,
  nodeDependencies,
  type Project,
  projectStyleOf,
  renameInfoInFormula,
  sameInfoName,
  uniqueName,
} from '@ps/model'
import { type Command, copyData } from './commands.ts'
import { familyOf } from './family.ts'
import { analysisSourceIn, type Remap, remapNode } from './remap.ts'

// File › Import from project… (roadmap 40, decisions 600–602): sheets of another project added
// to this one with new ids, every reference remapped by the reuse machinery (`remapNode`, which
// walks graphs through `mapGraphRefs`), names made unique, styles, images, info sheets and
// folders brought along — one undo step.

export interface MergeOptions {
  /** The sheets picked in the other project. */
  picked: readonly NodeId[]
  /** A picked data table brings its family: analyses, results and graphs (default on). */
  withFamily?: boolean
  newId?: () => NodeId
  newFolder?: () => FolderId
}

/**
 * What importing `picked` from `source` brings, in the source's order: the picked sheets, the
 * families of picked tables (with `withFamily`), the graphs picked layouts place, and everything
 * those need (a graph's table, the analyses whose curves and brackets it shows, an analysis'
 * input, the info sheets a table's formulas read), so no reference is left pointing outside.
 */
export function mergeSelection(
  source: Project,
  picked: readonly NodeId[],
  withFamily = true,
): NodeId[] {
  const set = new Set<NodeId>()
  const add = (id: NodeId) => {
    if (set.has(id)) return
    const n = nodeById(source.nodes, id)
    if (!n) return
    set.add(id)
    if (n.kind === 'layout')
      for (const it of n.items) {
        if (it.type === 'graph') add(it.graph)
        else if (it.type === 'table') add(it.source.node)
      }
    // Audit 2 (M5): the info sheets its formulas read.
    if (n.kind === 'table')
      for (const r of infoReads(n, infoSheets(source))) if (r.sheet) add(r.sheet.id)
    for (const dep of nodeDependencies(n)) add(dep)
  }
  for (const id of picked) {
    add(id)
    const n = nodeById(source.nodes, id)
    if (withFamily && n?.kind === 'table') for (const m of familyOf(source, id, 'none')) add(m)
  }
  return source.order.filter((id) => set.has(id))
}

export interface MergePlan {
  commands: Command[]
  /** Source id → the new id of its copy. */
  ids: Map<NodeId, NodeId>
  /** New ids, in the order added. */
  created: NodeId[]
  /** Sheets renamed because their name was taken. */
  renamed: { from: string; to: string }[]
  /** Images the imported pages place (to add to the asset store first). */
  assets: AssetId[]
  /**
   * Audit 2 (M5): what the user should know: formulas reading `[Info: label]` from an imported
   * info sheet where this project has a field so labelled too now name the imported sheet.
   */
  warnings: string[]
}

/**
 * The commands importing sheets of `source` into `target` (dispatch them as one undo step):
 * every sheet of `mergeSelection` with a new id, references remapped (tables, analyses, graphs,
 * pages, shared axes and split sets with new link ids), a name taken by a sheet of the same kind
 * given " (2)"… (formulas naming a renamed info sheet follow), graphs keeping the source
 * project's style as their own where it differs from this project's, and the source's folders
 * holding them recreated.
 */
export function mergePlan(target: Project, source: Project, opts: MergeOptions): MergePlan {
  const newId = opts.newId ?? newNodeId
  const newFolder = opts.newFolder ?? newFolderId
  const members = mergeSelection(source, opts.picked, opts.withFamily ?? true)
  const ids = new Map<NodeId, NodeId>()
  for (const id of members) {
    let fresh = newId()
    while (nodeById(target.nodes, fresh) || [...ids.values()].includes(fresh)) fresh = newId()
    ids.set(id, fresh)
  }
  const remap: Remap = {
    nodes: ids,
    keys: new Map(),
    links: new Map(),
    newLink: () => newNodeId(),
    analysisSource: analysisSourceIn(source),
  }

  // Names: unique among this project's sheets of the same kind.
  const taken = new Map<string, string[]>()
  for (const n of Object.values(target.nodes))
    taken.set(n.kind, [...(taken.get(n.kind) ?? []), n.name])
  const renamed: MergePlan['renamed'] = []
  const infoRenames = new Map<string, string>()

  const sourceStyle = projectStyleOf(source.settings)
  const sameStyle =
    JSON.stringify(sourceStyle ?? null) === JSON.stringify(projectStyleOf(target.settings) ?? null)

  const copies: DocNode[] = members.map((id) => {
    const original = nodeById(source.nodes, id)!
    const node: DocNode = { ...remapNode(original, remap), id: ids.get(id)! }
    const names = taken.get(node.kind) ?? []
    const name = uniqueName(node.name, names)
    if (name !== node.name) {
      renamed.push({ from: node.name, to: name })
      if (node.kind === 'info') infoRenames.set(node.name, name)
      node.name = name
    }
    taken.set(node.kind, [...names, name])
    // The source project's style stays the graph's (its own over it), where it differs.
    if (node.kind === 'graph' && original.kind === 'graph' && sourceStyle && !sameStyle) {
      const style = effectiveStyle(source.settings, original)
      if (style) node.theme = { id: original.theme?.id ?? source.settings.theme, style }
    }
    return node
  })

  // Formulas naming a renamed info sheet follow it. Audit 2 (M5): `[Info: label]` read from an
  // imported sheet would read this project's field so labelled (its sheets come first): it names
  // the imported sheet instead.
  const warnings: string[] = []
  const sourceSheets = infoSheets(source)
  const targetSheets = infoSheets(target)
  const copyName = (id: NodeId) => copies[members.indexOf(id)]?.name
  for (const [i, node] of copies.entries()) {
    if (node.kind !== 'table') continue
    const original = nodeById(source.nodes, members[i]!)
    const pinned = new Map<string, string>()
    for (const r of original?.kind === 'table' ? infoReads(original, sourceSheets) : []) {
      if (!r.info || !r.sheet) continue
      if (!targetSheets.some((t) => t.fields.some((f) => sameInfoName(f.label, r.label)))) continue
      const name = copyName(r.sheet.id)
      const label = r.label.trim()
      if (name === undefined || [...pinned.keys()].some((l) => sameInfoName(l, label))) continue
      if (sameInfoName(name, INFO_PREFIX)) {
        warnings.push(
          `“${node.name}”: its formulas read [${INFO_PREFIX}: ${label}], which this project's info sheets also hold; they now read this project's.`,
        )
        continue
      }
      pinned.set(label, name)
      warnings.push(
        `“${node.name}”: [${INFO_PREFIX}: ${label}] now reads [${name.trim()}: ${label}] (this project's info sheets hold “${label}” too).`,
      )
    }
    if (!infoRenames.size && !pinned.size) continue
    for (const ds of node.dataSets) {
      if (ds.formula === undefined) continue
      const next = renameInfoInFormula(ds.formula, (prefix, label) => {
        if (sameInfoName(prefix, INFO_PREFIX)) {
          const to = [...pinned].find(([l]) => sameInfoName(l, label))?.[1]
          return to === undefined ? null : `${to.trim()}: ${label}`
        }
        for (const [from, to] of infoRenames)
          if (sameInfoName(prefix, from)) return `${to}: ${label}`
        return null
      })
      if (next !== null) ds.formula = next
    }
  }

  // Folders holding imported sheets (and their parents), recreated with new ids and names.
  const commands: Command[] = []
  const folderIds = new Map<string, FolderId>()
  const wanted = new Set<string>()
  for (const f of source.folders ?? [])
    if (f.members.some((m) => ids.has(m))) {
      wanted.add(f.id)
      if (f.parent !== undefined) wanted.add(f.parent)
    }
  const folderNames = (target.folders ?? []).map((f) => f.name)
  // Top folders first, so a subfolder's parent exists when it is added.
  const byDepth = [...(source.folders ?? [])].sort(
    (a, b) => Number(a.parent !== undefined) - Number(b.parent !== undefined),
  )
  for (const f of byDepth) {
    if (!wanted.has(f.id)) continue
    const id = newFolder()
    folderIds.set(f.id, id)
    const name = uniqueName(f.name, folderNames)
    folderNames.push(name)
    const parent = f.parent !== undefined ? folderIds.get(f.parent) : undefined
    commands.push({
      type: 'folder.add',
      folder: { id, name, ...(parent !== undefined ? { parent } : {}) },
    })
  }
  const folderOfSource = new Map<NodeId, FolderId>()
  for (const f of source.folders ?? [])
    for (const m of f.members) {
      const to = folderIds.get(f.id)
      if (to !== undefined) folderOfSource.set(m, to)
    }

  for (const [i, node] of copies.entries())
    commands.push({
      type: 'node.add',
      node: copyData(node),
      folder: folderOfSource.get(members[i]!) ?? null,
    })

  const assets = new Set<AssetId>()
  for (const n of copies)
    if (n.kind === 'layout') for (const it of n.items) if (it.type === 'image') assets.add(it.asset)

  return {
    commands,
    ids,
    created: copies.map((c) => c.id),
    renamed,
    assets: [...assets],
    warnings,
  }
}
