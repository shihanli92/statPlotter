import { readFile } from 'node:fs/promises'
import { FontRegistry } from './registry.ts'

const FONT_DIR = new URL('../../assets/fonts/', import.meta.url)

/** Node/headless font loading (tests, CLI export). Import via '@ps/graph/node'. */
export const nodeFontLoader = async (file: string): Promise<Uint8Array> =>
  new Uint8Array(await readFile(new URL(file, FONT_DIR)))

export const loadNodeFonts = () => FontRegistry.load(nodeFontLoader)
