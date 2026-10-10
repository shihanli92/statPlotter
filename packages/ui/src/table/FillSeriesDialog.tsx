import { useState } from 'react'
import { Dialog } from '../components/Dialog.tsx'
import { Field, Select } from '../components/fields.tsx'
import { type SeriesSpec, seriesValues } from './fill.ts'

type Kind = SeriesSpec['kind']

const KINDS: { value: Kind; label: string }[] = [
  { value: 'linear', label: 'Linear: add a step' },
  { value: 'multiply', label: 'Multiply by a factor (e.g. 10, or 0.5 for 1:2 dilutions)' },
  { value: 'log', label: 'Log: from start to end, evenly spaced on a log scale' },
]

const num = (s: string) => (s.trim() === '' ? Number.NaN : Number(s))

/**
 * Edit › Fill › Series…: numbers down the selected columns, over the selected rows or a count of
 * rows from the selection's top.
 */
export function FillSeriesDialog({
  rows,
  columns,
  onFill,
  onClose,
}: {
  /** Rows selected (the default count) and columns filled. */
  rows: number
  columns: number
  /** Returns an error to show, or null when filled. */
  onFill: (spec: SeriesSpec, count: number | undefined) => string | null
  onClose: () => void
}) {
  const [kind, setKind] = useState<Kind>('linear')
  const [start, setStart] = useState('1')
  const [step, setStep] = useState('1')
  const [factor, setFactor] = useState('10')
  const [end, setEnd] = useState('1000')
  const [useCount, setUseCount] = useState(rows <= 1)
  const [count, setCount] = useState(String(Math.max(rows, 10)))
  const [error, setError] = useState<string | null>(null)

  const spec = (): SeriesSpec =>
    kind === 'linear'
      ? { kind, start: num(start), step: num(step) }
      : kind === 'multiply'
        ? { kind, start: num(start), factor: num(factor) }
        : { kind, start: num(start), end: num(end) }
  const n = useCount ? num(count) : rows
  const preview = Number.isInteger(n) && n >= 1 ? seriesValues(spec(), Math.min(n, 6)) : null
  const fill = () => {
    if (!(Number.isInteger(n) && n >= 1 && n <= 1_000_000))
      return setError('Enter a number of rows.')
    const err = onFill(spec(), useCount ? n : undefined)
    if (err) setError(err)
    else onClose()
  }
  const input = (label: string, value: string, set: (v: string) => void) => (
    <Field label={label}>
      {(id) => (
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => set(e.target.value)}
        />
      )}
    </Field>
  )
  return (
    <Dialog title="Fill series" onClose={onClose} okLabel="Fill" onOk={fill}>
      <Select label="Series" value={kind} options={KINDS} onChange={setKind} />
      {input('Start', start, setStart)}
      {kind === 'linear' && input('Step', step, setStep)}
      {kind === 'multiply' && input('Factor', factor, setFactor)}
      {kind === 'log' && input('End', end, setEnd)}
      <fieldset className="field radio">
        <legend>Fill</legend>
        <label className="check">
          <input
            type="radio"
            name="fill-rows"
            checked={!useCount}
            disabled={rows <= 1}
            onChange={() => setUseCount(false)}
          />
          The selected rows ({rows})
        </label>
        <label className="check">
          <input
            type="radio"
            name="fill-rows"
            checked={useCount}
            onChange={() => setUseCount(true)}
          />
          This many rows from the first selected row:
          <input
            aria-label="Number of rows"
            className="count"
            type="text"
            inputMode="numeric"
            value={count}
            onChange={(e) => {
              setCount(e.target.value)
              setUseCount(true)
            }}
          />
        </label>
      </fieldset>
      <div className="field">
        <div className="muted">
          {columns === 1 ? 'The selected column' : `Each of the ${columns} selected columns`} gets{' '}
          {Array.isArray(preview)
            ? `${preview.join(', ')}${n > preview.length ? ', …' : ''}`
            : (preview ?? '…')}
        </div>
        {error && <div className="error-text">{error}</div>}
      </div>
    </Dialog>
  )
}
