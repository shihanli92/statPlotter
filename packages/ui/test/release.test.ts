import { readFileSync } from 'node:fs'
import { APP_VERSION } from '@ps/model'
import { describe, expect, it } from 'vitest'

// Roadmap 41: the desktop release's configuration (tools/release-config.mjs) and the files the
// release builds from. The workflow itself runs only on GitHub (docs/RELEASING.md).

const root = new URL('../../../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), 'utf8')

interface ReleaseTool {
  releaseConfig(env: Record<string, string | undefined>): {
    config: {
      bundle?: { createUpdaterArtifacts?: boolean; windows?: Record<string, string> }
      plugins?: { updater?: { pubkey: string; endpoints: string[] } }
    }
    notes: string[]
  }
  appVersion(): string
  defaultEndpoint(repository: string): string
}
const tool = (): Promise<ReleaseTool> =>
  import(new URL('tools/release-config.mjs', root).href as string) as Promise<ReleaseTool>

describe('release configuration', () => {
  it('is empty without keys: the release builds, without updates or signing', async () => {
    const { releaseConfig } = await tool()
    const { config, notes } = releaseConfig({ GITHUB_REPOSITORY: 'o/r' })
    expect(config).toEqual({})
    expect(notes).toContain('updates: off (no update key set up)')
    expect(notes).toContain('Windows signing: off (unsigned)')
  })

  it('needs both keys for updates', async () => {
    const { releaseConfig } = await tool()
    expect(releaseConfig({ TAURI_UPDATER_PUBKEY: 'pub', GITHUB_REPOSITORY: 'o/r' }).config).toEqual(
      {},
    )
    expect(
      releaseConfig({ TAURI_SIGNING_PRIVATE_KEY: 'k', GITHUB_REPOSITORY: 'o/r' }).config,
    ).toEqual({})
    expect(
      releaseConfig({ TAURI_UPDATER_PUBKEY: '  ', TAURI_SIGNING_PRIVATE_KEY: 'k' }).config,
    ).toEqual({})
  })

  it('turns updates on with the public key and the latest release as the endpoint', async () => {
    const { releaseConfig } = await tool()
    const { config } = releaseConfig({
      TAURI_UPDATER_PUBKEY: ' pub \n',
      TAURI_SIGNING_PRIVATE_KEY: 'secret',
      GITHUB_REPOSITORY: 'owner/repo',
    })
    expect(config.bundle?.createUpdaterArtifacts).toBe(true)
    expect(config.plugins?.updater?.pubkey).toBe('pub')
    expect(config.plugins?.updater?.endpoints).toEqual([
      'https://github.com/owner/repo/releases/latest/download/latest.json',
    ])
    // The private key is never written anywhere.
    expect(JSON.stringify(config)).not.toContain('secret')
    const own = releaseConfig({
      TAURI_UPDATER_PUBKEY: 'pub',
      TAURI_SIGNING_PRIVATE_KEY: 'k',
      TAURI_UPDATER_ENDPOINT: 'https://example.org/latest.json',
    })
    expect(own.config.plugins?.updater?.endpoints).toEqual(['https://example.org/latest.json'])
  })

  it('signs Windows builds when a certificate thumbprint is given', async () => {
    const { releaseConfig } = await tool()
    const { config } = releaseConfig({
      WINDOWS_CERTIFICATE_THUMBPRINT: 'AB12',
      TAURI_UPDATER_PUBKEY: 'pub',
      TAURI_SIGNING_PRIVATE_KEY: 'k',
      GITHUB_REPOSITORY: 'o/r',
    })
    expect(config.bundle?.windows?.certificateThumbprint).toBe('AB12')
    expect(config.bundle?.createUpdaterArtifacts).toBe(true)
  })

  it('reads the app version the tag must match', async () => {
    expect((await tool()).appVersion()).toBe(APP_VERSION)
  })
})

describe('desktop bundle', () => {
  const conf = JSON.parse(read('apps/desktop/src-tauri/tauri.conf.json'))
  const mac = JSON.parse(read('apps/desktop/src-tauri/tauri.macos.conf.json'))
  const win = JSON.parse(read('apps/desktop/src-tauri/tauri.windows.conf.json'))
  const exts = (list: { ext: string[] }[]) => list.flatMap((a) => a.ext).sort()

  it('has no updater in the committed configuration (the release adds it with the key)', () => {
    expect(conf.plugins?.updater).toBeUndefined()
    expect(conf.bundle.createUpdaterArtifacts).toBeUndefined()
  })

  it("owns its own files everywhere, and is only an alternative for others' on macOS", () => {
    expect(exts(conf.bundle.fileAssociations)).toEqual(['psproj', 'pspreset', 'psstyle'].sort())
    expect(exts(mac.bundle.fileAssociations)).toEqual(
      ['csv', 'psproj', 'pspreset', 'psstyle', 'pzfx', 'tsv', 'xlsx'].sort(),
    )
    for (const a of mac.bundle.fileAssociations)
      if (!a.ext[0].startsWith('ps')) expect(a.rank).toBe('Alternate')
  })

  it('adds data files to Windows "Open with" without becoming their default', () => {
    expect(win.bundle.windows.nsis.installerHooks).toBe('./windows/open-with.nsh')
    const nsh = read('apps/desktop/src-tauri/windows/open-with.nsh')
    for (const ext of ['csv', 'tsv', 'xlsx', 'pzfx'])
      expect(nsh).toContain(`!insertmacro PS_OPEN_WITH "${ext}"`)
    // Only OpenWithProgids: never the extension's default value.
    expect(nsh).not.toMatch(/Classes\\\.\$\{EXT\}" ""/)
  })

  it('builds a universal macOS app and Windows installers on version tags', () => {
    const wf = read('.github/workflows/release.yml')
    expect(wf).toContain("tags: ['v*']")
    expect(wf).toContain('--target universal-apple-darwin')
    expect(wf).toContain('workflow_dispatch')
    expect(wf).toContain('tools/release-config.mjs')
  })
})
