import { readFileSync } from 'node:fs'
import type { UserConfig } from 'vite'
import { describe, expect, it } from 'vitest'
import config from '../vite.config.ts'

// Audit 3 (T7): `vite preview`, the server of the end-to-end tests, sends the response headers
// the deployment sends (public/_headers, Cloudflare Pages), so the tests run under the
// production Content-Security-Policy.

const headersFile = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8')

describe('the preview server', () => {
  it('sends the deployed headers, the Content-Security-Policy among them', () => {
    const headers = (config as UserConfig).preview?.headers as Record<string, string> | undefined
    const csp = headersFile.match(/^\s+Content-Security-Policy: (.+)$/m)?.[1]
    expect(csp).toContain("script-src 'self'")
    expect(headers?.['Content-Security-Policy']).toBe(csp)
    expect(headers?.['X-Content-Type-Options']).toBe('nosniff')
    expect(headers?.['Referrer-Policy']).toBe('no-referrer')
  })
})
