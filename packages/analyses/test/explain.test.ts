import type { FormField, MethodCard } from '@ps/model'
import { describe, expect, it } from 'vitest'
import {
  CARD_FAMILIES,
  GUIDE_ENTRIES,
  guidePaths,
  METHOD_CARDS,
  registry,
  tableFacts,
} from '../src/index.ts'

// Roadmap 51a (design §2.3): every analysis, field and option has its text; cards are complete
// and reachable; lengths and the writing style of §2.4 hold. (No product names: the repository's
// brand guard, ui/test/noBrand.test.ts, reads every tracked file, these included.)

const defs = registry.list()
const choice = (f: FormField) => f.kind === 'select' || f.kind === 'radio'

/** Every combination of the select and radio values (sampled when there are very many). */
function combinations(form: readonly FormField[]): Record<string, unknown>[] {
  const fields = form.filter(choice) as Extract<FormField, { kind: 'select' | 'radio' }>[]
  const unique = new Map(fields.map((f) => [f.path.join('.'), f]))
  let out: Record<string, unknown>[] = [{}]
  for (const f of unique.values()) {
    const next: Record<string, unknown>[] = []
    for (const p of out)
      for (const o of f.options) {
        const copy = structuredClone(p) as Record<string, unknown>
        let at = copy
        f.path.slice(0, -1).forEach((k) => {
          at[k] = { ...((at[k] as object) ?? {}) }
          at = at[k] as Record<string, unknown>
        })
        at[f.path.at(-1)!] = o.value
        next.push(copy)
      }
    // Keep it bounded: every value of every field still appears.
    out =
      next.length > 20_000 ? next.filter((_, i) => i % Math.ceil(next.length / 20_000) === 0) : next
  }
  return out
}

describe('method cards', () => {
  const cards = [...METHOD_CARDS.values()]

  it('are unique, complete, and their neighbours resolve', () => {
    const ids = CARD_FAMILIES.flatMap((f) => f.cards.map((c) => c.id))
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of cards) {
      for (const k of ['name', 'shortName', 'question', 'useWhen', 'reading'] as const)
        expect(c[k].trim(), `${c.id}.${k}`).not.toBe('')
      expect(c.nullHypothesis === null || c.nullHypothesis.length > 0, c.id).toBe(true)
      expect(c.more.formula.trim(), c.id).not.toBe('')
      expect(c.more.r.trim(), c.id).not.toBe('')
      for (const i of c.instead) {
        expect(METHOD_CARDS.has(i.card), `${c.id} → ${i.card}`).toBe(true)
        expect(i.card, c.id).not.toBe(c.id)
        expect(i.when.length, `${c.id} → ${i.card}`).toBeLessThanOrEqual(160)
      }
      // A statistic cites one to three references; a tool that tests nothing may cite none.
      expect(c.references.length, c.id).toBeLessThanOrEqual(3)
      if (c.nullHypothesis !== null) expect(c.references.length, c.id).toBeGreaterThanOrEqual(1)
    }
  })

  it('keep the lengths of design §2.3', () => {
    const words = (s: string) => s.split(/\s+/).filter(Boolean).length
    for (const c of cards) {
      expect(c.question.length, c.id).toBeLessThanOrEqual(160)
      expect((c.nullHypothesis ?? '').length, c.id).toBeLessThanOrEqual(220)
      expect(c.useWhen.length, c.id).toBeLessThanOrEqual(320)
      expect(c.reading.length, c.id).toBeLessThanOrEqual(600)
      for (const a of c.assumptions) expect(a.length, `${c.id}: ${a}`).toBeLessThanOrEqual(160)
      const first = [c.question, c.nullHypothesis ?? '', c.useWhen, c.reading].join(' ')
      expect(words(first), c.id).toBeLessThanOrEqual(150)
    }
  })

  it('are each shown by some analysis, or named as a neighbour', () => {
    const shown = new Set<string>()
    for (const d of defs)
      for (const p of combinations(d.form))
        for (const id of d.cards?.(d.params.parse(p)) ?? []) shown.add(id)
    for (const c of cards) for (const i of c.instead) shown.add(i.card)
    for (const c of cards) expect(shown.has(c.id), c.id).toBe(true)
  })
})

