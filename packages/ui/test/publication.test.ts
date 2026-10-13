import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Audit 3 (T8, T11, licence): what the repository holds is fit to publish as it is.

const root = new URL('../../../', import.meta.url)
/** The tracked files whose text matches `pattern` (git grep's extended regular expression). */
const grep = (pattern: string) =>
  spawnSync('git', ['grep', '-l', '-I', '-E', pattern], { cwd: root, encoding: 'utf8' })
    .stdout.split('\n')
    .filter(Boolean)

/** A workflow job's lines: from `  <job>:` to the next job (or the end of the file). */
const job = (workflow: string, name: string) => {
  const text = readFileSync(new URL(`.github/workflows/${workflow}`, root), 'utf8')
  const start = text.indexOf(`\n  ${name}:\n`)
  if (start < 0) throw new Error(`${workflow} has no job ${name}`)
  const rest = text.slice(start + 1)
  const next = rest.slice(1).search(/\n {2}[A-Za-z][\w-]*:\n/)
  return next < 0 ? rest : rest.slice(0, next + 1)
}

/** The workflows, by file name. */
const workflows = () =>
  readdirSync(new URL('.github/workflows/', root)).filter((f) => /\.ya?ml$/.test(f))
const workflowText = (file: string) =>
  readFileSync(new URL(`.github/workflows/${file}`, root), 'utf8')
/** A workflow's job names (two-space keys under `jobs:`). */
const jobsOf = (file: string) => {
  const text = workflowText(file)
  return [...text.slice(text.indexOf('\njobs:\n')).matchAll(/^ {2}([A-Za-z][\w-]*):/gm)].map(
    (m) => m[1]!,
  )
}

