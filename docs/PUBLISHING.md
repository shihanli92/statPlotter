# Publishing the source and the demo

Roadmap 48. Development happens in the private repository `shihanli92/plottingTool`, which keeps
the whole history. The public repository [`shihanli92/statPlotter`](https://github.com/shihanli92/statPlotter)
receives **one squashed commit per published version**, made by `tools/publish-public.mjs`, and
the public demo is built from it by Netlify.

## What is published

Everything at the version's commit except:

| Left out | Why |
|---|---|
| `.claude/`, `CLAUDE.md` | the agents' configuration and instructions |
| `docs/DECISIONS.md`, `docs/design/PAPER_PANELS.md` | the decision log and the paper panels' catalogue |
| `packages/ui/src/examples/private/` | the papers whose source data aren't openly licensed, and the example of the user's own data |
| `packages/ui/test/private/` | the tests that exist only for those examples |
| `.github/dependabot.yml` | Dependabot's version updates: their pull requests could never merge into a tree the next version replaces whole (audit 4, T5) |

The app and the tests find the private examples through `import.meta.glob`
(`packages/ui/src/examples/privateExamples.ts`), so a tree without the folder builds and passes
its checks with the examples that are part of the app. Development builds of the private
repository list them as before; production builds never contain them. In the public tree, links
in Markdown files to the files left out become plain text ("DECISIONS.md (not in the public
repository)").

## Once: the public repository

- Settings › Code security: turn on Dependabot alerts and security updates, secret scanning with
  push protection, and private vulnerability reporting (all free for a public repository).
  Dependabot's alerts say when a locked dependency has an advisory; its pull requests there (and
  its version updates, which `.github/dependabot.yml` asks for in the private repository only)
  can't be merged, since each version replaces the tree: make the update in the private
  repository and publish the next version. `.github/workflows/codeql.yml` scans the code (it
  runs only in `statPlotter`).
- Settings › Actions › General: keep "Require approval for all outside collaborators" for fork
  pull requests. CI (`ci.yml`) runs the checks and the Chromium end-to-end tests there without
  any secret, and so do the nightly end-to-end tests in all three browsers (`e2e-nightly.yml`)
  and the weekly Rust advisories check (`desktop.yml` `audit`), which run in the owner's
  repositories, never in a fork (audit 4, T2); deploys and releases are guarded to the private
  repository, and no workflow uses `pull_request_target` (`ui/test/publication.test.ts` checks
  all of this). Actions are turned off in the private repository, so these public runs are the
  only ones (GitHub emails a failed scheduled run; it pauses a public repository's schedules
  after 60 days without a commit, which a published version restarts).

## Once: the demo on Netlify

The demo is a Netlify site (free plan) connected to `shihanli92/statPlotter`: Netlify builds and
deploys `main` on each push, at <https://statplotter.netlify.app>. Its build settings are in
`netlify.toml` at the root, so the site needs no build settings of its own:

| Setting | Value |
|---|---|
| Build command | `pnpm --filter @ps/web build` (`netlify.toml`) |
| Publish directory | `apps/web/dist` (`netlify.toml`) |
| Node | `NODE_VERSION` = `24` (`netlify.toml`; `.nvmrc` says the same) |
| pnpm | 11.9.0, from `packageManager` in `package.json` (Netlify installs it with Corepack) |

Creating it (Netlify › Add new project › Import an existing project › GitHub):