describe('every analysis', () => {
  it('names known cards for every combination of its options', () => {
    for (const d of defs) {
      expect(d.cards, d.id).toBeTypeOf('function')
      for (const p of combinations(d.form)) {
        const ids = d.cards!(d.params.parse(p))
        expect(ids.length, `${d.id} ${JSON.stringify(p)}`).toBeGreaterThan(0)
        for (const id of ids) expect(METHOD_CARDS.has(id), `${d.id} → ${id}`).toBe(true)
      }
    }
  })

  it('has a line for every field and every option, within the lengths', () => {
    let fields = 0
    let options = 0
    for (const d of defs)
      for (const f of d.form) {
        const at = `${d.id}.${f.path.join('.')}`
        expect(f.explain?.line, at).toBeTruthy()
        expect(f.explain!.line.length, at).toBeLessThanOrEqual(90)
        expect((f.explain!.card ?? '').length, at).toBeLessThanOrEqual(500)
        fields++
        if (!choice(f)) continue
        for (const o of (f as Extract<FormField, { options: unknown }>).options) {
          const oat = `${at} = ${String(o.value)}`
          expect(o.explain?.line, oat).toBeTruthy()
          expect(o.explain!.line.length, oat).toBeLessThanOrEqual(90)
          expect((o.explain!.card ?? '').length, oat).toBeLessThanOrEqual(400)
          if (o.explain!.method) expect(METHOD_CARDS.has(o.explain!.method), oat).toBe(true)
          options++
        }
      }
    // The counts the roadmap reports (every field and option of the 54 analyses; 51c added
    // 42 fields, 91 options and the Holm card; 51b listed Welch's methods under each with the
    // control on their own, in one-way and multiple one-way ANOVA: 2 fields, 6 options).
    expect(defs.length).toBe(54)
    expect(fields).toBe(449)
    expect(options).toBe(696)
    expect(METHOD_CARDS.size).toBe(89)
  })

  it('gives the reason wherever a label says (not) recommended', () => {
    for (const d of defs)
      for (const f of d.form) {
        const at = `${d.id}.${f.path.join('.')}`
        if (!choice(f)) {
          // A checkbox labelled recommended: its line says why.
          if (/recommended/i.test(f.label))
            expect(f.explain!.line, at).toMatch(/recommended (because|when|for)/i)
          continue
        }
        for (const o of (f as Extract<FormField, { options: unknown }>).options) {
          const oat = `${at} = ${String(o.value)}`
          const tag = o.explain?.tag
          if (/not recommended/i.test(o.label)) expect(tag?.kind, oat).toBe('notRecommended')
          else if (/recommended/i.test(o.label)) expect(tag?.kind, oat).toBe('recommended')
          else expect(tag, oat).toBeUndefined()
          if (tag) {
            expect(tag.why.trim().split(/\s+/).length, oat).toBeGreaterThanOrEqual(5)
            expect(tag.why.length, oat).toBeLessThanOrEqual(160)
          }
        }
      }
  })
})

// ---- Writing style (design §2.4) -------------------------------------------------------------

/** Every piece of text with where it is from; `first`: a card's first layer (no formulas). */
function allText(): { at: string; text: string; first?: boolean }[] {
  const out: { at: string; text: string; first?: boolean }[] = []
  for (const c of METHOD_CARDS.values() as Iterable<MethodCard>) {
    for (const k of ['name', 'question', 'nullHypothesis', 'useWhen', 'reading'] as const)
      if (c[k]) out.push({ at: `${c.id}.${k}`, text: c[k]!, first: k !== 'name' })
    for (const [i, a] of c.assumptions.entries())
      out.push({ at: `${c.id}.assumptions[${i}]`, text: a, first: true })
    for (const i of c.instead) out.push({ at: `${c.id}.instead`, text: i.when, first: true })
  }
  for (const d of defs)
    for (const f of d.form) {
      const at = `${d.id}.${f.path.join('.')}`
      if (f.explain) out.push({ at, text: f.explain.line }, { at, text: f.explain.card ?? '' })
      if (choice(f))
        for (const o of (f as Extract<FormField, { options: unknown }>).options) {
          const e = o.explain
          if (!e) continue
          out.push({
            at: `${at}=${String(o.value)}`,
            text: [e.line, e.card ?? '', e.tag?.why ?? ''].join(' '),
          })
        }
    }
  return out
}

describe('the writing style', () => {
  const text = allText()

  it('keeps Greek letters and formulas out of cards’ first layers', () => {
    for (const t of text.filter((x) => x.first)) expect(t.text, t.at).not.toMatch(/[Ͱ-Ͽ√Σ∑]/)
  })

  it('names groups by their titles and words P as the design says', () => {
    for (const t of text) {
      expect(t.text, t.at).not.toMatch(/\bcolumn [AB]\b/i)
      expect(t.text, t.at).not.toMatch(/\bnot (significantly )?different\b/i)
      expect(t.text, t.at).not.toMatch(/\b(groups|they|the means) are the same\b/i)
      expect(t.text, t.at).not.toMatch(/probability that the null|due to chance/i)
    }
  })

  it('spells names one way, in the app’s spelling', () => {
    for (const t of text) {
      expect(t.text, t.at).not.toMatch(/\bSidak|Šídák|Greenhouse-Geisser|Bonferroni-Dunn/)
      expect(t.text, t.at).not.toMatch(/Kruskal Wallis|Mann Whitney|Bland Altman|Kaplan Meier/)
      expect(t.text, t.at).not.toMatch(/\banalys(e|ed|es|ing)\b|\bcolor\b/i)
    }
  })

  it('says recommended only with a reason in the same sentence', () => {
    for (const t of text)
      for (const s of t.text.split(/(?<=[.;])\s+/))
        if (/\brecommended\b/i.test(s) && !/not recommended/i.test(s))
          expect(s, t.at).toMatch(/because|when|for |:|as it|since|protects|keeps/i)
  })

  it('covers the chooser’s questions and reasons too', () => {
    const facts = tableFacts('column', [])
    for (const e of GUIDE_ENTRIES)
      for (const p of guidePaths(e, facts)) {
        const t = p.end.kind === 'leaf' ? p.end.reason : p.end.text
        expect(t, e.id).not.toMatch(/\bcolumn [AB]\b|\bSidak|\bnot different\b/i)
      }
  })
})
