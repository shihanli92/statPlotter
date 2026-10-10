import { type FamilyEntry, familyTree, mergePlan, mergeSelection } from '@ps/engine'
import type { AssetId, ImageAsset, NodeId, Project } from '@ps/model'
import { type ReactNode, useMemo, useState } from 'react'
import { Dialog } from '../components/Dialog.tsx'
import { useServices } from '../context.tsx'
import { KIND_NAMES } from '../Navigator.tsx'
import { errorMessage } from '../util.ts'

/**
 * File › Import from project… (roadmap 40): the other project's sheets by family, with
 * checkboxes; a table brings its analyses, results and graphs ("With their families", on by
 * default), a page its graphs, and everything brought brings what it needs. New ids, names made
 * unique, styles, images, info sheets and folders along — one undo step.
 */
export function MergeDialog({
  fileName,
  source,
  assets,
  onClose,
  onDone,
  onError,
}: {
  fileName: string
  source: Project
  assets: ReadonlyMap<AssetId, ImageAsset>
  onClose: () => void
  onDone: (first: NodeId | null, message: string | null) => void
  onError: (msg: string) => void
}) {
  const { store, assets: store_ } = useServices()
  const tree = useMemo(() => familyTree(source), [source])
  // Everything is ticked at first: the whole project.
  const [picked, setPicked] = useState<Set<NodeId>>(
    () => new Set(tree.flatMap((e) => (e.kind === 'node' ? [e.id] : []))),
  )
  const [withFamily, setWithFamily] = useState(true)
  const brought = useMemo(
    () => mergeSelection(source, [...picked], withFamily),
    [source, picked, withFamily],
  )
  const bringing = new Set(brought)

  const toggle = (id: NodeId) =>
    setPicked((p) => {
      const next = new Set(p)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const row = (e: FamilyEntry, depth: number): ReactNode => {
    if (e.kind === 'set')
      return (
        <li key={`set:${e.set}`} className="merge-set">
          <span style={{ paddingLeft: depth * 16 }} className="hint">
            Split graphs
          </span>
          <ul>{e.children.map((c) => row(c, depth + 1))}</ul>
        </li>
      )
    if (e.link) return null
    const n = source.nodes[e.id]
    if (!n) return null
    const implied = !picked.has(e.id) && bringing.has(e.id)
    return (
      <li key={e.id}>
        <label style={{ paddingLeft: depth * 16 }} className={implied ? 'implied' : ''}>
          <input
            type="checkbox"
            checked={picked.has(e.id) || implied}
            ref={(el) => {
              if (el) el.indeterminate = implied
            }}
            onChange={() => toggle(e.id)}
          />{' '}
          <span className={`icon icon-${n.kind}`} aria-hidden /> {n.name}
          <span className="hint"> — {KIND_NAMES[n.kind]}</span>
        </label>
        {e.children.length > 0 && <ul>{e.children.map((c) => row(c, depth + 1))}</ul>}
      </li>
    )
  }

  const run = () => {
    try {
      const plan = mergePlan(store.getState(), source, { picked: [...picked], withFamily })
      for (const id of plan.assets) {
        const a = assets.get(id)
        if (a) store_.add(a)
      }
      store.dispatch(plan.commands, `Import from ${fileName}`)
      const renamed = plan.renamed.length
        ? ` Renamed (the names were taken): ${plan.renamed.map((r) => `“${r.from}” → “${r.to}”`).join(', ')}.`
        : ''
      onDone(
        plan.created[0] ?? null,
        `${plan.created.length} ${plan.created.length === 1 ? 'sheet' : 'sheets'} imported from ${fileName}.${renamed}${plan.warnings.map((w) => ` ${w}`).join('')}`,
      )
    } catch (e) {
      onError(`Import failed: ${errorMessage(e)}`)
    }
  }

  return (
    <Dialog
      title={`Import from ${fileName}`}
      wide
      onClose={onClose}
      okLabel={`Import ${brought.length} ${brought.length === 1 ? 'sheet' : 'sheets'}`}
      okDisabled={!brought.length}
      onOk={run}
    >
      <p className="hint">
        Copies of the ticked sheets join this project with new names where theirs are taken; graphs
        and pages bring the tables and analyses they show.
      </p>
      <label>
        <input
          type="checkbox"
          checked={withFamily}
          onChange={(e) => setWithFamily(e.target.checked)}
        />{' '}
        Tables bring their families (analyses, results and graphs)
      </label>
      <div className="merge-actions">
        <button
          type="button"
          onClick={() => setPicked(new Set(tree.flatMap((e) => (e.kind === 'node' ? [e.id] : []))))}
        >
          Tick all
        </button>
        <button type="button" onClick={() => setPicked(new Set())}>
          Untick all
        </button>
      </div>
      <ul className="merge-list" aria-label="Sheets of the other project">
        {tree.map((e) => row(e, 0))}
      </ul>
    </Dialog>
  )
}
