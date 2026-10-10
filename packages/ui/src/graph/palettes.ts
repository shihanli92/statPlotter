/** Colour schemes offered for a graph's palette (data sets take colours in order). */
export const PALETTES: { id: string; name: string; colors: string[] }[] = [
  {
    id: 'okabe-ito',
    name: 'Colour-blind safe (Okabe–Ito)',
    colors: [
      '#0072b2',
      '#d55e00',
      '#009e73',
      '#cc79a7',
      '#e69f00',
      '#56b4e9',
      '#f0e442',
      '#000000',
    ],
  },
  {
    id: 'classic',
    name: 'Classic',
    colors: [
      '#1f77b4',
      '#ff7f0e',
      '#2ca02c',
      '#d62728',
      '#9467bd',
      '#8c564b',
      '#e377c2',
      '#7f7f7f',
    ],
  },
  {
    id: 'bold',
    name: 'Bold primaries',
    colors: [
      '#000000',
      '#e41a1c',
      '#377eb8',
      '#4daf4a',
      '#984ea3',
      '#ff7f00',
      '#a65628',
      '#f781bf',
    ],
  },
  {
    id: 'pastel',
    name: 'Pastel',
    colors: [
      '#8dd3c7',
      '#fdb462',
      '#bebada',
      '#fb8072',
      '#80b1d3',
      '#b3de69',
      '#fccde5',
      '#d9d9d9',
    ],
  },
  {
    id: 'viridis',
    name: 'Viridis (sequential)',
    colors: [
      '#440154',
      '#46327e',
      '#365c8d',
      '#277f8e',
      '#1fa187',
      '#4ac16d',
      '#a0da39',
      '#fde725',
    ],
  },
  {
    id: 'blues',
    name: 'Blues (sequential)',
    colors: [
      '#08306b',
      '#08519c',
      '#2171b5',
      '#4292c6',
      '#6baed6',
      '#9ecae1',
      '#c6dbef',
      '#deebf7',
    ],
  },
  {
    id: 'grays',
    name: 'Grayscale',
    colors: [
      '#000000',
      '#525252',
      '#737373',
      '#969696',
      '#bdbdbd',
      '#d9d9d9',
      '#f0f0f0',
      '#ffffff',
    ],
  },
]

/** The preset matching a palette exactly, if any. */
export const paletteId = (colors: readonly string[] | undefined) =>
  colors ? PALETTES.find((p) => p.colors.join() === colors.join())?.id : undefined
