import { readFileSync } from 'node:fs'
import { APP_VERSION } from '@ps/model'
import { describe, expect, it } from 'vitest'

// The app's version (CLAUDE.md, Versioning): APP_VERSION is the one source; the web and desktop
// manifests must say the same, so the About box, saved files and the desktop build agree.

const root = new URL('../../../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), 'utf8')

describe('app version', () => {
  it('is 0.<audits>.<phases>', () => {
    expect(APP_VERSION).toMatch(/^0\.\d+\.\d+$/)
  })

  it.each([
    ['apps/web/package.json', (s: string) => JSON.parse(s).version],
    ['apps/desktop/package.json', (s: string) => JSON.parse(s).version],
    ['apps/desktop/src-tauri/tauri.conf.json', (s: string) => JSON.parse(s).version],
    ['apps/desktop/src-tauri/Cargo.toml', (s: string) => /^version = "(.+)"/m.exec(s)?.[1]],
    [
      'apps/desktop/src-tauri/Cargo.lock',
      (s: string) => /name = "ps-desktop"\nversion = "(.+)"/.exec(s)?.[1],
    ],
  ])('%s matches', (path, version) => {
    expect(version(read(path))).toBe(APP_VERSION)
  })
})
