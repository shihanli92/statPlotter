#!/usr/bin/env node
// The release workflow's Tauri command (.github/workflows/release.yml, tauri-action's
// `tauriScript`; code audit 2, decision 652): `tauri` with the signing variables that are set.
//
// The signing secrets reach only the tauri-action step, in its own `env:` (never $GITHUB_ENV, which
// would hand them to every later step), and there an unset secret is an empty variable. Tauri
// takes an empty APPLE_CERTIFICATE or APPLE_ID as one to use and fails, so they are removed here
// first: macOS signing needs the certificate, notarization all three APPLE_ID values as well, the
// update signature the private key (an empty password is a real one).

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const set = (name) => (process.env[name] ?? '').trim() !== ''
const env = { ...process.env }
const drop = (...names) => {
  for (const n of names) delete env[n]
}

const MAC_SIGNING = ['APPLE_CERTIFICATE', 'APPLE_CERTIFICATE_PASSWORD', 'APPLE_SIGNING_IDENTITY']
const MAC_NOTARY = ['APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID']
if (!set('APPLE_CERTIFICATE')) drop(...MAC_SIGNING, ...MAC_NOTARY)
if (!MAC_NOTARY.every(set)) drop(...MAC_NOTARY)
if (!set('TAURI_SIGNING_PRIVATE_KEY'))
  drop('TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD')

console.log(
  `signing: macOS ${set('APPLE_CERTIFICATE') ? 'on' : 'off'}, notarization ${
    env.APPLE_ID ? 'on' : 'off'
  }, updates ${env.TAURI_SIGNING_PRIVATE_KEY ? 'on' : 'off'}`,
)

// The CLI's own script, run by this Node: no shell, the same on macOS and Windows.
const cli = createRequire(import.meta.url).resolve('@tauri-apps/cli/tauri.js')
const run = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { stdio: 'inherit', env })
process.exit(run.status ?? 1)
