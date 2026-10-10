# Releasing the desktop app

Roadmap 41 (decisions 610–616; hardened in code audit 2, decisions 650–656). The desktop installers are built by GitHub Actions
(`.github/workflows/release.yml`), never on a laptop, and attached to a GitHub Release for each
version tag:

| Platform | File | Notes |
|---|---|---|
| macOS (Apple Silicon and Intel) | `statPlotter_<version>_universal.dmg` | one universal app (`--target universal-apple-darwin`) |
| Windows | `statPlotter_<version>_x64_en-US.msi` | per machine (asks for an administrator) |
| Windows | `statPlotter_<version>_x64-setup.exe` | NSIS, per user; also adds "Open with" for data files |
| Updater (when set up) | `latest.json`, `*.app.tar.gz`, `*.sig` | read by the app's updater; not for people to download |

Linux isn't built.

## Cutting a release

1. Merge the phase into `main` and bump the version as usual (CLAUDE.md, Versioning:
   `APP_VERSION` in `packages/model/src/factory.ts` and the manifests, which
   `ui/test/version.test.ts` checks). Add the version's row to the table in
   `docs/ROADMAP.md` ("Versions"): the release notes quote it.
2. Tag the merge commit and push the tag:

   ```sh
   git tag -a v0.2.0 -m "Version 0.2.0"
   git push origin v0.2.0
   ```

3. The **Release** workflow runs (Actions › Release). It
   - refuses a tag whose commit isn't on `main` (tag the merge commit on `main`, never a branch);
   - refuses a tag that isn't `v` + `APP_VERSION`;
   - makes a draft release named "statPlotter 0.2.0" whose notes quote the version's row
     of the roadmap table and link to the roadmap, and say how to open an unsigned build;
   - builds the macOS and Windows installers in parallel (about 15–25 minutes; macOS minutes cost
     ten times Linux ones on a private repository, Windows twice) and attaches them;
   - publishes the release once both builds have succeeded. If one fails the release stays a
     draft: fix, delete the draft and the tag (`git push --delete origin v0.2.0`), tag again.

**Dry run** (no tag, no release): Actions › Release › Run workflow on any branch. The installers
are kept as the run's artifacts for 7 days (`installers-macos-latest`,
`installers-windows-latest`). A dry run is **never signed**: it doesn't enter the `release`
environment, so it gets none of the signing secrets (and the workflow passes them only to tag
runs even while they are still repository secrets).

The workflow can't be run locally, and wasn't run while it was written: the first real run is the
first tag pushed. Check its log the first time, in particular that `latest.json` lists
`darwin-aarch64`, `darwin-x86_64` and `windows-x86_64` once updates are set up (tauri-action
writes both macOS entries for a universal build).

## The release environment and tag protection (once)

The signing secrets (update key, Apple certificate and notarization, Windows certificate) are
given only to the release builds of version tags (code audit 2, decision 652). Set this up once,
before the first signing secret is added (and move any that already exist):

