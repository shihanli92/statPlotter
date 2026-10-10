import type { FontId } from '@ps/model'
import { FONT_VARIANTS, FONTS } from './manifest.ts'
import { FontRegistry } from './registry.ts'

// Literal `new URL(..., import.meta.url)` calls so the bundler emits each font as an asset.
const FONT_URLS: Record<string, URL> = {
  'LiberationSans-Regular.ttf': new URL(
    '../../assets/fonts/LiberationSans-Regular.ttf',
    import.meta.url,
  ),
  'LiberationSans-Bold.ttf': new URL('../../assets/fonts/LiberationSans-Bold.ttf', import.meta.url),
  'LiberationSans-Italic.ttf': new URL(
    '../../assets/fonts/LiberationSans-Italic.ttf',
    import.meta.url,
  ),
  'LiberationSans-BoldItalic.ttf': new URL(
    '../../assets/fonts/LiberationSans-BoldItalic.ttf',
    import.meta.url,
  ),
  'LiberationSerif-Regular.ttf': new URL(
    '../../assets/fonts/LiberationSerif-Regular.ttf',
    import.meta.url,
  ),
  'LiberationSerif-Bold.ttf': new URL(
    '../../assets/fonts/LiberationSerif-Bold.ttf',
    import.meta.url,
  ),
  'LiberationSerif-Italic.ttf': new URL(
    '../../assets/fonts/LiberationSerif-Italic.ttf',
    import.meta.url,
  ),
  'LiberationSerif-BoldItalic.ttf': new URL(
    '../../assets/fonts/LiberationSerif-BoldItalic.ttf',
    import.meta.url,
  ),
  'LiberationMono-Regular.ttf': new URL(
    '../../assets/fonts/LiberationMono-Regular.ttf',
    import.meta.url,
  ),
  'LiberationMono-Bold.ttf': new URL('../../assets/fonts/LiberationMono-Bold.ttf', import.meta.url),
  'LiberationMono-Italic.ttf': new URL(
    '../../assets/fonts/LiberationMono-Italic.ttf',
    import.meta.url,
  ),
  'LiberationMono-BoldItalic.ttf': new URL(
    '../../assets/fonts/LiberationMono-BoldItalic.ttf',
    import.meta.url,
  ),
  'LiberationSansNarrow-Regular.ttf': new URL(
    '../../assets/fonts/LiberationSansNarrow-Regular.ttf',
    import.meta.url,
  ),
  'LiberationSansNarrow-Bold.ttf': new URL(
    '../../assets/fonts/LiberationSansNarrow-Bold.ttf',
    import.meta.url,
  ),
  'LiberationSansNarrow-Italic.ttf': new URL(
    '../../assets/fonts/LiberationSansNarrow-Italic.ttf',
    import.meta.url,
  ),
  'LiberationSansNarrow-BoldItalic.ttf': new URL(
    '../../assets/fonts/LiberationSansNarrow-BoldItalic.ttf',
    import.meta.url,
  ),
}

function urlOf(file: string): URL {
  const url = FONT_URLS[file]
  if (!url) throw new Error(`no bundled URL for font ${file}`)
  return url
}

export const browserFontLoader = async (file: string): Promise<Uint8Array> => {
  const res = await fetch(urlOf(file))
  if (!res.ok) throw new Error(`failed to load font ${file}: HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

/**
 * The app's fonts: Sans (the default family, which the page preloads) now, the other families
 * when first needed (audit 2 P5: the page no longer waits for all sixteen files).
 */
export const loadBrowserFonts = (families: readonly FontId[] = ['sans']) =>
  FontRegistry.load(browserFontLoader, families)

/** @font-face rules so on-screen SVG renders with exactly the fonts we measure with. */
export function fontFaceCss(): string {
  return Object.values(FONTS)
    .flatMap((family) =>
      FONT_VARIANTS.map((variant) => {
        const bold = variant === 'bold' || variant === 'boldItalic'
        const italic = variant === 'italic' || variant === 'boldItalic'
        return `@font-face { font-family: '${family.cssFamily}'; src: url('${urlOf(family.files[variant]).href}') format('truetype'); font-weight: ${bold ? 700 : 400}; font-style: ${italic ? 'italic' : 'normal'}; }`
      }),
    )
    .join('\n')
}
