import { closeSync, existsSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { deserialize, serialize } from 'node:v8'
import type { Project } from '@ps/model'
import { inject } from 'vitest'
import { fonts } from '../../graph/test/helpers.ts'
import { privateExamples } from '../src/examples/privateExamples.ts'
import { type BuiltPaper, buildPaper, type PaperSpec } from '../src/examples/published/paper.ts'
import type { ExampleContext, ExampleDef } from '../src/examples/registry.ts'
import { counted } from './countedIds.ts'

// The examples built once per test run (audit 2, P22), shared by every ui test file that needs
// them: a published paper with large workbooks takes most of a minute to build, and four files
// check the examples. The first file to ask builds (ids counted, `countedIds.ts`, so the document
// is the same whoever builds it) and writes it to the run's cache folder (made by
// `exampleCache.setup.ts`, the ui project's global setup); the others wait for it and read it.
// Every caller gets its own copy. Without the global setup (a run of this package's tests by
// another config) each file builds what it needs once.

declare module 'vitest' {
  export interface ProvidedContext {
    /** The folder this run's built examples are kept in (`exampleCache.setup.ts`). */
    exampleCache: string
  }
}

/** Reads the repository's local source_data folder (never committed: absent in most checkouts). */
const SOURCE_DATA = new URL('../../../source_data/', import.meta.url)

export const sourceContext = (): ExampleContext => ({
  fonts,
  sourceFile: async (path) => {
    const url = new URL(path, SOURCE_DATA)
    return existsSync(url) ? new Uint8Array(readFileSync(url)) : null
  },
})

const memo = new Map<string, Promise<Uint8Array>>()

/** A build's bytes (`v8.serialize`: maps, NaN and −0 kept), made once per run. */
function cached(key: string, build: () => Promise<unknown>): Promise<Uint8Array> {
  let bytes = memo.get(key)
  if (!bytes) {
    bytes = fromCache(key, build)
    memo.set(key, bytes)
  }
  return bytes
}

const WAIT_MS = 600_000

async function fromCache(key: string, build: () => Promise<unknown>): Promise<Uint8Array> {
  const dir = inject('exampleCache') as string | undefined
  const make = async () => new Uint8Array(serialize(await counted(build)))
  if (!dir) return make()
  const file = `${dir}/${key}.bin`
  const failed = `${dir}/${key}.error`
  let mine = false
  try {
    closeSync(openSync(`${dir}/${key}.lock`, 'wx'))
    mine = true
  } catch {
    // Another file is building it.
  }
  if (mine) {
    try {
      const bytes = await make()
      writeFileSync(`${file}.part`, bytes)
      renameSync(`${file}.part`, file)
      return bytes
    } catch (e) {
      writeFileSync(failed, e instanceof Error ? (e.stack ?? e.message) : String(e))
      throw e
    }
  }
  const start = Date.now()
  while (!existsSync(file)) {
    if (existsSync(failed)) throw new Error(`building ${key} failed:\n${readFileSync(failed)}`)
    if (Date.now() - start > WAIT_MS) throw new Error(`waited too long for ${key} to be built`)
    await new Promise((r) => setTimeout(r, 100))
  }
  return new Uint8Array(readFileSync(file))
}

/** A published paper built (its project, P value checks and results), once per run. */
export async function builtPaper(
  paper: PaperSpec,
  ctx: ExampleContext = sourceContext(),
): Promise<BuiltPaper> {
  return deserialize(await cached(`paper-${paper.id}`, () => buildPaper(paper, ctx)))
}

/**
 * An example's project, built once per run; null when it can't be built here (its local files
 * are missing). A published paper's project is its `builtPaper`'s.
 */
export async function builtExample(
  example: ExampleDef,
  ctx: ExampleContext = sourceContext(),
): Promise<Project | null> {
  if (example.available && !(await example.available(ctx))) return null
  const paper =
    example.section === 'published' && privateExamples().papers.find((p) => p.id === example.id)
  if (paper) return (await builtPaper(paper, ctx)).project
  return deserialize(await cached(`example-${example.id}`, async () => example.build(ctx)))
}
