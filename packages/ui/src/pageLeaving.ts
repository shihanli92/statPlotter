// Whether the page is being left (decision 786): from `beforeunload` (a link followed, a reload,
// another URL) or `pagehide` until the page shows again or the user acts on it (a leave that was
// cancelled). WebKit refuses a worker or fetch started then, and reports it as an uncaught error
// ("Cannot load … due to access control checks"), so nothing optional is started while leaving.

let leaving = false

if (typeof addEventListener === 'function') {
  const leave = () => {
    leaving = true
  }
  const stay = () => {
    leaving = false
  }
  addEventListener('beforeunload', leave)
  addEventListener('pagehide', leave)
  addEventListener('pageshow', stay)
  for (const event of ['pointerdown', 'keydown'])
    addEventListener(event, stay, { capture: true, passive: true })
}

/** Whether the page is being left now. */
export const pageLeaving = (): boolean => leaving