describe('publication', () => {
  it('names no absolute path in a macOS home folder in a tracked file', () => {
    // (Split so that this file doesn't match.)
    expect(grep(['/Users/', '[^/[:space:]]+/'].join(''))).toEqual([])
  })

  it('is licensed GPL-3.0-or-later, with the text, the notices and every package saying so', () => {
    const read = (path: string) => readFileSync(new URL(path, root), 'utf8')
    const licence = read('LICENSE')
    expect(licence).toMatch(/^\s*GNU GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/)
    expect(licence).toContain('END OF TERMS AND CONDITIONS')
    const manifests = spawnSync('git', ['ls-files', '*package.json'], {
      cwd: root,
      encoding: 'utf8',
    })
      .stdout.split('\n')
      .filter(Boolean)
    expect(manifests.length).toBeGreaterThan(5)
    for (const path of manifests) {
      expect(JSON.parse(read(path)).license, path).toBe('GPL-3.0-or-later')
    }
    // Code translated from R and its packages: an SPDX line beside the source it cites, and a
    // credit in NOTICE for each file.
    const notice = read('NOTICE')
    const gpl = readdirSync(new URL('packages/stats/src/gpl/', root)).filter((f) =>
      f.endsWith('.ts'),
    )
    expect(gpl.length).toBeGreaterThan(5)
    for (const file of gpl) {
      const text = read(`packages/stats/src/gpl/${file}`)
      expect(text.split('\n')[0], file).toBe('// SPDX-License-Identifier: GPL-3.0-or-later')
      expect(text, file).toMatch(/Licensed under|GPL ≥ 2|GNU General Public License/)
      expect(notice, file).toContain(`packages/stats/src/gpl/${file}`)
    }
    for (const credit of ['MASS', 'nortest', 'survival', 'Liberation', 'Sans Narrow', 'pzfx']) {
      expect(notice).toContain(credit)
    }
    const readme = read('README.md')
    expect(readme).toContain('## Licence')
    expect(readme).not.toContain('personal / lab use')
  })

  it('runs deploys and releases only in the project repository', () => {
    // A copy published elsewhere (the public repository) has neither the secrets nor the
    // services: these jobs would run there and fail.
    const guarded = [
      ['ci.yml', 'deploy'],
      ['release.yml', 'create-release'],
      ['release.yml', 'build'],
      ['release.yml', 'publish-release'],
    ]
    for (const [workflow, name] of guarded) {
      const condition = job(workflow, name).match(/^ {4}if: (.*)$/m)?.[1] ?? ''
      expect(condition, `${workflow} ${name}`).toContain(
        "github.repository == 'shihanli92/plottingTool'",
      )
    }
  })

  // Audit 4 (T2): the Rust advisories and the three browsers' nightly run need no secret, so they
  // run in the owner's repositories, the public one included (where Actions run), never in forks.
  it('runs the Rust advisories and the nightly end-to-end tests in the owner’s repositories', () => {
    for (const [workflow, name] of [
      ['e2e-nightly.yml', 'e2e'],
      ['desktop.yml', 'audit'],
    ]) {
      const text = job(workflow, name)
      expect(text.match(/^ {4}if: (.*)$/m)?.[1], `${workflow} ${name}`).toBe(
        "github.repository_owner == 'shihanli92'",
      )
      expect(text, `${workflow} ${name}`).not.toMatch(/\$\{\{[^}]*secrets\./)
      expect(text, `${workflow} ${name}`).not.toMatch(/has no secrets/)
    }
  })

  // Roadmap 48: the public repository (shihanli92/statPlotter) receives this tree, workflows and
  // all. Its CI runs the checks and the end-to-end tests without secrets; code scanning runs
  // there only; no workflow runs a fork's pull request with the repository's token or secrets.
  it('runs code scanning only in the public repository', () => {
    expect(jobsOf('codeql.yml')).toEqual(['analyze'])
    expect(job('codeql.yml', 'analyze')).toContain(
      "    if: github.repository == 'shihanli92/statPlotter'",
    )
    expect(workflowText('codeql.yml')).toMatch(/languages: javascript-typescript/)
  })

  it('runs scheduled jobs in the owner’s repositories only', () => {
    for (const file of workflows().filter((f) => /^ {2}schedule:/m.test(workflowText(f)))) {
      for (const name of jobsOf(file)) {
        const condition = job(file, name).match(/^ {4}if: (.*)$/m)?.[1] ?? ''
        expect(condition, `${file} ${name}`).toMatch(
          /github\.repository(_owner)? == '[\w-]+(\/[\w-]+)?'|github\.event_name != 'schedule'/,
        )
      }
    }
  })

  it('gives workflows a read-only token, pinned actions and no pull_request_target', () => {
    const files = workflows()
    expect(files).toContain('ci.yml')
    for (const file of files) {
      const text = workflowText(file)
      expect(text, file).not.toContain('pull_request_target')
      expect(text, file).not.toMatch(/write-all/)
      expect(text, file).toMatch(/^permissions:\n {2}contents: read\n(?! {2}\S)/m)
      for (const [, ref] of text.matchAll(/^\s+(?:- )?uses: (\S+)/gm))
        expect(ref, `${file}: ${ref}`).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/)
    }
  })

  it('checks and tests every push and pull request without secrets', () => {
    const ci = workflowText('ci.yml')
    expect(ci).toMatch(/^on:\n {2}push:\n {4}branches: \[main\]\n {2}pull_request:\n/m)
    for (const name of ['check', 'e2e']) {
      const text = job('ci.yml', name)
      expect(text, name).not.toMatch(/\$\{\{[^}]*secrets\./)
      expect(text, name).not.toMatch(/^ {4}if:/m)
    }
  })

  // In the private repository only: the public snapshot leaves the file out (audit 4, T5).
  const hasDependabot = existsSync(new URL('.github/dependabot.yml', root))
  it.skipIf(!hasDependabot)('has Dependabot propose npm and Actions updates every week', () => {
    const text = readFileSync(new URL('.github/dependabot.yml', root), 'utf8')
    for (const ecosystem of ['npm', 'github-actions']) {
      expect(text).toMatch(
        new RegExp(
          `package-ecosystem: ${ecosystem}\\n {4}directory: /\\n {4}schedule:\\n {6}interval: weekly`,
        ),
      )
    }
  })
})
