import { capitalize } from '../../util.ts'
import type { PanelContext } from '../inspector/context.ts'
import { seriesOfLayer } from '../inspector/layers.ts'
import { sameTarget } from './formatHost.ts'
import {
  axisPlace,
  describeTarget,
  type FormatTarget,
  graphPlace,
  LEGEND_PLACE,
  layerPlace,
  pickKey,
  placeName,
  seriesPlace,
  TITLE_PLACE,
  tabsFor,
} from './route.ts'
import { sectionsFor } from './sections.tsx'

// Roadmap 46 (UX review V5): the Format panel's field search. Its index is read off a rendering
// of every place of the graph (`FORMAT_SECTIONS`, each section in its `data-format-section`
// wrapper, collapsed sections open) — the fields' own labels, their sections' titles and hints —
// never a list kept by hand, so it follows the sections wherever they move. A result names
// "Element › Section › Field"; choosing one shows the place, opens the section and focuses the
// field (`revealField`).

/** A place of the graph to search: what it formats, by name. */
export interface SearchPlace {
  target: FormatTarget
  /** The element, as results name it ("Y axis", "Data set “Control”", "Graph settings"). */
  element: string
  /** A layer's place: the layer's name ("Points"), as a result of several layers lists it. */
  layer?: string
}

/** One field of one place. */
export interface SearchEntry extends SearchPlace {
  /** The `data-format-section` it is in. */
  section: string
  /** The title of the inspector section holding it (the collapsible "Numbers"), if any. */
  heading: string | null
  /** Its label as shown. */
  label: string
  /** Its hint and other words describing it (help text, tooltips, placeholders, keywords). */
  hint: string
  /** Which of the fields so labelled in the same section and heading (0: the first). */
  nth: number
  /**
   * In a section of the graph's own settings shown in several places (`FormatSection.shared`:
   * the drawing order in the graph's and each layer's): listed once (roadmap 47).
   */
  shared?: boolean
}

/** A series' title, by its key, from the layers drawing it. */
function seriesTitle(ctx: PanelContext, key: string): string | undefined {
  for (const l of ctx.graph.layers) {
    const item = seriesOfLayer(ctx.project, ctx.graph, l, ctx.lookup).find((i) => i.key === key)
    if (item) return item.title
  }
  return undefined
}

/** The element a place formats, as results name it ("Y axis", "Layer “Points”"). */
function elementOf(t: FormatTarget, ctx: PanelContext): string {
  const name = placeName(t, ctx.graph, (key) => seriesTitle(ctx, key))
  if (t.place === 'layer') return `Layer “${name}”`
  if (t.place === 'series') return `${capitalize(describeTarget(t, ctx.graph))} “${name}”`
  if (t.place === 'bracket' || t.place === 'object') return `${name} ${t.index + 1}`
  return name
}

/** At most this many annotations are searched (each is a place of its own). */
const MAX_ANNOTATIONS = 12

/**
 * The places of a graph to search: the graph, its title, each axis, the legend, each layer, a
 * data set (the one shown, else the first), the annotations — those with sections.
 */
export function searchPlaces(ctx: PanelContext, current?: FormatTarget): SearchPlace[] {
  const { graph } = ctx
  const targets: FormatTarget[] = [graphPlace(), TITLE_PLACE]
  for (const tab of tabsFor(axisPlace('x'), graph)) targets.push(axisPlace(tab.id))
  targets.push(LEGEND_PLACE)
  for (const l of graph.layers) targets.push(layerPlace(l.id))
  // One data set (its own fields: colour, labels, the axis it is on, its formats in each layer).
  const shown = current?.place === 'series' ? pickKey(current.series) : undefined
  for (const l of graph.layers) {
    const items = seriesOfLayer(ctx.project, graph, l, ctx.lookup)
    const item = items.find((i) => i.key === shown) ?? (shown === undefined ? items[0] : undefined)
    if (!item) continue
    const pick =
      item.kind === 'output'
        ? { output: item.key }
        : item.kind === 'function'
          ? { fn: item.key }
          : { dataSet: item.key }
    targets.push(seriesPlace(pick))
    break
  }
  graph.annotations.slice(0, MAX_ANNOTATIONS).forEach((a, index) => {
    targets.push(a.type === 'bracket' ? { place: 'bracket', index } : { place: 'object', index })
  })
  return targets
    .filter((t) => sectionsFor(t).length > 0)
    .map((target) => ({
      target,
      element: elementOf(target, ctx),
      ...(target.place === 'layer' ? { layer: placeName(target, ctx.graph) } : {}),
    }))
}