1. Pick `shihanli92/statPlotter` (grant Netlify's GitHub app access to that repository only).
2. Project name `statplotter` (the address `statplotter.netlify.app`; if the name is taken, pick
   another and change the README's "Try it" link). Branch to deploy: `main`. Leave the build
   fields as `netlify.toml` fills them in, with no environment variables, and deploy.
3. Project configuration › Build & deploy › Continuous deployment › Branches and deploy contexts:
   **Deploy Previews: Don't deploy pull requests**, **Branch deploys: Deploy only the production
   branch**. With previews on, every pull request to the public repository would be built (its
   code run in Netlify's build) and served at a public URL; only `main`, which only the publish
   script writes, is deployed.
4. After the first deploy, check that a response carries the Content-Security-Policy
   (`apps/web/public/_headers`, copied into `apps/web/dist/`, which Netlify serves as Cloudflare
   did): `curl -I https://statplotter.netlify.app/`.

The publish script runs the same install and build in a fresh copy of the snapshot before it
commits (`DEMO_BUILD` in the script; `ui/test/publishPublic.test.ts` checks that `netlify.toml`
says the same).

**The earlier demo on Cloudflare** (the Worker `statplotter` at `*.workers.dev`): once the Netlify
site serves the app, delete that Worker (Workers & Pages › `statplotter` › Settings › Delete), so
the public repository isn't deployed in two places. `wrangler.jsonc` was its configuration and is
gone.

**The private deployment** (project `plotter`, deployed by `ci.yml`'s `deploy` job, which runs
only while the private repository's Actions are on: they are off, so it keeps its last build)
stays behind Cloudflare Access. Extend its Access policy to the preview deployments too (Workers & Pages › `plotter` ›
Settings › General › Access policy for preview deployments, or an Access application covering
`*.plotter.pages.dev`): otherwise a preview URL would serve the private build without a login.

## Each version

1. Merge the phase into `main` and bump the version as usual (CLAUDE.md, Versioning; the
   roadmap's "Versions" table: its row is quoted in the public commit's message).
2. **Dry run** (nothing is pushed):

   ```sh
   node tools/publish-public.mjs --version 0.3.1 --ref main
   ```

   It exports the tree at `--ref`, leaves out the files above, rewrites the links to them and
   checks every relative Markdown link, then runs the **leak checks** and stops on any hit (each
   one printed):
   - a path under any `source_data` folder, a `.pzfx` file outside the test fixtures
     (`packages/io/test/fixtures/`, `apps/e2e/fixtures/`), a file left out, a file over 5 MB,
     a file named like a secret (`.env`, `*.pem`, `*.key`, …);
   - absolute paths in a home folder (macOS, Windows or Linux);
   - private words (held in the script as SHA-256 hashes only);
   - anything shaped like a secret: private keys, GitHub, `sk-…`, AWS, Slack and Google keys,
     Cloudflare tokens, `TAURI_SIGNING_PRIVATE_KEY=` with a value;
   - the names of the left-out papers' source files and folders (read from their specs before
     they are removed).

   Text files are checked line by line; so are the members of zip archives (`.xlsx`, `.zip`:
   each checked as a file of its own, paths included, and a member that can't be read is a hit)
   and the text chunks of PNG images (`tEXt`, `zTXt`, `iTXt`, EXIF). Other binary files (JPEGs,
   fonts) are checked by their path and size only (audit 4, T10).

   Then it verifies the snapshot on its own (`pnpm install --frozen-lockfile`, `pnpm check`, the
   web build, and the demo's install and build above in a fresh copy, whose output must hold
   `_headers`), clones the public repository, replaces its tree with the snapshot and commits
   "statPlotter 0.3.1" as `60378562+shihanli92@users.noreply.github.com` (author and committer).
   It prints the commit, its file count and size, the top-level folders, and the paths of the
   file list and of the clone. It warns when `APP_VERSION` isn't the version given (`--push`
   refuses).
3. **Review**: the printed message, the file list (`files.txt`, with sizes), and the commit itself
   (`git -C <folder>/public show --stat HEAD`).
4. **Push**: run the same command with `--push`; it repeats every check, then asks you to type
   `yes` (`--yes` skips the question). It pushes `main` only and tags nothing.
5. Netlify builds and deploys the demo from the new commit (check the deployment's log the
   first time); the public CI and CodeQL run on the push.

`--remote <url>` publishes elsewhere (e.g. a scratch repository to try the script);
`--skip-verify` leaves out step 2's install, check and builds, for a quicker dry run only.
