import type { BrowserContext, Page } from '@playwright/test'
import { exampleIds, expect, openExample, sheets, test } from './fixtures.ts'
import {
  answer,
  cell,
  dialog,
  grid,
  newTable,
  runMenu,
  toolbar,
  typeCells,
} from './helpers-data.ts'

// Recovery copies (roadmap 25): while a project has unsaved changes the app keeps a copy of it in
// IndexedDB (a few seconds after edits stop); a page that goes away without saving leaves its
// copy, offered at the next start. Each test's browser context starts with empty storage, so no
// copy from another test shows up. Closing a page with page.close() skips beforeunload, like a
// crash or a closed window.
//
// Audit 2 (P16): the context's clock is Playwright's (it runs on as the real one does), so a test
// skips the 5 s the app waits after the last edit (`RECOVERY_POLICY.idleMs`) instead of waiting
// for it: `copyDue` moves the clock past it.

/** The app's wait after the last edit before it writes a copy, and a margin. */
const IDLE_MS = 5_000 + 500

test.beforeEach(async ({ context }) => {
  await context.clock.install()
  // Save downloads in every browser (Chromium's pickers are native dialogs a test can't drive),
  // for every page of the context. Without the open picker no file handles are stored.
  await context.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>
    for (const name of ['showSaveFilePicker', 'showOpenFilePicker']) {
      delete (Window.prototype as unknown as Record<string, unknown>)[name]
      delete w[name]
    }
  })
})

const dirtyDot = (page: Page) => toolbar(page).getByRole('img', { name: 'Unsaved changes' })
const fileTitle = (page: Page) => toolbar(page).locator('.file-title')
const recoveryDialog = (page: Page) => dialog(page, 'Recover unsaved changes')
const startScreen = (page: Page) => page.getByRole('heading', { name: 'Start a project' })

/** A new page of the context at the app, its console errors failing the test too. */
async function openPage(context: BrowserContext, errors: string[], url = '/'): Promise<Page> {
  const page = await context.newPage()
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
  page.on('pageerror', (e) => errors.push(`page error: ${e.message}`))
  await page.goto(url)
  return page
}

/** The number of recovery slots stored in the origin. */
const slotCount = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('plotting-software-recovery', 1)
        open.onupgradeneeded = () => {
          open.result.createObjectStore('records')
          open.result.createObjectStore('copies')
        }
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const req = db.transaction('records').objectStore('records').count()
          req.onsuccess = () => {
            db.close()
            resolve(req.result)
          }
        }
      }),
  )

/** A table with an edit, left unsaved until its recovery copy is written. */
async function editUnsaved(page: Page, name: string, value: string) {
  await newTable(page, { kind: 'Column', name, sample: true })
  await typeCells(page, 9, 0, [[value]])
  await expect(dirtyDot(page)).toBeVisible()
  await copyDue(page)
  // Written about 5 s after the last edit; the file name's tooltip says when.
  await expect(fileTitle(page)).toHaveAttribute('title', /^Recovery copy saved \d/)
}

/** Moves the clock past the copy's due time (timers due meanwhile fire once). */
const copyDue = (page: Page) => page.clock.fastForward(IDLE_MS)

/** The start check has had time to run (it offers nothing here). */
async function expectNoOffer(page: Page) {
  await expect(startScreen(page)).toBeVisible()
  await page.waitForTimeout(1000)
  await expect(recoveryDialog(page)).toHaveCount(0)
}

