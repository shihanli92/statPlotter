import { attachDialog } from './dialog/rules.ts'
import { attachExplanations } from './explain/index.ts'
import { ANALYSES } from './index.ts'
import { attachSketches } from './sketch/index.ts'

// Audit 4 (P6): `@ps/analyses/dialog` — what the Analyze dialog and the results read and the
// worker never runs: the explanations (the forms' text, the method cards), the dialog's words,
// tiers and conditions, the live sketches, the guided chooser's trees, the schematics and the
// method history's comparisons. Kept out of the registry the app starts with and the analysis
// worker loads (455 KB of the start-up bundle, 240 KB of the worker); importing this module
// attaches them to the registry's definitions, once, before its importer runs (the package marks
// it as having side effects). Everything reading a definition's `form`, `cards` or `sketch`
// imports from here.

// Roadmap 51a: every analysis' explanations (its form's text, `cards`; `explain/`).
attachExplanations(ANALYSES)
// Roadmap 51b: the Analyze dialog's words, tiers and conditions (`dialog/rules.ts`).
attachDialog(ANALYSES)
// Roadmap 51b: each analysis' live sketch (`sketch/`).
attachSketches(ANALYSES)

export * from './dialog/index.ts'
export {
  CARD_FAMILIES,
  CARDS_OF,
  explainedForm,
  FORM_TEXT,
  fieldText,
  METHOD_CARDS,
  methodCard,
  withNames,
} from './explain/index.ts'
export * from './guide/index.ts'
export { isMethodField, type MethodState, methodChanges } from './methodChanges.ts'
export * from './schematic/index.ts'
export { SKETCH_MAX_ROWS, SKETCHES, sampledRows } from './sketch/index.ts'
export { modelThumbnail, THUMBNAIL_PLOT } from './sketch/thumbnail.ts'
