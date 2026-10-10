#!/usr/bin/env node
// Enforces the package dependency rules from docs/ARCHITECTURE.md §3:
//   1. A package may only depend on (and import) the internal packages listed below.
//   2. Every internal import must be declared in package.json.
//   3. Headless packages stay platform-free: Node built-ins only in *.node.ts files,
//      React only in @ps/ui.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(import.meta.url), '..', '..')

const ALLOWED = {
  '@ps/stats': [],
  '@ps/model': [],
  '@ps/engine': ['@ps/model'],
  '@ps/analyses': ['@ps/model', '@ps/stats'],
  '@ps/graph': ['@ps/model', '@ps/stats'],
  '@ps/io': ['@ps/model', '@ps/graph'],
  '@ps/ui': ['@ps/model', '@ps/engine', '@ps/analyses', '@ps/graph', '@ps/io'],
}
const REACT_ALLOWED = new Set(['@ps/ui'])
const BUILTINS = new Set(builtinModules)

const errors = []

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (/\.(ts|tsx)$/.test(entry)) yield p
  }
}

const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g

for (const dir of readdirSync(join(ROOT, 'packages'))) {
  const pkgDir = join(ROOT, 'packages', dir)
  // Skip stray folders (e.g. a tool cache) that aren't packages.
  if (!existsSync(join(pkgDir, 'package.json'))) continue
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
  const allowed = ALLOWED[pkg.name]
  if (!allowed) {
    errors.push(`${pkg.name}: not listed in tools/check-deps.mjs ALLOWED`)
    continue
  }
  const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })

  for (const dep of declared.filter((d) => d.startsWith('@ps/'))) {
    if (!allowed.includes(dep)) errors.push(`${pkg.name}: may not depend on ${dep}`)
  }

  for (const file of walk(join(pkgDir, 'src'))) {
    const rel = relative(ROOT, file)
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2]
      if (spec.startsWith('.')) continue
      const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]

      if (spec.startsWith('node:') || BUILTINS.has(name)) {
        if (!file.endsWith('.node.ts'))
          errors.push(`${rel}: Node built-in '${spec}' outside a *.node.ts file`)
        continue
      }
      if (name.startsWith('@ps/')) {
        if (!allowed.includes(name))
          errors.push(`${rel}: imports ${name}, not allowed for ${pkg.name}`)
        else if (!declared.includes(name))
          errors.push(`${rel}: imports ${name} without declaring it`)
        continue
      }
      if ((name === 'react' || name === 'react-dom') && !REACT_ALLOWED.has(pkg.name)) {
        errors.push(`${rel}: React imported outside @ps/ui`)
        continue
      }
      if (!declared.includes(name)) errors.push(`${rel}: imports '${name}' without declaring it`)
    }
  }
}

if (errors.length) {
  console.error(`Dependency rule violations:\n  ${errors.join('\n  ')}`)
  process.exit(1)
}
console.log('Dependency rules OK')
