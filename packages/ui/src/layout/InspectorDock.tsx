import { type ReactNode, useEffect, useState } from 'react'

// Roadmap 46 (UX review P3): under 1100 px of window width a layout page's inspector folds to a
// narrow strip at the right of the page (its heading written down the strip and a button to show
// it), so the page gets the room; shown, it is a drawer over the page's right side, as the Format
// panel is in narrow windows. Wider, it is the inspector as before.

/** The window width the inspector folds under. */
export const NARROW_INSPECTOR = '(max-width: 1099px)'

function useNarrow(): boolean {
  const query = () =>
    typeof window !== 'undefined' && !!window.matchMedia?.(NARROW_INSPECTOR).matches
  const [narrow, setNarrow] = useState(query)
  useEffect(() => {
    const m = window.matchMedia?.(NARROW_INSPECTOR)
    if (!m) return
    const on = () => setNarrow(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return narrow
}

export function InspectorDock({ children }: { children: ReactNode }) {
  const narrow = useNarrow()
  const [open, setOpen] = useState(false)
  if (!narrow) return children
  return (
    <div className={`inspector-dock ${open ? 'open' : 'folded'}`} data-testid="inspector-dock">
      <button
        type="button"
        className="inspector-dock-toggle"
        aria-expanded={open}
        aria-label={open ? 'Hide the inspector' : 'Show the inspector'}
        title={open ? 'Hide the inspector' : 'Show the inspector'}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">{open ? '›' : '‹'}</span>
      </button>
      {children}
    </div>
  )
}
