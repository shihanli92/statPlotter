import { type FontRegistry, withFonts } from '@ps/graph'
import type { Project } from '@ps/model'
import { privateExamples } from './privateExamples.ts'
import {
  loadChenExample,
  loadHoffmannExample,
  loadJohnstonExample,
  loadPaperExample,
  loadSwamExample,
  loadTawkExample,
  PUBLISHED_EXAMPLES,
} from './published/index.ts'
import { loadSyntheticBuilds, SYNTHETIC_EXAMPLES } from './synthetic/index.ts'

/** What an example needs to build its project. */
export interface ExampleContext {
  fonts: FontRegistry
  /**
   * Reads a file from the local `source_data/` folder by its path there (e.g.
   * "<paper>_source_data/<file>.xlsx"); null where there is no such folder
   * (every deployed build). Published-data examples are built from these files at run time, so
   * no paper data is part of the app.
   */
  sourceFile: (path: string) => Promise<Uint8Array | null>
  /**
   * Whether this build can read a local source_data folder at all (development only). Without
   * it the Examples dialog leaves out the examples that need local files.
   */
  localSourceData?: boolean
}

export interface ExampleDef {
  id: string
  title: string
  /** One or two sentences: what the example shows. */
  description: string
  /** Roadmap 47: one line for its card in the Examples dialog (default the description). */
  summary?: string
  /** Roadmap 47: the card's badge, the kind of data ("Column", "XY"; default by section). */
  badge?: string
  /**
   * Roadmap 47: the graph its card shows, by name (default its first graph). Thumbnails are drawn
   * ahead of time into `thumbnails.json` (`ui/test/exampleThumbnails.test.ts`), for the examples
   * that are part of the app only.
   */
  thumbnail?: string
  /**
   * 'examples': synthetic data, part of the app. 'published': figures rebuilt from a paper's
   * source data (the CC BY papers embed their data; the others read local files). 'local':
   * the user's own data read from the local source_data folder (roadmap 34e).
   */
  section: 'examples' | 'published' | 'local'
  /** Whether the example can be built here (e.g. its local files exist); default yes. */
  available?: (ctx: ExampleContext) => Promise<boolean>
  build: (ctx: ExampleContext) => Project | Promise<Project>
}

/**
 * Every example, in the order the Examples dialog lists them (those of local files in
 * development builds only, audit 2 P6). A build waits for any font family it needs that is still
 * loading (`withFonts`).
 */
export const EXAMPLES: ExampleDef[] = [
  ...SYNTHETIC_EXAMPLES,
  ...PUBLISHED_EXAMPLES,
  ...(import.meta.env.DEV ? privateExamples().local : []),
].map((e) => ({ ...e, build: (ctx: ExampleContext) => withFonts(() => e.build(ctx)) }))

/** Loads the examples' builders (when the Examples dialog shows, so opening one is quick). */
export const preloadExamples = () =>
  Promise.all([
    loadSyntheticBuilds(),
    loadPaperExample(),
    loadJohnstonExample(),
    loadHoffmannExample(),
    loadTawkExample(),
    loadChenExample(),
    loadSwamExample(),
  ]).then(() => {})

export const exampleById = (id: string): ExampleDef | undefined => EXAMPLES.find((e) => e.id === id)
