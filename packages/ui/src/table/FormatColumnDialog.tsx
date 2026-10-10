import type { NumberDisplay } from '@ps/model'
import { useState } from 'react'
import { Dialog } from '../components/Dialog.tsx'
import { Field, Select } from '../components/fields.tsx'
import {
  cellShown,
  choiceOf,
  type DisplayChoice,
  type DisplayMode,
  displayOf,
  shownText,
} from './display.ts'

const MODES: { value: DisplayMode; label: string }[] = [
  { value: 'entered', label: 'As entered (full precision)' },
  { value: 'fixed', label: 'Fixed decimals' },
  { value: 'scientific', label: 'Scientific (1.2e+3)' },
  { value: 'power10', label: 'Power of ten (1.2×10³)' },
  { value: 'percent', label: 'Percent (× 100, with %)' },
]

/**
 * Format › Format column…: how the grid shows the numbers of the selected data sets (and X).
 * Only the grid changes: values, copies, exports, graphs and analyses keep every digit.
 */
export function FormatColumnDialog({
  names,
  current,
  sample,
  onApply,
  onClose,
}: {
  /** The columns formatted, for the heading ("Group A", "X"). */
  names: readonly string[]
  current: NumberDisplay | undefined
  /** A value shown in the preview. */
  sample: number
  onApply: (display: NumberDisplay | null) => void
  onClose: () => void
}) {
  const [choice, setChoice] = useState<DisplayChoice>(() => choiceOf(current))
  const [digits, setDigits] = useState(String(choice.digits))
  const set = (patch: Partial<DisplayChoice>) => setChoice((c) => ({ ...c, ...patch }))
  const d = Number(digits)
  const valid = Number.isInteger(d) && d >= 0 && d <= 15
  const next = displayOf({ ...choice, digits: valid ? d : 0 })
  const preview = shownText(cellShown({ value: sample, excluded: false }, next ?? undefined, false))
  const hasDigits = choice.mode !== 'entered'
  const hasThousands = ['entered', 'fixed', 'percent'].includes(choice.mode)
  return (
    <Dialog
      title="Format column"
      onClose={onClose}
      okLabel="OK"
      okDisabled={hasDigits && !valid}
      onOk={() => {
        onApply(next)
        onClose()
      }}
    >
      <p className="muted">
        How the grid shows the numbers of {names.join(', ')}. Only the display changes: copies,
        exports, graphs and analyses keep every digit.
      </p>
      <Select
        label="Numbers"
        value={choice.mode}
        options={MODES}
        onChange={(mode) => set({ mode })}
      />
      {hasDigits && (
        <Field
          label={
            choice.mode === 'fixed' || choice.mode === 'percent' ? 'Decimals' : 'Mantissa decimals'
          }
        >
          {(id) => (
            <input
              id={id}
              type="text"
              inputMode="numeric"
              value={digits}
              onChange={(e) => setDigits(e.target.value)}
            />
          )}
        </Field>
      )}
      {hasThousands && (
        <label className="field check">
          <input
            type="checkbox"
            checked={choice.thousands}
            onChange={(e) => set({ thousands: e.target.checked })}
          />
          Group thousands (1,000,000)
        </label>
      )}
      <div className="field">
        <div className="muted">
          {sample} shows as <b data-testid="format-preview">{preview}</b>
        </div>
      </div>
    </Dialog>
  )
}
