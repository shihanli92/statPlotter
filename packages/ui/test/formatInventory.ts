import type { Command } from '@ps/engine'
import { graphPalette, graphTheme } from '@ps/graph'
import type { GraphNode, GraphPathSegment, Project } from '@ps/model'
import type { ReactNode } from 'react'

// Roadmap 46 (stage 2): an inventory of the Format options' fields — every control a place
// renders, by its label and the paths its change writes — for the completeness test
// (`formatCompleteness.test.ts`): what the stage-1 tabs rendered (recorded once, frozen in
// `formatInventory.v46.json`) must all be rendered somewhere in the places by element.
//
// It runs in a node test file with happy-dom installed by hand (`installDom`): the examples are
// built first with the graph tests' fonts, which load from files (happy-dom's URLs can't).

/** One control of the Format options. */
export interface FieldEntry {
  /** 'check', 'select', 'number', 'text', 'color', 'rich', 'button'. */
  kind: string
  /** Its accessible label (a button's name). */
  label: string
  /** The paths a change writes (`set:axes/y/range`, `graph.addLayer`), sorted; '' when none. */
  writes: string
}

/** Installs happy-dom's window as the globals React and the panels need. */
export async function installDom(): Promise<void> {
  const { Window } = await import('happy-dom')
  const win = new Window({ url: 'http://localhost/' })
  const g = globalThis as Record<string, unknown>
  for (const key of [
    'window',
    'document',
    'navigator',
    'HTMLElement',
    'HTMLInputElement',
    'HTMLSelectElement',
    'HTMLTextAreaElement',
    'HTMLButtonElement',
    'Element',
    'Node',
    'Event',
    'KeyboardEvent',
    'MouseEvent',
    'InputEvent',
    'FocusEvent',
    'CustomEvent',
    'getComputedStyle',
    'localStorage',
    'sessionStorage',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'MutationObserver',
    'ResizeObserver',
    'DOMParser',
    'Text',
    'DocumentFragment',
    'CSS',
  ]) {
    const v = (win as unknown as Record<string, unknown>)[key]
    if (v !== undefined && !(key in g && key === 'navigator')) g[key] = v
  }
  g.IS_REACT_ACT_ENVIRONMENT = true
}

/** A path segment as text (a layer's `{ id }` by its id). */
const seg = (s: GraphPathSegment): string =>
  typeof s === 'object' && s !== null ? `{${(s as { id: string }).id}}` : String(s)

/** What commands write, as sorted text. */
export function writesOf(cmds: readonly Command[]): string {
  const out = new Set<string>()
  for (const c of cmds) {
    if (c.type === 'node.set') out.add(`set:${c.path.map(seg).join('/')}`)
    else out.add(c.type)
  }
  return [...out].sort().join('|')
}

/** A panel context over a graph whose writes are recorded, not applied. */
export function recordingContext(project: Project, graph: GraphNode, written: Command[]) {
  const theme = graphTheme(project, graph)
  return {
    graph,
    project,
    lookup: () => undefined,
    theme,
    palette: graphPalette(graph, theme),
    set: (path: GraphPathSegment[], value: unknown) => {
      written.push({ type: 'node.set', id: graph.id, path, value } as Command)
    },
    dispatch: (cmds: Command | Command[]) => {
      written.push(...(Array.isArray(cmds) ? cmds : [cmds]))
    },
    onSelect: () => {},
    onError: () => {},
    onChangeLayers: () => {},
    onSavePreset: () => {},
    onManagePresets: () => {},
    onSplit: () => {},
  }
}

const SKIP_BUTTONS =
  /^(Palette colour \d+|Black|Same colour as the data set|Mixed colours|[↑↓▾▸×≡])$/

/** The label of a control: its `<label>`, its own aria-label, or the label wrapping it. */
function labelOf(el: Element): string {
  const doc = el.ownerDocument
  const aria = el.getAttribute('aria-label')
  if (aria) return aria
  const by = el.getAttribute('aria-labelledby')
  if (by) return (doc.getElementById(by)?.textContent ?? '').trim()
  const id = el.getAttribute('id')
  if (id) {
    const l = doc.querySelector(`label[for="${CSS.escape(id)}"]`)
    if (l) return (l.textContent ?? '').trim()
  }
  const wrap = el.closest('label')
  if (wrap) return (wrap.textContent ?? '').trim()
  return ''
}

/**
 * Renders `node` (Format options for one place) and walks its controls: each changed once (a
 * checkbox clicked, another option chosen, a number typed, a swatch picked) to record the paths
 * it writes. Every collapsed section is opened first. `act` and `render` are React's, loaded after
 * the DOM is installed.
 */
