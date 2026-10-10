import { APP_VERSION } from '@ps/model'
import { useState } from 'react'
import {
  type Command,
  formatShortcut,
  isMacPlatform,
  MENUS,
  useCommandRegistry,
  VIEW_KEY_SECTIONS,
} from '../commands/index.ts'
import { Dialog } from './Dialog.tsx'
import { privacyText } from './privacy.ts'

/** Commands with a shortcut, grouped by the menu they are in ('Other' for the rest). */
export function shortcutSections(
  commands: readonly Command[],
): { title: string; items: Command[] }[] {
  const withKeys = commands.filter((c) => c.shortcut && !c.hideInPalette)
  const sections: { title: string; items: Command[] }[] = MENUS.map((m) => ({
    title: m.title,
    items: withKeys.filter((c) => c.menu?.menu === m.id),
  }))
  sections.push({ title: 'Other', items: withKeys.filter((c) => !c.menu) })
  return sections.filter((s) => s.items.length)
}

/** The keyboard shortcut sheet, generated from the commands on offer now. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const registry = useCommandRegistry()
  const [isMac] = useState(isMacPlatform)
  const sections = shortcutSections(registry.all())
  return (
    <Dialog
      title="Keyboard shortcuts"
      onClose={onClose}
      wide
      footer={
        <button type="button" onClick={onClose}>
          Close
        </button>
      }
    >
      <p className="muted">
        Shortcuts of the view that is open are included; others appear when their view is open. Keys
        of the navigator, the canvas and pages follow the commands.
      </p>
      <div className="shortcut-sheet">
        {sections.map((s) => (
          <section key={s.title}>
            <h3>{s.title}</h3>
            <dl>
              {s.items.map((c) => (
                <div key={c.id} className={c.enabled === false ? 'disabled' : ''}>
                  <dt>{c.label}</dt>
                  <dd>
                    <kbd>{formatShortcut(c.shortcut!, isMac)}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        {/* Keys the views handle themselves (audit 2, U20). */}
        {VIEW_KEY_SECTIONS.map((s) => (
          <section key={s.title}>
            <h3>{s.title}</h3>
            <dl>
              {s.items.map((k) => (
                <div key={k.label}>
                  <dt>{k.label}</dt>
                  <dd>
                    {k.keys.map((text, i) => (
                      <span key={text}>
                        {i > 0 && ' '}
                        <kbd>{formatShortcut(text, isMac)}</kbd>
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  )
}

/** Help › About. */
export function AboutDialog({ desktop, onClose }: { desktop: boolean; onClose: () => void }) {
  return (
    <Dialog
      title="About statPlotter"
      onClose={onClose}
      footer={
        <button type="button" className="primary" onClick={onClose}>
          OK
        </button>
      }
    >
      <p>
        <strong>statPlotter</strong> — version {APP_VERSION}
      </p>
      <p>Analysis and graphing of scientific data: data tables, statistics, graphs and layouts.</p>
      <p>Copyright (C) 2026 Shihan Li.</p>
      <p>
        <strong>Privacy.</strong> {privacyText(desktop)}
      </p>
      <p className="muted">
        Free software under the GNU GPL, version 3 or later. Some numerical routines are translated
        from R and the R packages MASS and nortest (GNU GPL) and survival (GNU LGPL); they are kept
        apart in the statistics package, with their sources cited. The logicle scale follows the
        reference implementation of W. A. Moore and D. R. Parks (Artistic License 2.0). Fonts:
        Liberation Sans, Serif and Mono (SIL Open Font License) and Liberation Sans Narrow (GNU GPL
        v2 with the font exception). Icons: Lucide (ISC License).
      </p>
    </Dialog>
  )
}
