import { Component, type ComponentType, lazy, type ReactNode, Suspense } from 'react'
import { pageLeaving } from '../pageLeaving.ts'

// Audit 2 (P8): code most sessions never run (the import, style, reuse and organise dialogs, the
// help sheets, recovery) is loaded when first shown, from a chunk of its own (a module script
// of the app's origin: the CSP's script-src 'self' allows it). The shell fetches every such chunk
// once the page is idle, so a dialog's first open is as quick as before.

const loaders = new Set<() => Promise<unknown>>()

/** A chunk that couldn't be loaded (the network, a newer deployment): nothing shows, said once. */
class LoadFailed extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override componentDidCatch(e: unknown) {
    console.error('Part of the app could not be loaded:', e)
  }
  override render() {
    return this.state.failed ? null : this.props.children
  }
}

/**
 * A component whose code is loaded when it first renders (`load` imports its module and picks
 * it). Nothing shows while it loads; `preload` fetches it ahead.
 */
export function lazyComponent<P extends object>(
  load: () => Promise<ComponentType<P>>,
): ComponentType<P> & { preload: () => Promise<unknown> } {
  let loading: Promise<{ default: ComponentType<P> }> | null = null
  const preload = () => {
    loading ??= load().then((c) => ({ default: c }))
    return loading
  }
  loaders.add(preload)
  const Lazy = lazy(preload)
  const Loaded = (props: P) => (
    <LoadFailed>
      <Suspense fallback={null}>
        <Lazy {...props} />
      </Suspense>
    </LoadFailed>
  )
  return Object.assign(Loaded, { preload })
}

/**
 * Fetches every lazy component's code now; not while the page is being left (WebKit reports a
 * load started then as a page error, decision 786: each loads when first shown instead).
 */
export function preloadAll(): Promise<unknown> {
  if (pageLeaving()) return Promise.resolve()
  return Promise.allSettled([...loaders].map((l) => l()))
}

/** Runs `fn` once the page is idle (or after a second, where there are no idle callbacks). */
export function whenIdle(fn: () => void, timeout = 4000): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(fn, { timeout })
    return () => cancelIdleCallback(id)
  }
  const id = setTimeout(fn, 1000)
  return () => clearTimeout(id)
}
