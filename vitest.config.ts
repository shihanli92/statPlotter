import { readdirSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

// One project per package (named like the package), each inheriting the options below.
const packages = readdirSync(new URL('./packages/', import.meta.url), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
/** Packages whose test files share a module graph per worker (`isolate: false`). */
const ISOLATE_FREE = ['stats', 'graph', 'analyses']

export default defineConfig({
  test: {
    projects: [
      ...packages.map((name) => ({
        extends: true,
        test: {
          name: `@ps/${name}`,
          root: `packages/${name}`,
          // The stats, graph and analyses tests are pure functions of their inputs (no mocks left
          // in place, no module state that changes results), so their files can share one module
          // graph per worker instead of re-importing it (and loading the fonts) for each file.
          // Checked with shuffled file and test order, in parallel and in one worker (decision 710).
          ...(ISOLATE_FREE.includes(name) ? { isolate: false } : {}),
          // The examples are built once per run and shared by the files checking them (audit 2,
          // P22): the setup only makes the folder they are kept in (`ui/test/exampleBuilds.ts`).
          ...(name === 'ui' ? { globalSetup: ['./test/exampleCache.setup.ts'] } : {}),
        },
      })),
      // The web app's production build (audit 2 step 3: what its bundle settings promise).
      { extends: true, test: { name: '@ps/web', root: 'apps/web' } },
    ],
    // Transforming the TS sources is about a third of the suite's time; keep the results between
    // runs (in node_modules/.vitest-cache, so reinstalling clears them).
    fsModuleCache: true,
    // Several suites run seconds of numerics; on a machine busy with other work the 5 s default
    // fails them for waiting, not for being wrong. Speed is checked by CPU-time guards instead.
    testTimeout: 20_000,
  },
})
