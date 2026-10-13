// Roadmap 51b: the Analyze dialog's analysis-side contract (docs/design/ANALYSIS_GUIDE.md §4–§5).
export {
  analysisChecks,
  countCheck,
  setsWord,
  sizeNotes,
} from './check.ts'
export { comparingText } from './comparing.ts'
export {
  type FieldState,
  fieldStates,
  formProblems,
  holds,
  showIfList,
  unavailableReason,
} from './conditions.ts'
export { analysisFacts, missingInMatched } from './facts.ts'
export {
  accepts,
  applyRoles,
  assignRoles,
  ROLES,
  type RoleAssignment,
  type RoleVariable,
  roleProblem,
  rolesOf,
  startingRoles,
} from './roles.ts'
export {
  attachDialog,
  DIALOG_PATCHES,
  dialogForm,
  type FieldPatch,
  INVALID_COMBINATIONS,
  NEEDS_RAW,
} from './rules.ts'
export { carryOver, sharedPaths, sharedValues } from './shared.ts'
export { withValidate } from './validate.ts'
