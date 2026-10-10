// @vitest-environment happy-dom
import { createProject, type Project } from '@ps/model'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { ExamplesDialog, nextCard, START_HERE } from '../src/examples/ExamplesDialog.tsx'
import { EXAMPLES, type ExampleContext } from '../src/examples/registry.ts'
import { loadThumbnails } from '../src/examples/thumbnails.ts'

// Roadmap 47: Open an example… is a grid of cards — a thumbnail drawn ahead of time, the title,
// a line saying what it shows and a badge; "Getting started" first and marked "Start here"; the
// sections kept; arrow keys across the grid, Enter (a click) opens.

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // happy-dom has no <dialog> methods.
  const proto = HTMLDialogElement.prototype as { showModal?: () => void; close?: () => void }
  proto.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  proto.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})

let root: Root | null = null
let host: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
  host = null
})

/** The deployed context: no local source_data folder. */
const context: ExampleContext = {
  fonts: {} as ExampleContext['fonts'],
  sourceFile: async () => null,
}
const cards = () => [...document.querySelectorAll<HTMLButtonElement>('.example-card')]
const settle = () => act(() => new Promise((r) => setTimeout(r, 20)))

async function show(opened: Project[] = []) {
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  act(() =>
    root!.render(
      <ExamplesDialog
        context={context}
        onOpen={(p) => opened.push(p)}
        onClose={() => {}}
        thumbnails={async () => ({ [START_HERE]: 'data:image/svg+xml,a', grouped: 'data:,b' })}
      />,
    ),
  )
  await settle()
}

describe('the examples’ cards', () => {
  it('show a thumbnail, title, summary and badge; Getting started first, marked Start here', async () => {
    await show()
    const all = cards()
    // Deployed: the examples part of the app only, in their sections.
    const shown = EXAMPLES.filter((e) => !e.available)
    expect(all.map((c) => c.dataset.example)).toEqual(shown.map((e) => e.id))
    expect(
      [...document.querySelectorAll('.examples-section h3')].map((h) => h.textContent),
    ).toEqual(['Examples', 'Published data'])
    const first = all[0]!
    expect(first.dataset.example).toBe(START_HERE)
    expect(first.classList.contains('start')).toBe(true)
    expect(first.querySelector('.example-start')?.textContent).toBe('Start here')
    expect(first.querySelector('img')?.getAttribute('src')).toBe('data:image/svg+xml,a')
    expect(first.querySelector('.example-title')?.textContent).toBe('Getting started: column data')
    expect(first.querySelector('.example-badge')?.textContent).toBe('Column')
    // Named by its title, described by its line and badge.
    const label = document.getElementById(first.getAttribute('aria-labelledby')!)
    expect(label?.textContent).toBe('Getting started: column data')
    const described = first
      .getAttribute('aria-describedby')!
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent)
    expect(described).toEqual(['Start here', EXAMPLES[0]!.summary, 'Column'])
    // No thumbnail yet: a placeholder, no image.
    const clinical = all.find((c) => c.dataset.example === 'clinical')!
    expect(clinical.querySelector('img')).toBeNull()
    expect(clinical.querySelector('.example-thumb.none')).not.toBeNull()
    // Audit 3 (A9): every card in the tab order (the arrow keys move between them too).
    expect(all.every((c) => c.tabIndex === 0)).toBe(true)
  })

  it('moves across the grid with the arrow keys', () => {
    // Two rows of three, then one.
    const at = [0, 1, 2, 0, 1, 2, 0].map((col, i) => ({
      x: col * 100 + 50,
      y: Math.floor(i / 3) * 200,
    }))
    expect(nextCard(at, 0, 'ArrowRight')).toBe(1)
    expect(nextCard(at, 2, 'ArrowRight')).toBe(3)
    expect(nextCard(at, 0, 'ArrowLeft')).toBeNull()
    expect(nextCard(at, 1, 'ArrowDown')).toBe(4)
    // To the nearest of a shorter row.
    expect(nextCard(at, 5, 'ArrowDown')).toBe(6)
    expect(nextCard(at, 6, 'ArrowUp')).toBe(3)
    expect(nextCard(at, 1, 'ArrowUp')).toBeNull()
    expect(nextCard(at, 4, 'Home')).toBe(0)
    expect(nextCard(at, 0, 'End')).toBe(6)
    expect(nextCard(at, 0, 'a')).toBeNull()
  })

  it('opens an example on a click (Enter on a focused card)', async () => {
    // Its build stood in for (the fonts load from files, which happy-dom can't).
    const example = EXAMPLES.find((e) => e.id === 'parts-of-whole')!
    const build = example.build
    const project = createProject()
    example.build = async () => project
    try {
      const opened: Project[] = []
      await show(opened)
      const card = cards().find((c) => c.dataset.example === 'parts-of-whole')!
      act(() => card.focus())
      act(() => card.click())
      await settle()
      expect(opened).toEqual([project])
      expect(card.tabIndex).toBe(0)
    } finally {
      example.build = build
    }
  })
})

describe('the thumbnails', () => {
  it('load once, as image URLs of every example part of the app', async () => {
    const t = await loadThumbnails()
    expect(await loadThumbnails()).toBe(t)
    for (const e of EXAMPLES.filter((x) => !x.available))
      expect(t[e.id], e.id).toMatch(/^data:image\/svg\+xml;charset=utf-8,%3Csvg/)
  })
})
