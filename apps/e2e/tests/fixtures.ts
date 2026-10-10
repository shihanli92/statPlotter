import { readFileSync } from 'node:fs'
import { test as base, expect, type Page } from '@playwright/test'

/**
 * Every test fails on a console error or an uncaught page error, reported after the test body so
 * the test's own failure (if any) comes first. The server sends the deployed Content-Security-
 * Policy (audit 3, T7): a violation is reported as a console error in every browser (some only
 * warn).
 */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = []
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (e) => {
          console.error(
            `Content-Security-Policy violation: ${e.effectiveDirective} blocked ${e.blockedURI || 'inline code'}`,
          )
        })
      })
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(`console: ${m.text()}`)
      })
      page.on('pageerror', (e) => errors.push(`page error: ${e.message}`))
      await use(errors)
      expect(errors, 'console or page errors during the test').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }

/** Ids of the example projects built into the app (the published ones need local files). */
export function exampleIds(): string[] {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
  const ids = (text: string) => [...text.matchAll(/^\s+id: '([^']+)',$/gm)].map((m) => m[1]!)
  return [
    ...ids(read('../../../packages/ui/src/examples/synthetic/index.ts')),
    ...ids(read('../../../packages/ui/src/examples/published/index.ts')),
  ]
}

/** The project navigator (sheet list). */
export const navigator = (page: Page) => page.getByRole('navigation', { name: 'Project' })

/** The navigator's rows, one per sheet. */
export const sheets = (page: Page) => navigator(page).locator('.nav-item')

/** Opens an example project from the URL and waits until every analysis has finished. */
export async function openExample(page: Page, id: string): Promise<void> {
  await page.goto(`/?example=${id}`)
  await expect(sheets(page).first()).toBeVisible()
  await expect(navigator(page).locator('.badge.pending')).toHaveCount(0)
}
