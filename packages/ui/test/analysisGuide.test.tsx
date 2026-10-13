// @vitest-environment happy-dom
import { registry, tableFacts } from '@ps/analyses'
import { createTable, normalizeTable, type TableFacts } from '@ps/model'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { factsLine, type GuideChoice, GuidePanel, methodLine } from '../src/analysis/GuidePanel.tsx'
import { MethodCards } from '../src/analysis/MethodCards.tsx'
import { ParamsForm } from '../src/analysis/ParamsForm.tsx'

// Roadmap 51a: the Guide me tab (questions → a recommendation with its reasons → Use this) and
// the explanation lines of the Analyze form (a line per question and option, the reason beside
// "(recommended)", ⓘ for the longer card).

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

let root: Root | null = null
let host: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
  host = null
})

function render(node: React.ReactNode) {
  host ??= document.body.appendChild(document.createElement('div'))
  root ??= createRoot(host)
  act(() => root!.render(node))
}

const table = (() => {
  const t = createTable({ tableKind: 'column', columns: 3, rows: 6 })
  t.dataSets.forEach((d, i) => {
    d.title = ['Vehicle', '1 mg/kg', '10 mg/kg'][i]!
    d.subcolumns[0]!.values = [1, 2, 3, 4, 5, 6].map((v) => v * (i + 1) + 0.5)
  })
  return t
})()

/** The panel with its state kept here, as the dialog keeps it. */
function Harness({ facts, used }: { facts: TableFacts; used: GuideChoice[] }) {
  const [state, set] = React.useState<{ entry: string | null; answers: Record<string, string> }>({
    entry: null,
    answers: {},
  })
  return (
    <GuidePanel
      kind="column"
      tableName="Dose response"
      facts={facts}
      groups={facts.groups.map((g) => ({ key: g.key, title: g.title }))}
      choices={facts.groups.map((g) => ({ key: g.key, title: g.title }))}
      selection={facts.groups.map((g) => g.key)}
      entryId={state.entry}
      answers={state.answers}
      onEntry={(entry) => set({ entry, answers: {} })}
      onAnswers={(answers) => set((s) => ({ ...s, answers }))}
      onSelection={() => {}}
      onUse={(c) => used.push(c)}
      onShowAll={() => {}}
      onNewTable={() => {}}
    />
  )
}

import React from 'react'

