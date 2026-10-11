# Publishing the source and the demo

Roadmap 48. Development happens in the private repository `shihanli92/plottingTool`, which keeps
the whole history. The public repository [`shihanli92/statPlotter`](https://github.com/shihanli92/statPlotter)
receives **one squashed commit per published version**, made by `tools/publish-public.mjs`, and
the public demo is built from it by Cloudflare Pages.

## What is published

Everything at the version's commit except:

| Left out | Why |
|---|---|
| `.claude/`, `CLAUDE.md` | the agents' configuration and instructions |
| `docs/DECISIONS.md`, `docs/design/PAPER_PANELS.md` | the decision log and the paper panels' catalogue |
| `packages/ui/src/examples/private/` | the papers whose source data aren't openly licensed, and the example of the user's own data |
| `packages/ui/test/private/` | the tests that exist only for those examples |

The app and the tests find the private examples through `import.meta.glob`
(`packages/ui/src/examples/privateExamples.ts`), so a tree without the folder builds and passes
its checks with the examples that are part of the app. Development builds of the private
repository list them as before; production builds never contain them. In the public tree, links
in Markdown files to the files left out become plain text ("DECISIONS.md (not in the public
repository)").

## Once: the public repository

- Settings › Code security: turn on Dependabot alerts and security updates, secret scanning with
  push protection, and private vulnerability reporting (all free for a public repository).
  `.github/dependabot.yml` proposes weekly updates of the npm packages and the pinned Actions;
  `.github/workflows/codeql.yml` scans the code (it runs only in `statPlotter`).
- Settings › Actions › General: keep "Require approval for all outside collaborators" for fork
  pull requests. CI (`ci.yml`) runs the checks and the Chromium end-to-end tests there without
  any secret; deploys, releases and the nightly runs are guarded to the private repository, and
  no workflow uses `pull_request_target` (`ui/test/publication.test.ts` checks all of this).

## Once: the demo on Cloudflare

The demo project (a Worker serving static assets, or a Pages project) is connected to `shihanli92/statPlotter` (Git integration): Cloudflare builds
and deploys `main` on each push. Its settings (Workers & Pages › the project › Settings):

| Setting | Value |
|---|---|
| Production branch | `main` |
| Framework preset | None |
| Build command | `npx --yes pnpm@11.9.0 install --frozen-lockfile && npx --yes pnpm@11.9.0 --filter @ps/web build` |
| Build output directory | `apps/web/dist` |
| Deploy command (Worker projects) | `npx wrangler deploy` (reads `wrangler.jsonc` at the root) |
| Root directory | `/` (empty) |
| Build system version | the latest (v3) |
| Environment variables (production) | `NODE_VERSION` = `24`, `SKIP_DEPENDENCY_INSTALL` = `true` |
| Preview deployments (Builds › Branch control) | **None** |
| Access policy | none: the demo is public |

- **Why npx:** the repository pins pnpm 11.9.0 (`packageManager` in `package.json`) and its
  lockfile is pnpm 11's. The build image's own pnpm may be older, so the command runs pnpm 11.9.0
  itself, and `SKIP_DEPENDENCY_INSTALL` skips the image's install step. If a build log shows the
  image installing anyway and failing, add `PNPM_VERSION` = `11.9.0`.
- **A Worker project** (the dashboard's default) runs a deploy command after the build. Without
  `wrangler.jsonc`, `npx wrangler deploy` stops at the workspace root ("application detection
  logic has been run in the root of a workspace"); the file names the Worker and its assets
  folder. Workers' static assets honour `_headers` as Pages does. Turn off its non-production
  branch builds as below.
- **Preview deployments off:** with them on, every branch (and pull request) pushed to the public
  repository would be built and served at a public URL. Only `main`, which only the publish
  script writes, is deployed.
- **The first build fails** until the first snapshot is pushed: the repository is empty until
  then. Retry the deployment (or push) after the first `--push`.
- `apps/web/public/_headers` is copied into `apps/web/dist/`, so the demo is served with the
  app's Content-Security-Policy. After the first deployment, check that a response carries it
  (the browser's network panel, or `curl -I https://<project>.pages.dev/`).

The publish script runs exactly this build command, in a fresh copy of the snapshot, before it
commits (`CLOUDFLARE_BUILD` in the script; `ui/test/publishPublic.test.ts` checks that this table
says the same).

**The private deployment** (project `plotter`, deployed by `ci.yml`) stays behind Cloudflare
Access. Extend its Access policy to the preview deployments too (Workers & Pages › `plotter` ›
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
   - absolute paths in a home folder (macOS or Windows);
   - private words (held in the script as SHA-256 hashes only);
   - anything shaped like a secret: private keys, GitHub, `sk-…`, AWS, Slack and Google keys,
     Cloudflare tokens, `TAURI_SIGNING_PRIVATE_KEY=` with a value;
   - the names of the left-out papers' source files and folders (read from their specs before
     they are removed).

   Then it verifies the snapshot on its own (`pnpm install --frozen-lockfile`, `pnpm check`, the
   web build, and the Cloudflare build command above in a fresh copy, whose output must hold
   `_headers`), clones the public repository, replaces its tree with the snapshot and commits
   "statPlotter 0.3.1" as `60378562+shihanli92@users.noreply.github.com` (author and committer).
   It prints the commit, its file count and size, the top-level folders, and the paths of the
   file list and of the clone. It warns when `APP_VERSION` isn't the version given (`--push`
   refuses).
3. **Review**: the printed message, the file list (`files.txt`, with sizes), and the commit itself
   (`git -C <folder>/public show --stat HEAD`).
4. **Push**: run the same command with `--push`; it repeats every check, then asks you to type
   `yes` (`--yes` skips the question). It pushes `main` only and tags nothing.
5. Cloudflare builds and deploys the demo from the new commit (check the deployment's log the
   first time); the public CI and CodeQL run on the push.

`--remote <url>` publishes elsewhere (e.g. a scratch repository to try the script);
`--skip-verify` leaves out step 2's install, check and builds, for a quicker dry run only.
