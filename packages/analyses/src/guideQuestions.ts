import type { GuideEntry, TableKind } from '@ps/model'

// Audit 4 (P6): every question of the guided chooser — its id, words and table kinds, in rail
// order — without its tree: what the navigator's results card asks while a table has no results,
// in the bundle the app starts with (the trees load with the Analyze dialog). The guide's own
// entries (`GUIDE_ENTRIES`, `guide/`) are checked against it (`guide.test.ts`).

export type GuideQuestionLine = Pick<GuideEntry, 'id' | 'question' | 'kinds'>

export const GUIDE_QUESTIONS: readonly GuideQuestionLine[] = [
  { id: 'groupsDiffer', question: 'Are the groups different?', kinds: ['column'] },
  { id: 'vsControl', question: 'Is each group different from a control?', kinds: ['column'] },
  { id: 'trend', question: 'Is there a trend across ordered groups?', kinds: ['column'] },
  { id: 'setValue', question: 'Is the average different from a set value?', kinds: ['column'] },
  { id: 'describe', question: 'Describe each group', kinds: ['column'] },
  { id: 'normalOdd', question: 'Is it normal, and are there odd values?', kinds: ['column'] },
  { id: 'goTogether', question: 'Do two columns go up and down together?', kinds: ['column'] },
  { id: 'methodsAgree', question: 'Do two methods agree?', kinds: ['column'] },
  { id: 'roc', question: 'Can this measurement tell patients from controls?', kinds: ['column'] },
  { id: 'distributions', question: 'Do the whole distributions differ?', kinds: ['column'] },
  { id: 'plan', question: 'Plan an experiment: how many subjects?', kinds: ['column'] },
  {
    id: 'twoFactors',
    question: 'How do two factors affect the response (and do they interact)?',
    kinds: ['grouped'],
  },
  { id: 'timeCourse', question: 'A time course in the same subjects', kinds: ['grouped'] },
  { id: 'rowsTwo', question: 'Compare two groups at each row (many genes)', kinds: ['grouped'] },
  { id: 'rowsMany', question: 'Compare three or more groups at each row', kinds: ['grouped'] },
  { id: 'threeFactors', question: 'Three factors (2 × 2 × k)', kinds: ['grouped'] },
  { id: 'describeRows', question: 'Describe each row', kinds: ['grouped'] },
  { id: 'doseResponse', question: 'Fit a dose-response curve (EC50 / IC50)', kinds: ['xy'] },
  { id: 'standardCurve', question: 'Read unknowns off a standard curve', kinds: ['xy'] },
  { id: 'otherCurve', question: 'Fit another curve (binding, kinetics, decay)', kinds: ['xy'] },
  { id: 'straightLine', question: 'Is there a straight-line relation?', kinds: ['xy'] },
  { id: 'compareCurves', question: 'Compare slopes or curves', kinds: ['xy'] },
  { id: 'xyTogether', question: 'Do X and Y go up together?', kinds: ['xy'] },
  { id: 'yesNo', question: 'A yes/no outcome against X', kinds: ['xy'] },
  { id: 'auc', question: 'Area under the curve', kinds: ['xy'] },
  { id: 'smooth', question: 'Smooth the points', kinds: ['xy'] },
  { id: 'outcomeGroup', question: 'Is the outcome related to the group?', kinds: ['contingency'] },
  {
    id: 'trendCounts',
    question: 'Is there a trend across ordered groups (counts)?',
    kinds: ['contingency'],
  },
  { id: 'diagnosticTest', question: 'How good is a diagnostic test?', kinds: ['contingency'] },
  { id: 'curvesDiffer', question: 'Do the survival curves differ?', kinds: ['survival'] },
  { id: 'medianSurvival', question: 'Median survival in each group', kinds: ['survival'] },
  {
    id: 'expectedProportions',
    question: 'Do the counts match expected proportions?',
    kinds: ['partsOfWhole'],
  },
  { id: 'fractions', question: 'What fraction is each part?', kinds: ['partsOfWhole'] },
  {
    id: 'predictOutcome',
    question: 'Predict an outcome from several variables',
    kinds: ['multipleVariables'],
  },
  {
    id: 'factorsAffect',
    question: 'Which factors affect the response?',
    kinds: ['multipleVariables'],
  },
  { id: 'pca', question: 'Summarize many variables (PCA)', kinds: ['multipleVariables'] },
  { id: 'coxCovariates', question: 'Time to event with covariates', kinds: ['multipleVariables'] },
  {
    id: 'kmFromRows',
    question: 'Kaplan-Meier from one row per subject',
    kinds: ['multipleVariables'],
  },
  { id: 'curvePerGroup', question: 'Fit a curve per group', kinds: ['multipleVariables'] },
  {
    id: 'nestedGroups',
    question: 'Are the groups different (several measurements per subject)?',
    kinds: ['nested'],
  },
]

/** The rail's first three questions, for the empty results card. */
export const topQuestions = (kind: TableKind, n = 3): GuideQuestionLine[] =>
  GUIDE_QUESTIONS.filter((e) => e.kinds.includes(kind)).slice(0, n)
