#!/usr/bin/env node
// The desktop release's extra Tauri configuration (roadmap 41, docs/RELEASING.md), merged over
// apps/desktop/src-tauri/tauri.conf.json by `tauri build --config <file>` in
// .github/workflows/release.yml. What it holds depends on what the repository has set up:
//
//   - the updater (`plugins.updater` with the public key, `bundle.createUpdaterArtifacts`) only
//     when both the public key (variable or secret TAURI_UPDATER_PUBKEY) and the private key
//     (secret TAURI_SIGNING_PRIVATE_KEY) exist: without them the release still builds, and the
//     app says "Updates aren't set up for this build";
//   - Windows code signing only when WINDOWS_CERTIFICATE_THUMBPRINT is set (the certificate
//     imported by the workflow's signing step).
//
// macOS signing and notarization need no configuration: Tauri signs when the APPLE_* variables
// are in the environment, which the workflow sets only when the secrets exist.
//
//   node tools/release-config.mjs <out.json> [--tag v0.2.0]
//
// With --tag, fails unless the tag is `v` + APP_VERSION (packages/model/src/factory.ts).

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(import.meta.url), '..', '..')

/** The update manifest the release workflow attaches to every GitHub Release. */
export const defaultEndpoint = (repository) =>
  `https://github.com/${repository}/releases/latest/download/latest.json`

const present = (v) => typeof v === 'string' && v.trim() !== ''

/**
 * The configuration for these environment variables: TAURI_UPDATER_PUBKEY,
 * TAURI_SIGNING_PRIVATE_KEY (only whether it is set: never read further), TAURI_UPDATER_ENDPOINT
 * (default: the repository's latest GitHub Release), GITHUB_REPOSITORY,
 * WINDOWS_CERTIFICATE_THUMBPRINT.
 */
export function releaseConfig(env) {
  const config = {}
  const notes = []
  if (present(env.TAURI_UPDATER_PUBKEY) && present(env.TAURI_SIGNING_PRIVATE_KEY)) {
    const endpoint = present(env.TAURI_UPDATER_ENDPOINT)
      ? env.TAURI_UPDATER_ENDPOINT.trim()
      : present(env.GITHUB_REPOSITORY)
        ? defaultEndpoint(env.GITHUB_REPOSITORY.trim())
        : null
    if (!endpoint) throw new Error('No update endpoint: set TAURI_UPDATER_ENDPOINT')
    config.bundle = { createUpdaterArtifacts: true }
    config.plugins = {
      updater: {
        pubkey: env.TAURI_UPDATER_PUBKEY.trim(),
        endpoints: [endpoint],
        // Windows: the installer runs with a progress bar and no questions, then the app restarts.
        windows: { installMode: 'passive' },
      },
    }
    notes.push(`updates: on (${endpoint})`)
  } else if (present(env.TAURI_UPDATER_PUBKEY) || present(env.TAURI_SIGNING_PRIVATE_KEY)) {
    notes.push('updates: off (the public key and the private key are both needed; only one is set)')
  } else notes.push('updates: off (no update key set up)')
  if (present(env.WINDOWS_CERTIFICATE_THUMBPRINT)) {
    config.bundle = {
      ...config.bundle,
      windows: {
        certificateThumbprint: env.WINDOWS_CERTIFICATE_THUMBPRINT.trim(),
        digestAlgorithm: 'sha256',
        timestampUrl: present(env.WINDOWS_TIMESTAMP_URL)
          ? env.WINDOWS_TIMESTAMP_URL.trim()
          : 'http://timestamp.digicert.com',
      },
    }
    notes.push('Windows signing: on')
  } else notes.push('Windows signing: off (unsigned)')
  return { config, notes }
}

/** APP_VERSION, read from the model's source. */
export function appVersion() {
  const src = readFileSync(join(ROOT, 'packages/model/src/factory.ts'), 'utf8')
  const m = /export const APP_VERSION = '([^']+)'/.exec(src)
  if (!m) throw new Error('APP_VERSION not found')
  return m[1]
}

const main = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (main) {
  const args = process.argv.slice(2)
  const out = args.find((a) => !a.startsWith('--'))
  const tagAt = args.indexOf('--tag')
  if (!out) {
    console.error('usage: node tools/release-config.mjs <out.json> [--tag v<version>]')
    process.exit(2)
  }
  if (tagAt >= 0) {
    const tag = args[tagAt + 1] ?? ''
    const want = `v${appVersion()}`
    if (tag !== want) {
      console.error(`The tag ${tag} doesn't match the app's version (${want}).`)
      process.exit(1)
    }
  }
  const { config, notes } = releaseConfig(process.env)
  writeFileSync(out, `${JSON.stringify(config, null, 2)}\n`)
  for (const n of notes) console.log(n)
}
