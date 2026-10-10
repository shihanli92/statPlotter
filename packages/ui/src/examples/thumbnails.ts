import type { ScreenSample } from '@ps/graph'

// Roadmap 47: the Examples dialog's thumbnails, drawn ahead of time by
// `ui/test/exampleThumbnails.test.ts` into `thumbnails.json` (an example's id → its SVG) and
// loaded when the dialog first shows (their own chunk, never with the app).

/** The points a thumbnail draws: an evenly spread sample of each data set's, XY graphs' too. */
export const THUMBNAIL_SAMPLE: ScreenSample = { points: 60, xy: true }

/** An example's id → its thumbnail as an image URL. */
export type Thumbnails = Readonly<Record<string, string>>

let loading: Promise<Thumbnails> | null = null

/** The thumbnails (fetched once). */
export function loadThumbnails(): Promise<Thumbnails> {
  loading ??= import('./thumbnails.json').then(
    (m) =>
      Object.fromEntries(
        Object.entries(m.default as Record<string, string>).map(([id, svg]) => [
          id,
          `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
        ]),
      ),
    (e: unknown) => {
      // Tried again the next time the dialog shows.
      loading = null
      throw e
    },
  )
  return loading
}
