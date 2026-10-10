import type { MenuModel, MenuNode } from './registry.ts'

// The command palette's search: every registered command (except `hideInPalette` ones) plus
// entries the shell adds on opening (analyses, sheets). A query's words must each match the
// label, a keyword or the menu path; labels rank above keywords and paths, word starts above
// substrings, substrings above scattered letters. Enabled entries come first.

export interface PaletteEntry {
  id: string
  label: string
  /** What kind of entry it is, shown at the right ('File › Open recent', 'Analysis', 'Sheet'). */
  section: string
  keywords?: readonly string[]
  /** Formatted shortcut hint. */
  shortcut?: string
  enabled: boolean
  hint?: string
}

/** Each menu command's path in the menu bar ('File', 'File › Open recent'), by command id. */
export function menuPaths(menus: readonly MenuModel[]): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (nodes: readonly MenuNode[], path: string) => {
    for (const n of nodes) {
      if (n.kind === 'command') out.set(n.command.id, path)
      else if (n.kind === 'submenu') walk(n.items, `${path} › ${n.title}`)
    }
  }
  for (const m of menus) walk(m.items, m.title)
  return out
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** How well one query word matches a text: 0 = not at all. */
function wordScore(text: string, word: string): number {
  const t = fold(text)
  const i = t.indexOf(word)
  if (i === 0) return 4
  if (i > 0) return /[\s\-–(/›.,]/.test(t[i - 1]!) ? 3 : 2
  // Scattered letters in order ("nlr" → "NonLinear Regression"): only in labels, only for 2+.
  if (word.length < 2) return 0
  let k = 0
  for (const ch of t) if (ch === word[k]) k++
  return k === word.length ? 1 : 0
}

/** The query's score for an entry (higher is better); 0 when some word doesn't match. */
export function paletteScore(e: PaletteEntry, query: string): number {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return 1
  let total = 0
  for (const w of words) {
    const label = wordScore(e.label, w)
    // Keywords and the path only count as substrings (scattered letters there match too much).
    const other = Math.max(
      0,
      ...(e.keywords ?? []).map((k) => wordScore(k, w)).filter((s) => s > 1),
      ...[e.section].map((s) => wordScore(s, w)).filter((s) => s > 1),
    )
    const s = label > 1 ? label * 2 : Math.max(label, other)
    if (!s) return 0
    total += s
  }
  // A whole-label prefix match of the full query wins outright.
  if (fold(e.label).startsWith(fold(query).trim())) total += 10
  return total
}

/**
 * The entries matching `query`, best first: enabled before disabled, then by score, then in the
 * order given. An empty query keeps the order given (enabled first).
 */
export function rankPalette<T extends PaletteEntry>(entries: readonly T[], query: string): T[] {
  return entries
    .map((e, i) => ({ e, i, s: paletteScore(e, query) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => Number(b.e.enabled) - Number(a.e.enabled) || b.s - a.s || a.i - b.i)
    .map((r) => r.e)
}
