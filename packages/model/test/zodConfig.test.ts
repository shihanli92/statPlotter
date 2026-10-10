import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { Project } from '../src/index.ts'

describe('zod configuration (decision 657)', () => {
  it('parses without compiling, so the eval probe never runs under the CSP', () => {
    expect(Project).toBeDefined()
    expect(z.config().jitless).toBe(true)
  })
})