/**
 * Where a result jumps: its place, asking for its section to be open where a place takes one (the
 * graph, an axis, a layer, a data set).
 */
export function jumpTarget(e: SearchEntry): FormatTarget {
  const t = e.target
  return t.place === 'graph' || t.place === 'axis' || t.place === 'layer' || t.place === 'series'
    ? { ...t, section: e.section }
    : t
}

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

/** A section's title, without its chevron. */
const headingOf = (field: Element): string | null => {
  const s = field.closest('.inspector-section')
  const h = s?.querySelector(':scope > h3')
  return h ? text(h).replace(/^[▾▸]\s*/, '') || null : null
}

/** A field's label: its label, legend, or (a checkbox) its own text, else its control's name. */
function labelOf(field: Element): string {
  if (field.tagName === 'FIELDSET') return text(field.querySelector(':scope > legend'))
  if (field.tagName === 'LABEL') return text(field)
  const label = field.querySelector(':scope > label')
  if (label) return text(label)
  const control = field.querySelector('[aria-label]')
  return control?.getAttribute('aria-label') ?? ''
}

/** Words describing a field beyond its label: help, tooltips, placeholders, keywords. */
function hintOf(field: Element): string {
  const words = [text(field.querySelector('.help'))]
  for (const el of [field, ...field.querySelectorAll('[title], [placeholder], [data-keywords]')])
    words.push(
      el.getAttribute('title') ?? '',
      el.getAttribute('placeholder') ?? '',
      el.getAttribute('data-keywords') ?? '',
    )
  return words.filter(Boolean).join(' ')
}

/** The fields of a section wrapper, outermost only, in order. */
function fieldsIn(wrapper: Element): Element[] {
  return [...wrapper.querySelectorAll('.field')].filter((f) => {
    const up = f.parentElement?.closest('.field')
    return !up || !wrapper.contains(up)
  })
}

/** The fields of one place's rendering (`root` holds its section wrappers). */
export function harvestFields(root: Element, place: SearchPlace): SearchEntry[] {
  const out: SearchEntry[] = []
  const shared = new Set(
    sectionsFor(place.target)
      .filter((s) => s.shared)
      .map((s) => s.id),
  )
  for (const wrapper of root.querySelectorAll('[data-format-section]')) {
    const section = wrapper.getAttribute('data-format-section') ?? ''
    const seen = new Map<string, number>()
    for (const field of fieldsIn(wrapper)) {
      const label = labelOf(field)
      if (!label) continue
      const heading = headingOf(field)
      const key = `${heading} ${label}`
      const nth = seen.get(key) ?? 0
      seen.set(key, nth + 1)
      out.push({
        ...place,
        section,
        heading,
        label,
        hint: hintOf(field),
        nth,
        ...(shared.has(section) ? { shared: true } : {}),
      })
    }
  }
  return out
}

/** Spellings searched as one ("colour" finds "Color"…). */
const SYNONYMS: readonly [RegExp, string][] = [
  [/colour/g, 'color'],
  [/grey/g, 'gray'],
  [/centre/g, 'center'],
  [/&/g, 'and'],
]

/** Lower case, accents and British spellings folded, for matching. */
export function fold(s: string): string {
  let t = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  for (const [re, to] of SYNONYMS) t = t.replace(re, to)
  return t
}

/** How well a word matches a text: at a word's start, inside one, not at all. */
const hit = (text: string, word: string): number => {
  const i = text.indexOf(word)
  if (i < 0) return 0
  return i === 0 || /[^a-z0-9]/.test(text[i - 1]!) ? 2 : 1
}

/**
 * A result: the entry and its parts for showing ("Element › Section", "Field"). A per-layer
 * setting matched in several layers is one result (roadmap 47): `layers` holds each layer's entry,
 * the front-most first (as every list of layers shows them), and `entry` is that first one.
 */
export interface SearchResult {
  entry: SearchEntry
  path: string
  layers?: readonly SearchEntry[]
}

