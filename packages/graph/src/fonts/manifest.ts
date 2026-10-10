import type { FontId } from '@ps/model'

export type FontVariant = 'regular' | 'bold' | 'italic' | 'boldItalic'

export const FONT_VARIANTS: readonly FontVariant[] = ['regular', 'bold', 'italic', 'boldItalic']

export interface FontFamilyInfo {
  /** Family name used in SVG/CSS; must match the @font-face rules we emit. */
  cssFamily: string
  /** Shown in the UI. */
  label: string
  files: Record<FontVariant, string>
}

/**
 * Bundled fonts. Liberation Sans, Serif and Mono 2.1.5 (SIL OFL, assets/fonts/LICENSE-Liberation.txt)
 * are metric-compatible with Arial, Times New Roman and Courier New; Liberation Sans Narrow 1.07.6
 * (GPL v2 with the font exception, assets/fonts/LICENSE-LiberationSansNarrow.txt) with Arial
 * Narrow. So layouts match what users expect from their usual fonts.
 */
export const FONTS: Record<FontId, FontFamilyInfo> = {
  sans: {
    cssFamily: 'PS Liberation Sans',
    label: 'Sans (Arial-compatible)',
    files: {
      regular: 'LiberationSans-Regular.ttf',
      bold: 'LiberationSans-Bold.ttf',
      italic: 'LiberationSans-Italic.ttf',
      boldItalic: 'LiberationSans-BoldItalic.ttf',
    },
  },
  serif: {
    cssFamily: 'PS Liberation Serif',
    label: 'Serif (Times-compatible)',
    files: {
      regular: 'LiberationSerif-Regular.ttf',
      bold: 'LiberationSerif-Bold.ttf',
      italic: 'LiberationSerif-Italic.ttf',
      boldItalic: 'LiberationSerif-BoldItalic.ttf',
    },
  },
  mono: {
    cssFamily: 'PS Liberation Mono',
    label: 'Mono (Courier-compatible)',
    files: {
      regular: 'LiberationMono-Regular.ttf',
      bold: 'LiberationMono-Bold.ttf',
      italic: 'LiberationMono-Italic.ttf',
      boldItalic: 'LiberationMono-BoldItalic.ttf',
    },
  },
  narrow: {
    cssFamily: 'PS Liberation Sans Narrow',
    label: 'Narrow (Arial Narrow-compatible)',
    files: {
      regular: 'LiberationSansNarrow-Regular.ttf',
      bold: 'LiberationSansNarrow-Bold.ttf',
      italic: 'LiberationSansNarrow-Italic.ttf',
      boldItalic: 'LiberationSansNarrow-BoldItalic.ttf',
    },
  },
}

/** The font menu's short names. */
export const FONT_SHORT: Record<FontId, string> = {
  sans: 'Sans',
  serif: 'Serif',
  mono: 'Mono',
  narrow: 'Narrow',
}

export function variantOf(bold: boolean, italic: boolean): FontVariant {
  if (bold) return italic ? 'boldItalic' : 'bold'
  return italic ? 'italic' : 'regular'
}
