import type { PaperSpec } from './published/paper.ts'
import type { ExampleDef } from './registry.ts'

/**
 * The examples kept in `./private/` (roadmap 48): published papers whose source data aren't
 * openly licensed and the user's own data, all read from the local source_data folder at run
 * time. The folder is left out of the public repository (`tools/publish-public.mjs`), so it is
 * found with `import.meta.glob`, which gives nothing where it isn't.
 */
export interface PrivateExamples {
  /** Papers rebuilt from local source data (development builds only). */
  papers: PaperSpec[]
  /** Examples of the user's own local data (development builds only). */
  local: ExampleDef[]
}

const NONE: PrivateExamples = { papers: [], local: [] }

/**
 * The private examples, or none where the folder isn't there. Called only in development builds
 * and tests (`import.meta.env.DEV`), so a production bundle drops the folder (audit 2 P6, checked
 * by apps/web/test/build.test.ts).
 */
export function privateExamples(): PrivateExamples {
  const found = import.meta.glob<PrivateExamples>('./private/index.ts', {
    eager: true,
    import: 'PRIVATE',
  })
  return found['./private/index.ts'] ?? NONE
}
