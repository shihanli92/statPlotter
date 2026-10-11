// Where a pop-up (a colour popover, a format-bar menu, a tooltip, the format bar's More panel) is
// portalled (decision 1212). A modal dialog (`showModal()`, every dialog of the app) sits in the
// top layer and makes everything outside it inert: a pop-up portalled to the body while its
// button is in a modal dialog is drawn under the dialog and never gets a press. So a pop-up goes
// into the open dialog its anchor is in, as the dialog's own child (outside its scrolling body),
// else into the body. Positions stay viewport coordinates (`position: fixed`): no dialog may be a
// containing block for fixed descendants (no transform, translate, filter, contain or container
// query on a dialog itself; `ui/test/portalHost.test.tsx` checks the style sheet).

/** The element a pop-up hung from `anchor` is portalled into: its open dialog, else the body. */
export function portalHost(anchor: Element | null | undefined): HTMLElement {
  return anchor?.closest<HTMLElement>('dialog[open]') ?? document.body
}
