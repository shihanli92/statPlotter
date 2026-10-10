import { FONT_IDS, fontsUsedBy, loadBrowserFonts } from '@ps/graph'
import { App, createServices, createWorkerRunner, initialColorScheme, pageLeaving } from '@ps/ui'
import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { platform } from './platform.ts'

// No top-level await in this module (audit 2): it turns off the bundler's merging of shared
// modules into the entry chunk, which lazily loaded chunks (examples) otherwise split it into.

const root = createRoot(document.getElementById('root')!)
// The app's colours from the first paint (roadmap 41): the last choice, or the system's.
initialColorScheme()

/** The app, once the default font family has loaded. */
async function start() {
  // The page going away (a link followed, a reload) cuts the font downloads short: their
  // rejections then mean nothing and stay quiet. A real failure says so on the page.
  try {
    // Sans (preloaded by index.html) now, the other families when first needed (audit 2 P5).
    const fonts = await loadBrowserFonts()
    const services = createServices({ fonts, platform, runner: createWorkerRunner() ?? undefined })
    // The families a document names start loading as soon as it changes (an opened file, an
    // example, a font chosen); a drawing that needs one still loading waits for it (the
    // Suspense below), never laying text out in another font.
    // Not while the page is being left: WebKit refuses a download started then and reports it
    // as a page error (decision 786); a drawing still loads what it needs.
    const prefetch = () => {
      if (!pageLeaving()) void fonts.ensure(fontsUsedBy(services.store.getState())).catch(() => {})
    }
    services.store.subscribe(prefetch)
    prefetch()
    root.render(
      <StrictMode>
        <Suspense fallback={null}>
          <App services={services} />
        </Suspense>
      </StrictMode>,
    )
    // The other families then load in the background once the app is idle, one at a time: a
    // drawing waiting for one hides the app until it is in (Suspense), so they are better in
    // before they are chosen. None is started as the page goes (decision 786), and a failure
    // stops them (a drawing that needs the family tries again).
    const rest = FONT_IDS.filter((id) => !fonts.has(id))
    const next = () => {
      const id = rest.shift()
      if (id && !pageLeaving()) fonts.ensure([id]).then(next, () => {})
    }
    // WebKit has no requestIdleCallback.
    if ('requestIdleCallback' in globalThis) requestIdleCallback(next, { timeout: 2000 })
    else setTimeout(next, 1000)
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    if (!pageLeaving() && !aborted) {
      console.error(e)
      root.render(
        <p className="startup-error" role="alert">
          The graph fonts could not be loaded ({e instanceof Error ? e.message : String(e)}). Reload
          the page to try again.
        </p>,
      )
    }
  }
}

// Diagnostic page from Phase 0 (/?fontcheck), in development only (audit 2: not shipped).
if (import.meta.env.DEV && new URLSearchParams(location.search).has('fontcheck'))
  void import('./FontCheck.tsx').then(({ FontCheck }) =>
    root.render(
      <StrictMode>
        <FontCheck />
      </StrictMode>,
    ),
  )
else void start()
