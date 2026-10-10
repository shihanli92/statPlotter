import { readFileSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const SOURCE_DATA = fileURLToPath(new URL('../../source_data', import.meta.url))

/**
 * Development only (`apply: 'serve'`): serves the repository's local `source_data/` folder
 * (journal source data, gitignored) at /__source_data/, for the published-data examples. Nothing
 * of it reaches a production build.
 */
function localSourceData(): Plugin {
  return {
    name: 'local-source-data',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__source_data', async (req, res) => {
        const rel = decodeURIComponent((req.url ?? '/').split('?')[0]!).replace(/^\/+/, '')
        const file = fileURLToPath(new URL(rel, pathToFileURL(`${SOURCE_DATA}/`)))
        if (!file.startsWith(SOURCE_DATA + sep)) {
          res.statusCode = 403
          res.end()
          return
        }
        try {
          if (!(await stat(file)).isFile()) throw new Error('not a file')
          res.setHeader('Content-Type', 'application/octet-stream')
          res.end(await readFile(file))
        } catch {
          res.statusCode = 404
          res.end()
        }
      })
    },
  }
}

/**
 * The response headers the deployment sends for every path (public/_headers, Cloudflare Pages'
 * format: a `/*` line, then indented `Name: value` lines). `vite preview`, the end-to-end tests'
 * server, sends them too, so the tests run under the production Content-Security-Policy and a
 * violation fails them (audit 3, T7).
 */
function deployedHeaders(): Record<string, string> {
  const text = readFileSync(new URL('./public/_headers', import.meta.url), 'utf8')
  const headers: Record<string, string> = {}
  let all = false
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || !line.trim()) continue
    if (!/^\s/.test(line)) {
      all = line.trim() === '/*'
      continue
    }
    const i = line.indexOf(':')
    if (all && i > 0) headers[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return headers
}

export default defineConfig({
  plugins: [react(), localSourceData()],
  resolve: {
    // fontkit's Brotli decoder reads only WOFF2 fonts; the bundled ones are TrueType (P9).
    alias: [
      {
        find: /^brotli\/decompress\.js$/,
        replacement: fileURLToPath(new URL('./src/noBrotli.ts', import.meta.url)),
      },
    ],
  },
  // Fixed port: the Tauri shell loads this URL in development.
  server: { port: 5173, strictPort: true },
  preview: { headers: deployedHeaders() },
  clearScreen: false,
})
