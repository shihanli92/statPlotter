// @vitest-environment happy-dom
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { guideEntry, guideSchematic, tableFacts } from '@ps/analyses/dialog'
import { FontRegistry } from '@ps/graph'
import {
  createProject,
  createTable,
  type DataTable,
  type GuideAnswers,
  normalizeTable,
  type Project,
} from '@ps/model'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { AnalyzeDialog, SKETCH_DEBOUNCE_MS } from '../src/analysis/AnalyzeDialog.tsx'
import { GuidePanel } from '../src/analysis/GuidePanel.tsx'
import { schematicImage } from '../src/analysis/SchematicView.tsx'
import { ServicesContext } from '../src/context.tsx'
import { type AppServices, createServices } from '../src/services.ts'

// Roadmap 51f: Guide me's diagrams in the Analyze dialog — the map of the path under the
// question chosen (a step goes back to its question; ↑ ↓ Home End move, Enter goes), and "What
// will be tested" beside the questions, built up as they are answered with the user's names;
// after Use this, the method's own schematic above the sketch (a one-tailed test's arrow). No P
// value anywhere.

// The bundled fonts, read by path (happy-dom's URLs aren't Node's).
const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../graph/assets/fonts')
const fonts = await FontRegistry.load(
  async (file) => new Uint8Array(await readFile(join(FONT_DIR, file))),
)

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const proto = HTMLDialogElement.prototype as { showModal?: () => void; close?: () => void }
  proto.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  proto.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})

let root: Root | null = null
let host: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
  host = null
  document.documentElement.removeAttribute('data-theme')
})

function columnTable(titles: string[]): DataTable {
  const t = createTable({ name: 'Doses', tableKind: 'column', columns: titles.length, rows: 6 })
  t.dataSets.forEach((d, i) => {
    d.title = titles[i]!
    d.subcolumns[0]!.values = [1, 2, 3, 4, 5, 6].map((v) => v * (i + 1) + 0.25)
  })
  return t
}

function services(t: DataTable): AppServices {
  const p: Project = createProject('Diagrams')
  p.nodes[t.id] = t
  p.order.push(t.id)
  return createServices({ fonts, platform: {} as never, project: p })
}

const settle = (ms = SKETCH_DEBOUNCE_MS + 30) => act(() => new Promise((r) => setTimeout(r, ms)))

async function openGuide(t: DataTable): Promise<HTMLDialogElement> {
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  act(() =>
    root!.render(
      <ServicesContext.Provider value={services(t)}>
        <AnalyzeDialog
          mode="create"
          tableId={t.id}
          tab="guide"
          onClose={vi.fn()}
          onError={vi.fn()}
          onCreated={vi.fn()}
        />
      </ServicesContext.Provider>,
    ),
  )
  await settle()
  return document.querySelector('dialog')!
}

const button = (d: Element, name: string) =>
  [...d.querySelectorAll('button')].find((b) => b.textContent?.trim() === name) as HTMLElement
const radio = (d: Element, label: string) =>
  [...d.querySelectorAll('label')]
    .find((l) => l.textContent?.trim() === label)!
    .querySelector('input') as HTMLInputElement
const steps = (d: Element) =>
  [...d.querySelectorAll('.guide-map .map-step')].map((b) => b.textContent?.trim())
const side = (d: Element) => d.querySelector('.guide-side .schematic') as HTMLElement
const description = (d: Element) =>
  document.getElementById(side(d).querySelector('[role="img"]')!.getAttribute('aria-describedby')!)!
    .textContent