/** What a result shows before the field: "Y axis › Numbers". */
export function resultPath(e: SearchEntry): string {
  return [e.element, e.heading]
    .filter((x, i, a) => x && x !== a[i - 1] && x !== e.label)
    .join(' › ')
}

/** A result of several layers' field: "Layers › Symbols". */
const layersPath = (e: SearchEntry): string =>
  ['Layers', e.heading].filter((x) => x && x !== e.label).join(' › ')

/**
 * Which result an entry is part of: a shared section's field once wherever it is shown, a
 * layer's field one result for every layer having it, any other field of its own element.
 */
function resultKey(e: SearchEntry): string {
  const field = `${e.section}|${e.heading}|${e.label}|${e.nth}`
  if (e.shared) return `shared|${field}`
  if (e.target.place === 'layer') return `layer|${field}`
  return `${e.element}|${e.heading}|${e.label}|${e.nth}`
}

/**
 * The fields matching a query: every word found in the label, section, element or hint; the
 * label's matches first (at a word's start, then inside one), then the section's, the element's,
 * the hint's. A field is one result: a shared section's once (where it is first found: the
 * graph's place), a layer's field with every layer it matched in (roadmap 47), any other field
 * once per element. At most `limit`.
 */
export function searchFields(
  entries: readonly SearchEntry[],
  query: string,
  limit = 40,
): SearchResult[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const groups = new Map<string, { entries: SearchEntry[]; score: number; i: number }>()
  entries.forEach((entry, i) => {
    const parts = {
      label: fold(entry.label),
      heading: fold(entry.heading ?? ''),
      element: fold(entry.element),
      hint: fold(`${entry.hint} ${entry.section}`),
    }
    let score = 0
    for (const w of words) {
      const s =
        hit(parts.label, w) * 10 ||
        hit(parts.heading, w) * 4 ||
        hit(parts.element, w) * 3 ||
        hit(parts.hint, w)
      if (!s) return
      score += s
    }
    const key = resultKey(entry)
    const g = groups.get(key)
    if (!g) groups.set(key, { entries: [entry], score, i })
    else if (entry.target.place === 'layer' && !entry.shared) {
      // Another layer with this field (each layer once).
      if (!g.entries.some((x) => sameTarget(x.target, entry.target))) g.entries.push(entry)
      g.score = Math.max(g.score, score)
    }
  })
  return [...groups.values()]
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((g) => {
      if (g.entries.length < 2) return { entry: g.entries[0]!, path: resultPath(g.entries[0]!) }
      // The index lists layers back to front: the front-most first.
      const layers = [...g.entries].reverse()
      return { entry: layers[0]!, path: layersPath(layers[0]!), layers }
    })
}

/** What a reveal did: the field focused, a section opened (try again next frame), not found. */
export type RevealResult = 'done' | 'retry' | 'missing'

/** How long a revealed field stays highlighted (ms). */
export const HIGHLIGHT_MS = 1600

/**
 * Shows a field in a rendered place (`root`): opens its collapsed section ('retry' then: its
 * fields render on the next frame), else scrolls to it, focuses its control and highlights it
 * briefly.
 */
export function revealField(root: Element | null, e: SearchEntry): RevealResult {
  const wrapper = root?.querySelector(`[data-format-section="${CSS.escape(e.section)}"]`)
  if (!wrapper) return 'missing'
  const matches = fieldsIn(wrapper).filter(
    (f) => labelOf(f) === e.label && headingOf(f) === e.heading,
  )
  const field = matches[e.nth] ?? matches[0]
  if (!field) {
    // Its section is collapsed: open it.
    const toggle = [...wrapper.querySelectorAll<HTMLElement>('.inspector-section')]
      .filter((s) => text(s.querySelector(':scope > h3')).replace(/^[▾▸]\s*/, '') === e.heading)
      .map((s) => s.querySelector<HTMLElement>(':scope > h3 [aria-expanded="false"]'))
      .find(Boolean)
    if (!toggle) return 'missing'
    toggle.click()
    return 'retry'
  }
  const control = field.matches('input, select, textarea, button')
    ? (field as HTMLElement)
    : field.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea, button:not(:disabled), [contenteditable="true"]',
      )
  field.scrollIntoView?.({ block: 'center' })
  control?.focus({ preventScroll: true })
  field.classList.add('search-hit')
  setTimeout(() => field.classList.remove('search-hit'), HIGHLIGHT_MS)
  return 'done'
}
