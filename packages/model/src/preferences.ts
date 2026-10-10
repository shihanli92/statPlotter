import { z } from 'zod'
import { createProject } from './factory.ts'
import { DEFAULT_STYLE_ID, isEmptyStyle, PValueStyle, StyleChoice } from './figureStyle.ts'
import type { Project } from './project.ts'

// The user's preferences (roadmap 37, decision 538): app-wide, kept per user (web: IndexedDB;
// desktop: a settings file in the app data folder). The style, P values and confidence level are
// what NEW projects start with — a project's own settings win once it exists; units, the page
// size of new layouts and the Export dialog's first format and resolution apply to the app.

/** Units sizes are shown in (graph and page sizes). */
export const SizeUnit = z.enum(['pt', 'mm', 'in'])
export type SizeUnit = z.infer<typeof SizeUnit>

export const AppPreferences = z.object({
  /** New projects' style. Absent: the app's own look. */
  style: StyleChoice.optional(),
  pValueStyle: PValueStyle.optional(),
  pValueDigits: z.number().int().min(1).max(15).optional(),
  confidenceLevel: z.number().gt(0).lt(1).optional(),
  /** Sizes in the Format and page panels. Absent: inches (as before). */
  units: SizeUnit.optional(),
  /** New layout pages. Absent: Letter. */
  pageSize: z.enum(['letter', 'a4']).optional(),
  /** The Export dialog's format and resolution until another is chosen there. */
  exportFormat: z.enum(['pdf', 'svg', 'png', 'tiff', 'jpeg']).optional(),
  exportDpi: z.number().int().min(72).max(2400).optional(),
  /**
   * Roadmap 39: missing-value codes the import dialog starts with ("-999", "ND", "not done"),
   * besides NA, N/A, NaN… which are always empty. Absent: none.
   */
  missingCodes: z.array(z.string().min(1).max(40)).max(50).optional(),
  /**
   * Roadmap 41: the app's colours (menus, panels, tables, dialogs). Absent: the system's
   * (light or dark). Graphs, pages and their previews stay on white paper either way.
   */
  colorScheme: z.enum(['light', 'dark']).optional(),
  /** Roadmap 41 (desktop app): check for updates at start, at most once a day. Absent: on. */
  checkUpdates: z.boolean().optional(),
  /** The version the user chose to skip ("Skip this version"); not offered again by itself. */
  skippedVersion: z.string().min(1).max(40).optional(),
  /** When updates were last checked for (ms since 1970). */
  lastUpdateCheck: z.number().int().nonnegative().optional(),
})
export type AppPreferences = z.infer<typeof AppPreferences>

/** Preferences read from storage: what is valid kept, the rest dropped (never throws). */
export function parsePreferences(raw: unknown): AppPreferences {
  if (typeof raw !== 'object' || raw === null) return {}
  const out: Record<string, unknown> = {}
  for (const [k, field] of Object.entries(AppPreferences.shape)) {
    const v = (raw as Record<string, unknown>)[k]
    if (v === undefined) continue
    const ok = field.safeParse(v)
    if (ok.success && ok.data !== undefined) out[k] = ok.data
  }
  return out as AppPreferences
}

/**
 * A new project with the user's preferences: its style (the style's P values too), then the
 * P-value style, digits and confidence level chosen in Preferences.
 */
export function createProjectWith(prefs: AppPreferences, title?: string, now?: Date): Project {
  const project = createProject(title, now)
  const s = project.settings
  const style = prefs.style
  if (style && !(style.id === DEFAULT_STYLE_ID && isEmptyStyle(style.style))) {
    s.theme = style.id
    s.style = style.style
  }
  if (style?.style.pValue?.style) s.pValueStyle = style.style.pValue.style
  if (style?.style.pValue?.digits) s.pValueDigits = style.style.pValue.digits
  if (prefs.pValueStyle) s.pValueStyle = prefs.pValueStyle
  if (prefs.pValueDigits) s.pValueDigits = prefs.pValueDigits
  if (prefs.confidenceLevel) s.defaultConfidenceLevel = prefs.confidenceLevel
  return project
}
