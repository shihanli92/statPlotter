import { describe, expect, it } from 'vitest'
import {
  AppPreferences,
  BUILTIN_STYLES,
  builtinStyle,
  createProject,
  createProjectWith,
  effectiveStyle,
  FigureStyle,
  isEmptyStyle,
  mergeStyles,
  newUserStyle,
  Project,
  parsePreferences,
  parseProject,
  projectStyleOf,
  readStyle,
  STYLE_FORMAT,
  StyleFileError,
  styleNameProblem,
  uniqueStyleName,
  userStyleChoice,
  writeStyle,
} from '../src/index.ts'

// Roadmap 37: the style schema, merging and precedence, `.psstyle` files, preferences for new
// projects (decisions 530–538).

describe('the style schema', () => {
  it('every field is optional; built-ins are valid', () => {
    expect(FigureStyle.parse({})).toEqual({})
    for (const s of BUILTIN_STYLES) expect(() => FigureStyle.parse(s.style), s.id).not.toThrow()
    expect(isEmptyStyle(builtinStyle('default')!.style)).toBe(true)
    expect(isEmptyStyle(builtinStyle('journal-nature')!.style)).toBe(false)
    expect(() => FigureStyle.parse({ lines: { axis: -1 } })).toThrow()
    expect(() => FigureStyle.parse({ palette: ['red'] })).toThrow()
  })

  it('old projects read as before (theme "default", no style)', () => {
    const p = createProject()
    expect(p.settings).toEqual({
      pValueStyle: 'GP',
      pValueDigits: 4,
      defaultConfidenceLevel: 0.95,
      theme: 'default',
    })
    expect(projectStyleOf(p.settings)).toBeUndefined()
    const raw = JSON.parse(JSON.stringify(p))
    expect(parseProject(raw)).toEqual(p)
  })

  it('a project keeps its style’s values (round trip)', () => {
    const p = createProject()
    const nature = builtinStyle('journal-nature')!
    p.settings = { ...p.settings, theme: nature.id, style: nature.style }
    const back = Project.parse(JSON.parse(JSON.stringify(p)))
    expect(back.settings.style).toEqual(nature.style)
    // A built-in named without values resolves to it.
    expect(projectStyleOf({ theme: 'journal-cell' })).toBe(builtinStyle('journal-cell')!.style)
  })
})

describe('merging styles (precedence)', () => {
  it('later styles win field by field; palettes as a whole', () => {
    const a: FigureStyle = {
      font: 'serif',
      text: { axisTitle: { size: 7, bold: true }, legend: { size: 6 } },
      lines: { axis: 0.5, errorBar: 0.5 },
      palette: ['#000000', '#111111'],
    }
    const b: FigureStyle = {
      text: { axisTitle: { size: 9 } },
      lines: { axis: 1 },
      palette: ['#222222'],
    }
    expect(mergeStyles(a, b)).toEqual({
      font: 'serif',
      text: { axisTitle: { size: 9, bold: true }, legend: { size: 6 } },
      lines: { axis: 1, errorBar: 0.5 },
      palette: ['#222222'],
    })
    expect(mergeStyles(undefined, a)).toEqual(a)
  })

  it('a graph’s style is over its project’s', () => {
    const p = { theme: 'journal-nature', style: builtinStyle('journal-nature')!.style }
    const g = { theme: { id: 'x', style: { text: { tickLabel: { size: 9 } } } } }
    const e = effectiveStyle(p, g)!
    expect(e.text?.tickLabel?.size).toBe(9)
    expect(e.text?.axisTitle?.size).toBe(7)
    expect(effectiveStyle(p, g)).toBe(e)
    expect(effectiveStyle(p, {})).toBe(p.style)
    expect(effectiveStyle({ theme: 'default' }, g)).toBe(g.theme.style)
  })
})

