import { exampleIds, expect, navigator, openExample, sheets, test } from './fixtures.ts'

// Every example project opens, every analysis finishes without an error, and every sheet shows.
for (const id of exampleIds()) {
  test(`example ${id}: every sheet opens`, async ({ page }) => {
    await openExample(page, id)
    await expect(navigator(page).locator('.badge.error')).toHaveCount(0)
    const count = await sheets(page).count()
    expect(count).toBeGreaterThan(0)
    const main = page.getByRole('main')
    for (let i = 0; i < count; i++) {
      const row = sheets(page).nth(i)
      await row.click()
      await expect(row).toHaveClass(/\bon\b/)
      await expect(main.locator('.banner.error')).toHaveCount(0)
    }
  })
}
