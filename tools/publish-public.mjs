#!/usr/bin/env node
// Publishes a version of the app to the public repository (roadmap 48, docs/PUBLISHING.md): the
// tree at a ref of this repository, without what stays private, as one squashed commit per
// version on the public repository's main branch. A dry run unless --push.
//
//   node tools/publish-public.mjs --version 0.3.1 [--ref main] [--push [--yes]]
//                                 [--remote <url>] [--skip-verify]
//
// 1. Exports the tree at --ref (git archive) into a temporary folder and removes the exclusions.
// 2. Rewrites the Markdown links to removed files, then checks every relative Markdown link.
// 3. Leak checks (stops on any hit, each printed): files under source_data/, .pzfx files outside
//    the test fixtures, absolute home paths, private words, secrets, any excluded file, files
//    over 5 MB, the source files of the papers left out (read from their specs before removal);
//    the lines of text files, of the members of zip archives (.xlsx) and of PNG text chunks.
// 4. Verifies the snapshot on its own: pnpm install --frozen-lockfile, pnpm check, the web build;
//    then, in a fresh copy, the public demo's install and build as Netlify runs them, whose output
//    must hold the deployment's _headers (the Content-Security-Policy).
// 5. Clones the public repository (or starts one when it can't be reached), replaces its tree
//    with the snapshot and commits "statPlotter <version>" as the GitHub noreply identity.
// 6. With --push (after typing "yes", or with --yes), pushes that commit. Never tags.

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix, relative, sep } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { inflateRawSync, inflateSync } from 'node:zlib'

const ROOT = join(fileURLToPath(import.meta.url), '..', '..')

export const PUBLIC_REPOSITORY = 'shihanli92/statPlotter'
const DEFAULT_REMOTE = `https://github.com/${PUBLIC_REPOSITORY}.git`
/** The public commits' author and committer (GitHub's noreply address for the account). */
export const IDENTITY = {
  name: 'shihanli92',
  email: '60378562+shihanli92@users.noreply.github.com',
}

/**
 * What stays in this repository only: paths (a trailing / is a folder) from the root. Also left
 * out wherever they are: any `.claude/` folder and any CLAUDE.md.
 */
export const EXCLUDED = [
  '.claude/',
  'CLAUDE.md',
  'docs/DECISIONS.md',
  'docs/design/PAPER_PANELS.md',
  // The papers whose source data aren't openly licensed and the user's own data (roadmap 48),
  // and the tests that exist only for them.
  'packages/ui/src/examples/private/',
  'packages/ui/test/private/',
  // Dependabot's version updates (audit 4, T5): a pull request can never merge into a tree the
  // next version replaces whole. The public repository keeps Dependabot's alerts and security
  // updates (its settings), which need no file.
  '.github/dependabot.yml',
]

/** The folder whose paper specs name the source files that must not appear in the snapshot. */
export const PRIVATE_EXAMPLES = 'packages/ui/src/examples/private/'

