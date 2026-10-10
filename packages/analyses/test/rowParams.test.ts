// Analysis parameters naming table rows by index follow row inserts, deletes and reorders
// (roadmap 29) through `ROW_PARAMS` in the model; this keeps that table and the plugins in step.

import { ROW_PARAMS } from '@ps/model'
import { describe, expect, it } from 'vitest'
import { registry } from '../src/index.ts'

/** Form editors (ui `statsFields.tsx`) whose values are table rows by index. */
const ROW_COMPONENTS = new Set(['row.pick', 'gof.expected'])

describe('ROW_PARAMS', () => {
  it('declares every parameter edited by a row editor', () => {
    const edited = registry
      .list()
      .flatMap((def) =>
        def.form
          .filter((f) => f.kind === 'custom' && ROW_COMPONENTS.has(f.component))
          .map((f) => `${def.id}:${f.path.join('.')}`),
      )
    const declared = Object.entries(ROW_PARAMS).flatMap(([id, specs]) =>
      specs.map((s) => `${id}:${s.path.join('.')}`),
    )
    expect(edited.sort()).toEqual(declared.sort())
  })

  it('names parameters the plugins have, with defaults of the declared shape', () => {
    for (const [id, specs] of Object.entries(ROW_PARAMS)) {
      const def = registry.get(id)
      expect(def, id).toBeDefined()
      const defaults = def!.params.parse({}) as Record<string, unknown>
      for (const spec of specs) {
        const value = spec.path.reduce<unknown>(
          (v, k) => (v as Record<string, unknown>)?.[k],
          defaults,
        )
        if (spec.kind === 'rowText') {
          expect(value, `${id} ${spec.path}`).toBe(spec.fallback)
          expect(def!.params.safeParse({ [spec.path[0]!]: '3' }).success).toBe(true)
        } else {
          expect(Array.isArray(value), `${id} ${spec.path}`).toBe(true)
          // Rows inserted since the values were entered hold null.
          expect(def!.params.safeParse({ [spec.path[0]!]: [1, null, 2] }).success).toBe(true)
        }
      }
    }
  })
})
