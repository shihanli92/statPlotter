import type { ArrowHead, ArrowShape, LineEnds } from '@ps/model'
import { NumberInput, Select } from './fields.tsx'

// Arrowheads at a line's ends (roadmap 32), for layout lines and graph line annotations alike.

type HeadChoice = ArrowShape | 'none'

export const ARROW_SHAPES: readonly { value: HeadChoice; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'triangle', label: 'Arrow (filled)' },
  { value: 'open', label: 'Arrow (open)' },
  { value: 'bar', label: 'Bar' },
  { value: 'circle', label: 'Dot' },
]

/** Start and end heads and their size (%), one size for both ends. */
export function ArrowheadFields({
  value,
  onChange,
}: {
  value: LineEnds
  onChange: (ends: LineEnds) => void
}) {
  const size = value.end?.size ?? value.start?.size ?? 1
  const head = (shape: HeadChoice): ArrowHead | undefined =>
    shape === 'none' ? undefined : { shape, ...(size !== 1 ? { size } : {}) }
  const set = (end: 'start' | 'end', shape: HeadChoice) => {
    const next: LineEnds = { ...value, [end]: head(shape) }
    if (!next[end]) delete next[end]
    onChange(next)
  }
  return (
    <>
      <div className="field-row">
        <Select<HeadChoice>
          label="Start"
          value={value.start?.shape ?? 'none'}
          options={ARROW_SHAPES}
          onChange={(v) => set('start', v)}
        />
        <Select<HeadChoice>
          label="End"
          value={value.end?.shape ?? 'none'}
          options={ARROW_SHAPES}
          onChange={(v) => set('end', v)}
        />
      </div>
      {(value.start || value.end) && (
        <NumberInput
          label="Head size (%)"
          value={Math.round(size * 100)}
          min={25}
          max={500}
          step={5}
          onChange={(pct) => {
            const s = pct / 100
            const resize = (h: ArrowHead | undefined) =>
              h && { shape: h.shape, ...(s !== 1 ? { size: s } : {}) }
            const next: LineEnds = {}
            if (value.start) next.start = resize(value.start)
            if (value.end) next.end = resize(value.end)
            onChange(next)
          }}
        />
      )}
    </>
  )
}