/** Whether a path (relative, '/'-separated; a folder with or without its trailing /) is left out. */
export function isExcluded(path) {
  const p = path.replace(/^\.\//, '')
  const segments = p.split('/').filter(Boolean)
  if (segments.includes('.claude')) return true
  if (/^CLAUDE(\.local)?\.md$/.test(segments.at(-1) ?? '')) return true
  return EXCLUDED.some((e) => (e.endsWith('/') ? p === e.slice(0, -1) || p.startsWith(e) : p === e))
}

/** The committed .pzfx files: test fixtures (any other .pzfx is someone's data). */
export const PZFX_FIXTURES = ['packages/io/test/fixtures/', 'apps/e2e/fixtures/']

export const MAX_FILE_BYTES = 5 * 1024 * 1024

/**
 * The public demo's build: Netlify builds the public repository's main branch itself (connected
 * to it; `netlify.toml` at the root holds these settings, docs/PUBLISHING.md the rest). Netlify
 * installs with the pnpm `packageManager` pins (Corepack) under `NODE_VERSION`, then runs
 * `command`; the script does the same with that pnpm through npx.
 */
export const DEMO_BUILD = {
  command: 'pnpm --filter @ps/web build',
  output: 'apps/web/dist',
  env: { NODE_VERSION: '24' },
}

/**
 * Words that must never be published, as SHA-256 hashes so that this published file doesn't hold
 * them: a `word` is matched against every run of letters and digits (case ignored); an `email`
 * (ending in @) against the end of every address's local part.
 */
export const PRIVATE_WORDS = [
  { kind: 'word', sha256: 'd81176965e9ca9fefab353655d119e3938d5b3244637b73cd2e948b81a7314fc' },
  { kind: 'email', sha256: 'bf675bd53964a188df1ead3dc8950de710fe453a3699d66e530f1e836cc96ca7' },
]

/** Secrets by their shape (rule, pattern). */
export const SECRET_PATTERNS = [
  ['private key', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})/],
  ['API key (sk-…)', /\bsk-(?:[a-z]+-)?[A-Za-z0-9_-]{20,}/],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['AWS secret key', /aws_?secret_?access_?key["']?\s*[=:]\s*["']?[A-Za-z0-9/+=]{40}/i],
  [
    'Cloudflare token',
    /\b(?:CLOUDFLARE|CF)_API_(?:TOKEN|KEY)["']?\s*[=:]\s*["']?[A-Za-z0-9_-]{30,}/,
  ],
  ['Tauri signing key', /TAURI_SIGNING_PRIVATE_KEY(?:_PASSWORD)?\s*=\s*["'`]?[^\s"'`$]/],
  ['minisign secret key', /untrusted comment: (?:rsign|minisign) encrypted secret key/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
]

/** Files that are secrets by their name. */
const SECRET_FILES =
  /(^|\/)(\.env(\.(?!example$|sample$)[^/]*)?|id_[a-z0-9]+|[^/]+\.(pem|key|p12|pfx))$/

/**
 * Absolute paths in a home folder (macOS, Windows or Linux; audit 4, T10: Linux). The Linux
 * folders tests name as placeholders (`/home/me/`, CI's `/home/runner/`) are no one's.
 */
const HOME_PATHS = [
  ['home path', /\/Users\/[^/\s'"`*<>]+\//],
  ['home path', /\b[A-Za-z]:(?:\\\\?|\/)Users(?:\\\\?|\/)[^\\/\s'"`*<>]+/],
  ['home path', /\/home\/(?!(?:me|runner)\/)[^/\s'"`*<>]+\//],
]

/** Longer runs of letters are never one of the private words. */
const MAX_WORD = 64
const LOCAL_PART = /[a-z0-9._%+-]/

const hashes = new Map()
/** A token's SHA-256 (remembered: the same tokens recur across a repository's files). */
function sha256(text) {
  let h = hashes.get(text)
  if (h === undefined) {
    h = createHash('sha256').update(text).digest('hex')
    hashes.set(text, h)
  }
  return h
}

/** The private words a text holds (as `private word #n`, never the word). */
export function privateWordHits(text, words = PRIVATE_WORDS) {
  const lower = text.toLowerCase()
  const hits = new Set()
  const want = new Map(words.map((w, i) => [w.sha256, i]))
  if (words.some((w) => w.kind === 'word')) {
    for (const token of new Set(lower.match(/[a-z0-9]+/g) ?? [])) {
      if (token.length > MAX_WORD) continue
      const i = want.get(sha256(token))
      if (i !== undefined && words[i].kind === 'word') hits.add(i)
    }
  }
  if (words.some((w) => w.kind === 'email')) {
    // Each address's local part, read back from its @ (linear, however long the line).
    for (let at = lower.indexOf('@'); at >= 0; at = lower.indexOf('@', at + 1)) {
      let start = at
      while (start > 0 && at - start < MAX_WORD && LOCAL_PART.test(lower[start - 1])) start--
      const local = lower.slice(start, at)
      // The whole local part and each of its ends after a separator ("x.name@" → "name@").
      const ends = [0, ...[...local.matchAll(/[._%+-]/g)].map((m) => m.index + 1)]
      for (const from of ends) {
        if (from >= local.length) continue
        const i = want.get(sha256(`${local.slice(from)}@`))
        if (i !== undefined && words[i].kind === 'email') hits.add(i)
      }
    }
  }
  return [...hits].sort().map((i) => `private word #${i + 1}`)
}

/**
 * The names the papers left out read from source_data (their journals' supplementary file
 * prefixes, e.g. "12345_2026_1234_MOESM", and their folders), from the texts of their specs.
 */
export function privateNames(texts) {
  const names = new Set()
  for (const text of texts) {
    for (const m of text.matchAll(/\b(\d{5}_\d{4}_\d{4,5})_MOESM\d+_ESM\b/g)) {
      names.add(`${m[1]}_MOESM`)
    }
    for (const m of text.matchAll(/\bfolder:\s*['"]([^'"]+)['"]/g)) names.add(m[1])
  }
  return [...names].sort()
}

/** Whether bytes look like text (no NUL in the first 8 kB). */
export const isText = (bytes) => !bytes.subarray(0, 8192).includes(0)

/** The most an archive member may inflate to and still be checked (more is a hit of its own). */
const MAX_MEMBER_BYTES = 64 * 1024 * 1024

const bufferOf = (bytes) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)

/**
 * The members of a zip archive (an .xlsx, a .zip): [name, bytes], the bytes null when they can't
 * be read (a compression other than stored or deflate, encryption, damage, too large); [] when
 * the bytes aren't a zip archive. Read from the central directory (sizes are there even when a
 * member's local header defers them).
 */
export function zipMembers(bytes) {
  const buf = bufferOf(bytes)
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) return []
  let end = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i
      break
    }
  }
  if (end < 0) return [['(no central directory)', null]]
  const count = buf.readUInt16LE(end + 10)
  let p = buf.readUInt32LE(end + 16)
  const out = []
  for (let k = 0; k < count; k++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) {
      out.push([`(member ${k + 1})`, null])
      break
    }
    const flags = buf.readUInt16LE(p + 8)
    const method = buf.readUInt16LE(p + 10)
    const size = buf.readUInt32LE(p + 20)
    const nameLength = buf.readUInt16LE(p + 28)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLength)
    p += 46 + nameLength + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32)
    if (name.endsWith('/')) continue
    let content = null
    try {
      if (buf.readUInt32LE(local) === 0x04034b50 && !(flags & 1)) {
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
        const data = buf.subarray(start, start + size)
        if (method === 0) content = data
        else if (method === 8) content = inflateRawSync(data, { maxOutputLength: MAX_MEMBER_BYTES })
      }
    } catch {
      content = null
    }
    out.push([name, content])
  }
  return out
}

/**
 * The text a PNG image carries: its tEXt, zTXt and iTXt chunks (as "keyword: text", by chunk
 * type) and its EXIF; [] when the bytes aren't a PNG. A chunk that can't be inflated is "".
 */
export function pngTexts(bytes) {
  const buf = bufferOf(bytes)
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a)
    return []
  const out = []
  const inflated = (data) => {
    try {
      return inflateSync(data, { maxOutputLength: MAX_MEMBER_BYTES })
    } catch {
      return Buffer.alloc(0)
    }
  }
  for (let p = 8; p + 12 <= buf.length; ) {
    const length = buf.readUInt32BE(p)
    const type = buf.toString('latin1', p + 4, p + 8)
    const data = buf.subarray(p + 8, Math.min(buf.length, p + 8 + length))
    p += 12 + length
    const nul = data.indexOf(0)
    const keyword = data.toString('latin1', 0, Math.max(0, nul))
    if (type === 'tEXt') out.push([type, `${keyword}: ${data.toString('latin1', nul + 1)}`])
    else if (type === 'zTXt')
      out.push([type, `${keyword}: ${inflated(data.subarray(nul + 2)).toString('latin1')}`])
    else if (type === 'iTXt') {
      // keyword \0 compressed method language \0 translated keyword \0 text
      const compressed = data[nul + 1] === 1
      const language = data.indexOf(0, nul + 3)
      const translated = data.indexOf(0, language + 1)
      const text = data.subarray(translated + 1)
      out.push([type, `${keyword}: ${(compressed ? inflated(text) : text).toString('utf8')}`])
    } else if (type === 'eXIf') out.push([type, data.toString('latin1')])
    else if (type === 'IEND') break
  }
  return out
}

/** A match shown without giving it away: its ends, the middle masked. */
const masked = (s) => (s.length <= 8 ? `${s[0]}…` : `${s.slice(0, 4)}…${s.slice(-2)}`)

/**
 * The leak-check hits of one file: { path, rule, line?, match? } for its path, its size and
 * (text files) every line. Audit 4 (T10): the members of a zip archive (an .xlsx) are checked
 * as files of their own ("a.xlsx!xl/sharedStrings.xml"), and a PNG's text chunks as text
 * ("a.png (tEXt)"); a member that can't be read is a hit.
 */
export function leakHits(path, bytes, { names = [], words = PRIVATE_WORDS } = {}) {
  const hits = []
  const hit = (rule, line, match) =>
    hits.push({ path, rule, ...(line ? { line } : {}), ...(match ? { match } : {}) })
  // An archive's member: its path inside the archive, checked like a path of the tree.
  const inner = path.includes('!') ? path.slice(path.lastIndexOf('!') + 1) : path
  if (isExcluded(inner)) hit('excluded file')
  if (path.split(/[/!]/).some((s) => /source_data/i.test(s))) hit('source_data path')
  if (/\.pzfx$/i.test(path) && !PZFX_FIXTURES.some((f) => path.startsWith(f))) {
    hit('.pzfx outside the test fixtures')
  }
  if (SECRET_FILES.test(inner)) hit('secret file name')
  for (const name of names) {
    if (path.toLowerCase().includes(name.toLowerCase())) hit('private source file name', 0, name)
  }
  if (bytes.length > MAX_FILE_BYTES && inner === path) {
    hit(`larger than ${MAX_FILE_BYTES / 1024 / 1024} MB`)
  }
  if (!isText(bytes)) {
    for (const [name, content] of zipMembers(bytes)) {
      if (content === null)
        hits.push({ path: `${path}!${name}`, rule: 'unreadable archive member' })
      else hits.push(...leakHits(`${path}!${name}`, content, { names, words }))
    }
    for (const [type, text] of pngTexts(bytes)) {
      for (const h of lineHits(`${path} (${type})`, text, names, words)) hits.push(h)
    }
    return hits
  }
  hits.push(...lineHits(path, Buffer.from(bytes).toString('utf8'), names, words))
  return hits
}

/** The hits of a text's lines: home paths, secrets, private source names and words. */
function lineHits(path, text, names, words) {
  const hits = []
  const hit = (rule, line, match) =>
    hits.push({ path, rule, ...(line ? { line } : {}), ...(match ? { match } : {}) })
  const lowerNames = names.map((n) => n.toLowerCase())
  text.split('\n').forEach((line, i) => {
    // One home path hit per line (a Windows path written with / matches both patterns).
    const home = HOME_PATHS.map(([, re]) => line.match(re)).find(Boolean)
    if (home) hit('home path', i + 1, home[0])
    for (const [rule, re] of SECRET_PATTERNS) {
      const m = line.match(re)
      if (m) hit(rule, i + 1, masked(m[0]))
    }
    const lower = line.toLowerCase()
    lowerNames.forEach((n, j) => {
      if (lower.includes(n)) hit('private source file name', i + 1, names[j])
    })
    for (const w of privateWordHits(line, words)) hit(w, i + 1)
  })
  return hits
}

/** A Markdown link's target as a path from the root, or null for a URL, an anchor or a root path. */
export function linkPath(file, target) {
  const t = target.trim().replace(/^<|>$/g, '')
  if (/^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith('#') || t.startsWith('/')) return null
  const path = decodeURI(t.split('#')[0].split('?')[0])
  if (!path) return null
  return posix.normalize(posix.join(posix.dirname(file), path)).replace(/\/$/, '')
}

const LINK = /(!?)\[((?:[^[\]]|\[[^\]]*\])*)\]\(([^()\s]+|<[^>]*>)(\s+"[^"]*")?\)/g

/** Lines of Markdown outside fenced code blocks, as [line index, text]. */
function proseLines(text) {
  const out = []
  let fence = null
  text.split('\n').forEach((line, i) => {
    const m = line.match(/^\s*(`{3,}|~{3,})/)
    if (m) {
      if (!fence) fence = m[1][0]
      else if (m[1][0] === fence) fence = null
      return
    }
    if (!fence) out.push([i, line])
  })
  return out
}

/**
 * A Markdown file with its links to left-out files made plain text: the link text kept, and
 * "(not in the public repository)" after it where the text names the file.
 */
export function rewriteLinks(file, text, excluded = isExcluded) {
  const lines = text.split('\n')
  for (const [i, line] of proseLines(text)) {
    lines[i] = line.replace(LINK, (whole, bang, label, target) => {
      const path = linkPath(file, target)
      if (path === null || !excluded(path)) return whole
      if (bang) return ''
      const named = /^`?[\w./-]+\.md`?$/.test(label.trim())
      return named ? `${label} (not in the public repository)` : label
    })
  }
  return lines.join('\n')
}

/** The relative links of a Markdown file whose target doesn't exist: { file, line, target }. */
export function brokenLinks(file, text, exists) {
  const out = []
  for (const [i, line] of proseLines(text)) {
    const targets = [
      ...[...line.matchAll(LINK)].map((m) => m[3]),
      ...[...line.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/g)].map((m) => m[1]),
    ]
    for (const target of targets) {
      const path = linkPath(file, target)
      if (path !== null && path !== '' && path !== '.' && !exists(path)) {
        out.push({ file, line: i + 1, target })
      }
    }
  }
  return out
}

/**
 * The commit message's body: a headline for the version from docs/ROADMAP.md's table ("Versions")
 * and its phase's whole entry, where they are. The decision log is not in the public repository,
 * so references to its rows ("decisions 1170–1203") are left out, as are the roadmap's ✅ marks.
 */
export function versionNotes(roadmap, version) {
  const esc = version.replace(/\./g, '\\.')
  const row = roadmap
    .split('\n')
    .find((l) => new RegExp(`^\\|\\s*\\**[^|]*(^|[^\\d.])${esc}([^\\d.]|$)[^|]*\\|`).test(l))
  if (!row) return []
  const cells = row.split('|').map((c) => c.trim().replace(/\*\*/g, ''))
  const phaseCell = cells[2] ?? ''
  const phase = phaseCell.match(/^(\d+[a-z]?)\b/)?.[1]
  const lines = roadmap.split('\n')
  const start = phase ? lines.findIndex((l) => l.startsWith(`${phase}. `)) : -1
  const entry = []
  if (start >= 0) {
    entry.push(lines[start])
    for (let i = start + 1; i < lines.length && /^\s+\S/.test(lines[i]); i++)
      entry.push(lines[i].trim())
  }
  const text = entry
    .join(' ')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^\d+[a-z]?\.\s*(✅\s*)?/, '')
    .replace(/\s*—\s*decisions? [\d–, -]+(\([^)]*\))?(;[^.]*)?\.\s*/, '. ')
    .replace(/\s*\((?:decisions?|amends) [^)]*\)/g, '')
    .trim()
  // The headline: the entry's title ("Open source as statPlotter"), else the table's words.
  const title = text.split('. ')[0]
  const headline = phase ? title || phaseCell : phaseCell.replace(/\s*\(.*$/, '')
  if (!headline) return []
  const body =
    phase && text
      ? text
          .slice(title.length)
          .replace(/^\.\s*/, '')
          .trim()
      : ''
  return body ? [headline, '', body] : [headline]
}

/** Wraps text at `width` columns (for the commit body). */
export const wrap = (text, width = 72) =>
  text
    .split('\n')
    .map((para) => {
      const out = []
      let line = ''
      for (const word of para.split(' ')) {
        if (line && line.length + 1 + word.length > width) {
          out.push(line)
          line = word
        } else line = line ? `${line} ${word}` : word
      }
      out.push(line)
      return out.join('\n')
    })
    .join('\n')

// ---------------------------------------------------------------------------------------------

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })
}

/** Every file under `dir`, as '/'-separated paths from it (folders named in `skip` left out). */
function walk(dir, skip = new Set()) {
  const out = []
  const visit = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue
      const p = join(d, entry.name)
      if (entry.isDirectory()) visit(p)
      else out.push(relative(dir, p).split(sep).join('/'))
    }
  }
  visit(dir)
  return out.sort()
}

function parseArgs(argv) {
  const opts = { ref: 'main', remote: DEFAULT_REMOTE, push: false, yes: false, verify: true }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const value = () => {
      const v = argv[++i]
      if (!v || v.startsWith('--')) throw new Error(`${a} needs a value`)
      return v
    }
    if (a === '--version') opts.version = value()
    else if (a === '--ref') opts.ref = value()
    else if (a === '--remote') opts.remote = value()
    else if (a === '--push') opts.push = true
    else if (a === '--yes') opts.yes = true
    else if (a === '--skip-verify') opts.verify = false
    else throw new Error(`unknown argument ${a}`)
  }
  if (!opts.version || !/^\d+\.\d+\.\d+$/.test(opts.version)) {
    throw new Error('--version <major.minor.patch> is required')
  }
  if (opts.push && !opts.verify) throw new Error('--skip-verify is for dry runs only')
  return opts
}

const step = (text) => console.log(`\n▸ ${text}`)

function fail(text) {
  console.error(`\n✗ ${text}`)
  process.exit(1)
}

async function main(argv) {
  let opts
  try {
    opts = parseArgs(argv)
  } catch (e) {
    console.error(`${e.message}\n`)
    console.error(
      'usage: node tools/publish-public.mjs --version <x.y.z> [--ref main] [--push [--yes]] [--remote <url>] [--skip-verify]',
    )
    process.exit(2)
  }
  const { version, ref } = opts
  const commit = run('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd: ROOT }).trim()
  const work = mkdtempSync(join(tmpdir(), 'statplotter-publish-'))
  const tree = join(work, 'tree')
  mkdirSync(tree)
  console.log(`Publishing statPlotter ${version} from ${ref} (${commit.slice(0, 12)})`)
  console.log(`Working folder: ${work}`)

  step('Exporting the tree')
  const tar = join(work, 'tree.tar')
  run('git', ['archive', '--format=tar', '-o', tar, commit], { cwd: ROOT })
  run('tar', ['-xf', tar, '-C', tree])
  rmSync(tar)
  const all = walk(tree)
  const specs = all
    .filter((p) => p.startsWith(PRIVATE_EXAMPLES) && /\.[cm]?[jt]sx?$/.test(p))
    .map((p) => readFileSync(join(tree, p), 'utf8'))
  const names = privateNames(specs)
  const removed = all.filter(isExcluded)
  for (const p of removed) rmSync(join(tree, p))
  // Folders left empty by the removals.
  for (const e of EXCLUDED.filter((x) => x.endsWith('/')))
    rmSync(join(tree, e), { recursive: true, force: true })
  for (const d of new Set(removed.map((p) => posix.dirname(p)))) {
    let dir = d
    while (
      dir !== '.' &&
      existsSync(join(tree, dir)) &&
      readdirSync(join(tree, dir)).length === 0
    ) {
      rmSync(join(tree, dir), { recursive: true })
      dir = posix.dirname(dir)
    }
  }
  const files = walk(tree)
  console.log(`${all.length} files at ${ref}; ${removed.length} left out; ${files.length} kept`)
  console.log(`${names.length} private source names to look for (from ${specs.length} specs)`)

  step('Rewriting links to files left out')
  const present = new Set(files)
  const dirs = new Set(
    files.flatMap((f) =>
      f
        .split('/')
        .slice(0, -1)
        .map((_, i, s) => s.slice(0, i + 1).join('/')),
    ),
  )
  const exists = (p) => present.has(p) || dirs.has(p)
  let rewritten = 0
  const broken = []
  for (const f of files.filter((p) => p.endsWith('.md'))) {
    const text = readFileSync(join(tree, f), 'utf8')
    const next = rewriteLinks(f, text)
    if (next !== text) {
      writeFileSync(join(tree, f), next)
      rewritten++
      console.log(`  ${f}`)
    }
    broken.push(...brokenLinks(f, next, exists))
  }
  console.log(`${rewritten} files rewritten`)
  for (const b of broken) console.error(`  broken link: ${b.file}:${b.line} → ${b.target}`)
  if (broken.length) fail(`${broken.length} broken relative links in the snapshot`)

  step('Leak checks')
  const hits = files.flatMap((f) => leakHits(f, readFileSync(join(tree, f)), { names }))
  for (const h of hits) {
    console.error(
      `  ${h.rule}: ${h.path}${h.line ? `:${h.line}` : ''}${h.match ? `  (${h.match})` : ''}`,
    )
  }
  if (hits.length) fail(`${hits.length} leak-check hits: nothing published`)
  console.log('none')

  step('Version')
  const factory = readFileSync(join(tree, 'packages/model/src/factory.ts'), 'utf8')
  const appVersion = factory.match(/APP_VERSION\s*=\s*'([^']+)'/)?.[1]
  if (appVersion !== version) {
    const text = `APP_VERSION at ${ref} is ${appVersion}, not ${version}`
    if (opts.push) fail(text)
    console.warn(`  warning: ${text} (a dry run goes on; --push refuses)`)
  } else console.log(`APP_VERSION ${appVersion}`)

  if (opts.verify) {
    step('Verifying the snapshot on its own (install, check, web build)')
    const verify = join(work, 'verify')
    cpSync(tree, verify, { recursive: true, verbatimSymlinks: true })
    // A repository of its own: the checks read tracked files through git.
    const git = (...args) => run('git', args, { cwd: verify })
    git('init', '-q', '-b', 'main')
    git('add', '-A')
    git(
      '-c',
      `user.name=${IDENTITY.name}`,
      '-c',
      `user.email=${IDENTITY.email}`,
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-q',
      '-m',
      'snapshot',
    )
    for (const args of [
      ['install', '--frozen-lockfile'],
      ['check'],
      ['--filter', '@ps/web', 'build'],
    ]) {
      console.log(`  pnpm ${args.join(' ')}`)
      const r = spawnSync('pnpm', args, {
        cwd: verify,
        stdio: 'inherit',
        env: { ...process.env, CI: 'true' },
      })
      if (r.status !== 0) fail(`pnpm ${args.join(' ')} failed in the snapshot (${verify})`)
    }
    rmSync(verify, { recursive: true, force: true })

    step('The demo’s build as Netlify runs it, in a fresh copy')
    const demo = join(work, 'demo')
    cpSync(tree, demo, { recursive: true, verbatimSymlinks: true })
    const major = process.versions.node.split('.')[0]
    if (major !== DEMO_BUILD.env.NODE_VERSION) {
      console.warn(`  warning: Node ${process.versions.node} here; Netlify builds with Node 24`)
    }
    // Netlify's install (Corepack's pnpm at the `packageManager` version), then the command.
    const pm = JSON.parse(readFileSync(join(demo, 'package.json'), 'utf8')).packageManager
    const pnpm = `npx --yes ${pm}`
    const commands = [
      `${pnpm} install --frozen-lockfile`,
      DEMO_BUILD.command.replace(/^pnpm /, `${pnpm} `),
    ]
    for (const command of commands) {
      console.log(`  ${command}`)
      const built = spawnSync('sh', ['-c', command], {
        cwd: demo,
        stdio: 'inherit',
        env: { ...process.env, ...DEMO_BUILD.env, CI: 'true' },
      })
      if (built.status !== 0) fail(`the demo's build failed in the snapshot (${command}; ${demo})`)
    }
    const out = join(demo, DEMO_BUILD.output)
    const headers = join(out, '_headers')
    if (!existsSync(join(out, 'index.html'))) fail(`${DEMO_BUILD.output}/index.html is missing`)
    if (
      !existsSync(headers) ||
      readFileSync(headers, 'utf8') !== readFileSync(join(demo, 'apps/web/public/_headers'), 'utf8')
    ) {
      fail(`${DEMO_BUILD.output}/_headers is missing or not apps/web/public/_headers`)
    }
    console.log(`  ${DEMO_BUILD.output}: index.html and _headers (Content-Security-Policy)`)
    rmSync(demo, { recursive: true, force: true })
  } else {
    console.warn('\n  warning: --skip-verify: the snapshot was not installed, checked or built')
  }

  step(`Committing to ${opts.remote}`)
  const clone = join(work, 'public')
  const git = (...args) => run('git', args, { cwd: clone })
  const cloned = spawnSync('git', ['clone', '-q', opts.remote, clone], { encoding: 'utf8' })
  if (cloned.status !== 0) {
    console.warn(
      `  could not clone (${cloned.stderr.trim().split('\n').at(-1)}); starting a new history`,
    )
    rmSync(clone, { recursive: true, force: true })
    mkdirSync(clone)
    git('init', '-q', '-b', 'main')
    git('remote', 'add', 'origin', opts.remote)
  }
  const hasHistory =
    spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: clone }).status === 0
  if (hasHistory) git('checkout', '-q', 'main')
  else git('symbolic-ref', 'HEAD', 'refs/heads/main')
  for (const entry of readdirSync(clone)) {
    if (entry !== '.git') rmSync(join(clone, entry), { recursive: true, force: true })
  }
  cpSync(tree, clone, { recursive: true, verbatimSymlinks: true })
  git('add', '-A')
  if (spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: clone }).status === 0) {
    console.log('Nothing changed since the public repository’s last commit: nothing to publish.')
    return
  }
  const roadmap = existsSync(join(tree, 'docs/ROADMAP.md'))
    ? readFileSync(join(tree, 'docs/ROADMAP.md'), 'utf8')
    : ''
  const notes = versionNotes(roadmap, version)
  const message = [
    `statPlotter ${version}`,
    '',
    ...(notes.length ? [wrap(notes.join('\n')), ''] : []),
    wrap(
      `The source of statPlotter ${version}, one commit per published version (development happens in a private repository; this is its commit ${commit.slice(0, 12)}).`,
    ),
  ].join('\n')
  writeFileSync(join(work, 'message.txt'), `${message}\n`)
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: IDENTITY.name,
    GIT_AUTHOR_EMAIL: IDENTITY.email,
    GIT_COMMITTER_NAME: IDENTITY.name,
    GIT_COMMITTER_EMAIL: IDENTITY.email,
  }
  run('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '-F', join(work, 'message.txt')], {
    cwd: clone,
    env,
  })
  const head = git('rev-parse', 'HEAD').trim()
  const listed = git('ls-files').split('\n').filter(Boolean)
  const bytes = listed.reduce((n, f) => n + statSync(join(clone, f)).size, 0)
  const list = join(work, 'files.txt')
  writeFileSync(
    list,
    listed.map((f) => `${String(statSync(join(clone, f)).size).padStart(10)}  ${f}`).join('\n') +
      '\n',
  )
  const top = [...new Set(listed.map((f) => f.split('/')[0] + (f.includes('/') ? '/' : '')))]
  console.log(git('log', '-1', '--format=%H%n%an <%ae>%n%cn <%ce>%n%n%B').trim())
  console.log(`\n${listed.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB`)
  console.log(`top level: ${top.join('  ')}`)
  console.log(`file list: ${list}`)
  console.log(`the commit: ${clone}`)

  if (!opts.push) {
    console.log('\nDry run: nothing pushed. Review, then run again with --push.')
    return
  }
  if (!opts.yes) {
    if (!process.stdin.isTTY) fail('--push asks for "yes" on a terminal (or give --yes)')
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const answer = await rl.question(
      `\nPush ${head.slice(0, 12)} to ${opts.remote} main? Type yes: `,
    )
    rl.close()
    if (answer.trim() !== 'yes') fail('not pushed')
  }
  step('Pushing')
  const pushed = spawnSync('git', ['push', 'origin', 'main'], { cwd: clone, stdio: 'inherit' })
  if (pushed.status !== 0) fail('git push failed')
  console.log(`Pushed statPlotter ${version} (${head.slice(0, 12)}).`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => fail(e.stack ?? String(e)))
}
