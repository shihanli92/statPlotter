import type { GraphNode, LayoutNode, NodeId } from '@ps/model'
import type { ReactNode } from 'react'
import { GROUPS } from '../commands/menus.ts'
import type { Command } from '../commands/registry.ts'
import { lazyComponent } from '../components/lazy.tsx'
import type { ModalSlot } from '../components/modals.tsx'
import { useDoc } from '../context.tsx'
import { graphsAmong, useNavigatorSelection } from '../organise/useNavSelection.ts'
import type { StyleScope } from './StyleDialogs.tsx'
import { pageGraphs } from './styleActions.ts'
import { usePageSelection } from './units.ts'

// Roadmap 37's commands: Format › Styles…, Save this graph's look as a style…, Reset to style…,
// Reset every graph to its style…, Fit to column…; Edit › Preferences… (macOS: the application
// menu's Settings…, ⌘,).

// The dialogs load when first shown (audit 2, P8).
const dialogs = () => import('./StyleDialogs.tsx')
const StylesDialog = lazyComponent(() => dialogs().then((m) => m.StylesDialog))
const SaveStyleDialog = lazyComponent(() => dialogs().then((m) => m.SaveStyleDialog))
const ResetStyleDialog = lazyComponent(() => dialogs().then((m) => m.ResetStyleDialog))
const FitColumnDialog = lazyComponent(() => dialogs().then((m) => m.FitColumnDialog))
const PreferencesDialog = lazyComponent(() => dialogs().then((m) => m.PreferencesDialog))

type Open =
  | { kind: 'styles'; chosen?: NodeId[]; navigator?: NodeId[] }
  | { kind: 'save'; graph: NodeId }
  | { kind: 'reset'; ids: NodeId[]; what: string }
  | { kind: 'fit'; graph?: NodeId; layout?: NodeId }
  | { kind: 'preferences' }

export function useStyles(opts: {
  selected: NodeId | null
  onMessage: (msg: string) => void
  /** The shell's modal slot (audit 2, U26): the dialog open is held there. */
  slot: <T>(owner: string) => ModalSlot<T>
}): {
  commands: Command[]
  dialog: ReactNode
  /**
   * Roadmap 40: the Styles dialog for graphs chosen elsewhere: the Gallery, or (roadmap 47) the
   * graphs selected in the navigator.
   */
  openFor: (graphs: NodeId[], from?: 'gallery' | 'navigator') => void
} {
  const project = useDoc((d) => d)
  const { open, show: setOpen, close } = opts.slot<Open>('styles')
  const pageSel = usePageSelection()
  // Roadmap 47: several graphs selected in the navigator are offered too.
  const navSelected = graphsAmong(project, useNavigatorSelection())
  const node = opts.selected ? project.nodes[opts.selected] : undefined
  const graph = node?.kind === 'graph' ? node : undefined
  const layout = node?.kind === 'layout' ? node : undefined
  const allGraphs = project.order.filter((id) => project.nodes[id]?.kind === 'graph')
  const at = (order: number) => ({ menu: 'format' as const, group: GROUPS.format.styles, order })
  const keywords = ['style', 'theme', 'journal', 'nature', 'cell', 'science', 'pnas', 'font']

  const resetHere = (): Open | null => {
    if (graph) return { kind: 'reset', ids: [graph.id], what: `“${graph.name}”` }
    if (layout) {
      const ids = pageGraphs(project, layout)
      return ids.length ? { kind: 'reset', ids, what: `the graphs on “${layout.name}”` } : null
    }
    return null
  }
  const here = resetHere()

  const commands: Command[] = [
    {
      id: 'format.styles',
      label: 'Styles…',
      menu: at(10),
      keywords,
      hint: 'Journal and your own styles: fonts, sizes, line widths, palettes, figure widths',
      run: () => setOpen({ kind: 'styles' }),
    },
    {
      id: 'format.saveStyle',
      label: 'Save this graph’s look as a style…',
      menu: at(20),
      enabled: !!graph,
      keywords,
      run: () => graph && setOpen({ kind: 'save', graph: graph.id }),
    },
    {
      id: 'format.resetStyle',
      label: layout ? 'Reset the page’s graphs to their style…' : 'Reset to style…',
      menu: at(30),
      enabled: !!here,
      keywords: [...keywords, 'clear formatting'],
      hint: 'Clears your own fonts, sizes, line widths and colours of what styles set',
      run: () => here && setOpen(here),
    },
    {
      id: 'format.resetProjectStyle',
      label: 'Reset every graph to its style…',
      menu: at(35),
      enabled: allGraphs.length > 0,
      keywords: [...keywords, 'clear formatting'],
      run: () => setOpen({ kind: 'reset', ids: allGraphs, what: 'every graph in the project' }),
    },
    {
      id: 'format.fitColumn',
      label: 'Fit to column…',
      menu: at(40),
      enabled: !!graph || !!layout,
      keywords: [...keywords, 'width', 'single column', 'double column', 'figure size'],
      run: () =>
        (graph || layout) &&
        setOpen({ kind: 'fit', ...(graph ? { graph: graph.id } : { layout: layout!.id }) }),
    },
    {
      id: 'app.preferences',
      label: 'Preferences…',
      menu: { menu: 'edit', group: GROUPS.edit.preferences, order: 10 },
      shortcut: 'Mod+,',
      inTextFields: true,
      keywords: ['settings', 'options', 'defaults', 'units'],
      run: () => setOpen({ kind: 'preferences' }),
    },
  ]

  const navGraphs =
    open?.kind === 'styles' && open.navigator
      ? open.navigator
      : navSelected.length > 1
        ? navSelected
        : undefined
  const scope: StyleScope = {
    ...(open?.kind === 'styles' && open.chosen ? { chosen: open.chosen } : {}),
    ...(navGraphs ? { navigator: navGraphs } : {}),
    ...(graph ? { graph } : {}),
    ...(layout
      ? {
          page: {
            layout,
            selected: pageSel?.layout === layout.id ? (pageSel.graphs as NodeId[]) : [],
          },
        }
      : {}),
  }
  const g = (id: NodeId | undefined) => {
    const n = id ? project.nodes[id] : undefined
    return n?.kind === 'graph' ? (n as GraphNode) : undefined
  }
  const l = (id: NodeId | undefined) => {
    const n = id ? project.nodes[id] : undefined
    return n?.kind === 'layout' ? (n as LayoutNode) : undefined
  }

  let dialog: ReactNode = null
  if (open?.kind === 'styles')
    dialog = <StylesDialog scope={scope} onClose={close} onMessage={opts.onMessage} />
  else if (open?.kind === 'save' && g(open.graph))
    dialog = <SaveStyleDialog graph={g(open.graph)!} onClose={close} onMessage={opts.onMessage} />
  else if (open?.kind === 'reset')
    dialog = (
      <ResetStyleDialog
        ids={open.ids}
        what={open.what}
        onClose={close}
        onMessage={opts.onMessage}
      />
    )
  else if (open?.kind === 'fit')
    dialog = (
      <FitColumnDialog
        graph={g(open.graph)}
        layout={l(open.layout)}
        onClose={close}
        onMessage={opts.onMessage}
      />
    )
  else if (open?.kind === 'preferences') dialog = <PreferencesDialog onClose={close} />
  return {
    commands,
    dialog,
    openFor: (graphs, from = 'gallery') =>
      setOpen(
        from === 'navigator'
          ? { kind: 'styles', navigator: graphs }
          : { kind: 'styles', chosen: graphs },
      ),
  }
}
