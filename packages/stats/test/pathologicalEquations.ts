/**
 * Audit 4 (T1): user equations a few characters long that hung or crashed the app (selector
 * ranges expanded to lists, unbounded nesting overflowing the stack), and long or many-lined
 * ones. Every parser, analysis and graph that reads a user equation must answer each of them
 * with an error (or a result) quickly, never a hang or an exception. Shared with the analyses'
 * degenerate tests and the graph's function curves.
 */
export const PATHOLOGICAL_EQUATIONS: readonly { label: string; text: string }[] = [
  { label: 'selector to ZZZZ', text: '<A:ZZZZ> Y = X' },
  { label: 'selector to ZZZZZZ', text: '<A:ZZZZZZ> Y = X' },
  { label: 'selector to ZZZZZZZZ every 1', text: '<A:ZZZZZZZZ,1> Y = X' },
  {
    label: 'many selector lines',
    text: Array.from({ length: 2000 }, () => '<A:ZZ,1> Y = X').join('\n'),
  },
  { label: 'selector step too big', text: `<A:ZZ,${'9'.repeat(400)}> Y = X` },
  { label: '1,000 nested parentheses', text: `Y = ${'('.repeat(1000)}X${')'.repeat(1000)}` },
  { label: '3,000 nested parentheses', text: `Y = ${'('.repeat(3000)}X${')'.repeat(3000)}` },
  { label: '20,000 unbalanced parentheses', text: `Y = ${'('.repeat(20000)}X` },
  { label: '20,000 unary minus', text: `Y = ${'-'.repeat(20000)}X` },
  { label: '15,000 unary minus', text: `Y = ${'-'.repeat(15000)}X` },
  { label: '6,000 powers', text: `Y = X${'^X'.repeat(6000)}` },
  { label: '15,000 unbalanced parentheses', text: `Y = ${'['.repeat(15000)}X` },
  { label: '20,000 powers', text: `Y = X${'^X'.repeat(20000)}` },
  { label: '1,000 nested exp(', text: `Y = ${'exp('.repeat(1000)}X${')'.repeat(1000)}` },
  { label: '1,000 NOT', text: `Y = ${'NOT '.repeat(1000)}X` },
  { label: '1,000,000 characters', text: `Y = X ;${'x'.repeat(1_000_000)}` },
  {
    label: 'X[0] from X through a long chain of intermediates',
    text: `Y' = -K*Y\nV0 = X\n${Array.from({ length: 1000 }, (_, i) => `V${i + 1} = V${i} + 1`).join('\n')}\nX[0] = V1000`,
  },
]
