import type { FontId } from '@ps/model'
import * as fontkit from 'fontkit'
import { FONT_VARIANTS, FONTS, type FontVariant } from './manifest.ts'

export type FontBytesLoader = (file: string) => Promise<Uint8Array>

/** Every bundled family. */
export const FONT_IDS = Object.keys(FONTS) as FontId[]

/**
 * Thrown by `FontRegistry.get` for a family that isn't loaded yet (the app starts with Sans and
 * loads the others when first needed, audit 2 P5); its loading has started. Text is never
 * measured with another font instead. It is a thenable that settles when the loading does, so
 * a React render that lays text out suspends until then (the app's root `<Suspense>`); other
 * callers wait with `withFonts` or load the families first (`FontRegistry.ensure`).
 */
export class FontsPending extends Error {
  constructor(
    readonly family: FontId,
    /** Settles (never rejects) when the family's loading ends, loaded or failed. */
    readonly settled: Promise<void>,
  ) {
    super(`The ${FONTS[family].label} font is still loading.`)
    this.name = 'FontsPending'
  }

  // biome-ignore lint/suspicious/noThenProperty: a thenable on purpose, for React's Suspense
  then(onSettled?: () => unknown, onRejected?: (reason: unknown) => unknown): Promise<unknown> {
    return this.settled.then(onSettled, onRejected)
  }
}

/**
 * Runs `fn`, waiting for each font family it needs that is still loading and running it again
 * (`fn` must be safe to repeat): for work outside a React render that lays text out.
 */
export async function withFonts<T>(fn: () => T | Promise<T>): Promise<T> {
  for (;;) {
    try {
      return await fn()
    } catch (e) {
      if (!(e instanceof FontsPending)) throw e
      await e.settled
    }
  }
}

/**
 * Parsed fonts used for all text measurement, one per family and variant. Families are loaded
 * whole (all four variants), when `load` is told to or first needed. Load once per process.
 */
export class FontRegistry {
  private readonly fonts = new Map<string, fontkit.Font>()
  private readonly loaded = new Set<FontId>()
  private readonly loading = new Map<FontId, Promise<void>>()
  private readonly failed = new Map<FontId, Error>()

  private constructor(private readonly loader: FontBytesLoader) {}

  /**
   * A registry with `families` loaded (every bundled family unless told otherwise); the others
   * load when first needed. Rejects if one of `families` can't be loaded.
   */
  static async load(
    loader: FontBytesLoader,
    families: readonly FontId[] = FONT_IDS,
  ): Promise<FontRegistry> {
    const registry = new FontRegistry(loader)
    await registry.ensure(families)
    return registry
  }

  /** Whether the family is loaded (all four variants). */
  has(id: FontId): boolean {
    return this.loaded.has(id)
  }

  /** Loads the families not loaded yet (one that failed is tried again). */
  ensure(ids: Iterable<FontId>): Promise<void> {
    return Promise.all([...new Set(ids)].map((id) => this.family(id))).then(() => {})
  }

  get(id: FontId, variant: FontVariant): fontkit.Font {
    const font = this.fonts.get(key(id, variant))
    if (font) return font
    if (!Object.hasOwn(FONTS, id)) throw new Error(`font not loaded: ${id}/${variant}`)
    const failed = this.failed.get(id)
    if (failed) throw failed
    throw new FontsPending(
      id,
      this.family(id).catch(() => {}),
    )
  }

  private family(id: FontId): Promise<void> {
    if (this.loaded.has(id)) return Promise.resolve()
    const pending = this.loading.get(id)
    if (pending) return pending
    this.failed.delete(id)
    const files = FONTS[id].files
    const loading = Promise.all(
      FONT_VARIANTS.map(async (variant) => {
        const bytes = await this.loader(files[variant])
        const font = fontkit.create(bytes as Buffer)
        if (!('layout' in font)) throw new Error(`${files[variant]} is a collection`)
        return [variant, font] as const
      }),
    ).then(
      (fonts) => {
        for (const [variant, font] of fonts) this.fonts.set(key(id, variant), font)
        this.loaded.add(id)
        this.loading.delete(id)
      },
      (e: unknown) => {
        const error = e instanceof Error ? e : new Error(String(e))
        this.failed.set(id, error)
        this.loading.delete(id)
        throw error
      },
    )
    this.loading.set(id, loading)
    return loading
  }
}

const key = (id: FontId, variant: FontVariant) => `${id}/${variant}`
