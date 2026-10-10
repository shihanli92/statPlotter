import type { Command } from '@ps/engine'
import {
  constantList,
  type DataSetColumn,
  type DataTable,
  FORMULA_FUNCTIONS,
  type FormulaCategory,
  formulaReference,
  infoSheets,
  newColumnId,
  numberFromText,
  tableFormulas,
} from '@ps/model'
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { useConfirm } from '../components/modals.tsx'
import { useDoc } from '../context.tsx'
import { type VariableKind, variableKind } from './gridModel.ts'

/*
 * Multiple-variables tables: what kind each variable is (numbers, text categories, calculated)
 * and the formula of a calculated one, edited in a bar above the grid for the focused column.
 */

const FORMULA_HELP = [
  'A formula calculates a variable row by row from the others.',
  'Variables by name: Weight, [Body weight (kg)] or Body_weight (case is ignored).',
  'Operators: + − * / ^, comparisons = <> < <= > >= (1 = true, 0 = false), and, or, not.',
  `Functions: ${FORMULA_FUNCTIONS.map((f) => f.name).join(', ')} (ƒx Functions lists them).`,
  'Text compares with text in quotes: if(Group = "WT", 1, 0); a text result makes a text variable.',
  'Rows missing a value the formula needs stay empty.',
  'Info sheets’ numbers are constants: [Info: dilution] (the first info sheet with that field) or [Sheet name: dilution].',
].join('\n')

const CATEGORIES: readonly FormulaCategory[] = [
  'Maths',
  'Logic',
  'Statistics',
  'Groups',
  'Running',
  'Text',
  'Categories',
]

interface Suggestion {
  /** What is inserted: a function's name and "(", or a variable's reference. */
  insert: string
  label: string
  detail: string
}

/**
 * Roadmap 38: what the formula bar suggests for the name being typed before the caret (functions,
 * then variables), and where that name starts; null outside a name (in text, in [ ]).
 */
