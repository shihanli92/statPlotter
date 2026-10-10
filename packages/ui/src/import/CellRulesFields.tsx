import { type CellRules, parseMissingCodes, type Sheet } from '@ps/io'
import { DEFAULT_LIMIT_RULE, type LimitRule, parseLimitText } from '@ps/model'
import { useMemo } from 'react'
import { Field } from '../components/fields.tsx'
import { type LimitColumn, LimitRuleFields } from '../table/LimitsDialog.tsx'

// The import dialog's missing codes and values at detection limits (roadmap 39).

export interface CellRulesState {
  /** The missing codes as typed ("-999, ND"). */
  missing: string
  /** Read values at a limit ("<0.5", "BLQ"). */
  limits: boolean
  rule: LimitRule
}

/** The dialog's first state: the preferences' codes; limits read when the sheet has any. */
export function initialCellRules(codes: readonly string[] | undefined, sheets: readonly Sheet[]) {
  return {
    missing: (codes ?? []).join(', '),
    limits: sheets.some((s) => limitCells(s).total > 0),
    rule: DEFAULT_LIMIT_RULE,
  } satisfies CellRulesState
}

/** The rules the importers take. */
export function cellRulesOf(state: CellRulesState): CellRules {
  const missing = parseMissingCodes(state.missing)
  return {
    ...(missing.length ? { missing } : {}),
    ...(state.limits ? { limits: state.rule, limitColumnsByTitle: true } : {}),
  }
}

/** A sheet's cells at a limit: how many, and per column title those that name no limit. */
export function limitCells(
  sheet: Sheet,
  header = false,
): { total: number; below: number; above: number; columns: LimitColumn[] } {
  let below = 0
  let above = 0
  const columns = new Map<number, LimitColumn>()
  sheet.rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (typeof cell !== 'string' || (header && r === 0)) return
      const p = parseLimitText(cell)
      if (!p) return
      if (p.side === 'below') below++
      else above++
      if (p.limit !== null) return
      let col = columns.get(c)
      if (!col) {
        const title = header ? String(sheet.rows[0]?.[c] ?? '').trim() : ''
        col = { key: title, title, words: { below: 0, above: 0 } }
        columns.set(c, col)
      }
      col.words[p.side]++
    })
  })
  // Without a header, words get one limit for all (titles aren't known).
  const list = [...columns.values()]
  const merged: LimitColumn[] = header
    ? list
    : list.length
      ? [
          {
            key: '',
            title: 'all columns',
            words: {
              below: list.reduce((n, c) => n + c.words.below, 0),
              above: list.reduce((n, c) => n + c.words.above, 0),
            },
          },
        ]
      : []
  return { total: below + above, below, above, columns: merged }
}

export function CellRulesFields({
  value,
  onChange,
  sheet,
  header,
}: {
  value: CellRulesState
  onChange: (v: CellRulesState) => void
  sheet: Sheet
  header: boolean
}) {
  const found = useMemo(() => limitCells(sheet, header), [sheet, header])
  const codes = parseMissingCodes(value.missing)
  return (
    <fieldset className="field import-rules">
      <legend>Missing values and detection limits</legend>
      <Field label="Missing-value codes">
        {(id) => (
          <>
            <input
              id={id}
              type="text"
              placeholder="e.g. -999, ND, not done"
              value={value.missing}
              onChange={(e) => onChange({ ...value, missing: e.target.value })}
            />
            <div className="muted">
              {codes.length
                ? `Cells reading ${codes.map((c) => `“${c}”`).join(', ')} import as empty, besides NA, N/A, NaN and “.”.`
                : 'NA, N/A, NaN and “.” import as empty; add your own codes, separated by commas.'}
            </div>
          </>
        )}
      </Field>
      <label className="check field">
        <input
          type="checkbox"
          checked={value.limits}
          onChange={(e) => onChange({ ...value, limits: e.target.checked })}
        />
        Values at detection limits (“&lt;0.5”, “BLQ”, “&gt;ULOQ”)
        {found.total > 0
          ? `: ${found.below} below and ${found.above} above in this sheet`
          : ': none in this sheet'}
      </label>
      {value.limits && (
        <div className="limit-rule">
          <LimitRuleFields
            rule={value.rule}
            onChange={(rule) => onChange({ ...value, rule })}
            columns={found.columns}
          />
          <div className="muted">
            Substituted cells are flagged in the table (Edit › Limits… changes the rule later);
            analyses use the substituted values.
          </div>
        </div>
      )}
    </fieldset>
  )
}