describe('.psstyle files', () => {
  it('round trip, without the library’s order when exported', () => {
    const s = { ...newUserStyle('Lab style', builtinStyle('journal-cell')!.style), order: 3 }
    expect(readStyle(writeStyle(s))).toEqual(s)
    const exported = readStyle(writeStyle(s, { exported: true }))
    expect(exported.order).toBeUndefined()
    expect(exported.style.name).toBe('Lab style')
    expect(userStyleChoice(exported)).toEqual({ id: 'user:Lab style', style: exported.style })
  })

  it('refuses what isn’t a style, a newer file or an invalid one', () => {
    expect(() => readStyle('nope')).toThrow(StyleFileError)
    expect(() => readStyle('{"format":"other"}')).toThrow('Not a style file.')
    const s = JSON.parse(writeStyle(newUserStyle('A', {})))
    expect(() => readStyle(JSON.stringify({ ...s, version: 99 }))).toThrow(/newer version/)
    expect(() => readStyle(JSON.stringify({ ...s, style: { lines: { axis: 'thick' } } }))).toThrow(
      /can’t be used/,
    )
    expect(s.format).toBe(STYLE_FORMAT)
  })

  it('names', () => {
    expect(styleNameProblem('')).toMatch(/name/)
    expect(styleNameProblem('a/b')).toMatch(/contain/)
    expect(styleNameProblem('Lab', ['lab'])).toMatch(/already/)
    expect(uniqueStyleName('Lab', ['Lab', 'Lab (2)'])).toBe('Lab (3)')
  })

  // Audit 2 X1: two forbidden characters (the replace had no `g`) looped forever.
  it('a name from a crafted file is made valid and the search ends', () => {
    expect(uniqueStyleName('a/b:c', [])).toBe('a-b-c')
    expect(uniqueStyleName('a/b:c', ['a-b-c'])).toBe('a-b-c (2)')
    expect(uniqueStyleName('..', [])).toBe('Style')
    expect(uniqueStyleName('.x|y', ['X-Y'])).toBe('x-y (2)')
    for (const n of ['a/b:c', '..', '"<>"', '.x|y'])
      expect(styleNameProblem(uniqueStyleName(n, ['Style']), ['Style'])).toBeNull()
  })
})

describe('preferences for new projects', () => {
  it('a new project takes the style, P values and confidence level', () => {
    const nature = builtinStyle('journal-nature')!
    const p = createProjectWith({
      style: nature,
      pValueStyle: 'NEJM',
      pValueDigits: 3,
      confidenceLevel: 0.9,
    })
    expect(p.settings).toMatchObject({
      theme: 'journal-nature',
      style: nature.style,
      pValueStyle: 'NEJM',
      pValueDigits: 3,
      defaultConfidenceLevel: 0.9,
    })
    expect(() => Project.parse(p)).not.toThrow()
    // A style's P values unless Preferences name their own.
    const q = createProjectWith({ style: { id: 'user:x', style: { pValue: { style: 'APA' } } } })
    expect(q.settings.pValueStyle).toBe('APA')
    // No preferences: a new project as ever; Default leaves the style out.
    expect(createProjectWith({}).settings).toEqual(createProject().settings)
    expect(createProjectWith({ style: builtinStyle('default')! }).settings.style).toBeUndefined()
  })

  it('stored preferences keep what is valid', () => {
    expect(parsePreferences(null)).toEqual({})
    expect(parsePreferences({ units: 'mm', exportDpi: 5, pageSize: 'a4', other: 1 })).toEqual({
      units: 'mm',
      pageSize: 'a4',
    })
    expect(() => AppPreferences.parse({ units: 'mm', exportFormat: 'png' })).not.toThrow()
  })

  it('keeps the colours and update settings (roadmap 41)', () => {
    expect(
      parsePreferences({
        colorScheme: 'dark',
        checkUpdates: false,
        skippedVersion: '0.1.30',
        lastUpdateCheck: 1_760_000_000_000,
      }),
    ).toEqual({
      colorScheme: 'dark',
      checkUpdates: false,
      skippedVersion: '0.1.30',
      lastUpdateCheck: 1_760_000_000_000,
    })
    expect(
      parsePreferences({ colorScheme: 'blue', checkUpdates: 'yes', lastUpdateCheck: -1 }),
    ).toEqual({})
  })
})