describe('Guide me: the map of the path and “What will be tested”', () => {
  it('builds the schematic step by step, in the user’s names', async () => {
    const d = await openGuide(columnTable(['Vehicle', '1 mg/kg', '10 mg/kg']))
    expect(d.querySelector('.guide-side')?.textContent).toMatch(/Choose a question/)
    act(() => button(d, 'Are the groups different?').click())
    // The table answers the count: a fact on the map, then the next question.
    expect(steps(d)).toEqual([
      'How many groups do you compare?→ Three or more groups',
      'NextWere the same subjects measured in every group?',
      'Then: a recommendation',
    ])
    expect(side(d).querySelector('.schematic-question')?.textContent).toBe(
      'Are the groups different?',
    )
    expect(side(d).querySelector('img')).not.toBeNull()
    expect(description(d)).toMatch(/Boxes: Vehicle; 1 mg\/kg; 10 mg\/kg\./)
    expect(side(d).querySelector('.schematic-pending')?.textContent).toBe(
      'Next: Were the same subjects measured in every group?',
    )
    act(() => radio(d, 'No, different subjects in each group').click())
    act(() => radio(d, 'Measurements').click())
    act(() => radio(d, 'No, similar scatter is expected').click())
    expect(side(d).querySelector('.schematic-question')?.textContent).toBe(
      'Do Vehicle, 1 mg/kg and 10 mg/kg differ in their mean?',
    )
    expect(side(d).querySelector('.schematic-null')?.textContent).toBe(
      'No effect: If the treatment had no effect, the means of all 3 groups would differ only by chance.',
    )
    // Every pair, then each against the control: the arrows change.
    act(() => radio(d, 'Every pair of groups').click())
    expect(description(d)).toMatch(
      /Compared: Vehicle with 1 mg\/kg; Vehicle with 10 mg\/kg; 1 mg\/kg with 10 mg\/kg\./,
    )
    expect(side(d).textContent).toMatch(/Every pair: 3 comparisons, one family \(Tukey\)\./)
    const before = side(d).querySelector('img')!.getAttribute('src')
    act(() => radio(d, 'Each group with a control').click())
    expect(description(d)).toMatch(/Compared: Vehicle with 1 mg\/kg; Vehicle with 10 mg\/kg\./)
    expect(description(d)).toMatch(/Vehicle \(control\)/)
    expect(side(d).querySelector('img')!.getAttribute('src')).not.toBe(before)
    expect(steps(d).at(-1)).toBe('Leads to: One-way ANOVA')
    // No statistic anywhere in the dialog.
    expect(d.textContent).not.toMatch(/P = |P < 0\.|P-value/)
  })

  it('links matched subjects; going back on the map keeps the later answers that apply', async () => {
    const d = await openGuide(columnTable(['Before', 'After']))
    act(() => button(d, 'Are the groups different?').click())
    act(() => radio(d, 'No, different subjects in each group').click())
    act(() => radio(d, 'Measurements (activity, area, the concentration of one analyte)').click())
    act(() => radio(d, 'Yes, or not sure').click())
    expect(description(d)).not.toMatch(/Linked/)
    // Back to "Were the same subjects…" from the map: its answer is focused.
    const back = [...d.querySelectorAll<HTMLButtonElement>('.guide-map .map-step')].find((b) =>
      b.textContent?.startsWith('Were the same subjects'),
    )!
    act(() => back.click())
    const question = d.querySelector('[data-question="matched"]')!
    expect(question.contains(document.activeElement)).toBe(true)
    expect((document.activeElement as HTMLInputElement).checked).toBe(true)
    act(() => radio(d, 'Yes, each row is one subject, plate or day').click())
    // "What kind of values?" is asked on the new branch too: kept; the scatter isn't.
    expect(steps(d)).toEqual([
      'How many groups do you compare?→ Two groups',
      'Were the same subjects measured in both groups?→ Yes, each row is one subject, plate or day',
      'What kind of values?→ Measurements',
      'Leads to: Paired t test',
    ])
    expect(description(d)).toMatch(/Linked, same subjects, row by row: Before, After\./)
    expect(side(d).querySelector('.schematic-question')?.textContent).toBe(
      'Is the mean change from Before to After different from zero?',
    )
  })

  it('the map by keyboard: one tab stop, arrows move, Enter goes back', async () => {
    const d = await openGuide(columnTable(['Control', 'Treated']))
    act(() => button(d, 'Are the groups different?').click())
    act(() => radio(d, 'No, different subjects in each group').click())
    const buttons = () => [...d.querySelectorAll<HTMLButtonElement>('.guide-map .map-step')]
    // The stop is where the path stands (the next question).
    expect(buttons().map((b) => b.tabIndex)).toEqual([-1, -1, 0, -1])
    expect(buttons()[2]!.getAttribute('aria-current')).toBe('step')
    act(() => buttons()[2]!.focus())
    const key = (k: string) =>
      act(() => {
        document.activeElement!.dispatchEvent(
          new KeyboardEvent('keydown', { key: k, bubbles: true }),
        )
      })
    key('ArrowUp')
    expect(document.activeElement).toBe(buttons()[1])
    expect(buttons()[1]!.getAttribute('aria-label')).toBe(
      'Step 2: Were the same subjects measured in both groups? Answer: No, different subjects in each group, one of 2 answers. Go back to change it.',
    )
    key('Home')
    expect(document.activeElement).toBe(buttons()[0])
    expect(buttons()[0]!.getAttribute('aria-label')).toMatch(
      /Answer: Two groups \(from your table\)\./,
    )
    key('End')
    expect(document.activeElement).toBe(buttons()[3])
    expect(buttons()[3]!.getAttribute('aria-disabled')).toBe('true')
    key('ArrowDown')
    expect(document.activeElement).toBe(buttons()[0])
    key('ArrowRight')
    // Enter on a button is its click: back to the question.
    act(() => (document.activeElement as HTMLButtonElement).click())
    expect(d.querySelector('[data-question="matched"]')!.contains(document.activeElement)).toBe(
      true,
    )
  })

  it('after Use this, the method’s own schematic above the sketch, with a one-tailed arrow', async () => {
    const d = await openGuide(columnTable(['Control', 'Treated']))
    act(() => button(d, 'Are the groups different?').click())
    act(() => radio(d, 'No, different subjects in each group').click())
    act(() => radio(d, 'Measurements (activity, area, the concentration of one analyte)').click())
    act(() => radio(d, 'Yes, or not sure').click())
    act(() => button(d, 'Use this').click())
    await settle()
    const details = d.querySelector('.analyze-side details.schematic-details') as HTMLDetailsElement
    expect(details.open).toBe(true)
    expect(details.querySelector('summary')?.textContent).toBe('What will be tested')
    expect(details.querySelector('.schematic-question')?.textContent).toBe(
      'Is the mean of Treated different from that of Control?',
    )
    // It sits above the sketch.
    const side = d.querySelector('.analyze-side')!
    expect(side.firstElementChild).toBe(details)
    // One-tailed, Treated predicted higher: the arrow points at Treated.
    const advanced = [...d.querySelectorAll('button')].find((b) =>
      /Advanced/i.test(b.textContent ?? ''),
    )
    if (advanced?.getAttribute('aria-expanded') === 'false') act(() => advanced.click())
    act(() => radio(d, 'One-tailed').click())
    const higher = [...d.querySelectorAll('label')].find((l) =>
      /Treated.* higher than .*Control/.test(l.textContent ?? ''),
    )!
    act(() => higher.querySelector('input')!.click())
    await settle()
    expect(details.querySelector('.schematic-question')?.textContent).toBe(
      'Is the mean of Treated higher than that of Control?',
    )
    const desc = document.getElementById(
      details.querySelector('[role="img"]')!.getAttribute('aria-describedby')!,
    )!.textContent
    expect(desc).toMatch(/Compared: Control to Treated \(Treated higher\?\)\./)
    // No result in it (the method's card explains P in words; the schematic says none).
    expect(details.textContent).not.toMatch(/\bP\b|CI\b/)
  })
})

