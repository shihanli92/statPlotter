import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { crc32, deflateSync } from 'node:zlib'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

// Roadmap 48: the pure parts of tools/publish-public.mjs, which publishes a version's tree to the
// public repository (docs/PUBLISHING.md): what it leaves out, what its leak checks catch (and
// don't), how it rewrites links to removed files and finds broken ones. Every sample that would
// itself be a hit is put together from pieces, so this file passes the checks it tests.

interface Hit {
  path: string
  rule: string
  line?: number
  match?: string
}
interface Word {
  kind: 'word' | 'email'
  sha256: string
}
interface PublishTool {
  EXCLUDED: string[]
  PRIVATE_EXAMPLES: string
  PRIVATE_WORDS: Word[]
  MAX_FILE_BYTES: number
  isExcluded(path: string): boolean
  privateNames(texts: string[]): string[]
  privateWordHits(text: string, words?: Word[]): string[]
  leakHits(path: string, bytes: Uint8Array, opts?: { names?: string[]; words?: Word[] }): Hit[]
  linkPath(file: string, target: string): string | null
  rewriteLinks(file: string, text: string, excluded?: (path: string) => boolean): string
  brokenLinks(
    file: string,
    text: string,
    exists: (path: string) => boolean,
  ): { file: string; line: number; target: string }[]
  versionNotes(roadmap: string, version: string): string[]
  DEMO_BUILD: { command: string; output: string; env: Record<string, string> }
}
const root = new URL('../../../', import.meta.url)
const tool = (): Promise<PublishTool> =>
  import(new URL('tools/publish-public.mjs', root).href as string) as Promise<PublishTool>

const bytes = (text: string) => new TextEncoder().encode(text)
const rules = (hits: Hit[]) => hits.map((h) => h.rule)
const j = (...parts: string[]) => parts.join('')
const sha = (text: string) => createHash('sha256').update(text).digest('hex')

describe('publish-public: what is left out', () => {
  it('leaves out the private files and folders, wherever .claude/ and CLAUDE.md are', async () => {
    const { isExcluded } = await tool()
    for (const path of [
      'CLAUDE.md',
      '.claude/launch.json',
      'apps/web/.claude/settings.json',
      'packages/ui/CLAUDE.md',
      'docs/DECISIONS.md',
      'docs/design/PAPER_PANELS.md',
      'packages/ui/src/examples/private/index.ts',
      'packages/ui/src/examples/private',
      'packages/ui/test/private/privatePapers.test.ts',
      // Audit 4 (T5): Dependabot's version updates can't merge into a tree the next version
      // replaces; the public repository has Dependabot's alerts and security updates instead.
      '.github/dependabot.yml',
    ])
      expect(isExcluded(path), path).toBe(true)
    for (const path of [
      'README.md',
      'docs/ROADMAP.md',
      'docs/design/PZFX_GRAPHS.md',
      'packages/ui/src/examples/published/paper.ts',
      'packages/ui/src/examples/privateExamples.ts',
      'packages/ui/test/publishedExamples.test.ts',
      'docs/DECISIONS.md.bak/x',
      'CLAUDE.md.txt',
      '.github/workflows/ci.yml',
      'docs/dependabot.yml',
    ])
      expect(isExcluded(path), path).toBe(false)
  })

  // In the private repository only: the public one is the tree without them.
  const isPrivate = existsSync(new URL('packages/ui/src/examples/private/', root))
  it.skipIf(!isPrivate)('names files and folders that exist in this repository', async () => {
    const { EXCLUDED, PRIVATE_EXAMPLES } = await tool()
    for (const e of EXCLUDED.filter((x) => !x.startsWith('.claude')))
      expect(existsSync(new URL(e, root)), e).toBe(true)
    // The private specs are where the script reads the names it looks for.
    expect(readdirSync(new URL(PRIVATE_EXAMPLES, root)).length).toBeGreaterThan(1)
  })
})

