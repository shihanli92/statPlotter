import type { ColorMapName } from '@ps/model'

// Colour arithmetic on #rrggbb colours, and the heat maps' colour maps (roadmap 30).

const hex = (c: string) => [1, 3, 5].map((i) => Number.parseInt(c.slice(i, i + 2), 16))

/** A #rrggbb colour's red, green and blue (0–255). */
export const hexToRgb = (c: string): [number, number, number] => hex(c) as [number, number, number]

/** A colour between `a` (t = 0) and `b` (t = 1), interpolated in RGB. */
export function mixColor(a: string, b: string, t: number): string {
  const [p, q] = [hex(a), hex(b)]
  const k = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0))
  return `#${p
    .map((v, i) =>
      Math.round(v + (q[i]! - v) * k)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

/**
 * A heat map's colour map: colours from its low to its high end (interpolated in RGB between
 * them), and whether it diverges from a middle colour. Viridis, magma, inferno, plasma and
 * cividis as R's viridisLite gives them at 17 points (CC0); the others are ColorBrewer's 9-class
 * sequential and 11-class diverging schemes (Apache 2.0; blue–red is RdBu reversed).
 */
export interface ColorMap {
  label: string
  stops: readonly string[]
  diverging: boolean
}

const seq = (label: string, stops: string): ColorMap => ({
  label,
  stops: stops.split(' '),
  diverging: false,
})
const div = (label: string, stops: string): ColorMap => ({
  label,
  stops: stops.split(' '),
  diverging: true,
})

export const COLOR_MAPS: Record<ColorMapName, ColorMap> = {
  viridis: seq(
    'Viridis',
    '#440154 #48186a #472d7b #424086 #3b528b #33638d #2c728e #26828e #21908c #1f9f88 #27ad81 #3ebc74 #5dc863 #82d34d #aadc32 #d5e21a #fde725',
  ),
  magma: seq(
    'Magma',
    '#000004 #0a0822 #1d1147 #36106b #51127c #691c81 #822681 #9c2e7f #b63679 #cf406f #e65164 #f46a5c #fb8861 #fea571 #fec287 #fde0a1 #fcfdbf',
  ),
  inferno: seq(
    'Inferno',
    '#000004 #0b0724 #210c4a #3d0965 #56106e #71196e #89226a #a32c61 #bb3754 #d14545 #e35932 #f1721e #f98c0a #fcaa0f #f9c932 #f2e865 #fcffa4',
  ),
  plasma: seq(
    'Plasma',
    '#0d0887 #310597 #4c02a1 #6600a7 #7e03a8 #9511a1 #a92395 #bc3488 #cc4678 #da596a #e56b5d #f07f4f #f89441 #fdab33 #fdc328 #f9dd25 #f0f921',
  ),
  cividis: seq(
    'Cividis',
    '#00204d #002c69 #05366e #2d426c #414d6b #52596c #61646f #6f7073 #7c7b78 #8b8779 #9b9477 #aca174 #bcaf6f #cebc68 #e0cb5e #f2da50 #ffea46',
  ),
  greys: seq('Greys', '#ffffff #f0f0f0 #d9d9d9 #bdbdbd #969696 #737373 #525252 #252525 #000000'),
  blues: seq('Blues', '#f7fbff #deebf7 #c6dbef #9ecae1 #6baed6 #4292c6 #2171b5 #08519c #08306b'),
  greens: seq('Greens', '#f7fcf5 #e5f5e0 #c7e9c0 #a1d99b #74c476 #41ab5d #238b45 #006d2c #00441b'),
  reds: seq('Reds', '#fff5f0 #fee0d2 #fcbba1 #fc9272 #fb6a4a #ef3b2c #cb181d #a50f15 #67000d'),
  purples: seq(
    'Purples',
    '#fcfbfd #efedf5 #dadaeb #bcbddc #9e9ac8 #807dba #6a51a3 #54278f #3f007d',
  ),
  blueRed: div(
    'Blue – white – red',
    '#053061 #2166ac #4393c3 #92c5de #d1e5f0 #f7f7f7 #fddbc7 #f4a582 #d6604d #b2182b #67001f',
  ),
  purpleGreen: div(
    'Purple – white – green',
    '#40004b #762a83 #9970ab #c2a5cf #e7d4e8 #f7f7f7 #d9f0d3 #a6dba0 #5aae61 #1b7837 #00441b',
  ),
  brownTeal: div(
    'Brown – white – teal',
    '#543005 #8c510a #bf812d #dfc27d #f6e8c3 #f5f5f5 #c7eae5 #80cdc1 #35978f #01665e #003c30',
  ),
}

/** The colour at t ∈ [0, 1] along a map (clamped), `reverse` running it from high to low. */
export function colorAt(map: ColorMap, t: number, reverse = false): string {
  const k = Math.max(0, Math.min(1, reverse ? 1 - t : t)) * (map.stops.length - 1)
  const i = Math.min(Math.floor(k), map.stops.length - 2)
  return mixColor(map.stops[i]!, map.stops[i + 1]!, k - i)
}

/** Relative luminance (0 black – 1 white) of a colour, as WCAG defines it. */
export function luminance(c: string): number {
  const [r, g, b] = hex(c).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Black or white, whichever reads better on a colour (text in heat map cells). */
export const textOn = (c: string): string => (luminance(c) > 0.18 ? '#000000' : '#ffffff')
