// @vitest-environment happy-dom
import type { AnalysisNode, FormField, MethodChange } from '@ps/model'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { historyLines, MethodChangeNotice, MethodHistory } from '../src/analysis/MethodHistory.tsx'
import { ParamsForm } from '../src/analysis/ParamsForm.tsx'

// Roadmap 51c (design §7.1, §7.2, S1, S5, S34): the notice when a method changes after its
// results were seen, the method history under the results, and the form's greyed choices,
// percentages and data set names.

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

function render(el: ReactNode): HTMLElement {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root!.render(el))
  return host
}

const setValue = (el: HTMLInputElement | HTMLTextAreaElement, text: string) =>
  act(() => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
    Object.getOwnPropertyDescriptor(proto.prototype, 'value')!.set!.call(el, text)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })

const change = (extra: Partial<MethodChange> = {}): MethodChange => ({
  at: '2026-10-12T10:00:00Z',
  from: { analysisId: 'ttest', pluginVersion: 2, params: {}, dataSets: ['a', 'b'] },
  changes: ['P value: Two-tailed → One-tailed'],
  afterResults: true,
  ...extra,
})

const node = (history?: MethodChange[], historyEarlier?: number): AnalysisNode => ({
  kind: 'analysis',
  id: 'n1' as AnalysisNode['id'],
  name: 'a',
  analysisId: 'ttest',
  pluginVersion: 2,
  input: { source: 't1' as AnalysisNode['id'], dataSets: [] },
  params: {},
  ...(history ? { history } : {}),
  ...(historyEarlier ? { historyEarlier } : {}),
})

describe('the method change notice', () => {
  it('lists the changes, takes a reason, and offers a new analysis instead', () => {
    const onReason = vi.fn()
    const onAddAsNew = vi.fn()
    const el = render(
      <MethodChangeNotice
        changes={['P value: Two-tailed → One-tailed', 'Data sets: removed Mouse 3']}
        reason=""
        onReason={onReason}
        onAddAsNew={onAddAsNew}
      />,
    )
    expect(el.querySelector('[role="note"]')!.textContent).toMatch(/after seeing results/)
    expect([...el.querySelectorAll('li')].map((l) => l.textContent)).toEqual([
      'P value: Two-tailed → One-tailed',
      'Data sets: removed Mouse 3',
    ])
    setValue(el.querySelector('textarea')!, 'a typo in the design')
    expect(onReason).toHaveBeenLastCalledWith('a typo in the design')
    const add = [...el.querySelectorAll('button')].find((b) => /new analysis/.test(b.textContent!))
    act(() => add!.click())
    expect(onAddAsNew).toHaveBeenCalledOnce()
  })
})

describe('the method history', () => {
  it('nothing when the method never changed', () => {
    expect(render(<MethodHistory node={node()} />).innerHTML).toBe('')
  })

  it('each change: when, after results or not, what it was, why; open after results', () => {
    const n = node([change({ reason: 'pre-registered' }), change({ afterResults: false })], 2)
    expect(historyLines(n)).toEqual([
      '2 earlier changes.',
      '12 Oct 2026: changed after its results were seen (it was t test): P value: Two-tailed → One-tailed — reason: “pre-registered”.',
      '12 Oct 2026: changed before results (it was t test): P value: Two-tailed → One-tailed.',
    ])
    const el = render(<MethodHistory node={n} />)
    const d = el.querySelector('details')!
    expect(d.open).toBe(true)
    expect(d.querySelector('summary')!.textContent).toBe(
      'Method history: changed after results were seen (3)',
    )
  })

  it('closed when every change came before results', () => {
    const d = render(<MethodHistory node={node([change({ afterResults: false })])} />)
    expect(d.querySelector('details')!.open).toBe(false)
  })
})

describe('the form', () => {
  const fields: FormField[] = [
    {
      path: ['sphericity'],
      label: 'Sphericity',
      kind: 'radio',
      options: [
        { value: 'gg', label: 'Not assumed' },
        { value: 'assume', label: 'Assumed' },
      ],
      unavailableIf: {
        fact: 'missingInMatched',
        when: [{ path: ['rmMethod'], in: ['auto'] }],
        reason: 'Values are missing: the mixed model is fitted, which needs no sphericity.',
      },
    },
    {
      path: ['predicted'],
      label: 'Which way did you predict?',
      kind: 'radio',
      options: [
        { value: 'increase', label: '{B} higher than {A}' },
        { value: 'decrease', label: '{B} lower than {A}' },
      ],
    },
    { path: ['alpha'], label: 'Alpha (%)', kind: 'number', percent: true, min: 0, max: 1 },
  ]
  const context = (missing: boolean) => ({
    dataSets: [
      { key: 'a', title: 'Control' },
      { key: 'b', title: 'Treated' },
    ],
    facts: { missingInMatched: missing },
  })

  it('greys a choice that doesn’t apply to the data, with the reason', () => {
    const value = { sphericity: 'gg', rmMethod: 'auto', predicted: 'increase', alpha: 0.05 }
    const greyed = render(
      <ParamsForm fields={fields} value={value} onChange={() => {}} context={context(true)} />,
    )
    const fs = greyed.querySelector('fieldset')!
    expect(fs.disabled).toBe(true)
    expect(fs.querySelector('.unavailable-reason')!.textContent).toMatch(/mixed model/)
    act(() => root!.unmount())
    root = null
    const plain = render(
      <ParamsForm
        fields={fields}
        value={{ ...value, rmMethod: 'anova' }}
        onChange={() => {}}
        context={context(true)}
      />,
    )
    expect(plain.querySelector('fieldset')!.disabled).toBe(false)
  })

  it('names the data sets in a one-tailed direction; a fraction typed as a percentage', () => {
    const onChange = vi.fn()
    const el = render(
      <ParamsForm
        fields={fields}
        value={{ sphericity: 'gg', rmMethod: 'anova', predicted: 'increase', alpha: 0.05 }}
        onChange={onChange}
        context={context(false)}
      />,
    )
    const labels = [...el.querySelectorAll('fieldset')[1]!.querySelectorAll('label')].map(
      (l) => l.textContent,
    )
    expect(labels).toEqual(['“Treated” higher than “Control”', '“Treated” lower than “Control”'])
    const box = el.querySelector('input[type="text"]') as HTMLInputElement
    expect(box.value).toBe('5')
    setValue(box, '1')
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ alpha: 0.01 }))
  })
})
