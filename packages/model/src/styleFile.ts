import { z } from 'zod'
import { APP_VERSION } from './factory.ts'
import { FigureStyle, type StyleChoice, userStyleId } from './figureStyle.ts'
import { uniqueLibraryName } from './presetFile.ts'

// --- Style files and the user's library ------------------------------------------------------

export const STYLE_FORMAT = 'plotting-software-style'
/** Version of the style file; newer files are refused. */
export const STYLE_VERSION = 1
export const STYLE_EXTENSION = 'psstyle'
/** Longest style name. */
export const STYLE_NAME_MAX = 80

/** A style in the user's library (desktop: `styles/` in the app data folder; web: IndexedDB). */
export interface UserStyle {
  name: string
  /** ISO date and time it was saved. */
  created: string
  appVersion: string
  style: FigureStyle
  /** Place in the list (the library's own; not exported). */
  order?: number
}

const StyleFile = z.object({
  format: z.literal(STYLE_FORMAT),
  version: z.number().int().min(1),
  name: z.string().trim().min(1).max(STYLE_NAME_MAX),
  created: z.string(),
  appVersion: z.string(),
  style: FigureStyle,
  order: z.number().int().optional(),
})

export class StyleFileError extends Error {}

const FORBIDDEN = /[\\/:*?"<>|]/

/** Why a name can't be a new style's (null: it can); `taken` are the names in use. */
export function styleNameProblem(name: string, taken: readonly string[] = []): string | null {
  const n = name.trim()
  if (!n) return 'Give the style a name.'
  if (n.length > STYLE_NAME_MAX) return `A name has at most ${STYLE_NAME_MAX} characters.`
  if (FORBIDDEN.test(n) || n.startsWith('.'))
    return 'A name can’t contain / \\ : * ? " < > | or start with a dot.'
  const lower = n.toLowerCase()
  if (taken.some((t) => t.trim().toLowerCase() === lower))
    return `There is already a style called “${n}”.`
  return null
}

/**
 * A name like `name` that isn't taken ("Lab style (2)"). A name that can't be a style's (one from
 * a shared file) is made one first.
 */
export const uniqueStyleName = (name: string, taken: readonly string[]): string =>
  uniqueLibraryName(name, taken, 'Style', STYLE_NAME_MAX, styleNameProblem)

/** A new user style. */
export function newUserStyle(name: string, style: FigureStyle): UserStyle {
  return {
    name: name.trim(),
    created: new Date().toISOString(),
    appVersion: APP_VERSION,
    style: { ...style, name: name.trim() },
  }
}

/** The style file's text (JSON). `exported`: a file to share, without the library's order. */
export function writeStyle(s: UserStyle, opts: { exported?: boolean } = {}): string {
  const file: z.input<typeof StyleFile> = {
    format: STYLE_FORMAT,
    version: STYLE_VERSION,
    name: s.name,
    created: s.created,
    appVersion: s.appVersion,
    style: s.style,
    ...(!opts.exported && s.order !== undefined ? { order: s.order } : {}),
  }
  return `${JSON.stringify(file, null, 1)}\n`
}

/** A style file read back and checked. Throws StyleFileError with a message for the user. */
export function readStyle(text: string): UserStyle {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new StyleFileError('Not a style file (it is not valid JSON).')
  }
  if ((raw as { format?: unknown } | null)?.format !== STYLE_FORMAT)
    throw new StyleFileError('Not a style file.')
  const version = (raw as { version?: unknown }).version
  if (typeof version === 'number' && version > STYLE_VERSION)
    throw new StyleFileError('This style was saved by a newer version of the app.')
  const parsed = StyleFile.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new StyleFileError(
      `This style can’t be used: ${issue ? `${issue.path.join('.') || 'file'}: ${issue.message}` : 'invalid file'}.`,
    )
  }
  const { format: _f, version: _v, ...rest } = parsed.data
  return rest
}

/** A user style as a project's or graph's choice (its values copied). */
export const userStyleChoice = (s: UserStyle): StyleChoice => ({
  id: userStyleId(s.name),
  style: { ...s.style, name: s.name },
})