test('a page closed with unsaved changes offers them again; Recover restores them', async ({
  page,
  context,
  consoleErrors,
}) => {
  await page.goto('/')
  await editUnsaved(page, 'Weights', '123')
  await page.close()

  const next = await openPage(context, consoleErrors)
  const d = recoveryDialog(next)
  await expect(d).toContainText(/Recover unsaved changes to an untitled project from \d/)
  await expect(d).toContainText('Weights (2 sheets)')
  await d.getByRole('button', { name: 'Recover' }).click()
  await expect(d).toBeHidden()
  await expect(grid(next)).toHaveAccessibleName('Weights')
  await expect(cell(next, 9, 0)).toHaveText('123')
  await expect(sheets(next)).toHaveCount(2)
  // Recovered as an unsaved project; this page's own copy replaces the orphan.
  await expect(dirtyDot(next)).toBeVisible()
  await expect(next).toHaveTitle('Untitled • — statPlotter')
  await expect.poll(() => slotCount(next)).toBe(1)

  // Saving clears the copy: the next start offers nothing.
  const download = next.waitForEvent('download')
  await runMenu(next, 'File', 'Save')
  await download
  await expect(dirtyDot(next)).toHaveCount(0)
  await expect.poll(() => slotCount(next)).toBe(0)
  await expect(fileTitle(next)).not.toHaveAttribute('title', /Recovery/)
  await next.close()
  await expectNoOffer(await openPage(context, consoleErrors))
})

test('Later keeps the copy for the next start; Discard deletes it', async ({
  page,
  context,
  consoleErrors,
}) => {
  await page.goto('/')
  await editUnsaved(page, 'Doses', '7')
  await page.close()

  let next = await openPage(context, consoleErrors)
  await recoveryDialog(next).getByRole('button', { name: 'Later' }).click()
  await expect(recoveryDialog(next)).toBeHidden()
  await expect(startScreen(next)).toBeVisible()
  expect(await slotCount(next)).toBe(1)
  await next.close()

  next = await openPage(context, consoleErrors)
  await recoveryDialog(next).getByRole('button', { name: 'Discard' }).click()
  await expect(recoveryDialog(next)).toBeHidden()
  await expect.poll(() => slotCount(next)).toBe(0)
  await next.close()
  await expectNoOffer(await openPage(context, consoleErrors))
})

test('an open page’s copy is never offered; several orphans are listed', async ({
  page,
  context,
  consoleErrors,
}) => {
  await page.goto('/')
  await editUnsaved(page, 'First', '1')

  // The first page is still open: its copy isn't an orphan.
  const second = await openPage(context, consoleErrors)
  await expectNoOffer(second)
  await editUnsaved(second, 'Second', '2')
  await page.close()
  await second.close()

  const next = await openPage(context, consoleErrors)
  const d = recoveryDialog(next)
  await expect(d).toContainText('These projects had unsaved changes')
  const rows = d.getByRole('listitem')
  await expect(rows).toHaveCount(2)
  // Newest first.
  await expect(rows.nth(0)).toContainText('Second')
  await expect(rows.nth(1)).toContainText('First')
  await rows.nth(1).getByRole('button', { name: 'Discard' }).click()
  // One left: the question for it.
  await expect(rows).toHaveCount(0)
  await expect(d).toContainText(/Recover unsaved changes to an untitled project from/)
  await expect(d).toContainText('Second')
  await d.getByRole('button', { name: 'Recover' }).click()
  await expect(d).toBeHidden()
  await expect(grid(next)).toHaveAccessibleName('Second')
  await expect(cell(next, 9, 0)).toHaveText('2')
})

test('an example URL opens the example; the copy waits for the next start', async ({
  page,
  context,
  consoleErrors,
}) => {
  await page.goto('/')
  await editUnsaved(page, 'Kept', '5')
  await page.close()

  const example = exampleIds()[0]!
  const next = await openPage(context, consoleErrors, `/?example=${example}`)
  await expect(sheets(next).first()).toBeVisible()
  await next.waitForTimeout(1000)
  await expect(recoveryDialog(next)).toHaveCount(0)
  expect(await slotCount(next)).toBe(1)
  await next.close()

  const later = await openPage(context, consoleErrors)
  await expect(recoveryDialog(later)).toContainText('Kept')
})

