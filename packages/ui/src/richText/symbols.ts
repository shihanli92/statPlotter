/**
 * The rich text editor's symbol picker: Greek letters and the symbols lab figures use. Every one
 * is drawn by the bundled Liberation fonts in all four faces (checked by a test), so graphs and
 * exports never fall back to another font.
 */
interface SymbolGroup {
  label: string
  symbols: readonly (readonly [char: string, name: string])[]
}

const greek = (letters: string, names: string, upper: boolean) =>
  [...letters].map((c, i) => {
    const name = names.split(' ')[i]!
    return [c, upper ? `${name[0]!.toUpperCase()}${name.slice(1)}` : name] as const
  })

const NAMES =
  'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega'

export const SYMBOL_GROUPS: readonly SymbolGroup[] = [
  { label: 'Greek', symbols: greek('αβγδεζηθικλμνξοπρστυφχψω', NAMES, false) },
  { label: 'Greek capitals', symbols: greek('ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ', NAMES, true) },
  {
    label: 'Math',
    symbols: [
      ['±', 'plus-minus'],
      ['×', 'times'],
      ['÷', 'divide'],
      ['·', 'middle dot'],
      ['−', 'minus'],
      ['≤', 'less than or equal'],
      ['≥', 'greater than or equal'],
      ['≈', 'approximately'],
      ['≠', 'not equal'],
      ['∞', 'infinity'],
      ['√', 'square root'],
      ['∑', 'sum'],
      ['∆', 'increment'],
      ['∂', 'partial'],
      ['∫', 'integral'],
      ['‰', 'per mille'],
      ['%', 'percent'],
    ],
  },
  {
    label: 'Units and marks',
    symbols: [
      ['µ', 'micro'],
      ['°', 'degree'],
      ['Å', 'angstrom'],
      ['′', 'prime'],
      ['″', 'double prime'],
      ['²', 'superscript two'],
      ['³', 'superscript three'],
      ['½', 'one half'],
      ['†', 'dagger'],
      ['‡', 'double dagger'],
      ['§', 'section'],
      ['•', 'bullet'],
      ['–', 'en dash'],
      ['—', 'em dash'],
    ],
  },
  {
    label: 'Arrows',
    symbols: [
      ['→', 'right arrow'],
      ['←', 'left arrow'],
      ['↑', 'up arrow'],
      ['↓', 'down arrow'],
      ['↔', 'left right arrow'],
    ],
  },
]