describe('the narrow dialog: a strip above the questions', () => {
  it('shows the schematic above the questions, and hides it', () => {
    const t = columnTable(['Control', 'Treated'])
    const facts = tableFacts('column', normalizeTable(t))
    function Harness() {
      const [answers, setAnswers] = React.useState<GuideAnswers>({ matched: 'yes' })
      return (
        <GuidePanel
          kind="column"
          tableName="Doses"
          facts={facts}
          groups={[...facts.groups]}
          choices={[...facts.groups]}
          selection={facts.groups.map((g) => g.key)}
          entryId="groupsDiffer"
          answers={answers}
          onEntry={() => {}}
          onAnswers={setAnswers}
          onSelection={() => {}}
          onUse={() => {}}
          onShowAll={() => {}}
          onNewTable={() => {}}
          fonts={fonts}
          layout="narrow"
        />
      )
    }
    host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
    act(() => root!.render(<Harness />))
    expect(document.querySelector('.guide-side')).toBeNull()
    const strip = document.querySelector('.guide-detail .guide-strip')!
    expect(strip.querySelector('.schematic.compact')).not.toBeNull()
    // Above the questions.
    const first = document.querySelector('.guide-detail .guide-question')!
    expect(strip.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const hide = [...strip.querySelectorAll('button')].find(
      (b) => b.textContent === 'Hide what will be tested',
    )!
    act(() => hide.click())
    expect(strip.querySelector('.schematic')).toBeNull()
    expect(hide.getAttribute('aria-expanded')).toBe('false')
  })
})

describe('the schematic’s picture', () => {
  it('follows the app’s colours (light or dark), drawn by @ps/graph', () => {
    const t = columnTable(['Control', 'Treated'])
    const facts = tableFacts('column', normalizeTable(t))
    const entry = guideEntry('groupsDiffer')!
    const spec = guideSchematic(entry, facts, { matched: 'yes', values: 'measure' })
    const light = schematicImage(spec, fonts, 'light')!
    const dark = schematicImage(spec, fonts, 'dark')!
    expect(light.svg).toContain('#2864cc')
    expect(dark.svg).toContain('#7aa8ff')
    expect(light.svg).not.toContain('#7aa8ff')
    // No background: the panel's own colour shows through.
    expect(light.svg).not.toMatch(/<rect x="0" y="0"/)
  })
})