test('a clean project leaves no copy; no Continue entry without recent files', async ({ page }) => {
  await page.goto('/')
  await newTable(page, { kind: 'Column', name: 'Clean' })
  await copyDue(page)
  // Nothing typed after creating: still unsaved (a new table is a change), so a copy is kept…
  await expect(fileTitle(page)).toHaveAttribute('title', /^Recovery copy saved/)
  // …until the project is closed (after confirming), which clears it.
  await runMenu(page, 'File', 'Close project')
  await answer(page, 'Discard unsaved changes?', 'Discard')
  await expect(startScreen(page)).toBeVisible()
  await expect.poll(() => slotCount(page)).toBe(0)
  // "Continue with …" needs a remembered file (Chromium file handles; none here).
  await expect(page.getByRole('button', { name: /^Continue with/ })).toHaveCount(0)
})

// Leaving right after an edit (decision 280), long before the copy is due: in pagehide the copy is
// made on the main thread, kept in a localStorage buffer and its IndexedDB write started (which
// Chromium and WebKit abort as the page goes; the buffer becomes the slot at the next start). The
// serialize worker, started when the page was idle, is never first loaded while the page goes
// away: WebKit reported that load, cut short, as a page error.

test('an edit, then at once another example: no error, and the edit is kept', async ({
  page,
  context,
  consoleErrors,
}) => {
  await openExample(page, 'getting-started')
  await cell(page, 0, 0).click()
  await page.keyboard.type('99')
  await page.keyboard.press('Enter')
  await openExample(page, 'grouped')
  await page.close()

  const next = await openPage(context, consoleErrors)
  const d = recoveryDialog(next)
  await expect(d).toContainText(/Recover unsaved changes to an untitled project from \d/)
  await d.getByRole('button', { name: 'Recover' }).click()
  await expect(d).toBeHidden()
  await expect(cell(next, 0, 0)).toHaveText('99')
})

test('an edit, then at once a reload: the copy offered has the edit', async ({ page }) => {
  await page.goto('/')
  await newTable(page, { kind: 'Column', name: 'Last', sample: true })
  await typeCells(page, 9, 0, [['4321']])
  await expect(dirtyDot(page)).toBeVisible()
  await page.reload()

  const d = recoveryDialog(page)
  await expect(d).toContainText('Last (2 sheets)')
  await d.getByRole('button', { name: 'Recover' }).click()
  await expect(d).toBeHidden()
  await expect(grid(page)).toHaveAccessibleName('Last')
  await expect(cell(page, 9, 0)).toHaveText('4321')
})

/** Recovery locks held in the origin (one per open page). */
const recoveryLocks = (page: Page) =>
  page.evaluate(
    async () =>
      (await navigator.locks.query()).held?.filter((l) => l.name?.startsWith('ps-recovery:'))
        .length ?? 0,
  )

test('an edit, then at once the tab closed: the copy has the edit', async ({
  page,
  context,
  consoleErrors,
}) => {
  await page.goto('/')
  await newTable(page, { kind: 'Column', name: 'Closed', sample: true })
  await typeCells(page, 9, 0, [['765']])
  await expect(dirtyDot(page)).toBeVisible()
  // Closed as a person closes it: asked whether to leave (unsaved changes), and leaving. (Firefox
  // keeps no write made only in pagehide when Playwright closes a tab outright, as in a crash.)
  page.on('dialog', (d) => void d.accept())
  const closed = page.waitForEvent('close')
  await page.close({ runBeforeUnload: true })
  await closed

  // Firefox frees the closed tab's lock a moment after the close, so a tab opened at once may
  // still see it open and leave its copy (buffered, or written in pagehide) for the next start.
  const probe = await openPage(context, consoleErrors)
  await expect.poll(() => recoveryLocks(probe)).toBe(1)
  await probe.close()

  const next = await openPage(context, consoleErrors)
  const d = recoveryDialog(next)
  await expect(d).toContainText('Closed (2 sheets)')
  await d.getByRole('button', { name: 'Recover' }).click()
  await expect(d).toBeHidden()
  await expect(cell(next, 9, 0)).toHaveText('765')
})
