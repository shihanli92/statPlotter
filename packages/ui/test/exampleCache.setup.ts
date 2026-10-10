import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestProject } from 'vitest/node'

// The ui project's global setup (audit 2, P22): a folder for this run's built examples
// (`exampleBuilds.ts`), emptied when watch mode reruns tests (the sources may have changed) and
// removed at the end. Nothing is built here: a run that needs no example builds none.

export default function setup(project: TestProject) {
  let dir = mkdtempSync(join(tmpdir(), 'ps-examples-'))
  project.provide('exampleCache', dir)
  project.onTestsRerun(() => {
    rmSync(dir, { recursive: true, force: true })
    dir = mkdtempSync(join(tmpdir(), 'ps-examples-'))
    project.provide('exampleCache', dir)
  })
  return () => rmSync(dir, { recursive: true, force: true })
}