describe('publish-public: leak checks', () => {
  it('reads the private source names from the specs: supplementary file prefixes, folders', async () => {
    const { privateNames } = await tool()
    const spec = j(
      "const F = '99999_2026_1234_",
      "MOESM5_ESM.xlsx'\n",
      "export const X = { id: 'x', folder: 'x_",
      "source_data', files: ['99999_2026_1234_",
      "MOESM6_ESM.xlsx'] }",
    )
    expect(privateNames([spec])).toEqual([j('99999_2026_1234_', 'MOESM'), j('x_', 'source_data')])
    expect(privateNames(['const nothing = 1'])).toEqual([])
  })

  it('finds the private names in paths and lines, case ignored', async () => {
    const { leakHits } = await tool()
    const names = [j('99999_2026_1234_', 'MOESM'), j('x_', 'source_data')]
    const text = j('a\n// read from X_', 'SOURCE_DATA/ and 99999_2026_1234_', 'MOESM5\n')
    expect(leakHits('docs/a.md', bytes(text), { names })).toEqual([
      { path: 'docs/a.md', rule: 'private source file name', line: 2, match: names[0] },
      { path: 'docs/a.md', rule: 'private source file name', line: 2, match: names[1] },
    ])
    expect(leakHits('docs/a.md', bytes('99999_2026_1235_MOESM5'), { names })).toEqual([])
  })

  it('refuses source_data paths, .pzfx files outside the fixtures, excluded and large files', async () => {
    const { leakHits, MAX_FILE_BYTES } = await tool()
    const of = (path: string, size = 10) => rules(leakHits(path, new Uint8Array(size).fill(97)))
    expect(of(j('source', '_data/a.csv'))).toEqual(['source_data path'])
    expect(of(j('paper_source', '_data/x.xlsx'))).toEqual(['source_data path'])
    expect(of('lab/run.pzfx')).toEqual(['.pzfx outside the test fixtures'])
    expect(of('packages/io/test/fixtures/pzfx/column.pzfx')).toEqual([])
    expect(of('apps/e2e/fixtures/xy.pzfx')).toEqual([])
    expect(of('CLAUDE.md')).toEqual(['excluded file'])
    expect(of('packages/ui/src/examples/private/a.ts')).toEqual(['excluded file'])
    expect(of('a.bin', MAX_FILE_BYTES + 1)).toEqual(['larger than 5 MB'])
    expect(of('a.bin', MAX_FILE_BYTES)).toEqual([])
    expect(of('.env')).toEqual(['secret file name'])
    expect(of('deploy/server.pem')).toEqual(['secret file name'])
    expect(of('.env.example')).toEqual([])
    expect(of('apps/web/src/sourceData.ts')).toEqual([])
  })

  it('finds absolute home paths, macOS, Windows and Linux', async () => {
    const { leakHits } = await tool()
    const of = (line: string) => rules(leakHits('a.ts', bytes(line)))
    expect(of(j("const p = '/", "Users/alice/data.csv'"))).toEqual(['home path'])
    expect(of(j('C:', '\\Users\\alice\\data.csv'))).toEqual(['home path'])
    expect(of(j("'C:", "\\\\Users\\\\alice\\\\x'"))).toEqual(['home path'])
    expect(of(j('D:/', 'Users/bob/x'))).toEqual(['home path'])
    expect(of('/usr/local/bin and /home/me and ~/Documents')).toEqual([])
    expect(of(j('/', 'Users/<you>/ (a placeholder)'))).toEqual([])
    // Audit 4 (T10): Linux home folders too; the placeholders tests use (`/home/me/`, CI's
    // `/home/runner/`) aren't anyone's.
    expect(of(j("const p = '/", "home/alice/data.csv'"))).toEqual(['home path'])
    expect(of(j('/', 'home/<you>/x'))).toEqual([])
    expect(of('PathBuf::from("/home/me/data.csv") or /home/runner/work')).toEqual([])
  })

  // Audit 4 (T10): what binary files carry as text — the members of zip archives (.xlsx, .zip)
  // and the text chunks of PNG images — is checked like a text file's lines.
  it('checks the members of zip archives (xlsx) and the text chunks of PNG images', async () => {
    const { leakHits } = await tool()
    const home = j('/', 'Users/alice/x.csv')
    const archive = zipSync({
      'xl/worksheets/sheet1.xml': strToU8(`<row><c t="s"><v>${home}</v></c></row>`),
      'xl/sharedStrings.xml': strToU8('<sst>clean</sst>'),
    })
    expect(leakHits('docs/a.xlsx', archive)).toEqual([
      {
        path: 'docs/a.xlsx!xl/worksheets/sheet1.xml',
        rule: 'home path',
        line: 1,
        match: j('/', 'Users/alice/'),
      },
    ])
    // Compressed or stored, nested in a folder of the archive.
    const stored = zipSync({ 'data/notes.txt': [strToU8(`one\n${home}`), { level: 0 }] })
    expect(rules(leakHits('a.zip', stored))).toEqual(['home path'])
    expect(leakHits('a.zip', zipSync({ 'a.txt': strToU8('nothing here') }))).toEqual([])
    // A member under a source_data folder is a leak by its path.
    const data = zipSync({ [j('source', '_data/a.csv')]: strToU8('1,2') })
    expect(rules(leakHits('a.zip', data))).toEqual(['source_data path'])

    const png = (...chunks: [string, Uint8Array][]) => {
      const parts: Uint8Array[] = [
        Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ]
      for (const [type, data] of [...chunks, ['IEND', new Uint8Array()] as [string, Uint8Array]]) {
        const head = new Uint8Array(8)
        new DataView(head.buffer).setUint32(0, data.length)
        head.set(strToU8(type), 4)
        const body = new Uint8Array([...strToU8(type), ...data])
        const crc = new Uint8Array(4)
        new DataView(crc.buffer).setUint32(0, crc32(body))
        parts.push(head, data, crc)
      }
      return new Uint8Array(parts.flatMap((p) => [...p]))
    }
    const text = (s: string) => strToU8(s, true)
    expect(rules(leakHits('docs/a.png', png(['tEXt', text(`Source\0${home}`)])))).toEqual([
      'home path',
    ])
    const z = new Uint8Array([...text('Comment\0\0'), ...deflateSync(text(`made from ${home}`))])
    expect(leakHits('docs/a.png', png(['zTXt', z]))).toEqual([
      { path: 'docs/a.png (zTXt)', rule: 'home path', line: 1, match: j('/', 'Users/alice/') },
    ])
    const i = new Uint8Array([...text('XML:com.adobe.xmp\0\0\0\0\0'), ...strToU8(home)])
    expect(rules(leakHits('docs/a.png', png(['iTXt', i])))).toEqual(['home path'])
    expect(leakHits('docs/a.png', png(['tEXt', text('Software\0statPlotter')]))).toEqual([])
  })

  it('finds secrets by their shape, not their names', async () => {
    const { leakHits } = await tool()
    const of = (line: string) => rules(leakHits('a.txt', bytes(line)))
    const positive: [string, string][] = [
      [j('-----BEGIN ', 'RSA PRIVATE KEY-----'), 'private key'],
      [j('-----BEGIN ', 'OPENSSH PRIVATE KEY-----'), 'private key'],
      [j('-----BEGIN ', 'PRIVATE KEY-----'), 'private key'],
      [j('-----BEGIN ', 'PGP PRIVATE KEY BLOCK-----'), 'private key'],
      [j('token = gh', 'p_', 'a'.repeat(36)), 'GitHub token'],
      [j('github', '_pat_', 'A1'.repeat(15)), 'GitHub token'],
      [j('key: s', 'k-', 'ant-', 'x9'.repeat(15)), 'API key (sk-…)'],
      [j('s', 'k-', 'Ab3'.repeat(10)), 'API key (sk-…)'],
      [j('AKIA', 'ABCDEFGHIJKLMNOP'), 'AWS access key'],
      [j('aws_secret', '_access_key = ', 'a/B+'.repeat(10)), 'AWS secret key'],
      [j('CLOUDFLARE', '_API_TOKEN=', 'x'.repeat(40)), 'Cloudflare token'],
      [j('TAURI_SIGNING', '_PRIVATE_KEY=', 'dW50cnVzdGVk'), 'Tauri signing key'],
      [j('TAURI_SIGNING', '_PRIVATE_KEY_PASSWORD="hunter2"'), 'Tauri signing key'],
      [j('untrusted comment: ', 'rsign encrypted secret key'), 'minisign secret key'],
    ]
    for (const [line, rule] of positive) expect(of(line), line).toEqual([rule])
    const negative = [
      // How the workflows and the docs name secrets, without their values.
      j('TAURI_SIGNING_PRIVATE_KEY: $', '{{ secrets.TAURI_SIGNING_PRIVATE_KEY }}'),
      j('TAURI_SIGNING_PRIVATE_KEY', '='),
      j('`TAURI_SIGNING_PRIVATE_KEY', '=` with a value'),
      'export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/app.key)"',
      "releaseConfig({ TAURI_SIGNING_PRIVATE_KEY: 'k' })",
      j('apiToken: $', '{{ secrets.CLOUDFLARE_API_TOKEN }}'),
      j('CLOUDFLARE_API_TOKEN', '='),
      'the mask-image and risk-adjusted desk-top values',
      'a gh_ prefix, AKIA alone, BEGIN PUBLIC KEY',
      j('-----BEGIN ', 'PUBLIC KEY-----'),
    ]
    for (const line of negative) expect(of(line), line).toEqual([])
  })

  it('finds private words by their hashes, as words and as the end of an address', async () => {
    const { privateWordHits, leakHits } = await tool()
    const words = [
      { kind: 'word' as const, sha256: sha('examplecorp') },
      { kind: 'email' as const, sha256: sha('jo.doe@') },
    ]
    expect(privateWordHits('Staff of ExampleCorp, Inc.', words)).toEqual(['private word #1'])
    expect(privateWordHits('mail: student.examplecorp.edu', words)).toEqual(['private word #1'])
    expect(privateWordHits('write to jo.doe@example.org', words)).toEqual(['private word #2'])
    expect(privateWordHits('write to Mr.Jo.Doe@example.org', words)).toEqual(['private word #2'])
    expect(privateWordHits('examplecorporation; ajo.doe@x; jo.doe (no @)', words)).toEqual([])
    expect(rules(leakHits('a.md', bytes('x\nexamplecorp\n'), { words }))).toEqual([
      'private word #1',
    ])
  })

  it('holds the private words only as hashes (one word, one address)', async () => {
    const { PRIVATE_WORDS } = await tool()
    expect(PRIVATE_WORDS.map((w) => w.kind).sort()).toEqual(['email', 'word'])
    for (const w of PRIVATE_WORDS) expect(w.sha256).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('publish-public: links', () => {
  it('resolves relative targets from the file; URLs, anchors and root paths are not files', async () => {
    const { linkPath } = await tool()
    expect(linkPath('docs/design/A.md', '../DECISIONS.md#row')).toBe('docs/DECISIONS.md')
    expect(linkPath('README.md', 'docs/ROADMAP.md')).toBe('docs/ROADMAP.md')
    expect(linkPath('docs/A.md', '../packages/ui/src/examples/private/')).toBe(
      'packages/ui/src/examples/private',
    )
    expect(linkPath('docs/A.md', 'My%20File.md')).toBe('docs/My File.md')
    for (const t of ['https://example.org/a.md', 'mailto:a@b', '#section', '/abs.md'])
      expect(linkPath('docs/A.md', t), t).toBeNull()
  })

  it('makes links to files left out plain text, saying so where the text names the file', async () => {
    const { rewriteLinks } = await tool()
    const text = [
      'Decision log: [docs/DECISIONS.md](docs/DECISIONS.md).',
      'See [the panels](docs/design/PAPER_PANELS.md#fig-1) and [the roadmap](docs/ROADMAP.md).',
      'A [link](https://example.org/DECISIONS.md) stays.',
      '```',
      '[docs/DECISIONS.md](docs/DECISIONS.md) in a code block stays',
      '```',
    ].join('\n')
    expect(rewriteLinks('README.md', text).split('\n')).toEqual([
      'Decision log: docs/DECISIONS.md (not in the public repository).',
      'See the panels and [the roadmap](docs/ROADMAP.md).',
      'A [link](https://example.org/DECISIONS.md) stays.',
      '```',
      '[docs/DECISIONS.md](docs/DECISIONS.md) in a code block stays',
      '```',
    ])
    expect(
      rewriteLinks('docs/design/X.md', 'Decisions 1–2 ([DECISIONS.md](../DECISIONS.md))'),
    ).toBe('Decisions 1–2 (DECISIONS.md (not in the public repository))')
    expect(rewriteLinks('docs/X.md', 'no links here')).toBe('no links here')
  })

  it('finds relative links to files that are not there, outside code blocks', async () => {
    const { brokenLinks } = await tool()
    const files = new Set(['docs/ROADMAP.md', 'docs/img/a.png', 'docs'])
    const exists = (p: string) => files.has(p)
    const text = [
      '[ok](ROADMAP.md) ![ok](img/a.png) [web](https://x.org) [top](#a)',
      '[gone](DECISIONS.md) and ![gone](img/b.png)',
      '```',
      '[ignored](nowhere.md)',
      '```',
      '[ref]: ./missing.md',
    ].join('\n')
    expect(brokenLinks('docs/A.md', text, exists)).toEqual([
      { file: 'docs/A.md', line: 2, target: 'DECISIONS.md' },
      { file: 'docs/A.md', line: 2, target: 'img/b.png' },
      { file: 'docs/A.md', line: 6, target: './missing.md' },
    ])
  })
})

describe('publish-public: the commit message', () => {
  it('quotes the version’s row of the roadmap and its phase entry', async () => {
    const { versionNotes } = await tool()
    const roadmap = [
      '| Version | Phase(s) | Commit |',
      '|---|---|---|',
      '| 0.2.10 | 47c | merge of 47c |',
      '| 0.3.1 | 48 Open source | merge of 48 |',
      '| **0.4.0** | **Code audit 4** | — |',
      '',
      '## Phases',
      '',
      '48. ✅ **Open source** — decisions 1–2. The source',
      '    is published (decisions 3–4), one commit per version.',
      '',
      '49. Next',
    ].join('\n')
    expect(versionNotes(roadmap, '0.3.1')).toEqual([
      'Open source',
      '',
      'The source is published, one commit per version.',
    ])
    expect(versionNotes(roadmap, '0.4.0')).toEqual(['Code audit 4'])
    expect(versionNotes(roadmap, '0.2.1')).toEqual([])
    expect(versionNotes(roadmap, '0.3.2')).toEqual([])
  })
})

describe('publish-public: the demo build', () => {
  it('builds as netlify.toml tells Netlify, with the repository’s pnpm and Node', async () => {
    const { DEMO_BUILD } = await tool()
    const read = (path: string) => readFileSync(new URL(path, root), 'utf8')
    // Netlify installs with the `packageManager` pin (Corepack) itself; the command builds.
    expect(JSON.parse(read('package.json')).packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/)
    expect(DEMO_BUILD.command).toBe('pnpm --filter @ps/web build')
    expect(DEMO_BUILD.env.NODE_VERSION).toBe(read('.nvmrc').trim())
    expect(DEMO_BUILD.output).toBe('apps/web/dist')
    const toml = read('netlify.toml')
    expect(toml).toContain(`command = "${DEMO_BUILD.command}"`)
    expect(toml).toContain(`publish = "${DEMO_BUILD.output}"`)
    for (const [k, v] of Object.entries(DEMO_BUILD.env)) expect(toml).toContain(`${k} = "${v}"`)
    expect(read('docs/PUBLISHING.md')).toContain('netlify.toml')
    // The deployment's headers (the Content-Security-Policy) are copied into the output.
    expect(existsSync(new URL('apps/web/public/_headers', root))).toBe(true)
  })
})