export async function inventory(
  render: (node: ReactNode) => HTMLElement,
  act: (fn: () => void) => void,
  node: ReactNode,
  written: Command[],
): Promise<FieldEntry[]> {
  const root = render(node)
  // Open every collapsed section (opening one may reveal more).
  for (let i = 0; i < 20; i++) {
    const closed = [...root.querySelectorAll('button.section-toggle[aria-expanded="false"]')]
    const details = [...root.querySelectorAll('details:not([open])')]
    if (!closed.length && !details.length) break
    act(() => {
      for (const b of closed) (b as HTMLButtonElement).click()
      for (const d of details) (d as HTMLDetailsElement).open = true
    })
  }
  const out: FieldEntry[] = []
  const seen = new Set<string>()
  const add = (e: FieldEntry) => {
    const k = `${e.kind}\u0000${e.label}\u0000${e.writes}`
    if (!seen.has(k)) {
      seen.add(k)
      out.push(e)
    }
  }
  const changed = (fn: () => void): string => {
    written.length = 0
    try {
      act(fn)
    } catch {
      // A control whose change throws on a recorded (unapplied) document: no path.
    }
    return writesOf(written)
  }
  const controls = [...root.querySelectorAll('input, select, textarea, [contenteditable="true"]')]
  for (const el of controls) {
    if (!el.isConnected) continue
    const label = labelOf(el)
    if (el instanceof root.ownerDocument.defaultView!.HTMLSelectElement) {
      const sel = el as HTMLSelectElement
      const other = [...sel.options].find((o) => !o.disabled && o.value !== sel.value)
      const writes = other
        ? changed(() => {
            sel.value = other.value
            sel.dispatchEvent(new Event('change', { bubbles: true }))
          })
        : ''
      add({ kind: 'select', label, writes })
      continue
    }
    if ((el as HTMLElement).isContentEditable) {
      add({ kind: 'rich', label, writes: '' })
      continue
    }
    const input = el as HTMLInputElement
    const type = input.type
    if (type === 'checkbox' || type === 'radio') {
      add({ kind: 'check', label, writes: changed(() => input.click()) })
      continue
    }
    const setValue = (v: string) => {
      const proto = Object.getPrototypeOf(input)
      const desc = Object.getOwnPropertyDescriptor(proto, 'value')
      desc?.set?.call(input, v)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    if (type === 'number') {
      const cur = Number(input.value)
      const min = input.min === '' ? undefined : Number(input.min)
      const max = input.max === '' ? undefined : Number(input.max)
      const ok = (v: number) =>
        Number.isFinite(v) &&
        v !== cur &&
        (min === undefined || v >= min) &&
        (max === undefined || v <= max)
      const tries = [cur + 1, cur - 1, cur + 0.5, cur / 2, min, max, 1, 0.5, 2].filter(
        (v): v is number => v !== undefined && ok(v),
      )
      let writes = ''
      for (const v of tries) {
        writes = changed(() => setValue(String(v)))
        if (writes) break
      }
      add({ kind: 'number', label, writes })
      continue
    }
    add({
      kind: 'text',
      label,
      writes: changed(() => setValue(input.value === '7' ? '8' : '7')),
    })
  }
  // A colour field (roadmap 46, V6): its button opens the colour popover (in the body); a swatch
  // not chosen in it writes what the field's picker would. Its label is the field's.
  for (const b of root.querySelectorAll<HTMLButtonElement>('button.color-button')) {
    if (!b.isConnected) continue
    const field = b.closest('.color-button-field')
    const label = (field?.querySelector(':scope > label')?.textContent ?? '').trim()
    act(() => b.click())
    const doc = root.ownerDocument
    const popover = doc.querySelector('[data-testid="color-popover"]')
    const swatch = popover?.querySelector<HTMLElement>('.color-choice.cell[aria-selected="false"]')
    const writes = swatch ? changed(() => swatch.click()) : ''
    // Closed again when nothing was picked.
    if (doc.querySelector('[data-testid="color-popover"]')) act(() => b.click())
    add({ kind: 'color', label, writes })
  }
  for (const b of root.querySelectorAll('button')) {
    if (b.classList.contains('section-toggle') || b.classList.contains('color-button')) continue
    const label = labelOf(b) || (b.textContent ?? '').trim()
    if (!label || SKIP_BUTTONS.test(label)) continue
    add({ kind: 'button', label, writes: '' })
  }
  for (const o of root.querySelectorAll('[role="option"]'))
    add({ kind: 'option', label: o.getAttribute('aria-label') ?? '', writes: '' })
  return out
}

/** A graph's kind, for picking one graph of each kind from the examples. */
export function graphKind(graph: GraphNode): string {
  return JSON.stringify({
    frame: graph.frame,
    layers: graph.layers
      .map((l) =>
        [
          l.geom,
          l.stat.kind,
          l.data?.from ?? 'table',
          l.aes ? 'aes' : '',
          l.position?.kind ?? '',
        ].join(':'),
      )
      .sort(),
    y2: !!graph.axes.y2,
    x: graph.axes.x.type,
    y: graph.axes.y.type === 'continuous' ? graph.axes.y.scale : graph.axes.y.type,
    annotations: [...new Set(graph.annotations.map((a) => a.type))].sort(),
    mapping: !!graph.mapping,
    legend: graph.legend.show,
    title: !!graph.title,
  })
}

/** One graph of each kind in the projects, in order: `[example/graph name, project, graph]`. */
export function representativeGraphs(
  projects: readonly [string, Project][],
): [string, Project, GraphNode][] {
  const kinds = new Set<string>()
  const out: [string, Project, GraphNode][] = []
  for (const [id, project] of projects)
    for (const g of Object.values(project.nodes)) {
      if (g?.kind !== 'graph') continue
      const k = graphKind(g)
      if (kinds.has(k)) continue
      kinds.add(k)
      out.push([`${id}/${g.name}`, project, g])
    }
  return out
}