const button = (text: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!
const radio = (text: string) =>
  [...document.querySelectorAll('label')]
    .find((l) => l.textContent?.trim() === text)!
    .querySelector('input') as HTMLInputElement

describe('Guide me', () => {
  const facts = tableFacts('column', normalizeTable(table))

  it('says what the table is, from its shape only', () => {
    expect(factsLine(facts)).toBe(
      '3 groups (Vehicle, 1 mg/kg, 10 mg/kg), 6 values each, raw values.',
    )
  })

  it('asks about the experiment, then recommends with a reason; Use this hands over the params', () => {
    const used: GuideChoice[] = []
    render(<Harness facts={facts} used={used} />)
    act(() => button('Is each group different from a control?').click())
    // The number of groups is a fact of the table; the design questions are asked.
    expect(document.querySelector('.guide-fact')?.textContent).toMatch(/Three or more groups/)
    act(() => radio('No, different subjects in each group').click())
    act(() => radio('Measurements').click())
    act(() => radio('No, similar scatter is expected').click())
    // Each with a control: answered by the question chosen; the control is asked for.
    const rec = document.querySelector('.guide-recommendation')!
    expect(rec.querySelector('h3')?.textContent).toBe('Recommended: One-way ANOVA')
    expect(rec.textContent).toMatch(/adjusted for their number/)
    expect(rec.querySelector('.guide-method')?.textContent).toBe('One-way ANOVA · Dunnett · 95% CI')
    // No statistic anywhere: no P, no CI of a difference.
    expect(document.querySelector('.guide')?.textContent).not.toMatch(/P = |P < 0\.0/)
    act(() => button('Use this').click())
    expect(used).toHaveLength(1)
    const c = used[0]!
    expect(c.analysisId).toBe('oneWayAnova')
    expect(c.entry).toBe('vsControl')
    expect(c.params).toMatchObject({
      matched: false,
      gaussian: true,
      equalSD: 'yes',
      comparisons: 'vsControl',
      control: table.dataSets[0]!.id,
      controlMethod: 'dunnett',
    })
    expect(registry.get('oneWayAnova')!.params.safeParse(c.params).success).toBe(true)
  })

  it('greys an answer the table rules out, with the reason', () => {
    const summary: TableFacts = { ...facts, raw: false }
    render(<Harness facts={summary} used={[]} />)
    act(() => button('Are the groups different?').click())
    const yes = radio('Yes, each row is one subject')
    expect(yes.getAttribute('aria-disabled')).toBe('true')
    const why = document.getElementById(yes.getAttribute('aria-describedby')!)
    expect(why?.textContent).toBe('Matching needs the raw values, not mean/SD/N.')
  })

  it('lists the questions of other table kinds under Not here?, with what they need', () => {
    render(<Harness facts={facts} used={[]} />)
    const notHere = document.querySelector('.guide-elsewhere')!
    expect(notHere.textContent).toMatch(/Fit a dose-response curve \(EC50 \/ IC50\)/)
    expect(notHere.textContent).toMatch(/Needs an XY table/)
    expect(button('New XY table…')).toBeDefined()
  })

  it('writes the method line from the cards', () => {
    expect(methodLine('ttest', { design: 'unpaired', unpaired: { assumeEqualSD: false } })).toBe(
      'Welch’s t test · 95% CI · two-tailed',
    )
  })
})

describe('the Analyze form’s explanations', () => {
  it('show a line per question and option, and why an option is recommended', () => {
    const def = registry.get('ttest')!
    render(
      <ParamsForm
        fields={def.form}
        value={def.params.parse({}) as Record<string, unknown>}
        onChange={() => {}}
      />,
    )
    const design = [...document.querySelectorAll('fieldset')].find((f) =>
      f.querySelector('legend')?.textContent?.startsWith('Same subjects in both groups?'),
    )!
    const described = document.getElementById(design.getAttribute('aria-describedby')!)
    expect(described?.textContent).toMatch(/decided by how the experiment was done/)
    const twoTailed = radio('Two-tailed (recommended)')
    const line = document.getElementById(twoTailed.getAttribute('aria-describedby')!)
    expect(line?.textContent).toMatch(/Recommended: the right choice unless you stated a direction/)
    // Roadmap 51c (S2): Welch's t test is the default choice, recommended with its reason.
    const welch = radio('Yes, or not sure: Welch’s t test (recommended)')
    expect(welch.checked).toBe(true)
    expect(document.getElementById(welch.getAttribute('aria-describedby')!)?.textContent).toMatch(
      /Recommended: it protects P when scatter differs/,
    )
  })

  it('opens the longer card behind ⓘ', () => {
    const def = registry.get('ttest')!
    render(
      <ParamsForm
        fields={def.form}
        value={def.params.parse({}) as Record<string, unknown>}
        onChange={() => {}}
      />,
    )
    const info = document.querySelector<HTMLButtonElement>(
      'button[aria-label="About “Same subjects in both groups?”"]',
    )!
    expect(info.getAttribute('aria-expanded')).toBe('false')
    act(() => info.click())
    expect(info.getAttribute('aria-expanded')).toBe('true')
    expect(document.getElementById(info.getAttribute('aria-controls')!)?.textContent).toMatch(
      /Pairing removes subject-to-subject variation/,
    )
  })

  it('show a select’s chosen option and the reason beside its recommended one', () => {
    const def = registry.get('oneWayAnova')!
    render(
      <ParamsForm
        fields={def.form}
        value={{ ...(def.params.parse({}) as Record<string, unknown>), allPairsMethod: 'sidak' }}
        onChange={() => {}}
      />,
    )
    const help = [...document.querySelectorAll('.field .help')].map((h) => h.textContent).join(' ')
    expect(help).toMatch(/Šidák: Splits the error rate/)
    expect(help).toMatch(/Tukey \(recommended\): Recommended: made for comparing every pair/)
  })
})

describe('method cards', () => {
  it('fill in the user’s group names', () => {
    render(<MethodCards ids={['welchT']} names={{ A: 'Control', B: 'Treated' }} mode="reading" />)
    const card = document.querySelector('.method-card')!
    expect(card.querySelector('h4')?.textContent).toBe('Welch’s t test')
    expect(card.textContent).toMatch(/difference between the means \(“Treated” − “Control”\)/)
    expect(card.textContent).toMatch(/R: t\.test\(B, A\)/)
  })
})
