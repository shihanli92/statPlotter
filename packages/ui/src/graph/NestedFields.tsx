import type { NestedOptions } from '@ps/graph'
import { Checkbox, Select } from '../components/fields.tsx'

type NestedGraphStyle = Partial<NestedOptions>

const NESTED_LAYOUTS = [
  { value: 'subjects', label: 'Side by side within the group' },
  { value: 'pooled', label: 'Together in one column per group' },
] as const

const NESTED_MARKS = [
  { value: 'none', label: 'Nothing else' },
  { value: 'shade', label: 'A shade of the group colour' },
  { value: 'shape', label: 'Symbol shape' },
] as const

/**
 * How a nested table's subjects are drawn on a column graph: pooled or side by side within each
 * group, told apart by symbol or shade, with or without each subject's mean. `onChange` gets the
 * one field that changed.
 */
function NestedControls({
  value,
  onChange,
}: {
  value: NestedGraphStyle
  onChange: (v: NestedGraphStyle) => void
}) {
  return (
    <>
      <Select
        label="Place each subject’s values"
        value={value.layout ?? 'pooled'}
        options={NESTED_LAYOUTS}
        onChange={(layout) => onChange({ layout })}
      />
      <Select
        label="Tell subjects apart by"
        value={value.mark ?? 'none'}
        options={NESTED_MARKS}
        onChange={(mark) => onChange({ mark })}
      />
      <Checkbox
        label="Line at each subject’s mean"
        checked={value.subjectMeans ?? false}
        onChange={(subjectMeans) => onChange({ subjectMeans })}
      />
    </>
  )
}

/** The subject controls as a fieldset (the graph builder). */
export function NestedFields(props: {
  value: NestedGraphStyle
  onChange: (v: NestedGraphStyle) => void
}) {
  return (
    <fieldset className="field">
      <legend>Subjects (nested data)</legend>
      <NestedControls {...props} />
    </fieldset>
  )
}
