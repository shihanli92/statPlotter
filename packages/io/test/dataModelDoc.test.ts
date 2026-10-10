import { readFileSync } from 'node:fs'
import { type AnalysisResult, createProject, type FolderId, type NodeId } from '@ps/model'
import { strFromU8, unzipSync } from 'fflate'
import { expect, it } from 'vitest'
import { writeProjectFile } from '../src/index.ts'

// DATA_MODEL.md §9 lists the fields of a project file's manifest and cached results (audit 2,
// M19: it named an `engineVersion` no file holds). A field written or dropped fails here until
// the doc says so.

const doc = readFileSync(new URL('../../../docs/DATA_MODEL.md', import.meta.url), 'utf8')

/** The field names of the `{ … }` on the line of §9's file listing that starts with `entry`. */
function listed(entry: string): string[] {
  const line = new RegExp(`^${entry.replace(/[.<>/]/g, '\\$&')}[^{\\n]*\\{([^}]*)\\}`, 'm').exec(
    doc,
  )
  expect(line, `DATA_MODEL.md lists ${entry}`).not.toBeNull()
  return line![1]!.split(',').map((f) => f.trim().replace(/\?$/, ''))
}

it('DATA_MODEL.md lists the fields project files hold (§9)', () => {
  const project = createProject('Doc', new Date('2026-10-07T00:00:00Z'))
  project.folders = [{ id: 'f1' as FolderId, name: 'Folder', members: [] }]
  // Every optional field present: a template's flag, folders and a cached result.
  const result: AnalysisResult = {
    status: 'ok',
    diagnostics: [],
    sheets: [],
    values: {},
    comparisons: [],
    outputs: {},
  }
  project.nodes['a1' as NodeId] = {
    kind: 'analysis',
    id: 'a1' as NodeId,
    name: 'A',
    analysisId: 'descriptive',
    pluginVersion: 1,
    input: { source: 'a1' as NodeId, dataSets: [] },
    params: {},
  }
  const files = unzipSync(
    writeProjectFile(project, {
      template: true,
      results: new Map([['a1' as NodeId, { inputKey: 'k', result }]]),
    }),
  )
  const json = (name: string) => Object.keys(JSON.parse(strFromU8(files[name]!)))
  expect(listed('manifest.json').sort()).toEqual(json('manifest.json').sort())
  expect(listed('results/<id>.json').sort()).toEqual(json('results/a1.json').sort())
})
