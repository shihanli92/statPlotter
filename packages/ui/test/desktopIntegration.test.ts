import { readFileSync } from 'node:fs'
import { AppPreferences } from '@ps/model'
import { describe, expect, it, vi } from 'vitest'
import { dropKindOf, dropSteps, projectAction } from '../src/drop/dropRouter.ts'
import { resolveColorScheme } from '../src/theme/colorScheme.ts'
import {
  type AvailableUpdate,
  afterCheck,
  checkForUpdate,
  checkMessage,
  dueForCheck,
  skipping,
  UPDATE_INTERVAL_MS,
  UPDATES_NOT_SET_UP,
  type Updates,
} from '../src/updates/updates.ts'

// Roadmap 41: files the operating system opens with the app, updates of the desktop app (the
// updater faked), and the app's colours.

const root = new URL('../../../', import.meta.url)

describe('files opened from the operating system', () => {
  it('routes every associated type as a drop of it would', () => {
    const conf = JSON.parse(
      readFileSync(new URL('apps/desktop/src-tauri/tauri.macos.conf.json', root), 'utf8'),
    )
    const exts: string[] = conf.bundle.fileAssociations.flatMap((a: { ext: string[] }) => a.ext)
    const kinds = Object.fromEntries(exts.map((e) => [e, dropKindOf(`file.${e}`)]))
    expect(kinds).toEqual({
      psproj: 'project',
      pspreset: 'preset',
      psstyle: 'style',
      pzfx: 'pzfx',
      csv: 'data',
      tsv: 'data',
      xlsx: 'data',
    })
  })

  it('opens a project from the system, asking only about unsaved changes', () => {
    const none = { alt: false, shift: false }
    // Opened from the Finder or Explorer: always opens (never the Open-or-import question).
    expect(projectAction('open', false, none)).toBe('open')
    expect(projectAction('open', true, none)).toBe('open')
    expect(projectAction('open', false, { alt: true, shift: false })).toBe('open')
    // Dropped (roadmap 40, unchanged): asks on an open project, imports with Alt or Shift.
    expect(projectAction('drop', false, none)).toBe('ask')
    expect(projectAction('drop', false, { alt: false, shift: true })).toBe('import')
    expect(projectAction('drop', true, none)).toBe('open')
  })

  it('handles several files as a drop: data first, one project last', () => {
    const { steps, refused } = dropSteps(['a.psproj', 'b.csv', 'c.psstyle', 'd.psproj'])
    expect(steps.map((s) => s.kind)).toEqual(['data', 'style', 'project'])
    expect(refused.map((s) => s.name)).toEqual(['d.psproj'])
  })
})

const fakeUpdate = (version: string, install = vi.fn(async () => {})): AvailableUpdate => ({
  version,
  notes: 'Dark mode.',
  install,
})
const fakeUpdater = (opts: {
  supported?: boolean
  found?: AvailableUpdate | null
  fails?: string
}): Updates & { checks: number } => {
  const u = {
    checks: 0,
    supported: async () => opts.supported ?? true,
    async check() {
      u.checks++
      if (opts.fails) throw new Error(opts.fails)
      return opts.found ?? null
    },
  }
  return u
}

describe('updates of the desktop app', () => {
  const now = 1_800_000_000_000

  it('checks by itself at most once a day, unless turned off', () => {
    expect(dueForCheck({}, now)).toBe(true)
    expect(dueForCheck({ lastUpdateCheck: now - 1000 }, now)).toBe(false)
    expect(dueForCheck({ lastUpdateCheck: now - UPDATE_INTERVAL_MS }, now)).toBe(true)
    expect(dueForCheck({ checkUpdates: false }, now)).toBe(false)
    // A clock set back: checks again.
    expect(dueForCheck({ lastUpdateCheck: now + 5000 }, now)).toBe(true)
  })

  it('offers a newer version, and passes over a skipped one unless asked', async () => {
    const update = fakeUpdate('0.1.30')
    const updater = fakeUpdater({ found: update })
    expect(await checkForUpdate(updater, {})).toEqual({ kind: 'available', update })
    const prefs = skipping({}, '0.1.30')
    expect(prefs.skippedVersion).toBe('0.1.30')
    expect((await checkForUpdate(updater, prefs)).kind).toBe('skipped')
    // "Check now" offers it anyway; a later version is offered again.
    expect((await checkForUpdate(updater, prefs, true)).kind).toBe('available')
    const later = fakeUpdater({ found: fakeUpdate('0.1.31') })
    expect((await checkForUpdate(later, prefs)).kind).toBe('available')
  })

  it('says when this is the latest, when it can’t tell, and when updates aren’t set up', async () => {
    expect(await checkForUpdate(fakeUpdater({}), {})).toEqual({ kind: 'latest' })
    expect(checkMessage({ kind: 'latest' }, '0.1.29')).toBe('You have the latest version (0.1.29).')
    const offline = await checkForUpdate(fakeUpdater({ fails: 'offline' }), {})
    expect(offline).toEqual({ kind: 'error', message: 'offline' })
    expect(checkMessage(offline, '0.1.29')).toBe('Couldn’t check for updates: offline')
    // A build without an update key never asks the updater.
    const keyless = fakeUpdater({ supported: false, found: fakeUpdate('9.9.9') })
    const check = await checkForUpdate(keyless, {})
    expect(check).toEqual({ kind: 'unsupported' })
    expect(keyless.checks).toBe(0)
    expect(checkMessage(check, '0.1.29')).toBe(UPDATES_NOT_SET_UP)
    expect(UPDATES_NOT_SET_UP).toBe('Updates aren’t set up for this build.')
  })

  it('remembers when it checked, as valid preferences', () => {
    const p = afterCheck({ units: 'mm', skippedVersion: '0.1.30' }, now)
    expect(p).toEqual({ units: 'mm', skippedVersion: '0.1.30', lastUpdateCheck: now })
    expect(() => AppPreferences.parse(p)).not.toThrow()
  })
})

describe('the app’s colours', () => {
  it('follow the system unless chosen', () => {
    expect(resolveColorScheme(undefined, true)).toBe('dark')
    expect(resolveColorScheme(undefined, false)).toBe('light')
    expect(resolveColorScheme('light', true)).toBe('light')
    expect(resolveColorScheme('dark', false)).toBe('dark')
  })
})