1. **The `release` environment.** The repository › Settings › Environments › **New environment**,
   name `release`. In it:
   - **Deployment branches and tags** › "Selected branches and tags" › **Add deployment branch or
     tag rule** › type **Tag**, pattern `v*`. Only version-tag runs may then enter it (a dry run
     doesn't try to).
   - Optionally **Required reviewers**: yourself. Each release then waits for your approval
     before anything is signed (Actions › the run › Review deployments).
   - **Environment secrets**: add the signing secrets here (the names below, under "Setting up
     the update key" and "Signing"), not as repository secrets. If some already exist as
     repository secrets (Settings › Secrets and variables › Actions), add each one to the
     environment and then **delete the repository secret**. The variables
     (`TAURI_UPDATER_PUBKEY`, `TAURI_UPDATER_ENDPOINT`, `WINDOWS_CERTIFICATE_THUMBPRINT`) aren't
     secret and stay repository variables.
2. **Tag protection.** Settings › Rules › Rulesets › **New ruleset › New tag ruleset**: name
   "Version tags", enforcement **Active**, target tags › **Add target › Include by pattern** `v*`;
   rules **Restrict creations**, **Restrict updates**, **Restrict deletions** and **Block force
   pushes**; under **Bypass list** add **Repository admin** (you), so only you can push, move or
   delete a version tag. The workflow checks as well that the tag's commit is on `main`.

The workflows' actions are pinned to commit SHAs (decision 650). Dependabot
(`.github/dependabot.yml`) opens a weekly pull request when they have updates; check the
release notes of the actions it moves, then merge it like any change.

## Installing an unsigned build

Until signing is set up (below) the installers aren't signed, so the systems warn the first time:

- **macOS:** "statPlotter can't be opened because Apple cannot check it for malicious
  software." Drag the app to Applications, then **right-click (or Control-click) it › Open ›
  Open**. Once is enough. (On macOS 15 and later, if there's no Open button: try to open it once,
  then System Settings › Privacy & Security › "Open Anyway".)
- **Windows:** SmartScreen says "Windows protected your PC". Click **More info › Run anyway**.
  The `.msi` installs for every user (an administrator's password); the `.exe` for you only.

## Updates

The app checks the latest release at start, at most once a day (Preferences › Updates: "Check for
updates automatically", on by default, and "Check now"), and offers "Version X is available" with
the release notes: **Update now** (downloads, installs, restarts), **Later**, or **Skip this
version** (not offered again by itself; "Check now" still offers it). The web app has none of this.

Updates are signed with a key of their own (not a code-signing certificate): the app only installs
an update signed by the private key matching the public key it was built with. **Until the key is
set up, releases still build and the app says "Updates aren't set up for this build"** in
Preferences.

### Setting up the update key (once)

1. On your own computer, make the key pair (the private key never leaves your machine and
   GitHub's secrets; never commit it):

   ```sh
   pnpm tauri signer generate -w ~/.tauri/plotting-software.key
   ```

   It asks for a password (use one, and keep it in your password manager) and writes
   `~/.tauri/plotting-software.key` (private) and `~/.tauri/plotting-software.key.pub` (public).
   Keep a backup of the private key: **if it is lost, installed apps can't take updates any more**
   (users then have to install the next version by hand).
2. In GitHub:
   - the `release` environment's secrets (Settings › Environments › `release` › **Add
     environment secret**; see "The release environment" above):
     - `TAURI_SIGNING_PRIVATE_KEY`: the whole contents of `~/.tauri/plotting-software.key`;
     - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: its password.
   - the repository › Settings › Secrets and variables › Actions › **Variables** › New repository
     variable:
     - `TAURI_UPDATER_PUBKEY`: the whole contents of `~/.tauri/plotting-software.key.pub` (a
       secret of that name works too).
3. The next tag's release has updates. The version that first carries the key can't update
   itself to that version: install it by hand once; from then on it updates itself.

**A private repository:** the updater downloads `latest.json` and the update from
`https://github.com/<owner>/<repo>/releases/latest/download/latest.json` without signing in, which
works only for a **public** repository. For a private one, either make the releases public
elsewhere and set the variable `TAURI_UPDATER_ENDPOINT` to that `latest.json`'s URL (the files it
names must be reachable without signing in too), or keep updating by hand. The installers on a
private repository's releases are downloadable only by people with access to it.

How it fits together: `tools/release-config.mjs` writes `apps/desktop/src-tauri/release.conf.json`
in the workflow, merged over `tauri.conf.json` by `tauri build --config`: `plugins.updater` (the
public key, the endpoint) and `bundle.createUpdaterArtifacts` only when both keys are set. The
desktop shell starts the updater plugin only when the configuration has a public key
(`updates_supported`).

## Signing (later)

The workflow signs only with the secrets that exist, so adding them is all it takes. Nothing else
changes. Every secret below is an **environment secret of `release`** (see "The release
environment" above), never a repository secret. They reach only the build step that uses them
(the tauri-action step, or the step importing the Windows certificate), through that step's own
environment; `apps/desktop/tauri-release.mjs` leaves out the ones not set up, which Tauri would
otherwise try to use empty.

### macOS: Developer ID and notarization

Needs a paid Apple Developer account.

1. In Xcode or developer.apple.com make a **Developer ID Application** certificate; export it
   from Keychain Access as a `.p12` with a password; `base64 -i cert.p12 | pbcopy`.
2. Secrets:
   - `APPLE_CERTIFICATE`: the base64 text;
   - `APPLE_CERTIFICATE_PASSWORD`: the `.p12`'s password;
   - `APPLE_SIGNING_IDENTITY`: e.g. `Developer ID Application: Your Name (TEAMID)`.
3. Notarization (so Gatekeeper opens the app without the right-click), secrets:
   - `APPLE_ID`: your Apple ID's email;
   - `APPLE_PASSWORD`: an app-specific password from appleid.apple.com;
   - `APPLE_TEAM_ID`: your team id.

### Windows: code signing

1. Buy a code-signing certificate (an OV certificate as a `.pfx`; EV certificates live on
   hardware tokens or cloud HSMs and need a `bundle.windows.signCommand` instead, not set up
   here). `base64 -i cert.pfx | pbcopy`.
2. Secrets `WINDOWS_CERTIFICATE` (the base64 text) and `WINDOWS_CERTIFICATE_PASSWORD`; variable
   `WINDOWS_CERTIFICATE_THUMBPRINT` (the certificate's SHA-1 thumbprint, no spaces). Optionally
   `WINDOWS_TIMESTAMP_URL` in the environment (default `http://timestamp.digicert.com`).

SmartScreen still warns for a new certificate until it has a reputation (an EV certificate has
one at once).

## File associations

Installing the app registers (decision 613):

- `.psproj` projects, `.pspreset` graph presets and `.psstyle` styles: the app is their default.
  A project opens (asking about unsaved changes); presets and styles go into your library.
- `.pzfx`, `.csv`, `.tsv`, `.xlsx`: the app is offered in **Open With** but never made their
  default (macOS: rank "Alternate"; Windows: `OpenWithProgids`, the `.exe` installer only). They
  open the import dialogs, as when dropped on the window.

Files opened while the app runs go to the running app (macOS: the system's open event; Windows:
the single-instance plugin hands a second launch's files to the first). **File › Open Recent** is
in the app on both systems; the macOS Dock menu's recent documents and the Windows jump list
aren't (no Tauri v2 API; decision 616).

## Checking a release by hand

**The Content-Security-Policy, before the first release with it** (code audit 2, decision 654):
the policy in `tauri.conf.json` (`app.security.csp`) and the frozen `Object.prototype`
(`app.security.freezePrototype`) were checked only in browsers (the web build's end-to-end tests
under the same policy, in Chromium and WebKit), never in the desktop webviews: WebKit on macOS,
WebView2 on Windows. On each system, build with the inspector on, `pnpm tauri build --debug`
(the built app, with the policy, unlike `pnpm desktop`), open it, then go through: the start
screen; an example; a graph and its Format dialog; an analysis (its results appear: the worker
runs); import a CSV and an `.xlsx`; export a graph as PNG, PDF and SVG, and Copy (macOS: paste
into Preview); a layout page with an image; File › Open Recent after a restart; a `.csv` opened
with the app from the Finder / Explorer (read through `read_opened_file`); Save. Then right-click
› Inspect Element › Console: no "Refused to …" message except one per start about `eval` (a
library probing whether it may compile code, which then does without). A blocked load names its
directive; fix the policy in `tauri.conf.json` and `apps/web/public/_headers` together.

After installing from the first release on each system:

1. The app opens (after the unsigned-build step above); Help › About says the version.
2. Double-click a `.psproj` in the Finder / Explorer with the app closed: it opens that project
   (not the last one). With the app open and unsaved changes: it asks first.
3. Right-click a `.csv` › Open With › statPlotter: the import dialog. Same for `.xlsx` and
   a `.pzfx` (the Prism dialog). The `.csv`'s default app is unchanged.
4. Double-click a `.psstyle` / `.pspreset`: "added to your styles / presets".
5. Preferences › Colours › Dark: the window's title bar turns dark too (macOS, Windows 11).
6. Preferences › Updates: "Updates aren't set up for this build" until the key is set up; after,
   install version N, publish N+1, start N: the prompt with N+1's notes; Update now restarts into
   N+1.
7. Open a project, quit, start again: File › Open Recent opens it (read by the shell,
   `read_project_file`, since code audit 2) and Save writes it.