export function suggestionsAt(
  text: string,
  caret: number,
  variables: readonly string[],
): { start: number; items: Suggestion[] } | null {
  const before = text.slice(0, caret)
  // Inside quoted text or a [name]: nothing to suggest.
  if ((before.match(/"/g)?.length ?? 0) % 2 === 1) return null
  if (before.lastIndexOf('[') > before.lastIndexOf(']')) return null
  const word = /[\p{L}_][\p{L}\p{N}_]*$/u.exec(before)?.[0]
  if (!word) return null
  const start = caret - word.length
  // A name already followed by "(" is complete.
  if (text[caret] === '(') return null
  const w = word.toLowerCase()
  const items: Suggestion[] = [
    ...FORMULA_FUNCTIONS.filter((f) => f.name.startsWith(w)).map((f) => ({
      insert: `${f.name}(`,
      label: f.signature,
      detail: f.description,
    })),
    ...variables
      .filter((v) => v.trim() && v.toLowerCase().replace(/\s+/g, '_').startsWith(w))
      .map((v) => ({ insert: formulaReference(v), label: v, detail: 'Variable' })),
  ].slice(0, 8)
  if (!items.length || (items.length === 1 && items[0]!.insert === word)) return null
  return { start, items }
}

/** The mark after a variable's title in the grid header: text or calculated (with its state). */
export function variableBadge(table: DataTable, ds: DataSetColumn): ReactNode {
  if (ds.text)
    return (
      <span className="var-badge text" title="Text (categorical) variable">
        abc
      </span>
    )
  if (ds.formula === undefined) return null
  const error = tableFormulas(table).get(ds.id)?.error
  return (
    <span
      className={`var-badge calc${error ? ' error' : ''}`}
      title={error ? `${ds.formula}\n${error}` : `Calculated: ${ds.formula}`}
    >
      ƒx
    </span>
  )
}

function nextName(table: DataTable): string {
  const taken = new Set(table.dataSets.map((d) => d.title.trim().toLowerCase()))
  for (let k = 1; ; k++) if (!taken.has(`calculated ${k}`)) return `Calculated ${k}`
}

const KIND_LABELS: Record<VariableKind, string> = {
  number: 'Numbers',
  text: 'Text (categories)',
  calculated: 'Calculated (ƒx)',
}

export function FormulaBar({
  table,
  focused,
  dispatch,
  onAdded,
  onDone,
}: {
  table: DataTable
  /** The variable of the focused column, if any. */
  focused: DataSetColumn | null
  dispatch: (cmds: Command | Command[], label?: string) => boolean
  /** A new calculated variable was added. */
  onAdded: (id: string) => void
  /** Editing finished: the grid takes the keyboard again. */
  onDone: () => void
}) {
  const confirm = useConfirm()
  // Roadmap 40: the info sheets' fields, as constants formulas can name.
  const constants = constantList(infoSheets(useDoc((d) => d)))
  // What is being typed, for the focused variable or a new one.
  const [draft, setDraft] = useState<{ target: string; text: string; name: string } | null>(null)
  const formulaInput = useRef<HTMLInputElement>(null)
  // Roadmap 41: the formula box takes the focus in the commit that shows it (a layout effect),
  // not a frame later — a later frame could take it from the field the user (or a test) had
  // already moved to, sending the new variable's name into the formula.
  const focusFormula = useRef(false)
  useLayoutEffect(() => {
    if (!focusFormula.current) return
    focusFormula.current = false
    formulaInput.current?.focus()
  })
  // Where the caret goes after an insert (a suggestion taken, a reference clicked), set in the
  // commit that shows the new text (audit 2): a frame later, keys typed meanwhile went in at the
  // old caret and then the caret jumped back before them ("=rank([S" typed fast became
  // "=rank(BP before], …)[S").
  const caretAfter = useRef<number | null>(null)
  useLayoutEffect(() => {
    const at = caretAfter.current
    if (at === null) return
    caretAfter.current = null
    formulaInput.current?.focus()
    formulaInput.current?.setSelectionRange(at, at)
  })
  // Roadmap 38: autocomplete of functions and variables, and the functions' reference.
  const [suggest, setSuggest] = useState<{
    start: number
    items: Suggestion[]
    index: number
    moved?: boolean
  } | null>(null)
  const [reference, setReference] = useState(false)
  const adding = draft?.target === 'new'
  const target = adding ? 'new' : (focused?.id ?? null)
  const text = draft && draft.target === target ? draft.text : (focused?.formula ?? '')
  const kind = focused ? variableKind(focused) : null
  const result =
    !adding && focused?.formula !== undefined ? tableFormulas(table).get(focused.id) : undefined

  // From the latest draft (not this render's), so edits in quick succession all count.
  const edit = (patch: Partial<{ text: string; name: string }>) =>
    setDraft((d) => ({
      target: target ?? '',
      text: d?.target === target ? d.text : text,
      name: d?.target === target ? d.name : '',
      ...patch,
    }))

  const cancel = () => {
    setDraft(null)
    setSuggest(null)
    onDone()
  }

  const variableTitles = table.dataSets
    .filter((d) => d.id !== (adding ? undefined : focused?.id))
    .map((d) => d.title)
  const typed = (value: string, caret: number) => {
    edit({ text: value })
    const s = suggestionsAt(value, caret, variableTitles)
    setSuggest(s ? { ...s, index: 0 } : null)
  }
  /** Puts `insert` in place of the name being typed (or at the caret), the caret after it. */
  const insertAt = (insert: string, start?: number) => {
    const input = formulaInput.current
    const caret = input?.selectionStart ?? text.length
    const from = start ?? caret
    const base = draft?.target === target ? draft.text : text
    const next = base.slice(0, from) + insert + base.slice(caret)
    edit({ text: next })
    setSuggest(null)
    caretAfter.current = from + insert.length
  }

  const commit = () => {
    if (!draft || draft.target !== target) return
    const formula = draft.text.trim()
    if (draft.target === 'new') {
      if (!formula || formula === '=') return cancel()
      const id = newColumnId()
      const title = draft.name.trim() || nextName(table)
      const ok = dispatch(
        [
          { type: 'table.addDataSet', table: table.id, id, title },
          { type: 'table.setFormula', table: table.id, id, formula },
        ],
        'New calculated variable',
      )
      if (ok) {
        setDraft(null)
        onAdded(id)
        onDone()
      }
      return
    }
    if (!focused || !formula || formula === '=' || formula === focused.formula) return cancel()
    const ok = dispatch(
      { type: 'table.setFormula', table: table.id, id: focused.id, formula },
      focused.formula !== undefined ? 'Edit formula' : 'Calculated variable',
    )
    // A formula that doesn't parse stays in the bar to be corrected.
    if (ok) {
      setDraft(null)
      onDone()
    }
  }

  const setKind = async (to: VariableKind) => {
    if (!focused || to === kind) return
    if (to === 'calculated') {
      setDraft({ target: focused.id, text: '=', name: '' })
      focusFormula.current = true
      return
    }
    if (to === 'number' && focused.text) {
      const lost = focused.text.filter((s) => s !== null && numberFromText(s) === null).length
      if (
        lost &&
        !(await confirm({
          title: 'Make it numeric?',
          message: `${lost} ${lost === 1 ? 'value' : 'values'} of “${focused.title}” ${lost === 1 ? 'is' : 'are'} not a number and will be cleared (undo brings them back).`,
          ok: 'Make numeric',
        }))
      )
        return
    }
    dispatch(
      { type: 'table.setVariableType', table: table.id, ids: [focused.id], to },
      to === 'text' ? 'Make text variable' : 'Make numeric variable',
    )
  }

  const keys = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (suggest && e.currentTarget === formulaInput.current) {
      const n = suggest.items.length
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setSuggest({
          ...suggest,
          index: (suggest.index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n,
          moved: true,
        })
        return
      }
      // Tab takes the suggestion; Enter only once one was picked with the arrows (else it
      // applies the formula as typed).
      if (e.key === 'Tab' || (e.key === 'Enter' && suggest.moved)) {
        e.preventDefault()
        insertAt(suggest.items[suggest.index]!.insert, suggest.start)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setSuggest(null)
        return
      }
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    }
  }

  let status: ReactNode = null
  if (adding)
    status = (
      <span className="muted">Name the new variable and type its formula; Enter adds it.</span>
    )
  else if (result?.error) status = <span className="error-text">{result.error}</span>
  else if (result?.invalidRows.length)
    status = (
      <span className="warn-text">
        {result.invalidRows.length} {result.invalidRows.length === 1 ? 'row gives' : 'rows give'} no
        number (#NUM)
      </span>
    )
  else if (focused && kind !== 'calculated')
    status = (
      <span className="muted">
        Type a formula (=…) to calculate “{focused.title}” from other variables.
      </span>
    )

  return (
    <div className="formula-bar">
      {!adding && (
        <label className="formula-kind">
          <span className="muted">Variable</span>
          <select
            value={kind ?? ''}
            disabled={!focused}
            onChange={(e) => void setKind(e.target.value as VariableKind)}
            title="What the focused variable holds"
          >
            {!focused && <option value="">—</option>}
            {(Object.keys(KIND_LABELS) as VariableKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      )}
      {adding && (
        <input
          className="formula-name"
          placeholder={nextName(table)}
          value={draft.name}
          aria-label="Name of the new variable"
          onChange={(e) => edit({ name: e.target.value })}
          onKeyDown={keys}
        />
      )}
      <button
        type="button"
        className="fx"
        title={FORMULA_HELP}
        aria-expanded={reference}
        aria-label="Formula functions"
        // Keeps the formula being typed in its field (a blur would apply it).
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setReference((r) => !r)}
      >
        ƒx
      </button>
      <div className="formula-field">
        <input
          ref={formulaInput}
          className="formula-input"
          aria-label="Formula"
          disabled={!focused && !adding}
          value={text}
          placeholder={
            adding
              ? '=Weight / Height^2'
              : focused
                ? kind === 'calculated'
                  ? ''
                  : 'Not calculated'
                : 'Select a variable'
          }
          onChange={(e) => typed(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onKeyDown={keys}
          onBlur={() => {
            setSuggest(null)
            if (!adding) commit()
          }}
          title={FORMULA_HELP}
          aria-autocomplete="list"
          aria-controls={suggest ? 'formula-suggestions' : undefined}
        />
        {suggest && (
          <div className="formula-suggestions" id="formula-suggestions" role="listbox">
            {suggest.items.map((it, i) => (
              <div
                key={it.insert}
                role="option"
                tabIndex={-1}
                aria-selected={i === suggest.index}
                className={i === suggest.index ? 'active' : undefined}
                onMouseDown={(e) => {
                  e.preventDefault()
                  insertAt(it.insert, suggest.start)
                }}
              >
                <span className="name">{it.label}</span>
                <span className="muted">{it.detail}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {adding ? (
        <>
          <button type="button" className="primary" onClick={commit}>
            Add
          </button>
          <button type="button" onClick={cancel}>
            Cancel
          </button>
        </>
      ) : (
        <>
          {kind === 'calculated' && focused && (
            <button
              type="button"
              title="Replace the formula by the values it gives now (they no longer update)"
              onClick={() =>
                dispatch(
                  { type: 'table.setFormula', table: table.id, id: focused.id, formula: null },
                  'Convert to values',
                )
              }
            >
              Convert to values
            </button>
          )}
          <button
            type="button"
            title="Add a variable calculated from the others by a formula"
            onClick={() => {
              setDraft({ target: 'new', text: '=', name: '' })
              focusFormula.current = true
            }}
          >
            + Calculated variable
          </button>
        </>
      )}
      <span className="formula-status">{status}</span>
      {reference && (
        <div className="formula-reference" role="dialog" aria-label="Formula functions">
          <div className="formula-reference-head">
            <strong>Functions</strong>
            <span className="muted">
              {focused || adding
                ? 'Click one to insert it.'
                : 'Select a variable to write a formula.'}
            </span>
            <button
              type="button"
              aria-label="Close the functions"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setReference(false)}
            >
              ×
            </button>
          </div>
          {constants.length > 0 && (
            <section>
              <h4>Info constants</h4>
              <dl>
                {constants.map((c) => (
                  <div key={c.reference}>
                    <dt>
                      <button
                        type="button"
                        className="link"
                        disabled={(!focused && !adding) || !c.number}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          if (!adding && focused && focused.formula === undefined && !draft)
                            setDraft({ target: focused.id, text: '=', name: '' })
                          insertAt(c.reference)
                        }}
                      >
                        {c.reference}
                      </button>
                    </dt>
                    <dd>
                      {c.number ? `= ${c.value.trim()}` : `“${c.value.trim()}” (not a number)`}{' '}
                      <span className="muted">({c.sheet})</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          {CATEGORIES.map((c) => (
            <section key={c}>
              <h4>{c}</h4>
              <dl>
                {FORMULA_FUNCTIONS.filter((f) => f.category === c).map((f) => (
                  <div key={f.name}>
                    <dt>
                      <button
                        type="button"
                        className="link"
                        disabled={!focused && !adding}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          if (!adding && focused && focused.formula === undefined && !draft)
                            setDraft({ target: focused.id, text: '=', name: '' })
                          insertAt(`${f.name}(`)
                        }}
                      >
                        {f.signature}
                      </button>
                    </dt>
                    <dd>{f.description}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
