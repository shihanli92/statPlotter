import type { MethodCard } from '@ps/model'

// Roadmap 51a: cards of correlation, regression, curve fitting and smoothing.

export const pearson: MethodCard = {
  id: 'pearson',
  name: 'Pearson correlation',
  shortName: 'Pearson r',
  question: 'Do two measurements rise and fall together along a straight line?',
  nullHypothesis:
    'There is no linear association (r = 0). P is the chance of an r at least this far from 0 if there were none.',
  useWhen:
    'Two measurements made on the same subjects (each row one subject), neither set by you, with roughly straight-line scatter.',
  instead: [
    { card: 'spearman', when: 'the relation is monotone but curved, or the values are ranks' },
    { card: 'linearRegression', when: 'you set X and want to predict Y from it' },
    { card: 'blandAltman', when: 'the question is whether two methods agree' },
  ],
  assumptions: [
    'The rows are independent subjects.',
    'Both measurements are roughly symmetric; one outlier can dominate r.',
  ],
  reading:
    'Read r (−1 to 1) with its CI, and r² (the share of variation the two share). r describes association, not agreement or cause. With several columns every pair is tested, and the P values are corrected for their number (false discovery rate by default).',
  more: {
    formula: 'r = Σ(x − x̄)(y − ȳ) / √(Σ(x − x̄)² Σ(y − ȳ)²); CI by Fisher’s z.',
    r: 'cor.test(x, y)',
  },
  references: [{ text: 'Pearson K (1896) Phil Trans R Soc A 187:253–318' }],
}

export const spearman: MethodCard = {
  id: 'spearman',
  name: 'Spearman correlation',
  shortName: 'Spearman r',
  question: 'Does one measurement tend to rise (or fall) as the other rises?',
  nullHypothesis:
    'There is no monotone association. P is the chance of a rank correlation at least this far from 0 if there were none.',
  useWhen:
    'Two measurements on the same subjects whose relation is monotone but curved, or that are ranks or scores, or have outliers.',
  instead: [{ card: 'pearson', when: 'the scatter is roughly a straight line' }],
  assumptions: ['The rows are independent subjects.'],
  reading:
    'Read the rank correlation (−1 to 1) with its CI and P. It is Pearson’s r of the ranks, so a steady but curved rise gives a value near 1.',
  more: {
    formula: 'Pearson’s r of the ranks of X and of Y.',
    r: 'cor.test(x, y, method = "spearman")',
  },
  references: [{ text: 'Spearman C (1904) Am J Psychol 15:72–101' }],
}

export const linearRegression: MethodCard = {
  id: 'linearRegression',
  name: 'Simple linear regression',
  shortName: 'Linear regression',
  question: 'What straight line best predicts Y from X, and does its slope differ from zero?',
  nullHypothesis:
    'The slope is 0 (Y doesn’t change with X). P is the chance of a slope at least this steep if it were.',
  useWhen:
    'X is set by you (dose, time, a standard’s concentration) and Y measured, with a straight-line relation; also standard curves for reading unknowns.',
  instead: [
    { card: 'nonlinearFit', when: 'the relation curves (dose-response, saturation, decay)' },
    { card: 'deming', when: 'both X and Y are measured with error' },
    { card: 'pearson', when: 'you only want the strength of association' },
  ],
  assumptions: [
    'The points are independent (or replicates are fitted as means).',
    'Y scatters symmetrically around the line, by the same amount at every X.',
    'X is known without error.',
  ],
  reading:
    'Read the slope and intercept with their CIs, and R². Comparing data sets, the slopes are tested first; intercepts are compared only if the slopes don’t differ. Check the residuals: a curved pattern means a line is the wrong model.',
  more: {
    formula: 'Least squares: slope = Σ(x − x̄)(y − ȳ) / Σ(x − x̄)².',
    r: 'summary(lm(y ~ x))',
    notes: 'Comparing slopes: anova(lm(y ~ x), lm(y ~ x * group)).',
  },
  references: [{ text: 'Zar JH (2010) Biostatistical Analysis, 5th ed.' }],
}

export const deming: MethodCard = {
  id: 'deming',
  name: 'Deming regression',
  shortName: 'Deming',
  question: 'What straight line relates two methods when both are measured with error?',
  nullHypothesis:
    'The P reported tests a slope of 0. P is the chance of a slope at least this steep if it were; agreement is read from the CIs instead.',
  useWhen:
    'Method comparison: the same samples measured by two methods, neither one exact. Ordinary regression would bias the slope towards zero.',
  instead: [
    { card: 'blandAltman', when: 'you want the bias and limits of agreement' },
    { card: 'linearRegression', when: 'X is known exactly' },
  ],
  assumptions: [
    'Errors in X and Y are independent and roughly symmetric.',
    'Their ratio is known (equal, or from the SDs you enter).',
  ],
  reading:
    'Read the slope and intercept with their CIs: a slope CI that includes 1 and an intercept CI that includes 0 show no evidence of a proportional or constant difference.',
  more: {
    formula: 'Minimizes the residuals weighted by the ratio of error variances.',
    r: 'mcr::mcreg(x, y, method.reg = "Deming")',
  },
  references: [{ text: 'Cornbleet PJ, Gochman N (1979) Clin Chem 25:432–438' }],
}

export const simpleLogistic: MethodCard = {
  id: 'simpleLogistic',
  name: 'Simple logistic regression',
  shortName: 'Logistic regression',
  question: 'How does the probability of a yes/no outcome change with X?',
  nullHypothesis:
    'The outcome doesn’t depend on X (the slope is 0). P is the chance of a slope at least this steep if it didn’t.',
  useWhen:
    'Y is 0 or 1 for each subject (responded or not, survived or not), X a measurement or dose.',
  instead: [
    { card: 'logisticRegression', when: 'several predictors' },
    { card: 'roc', when: 'you want how well X separates the two outcomes' },
  ],
  assumptions: ['Subjects are independent.', 'The log odds of the outcome change linearly with X.'],
  reading:
    'Read the odds ratio per unit of X with its CI, and X at 50% (where both outcomes are equally likely). The ROC area says how well X separates the outcomes.',
  more: {
    formula: 'log(p / (1 − p)) = β0 + β1·X, fitted by maximum likelihood.',
    r: 'glm(y ~ x, family = binomial)',
  },
  references: [{ text: 'Hosmer DW, Lemeshow S (2000) Applied Logistic Regression' }],
}

export const nonlinearFit: MethodCard = {
  id: 'nonlinearFit',
  name: 'Nonlinear regression (curve fit)',
  shortName: 'Curve fit',
  question: 'What are the parameters (EC50, Kd, rate constant) of a model fitted to your data?',
  nullHypothesis:
    'A fit itself tests nothing. When comparing, the null is that one model (or one shared parameter) fits as well as the more complex one.',
  useWhen:
    'X set by you (dose, concentration, time) and a model that describes the experiment: dose-response, binding, enzyme kinetics, decay or growth.',
  instead: [
    { card: 'linearRegression', when: 'the relation is a straight line' },
    { card: 'lowess', when: 'you only want a smooth curve, without a model' },
    { card: 'modelComparison', when: 'you compare two models, or a parameter between data sets' },
  ],
  assumptions: [
    'The model is right for the experiment; X is known exactly.',
    'Y scatters symmetrically around the curve (weighting can allow for scatter that grows with Y).',
    'The points are independent (or replicates are fitted as means).',
  ],
  reading:
    'Read each parameter with its CI. A very wide CI means the data don’t determine it (a plateau not reached, an EC50 outside the doses). Comparing data sets, read whether one shared parameter fits as well as separate ones.',
  more: {
    formula: 'Least squares by Levenberg-Marquardt from automatic initial values.',
    r: 'nls(y ~ bottom + (top - bottom) / (1 + 10^((logEC50 - x) * hill)), start = …)',
  },
  references: [{ text: 'Motulsky H, Christopoulos A (2004) Fitting Models to Biological Data' }],
}

export const robustFit: MethodCard = {
  id: 'robustFit',
  name: 'Robust nonlinear regression',
  shortName: 'Robust fit',
  question: 'What curve fits most of the points, little affected by a few outliers?',
  nullHypothesis: null,
  useWhen:
    'A curve fit where a few points may be wild, and you want the best-fit values without letting them pull the curve.',
  instead: [
    { card: 'rout', when: 'you want the outliers identified and removed, with CIs' },
    { card: 'nonlinearFit', when: 'no wild points' },
  ],
  assumptions: ['As for the curve fit, except that a few points may be far off.'],
  reading: 'Read the best-fit values only: robust fits give no CIs or comparisons.',
  more: {
    formula: 'Down-weights large residuals (a robust loss) instead of summing their squares.',
    r: 'robustbase::nlrob(formula, data = d, start = …)',
  },
  references: [
    {
      text: 'Motulsky HJ, Brown RE (2006) BMC Bioinformatics 7:123',
      doi: '10.1186/1471-2105-7-123',
    },
  ],
}

export const rout: MethodCard = {
  id: 'rout',
  name: 'ROUT method (outliers)',
  shortName: 'ROUT',
  question: 'Which values are outliers, controlling how often good values are flagged?',
  nullHypothesis:
    'No value is an outlier. Q is the largest share of flagged values you accept as false discoveries.',
  useWhen:
    'Looking for one or more outliers among measurements, or among the points of a curve fit.',
  instead: [{ card: 'grubbs', when: 'at most one outlier, in roughly normal values' }],
  assumptions: ['The values (or the curve’s residuals) are otherwise roughly symmetric.'],
  reading:
    'Read which values are flagged. Remove a value only with a known cause (a pipetting error, a failed well), and report the analysis with and without it.',
  more: {
    formula: 'A robust fit, then a false discovery rate test on the residuals.',
    r: 'no standard R function; as Motulsky and Brown (2006)',
  },
  references: [
    {
      text: 'Motulsky HJ, Brown RE (2006) BMC Bioinformatics 7:123',
      doi: '10.1186/1471-2105-7-123',
    },
  ],
}

export const modelComparison: MethodCard = {
  id: 'modelComparison',
  name: 'Comparing fits (extra sum-of-squares F test and AICc)',
  shortName: 'Model comparison',
  question: 'Does a more complex model (or separate parameters per data set) fit better enough?',
  nullHypothesis:
    'The simpler model is right. P (F test) is the chance of an improvement at least this large if it were.',
  useWhen:
    'Two models for one curve (standard or variable slope), or whether a parameter (an EC50) differs between data sets. Decide which comparison before looking at the fits.',
  instead: [{ card: 'nonlinearFit', when: 'you only want the parameters' }],
  assumptions: ['The F test needs nested models (one a special case of the other); AICc doesn’t.'],
  reading:
    'Read the preferred model and its evidence: the F test’s P, or the AICc difference and the probability that each model is right, by the method you chose before the fit (one verdict).',
  more: {
    formula:
      'F = ((SS1 − SS2)/(df1 − df2)) / (SS2/df2); AICc = n·ln(SS/n) + 2K + 2K(K + 1)/(n − K − 1).',
    r: 'anova(fit1, fit2); AICcmodavg::AICc(fit)',
  },
  references: [{ text: 'Motulsky H, Christopoulos A (2004) Fitting Models to Biological Data' }],
}

export const lowess: MethodCard = {
  id: 'lowess',
  name: 'LOWESS curve',
  shortName: 'LOWESS',
  question: 'What smooth curve follows the trend of the points, without a model?',
  nullHypothesis: null,
  useWhen: 'Showing the trend of noisy data when no model describes the experiment.',
  instead: [
    { card: 'nonlinearFit', when: 'a model describes the experiment and you want parameters' },
    { card: 'smoothingSpline', when: 'you want to set the smoothness by a number of knots' },
  ],
  assumptions: ['None for drawing; it gives no parameters and no P.'],
  reading:
    'Read it as a picture of the trend only. Coarse follows the broad trend, fine follows local wiggles (and noise).',
  more: {
    formula: 'Locally weighted linear fits with robustness iterations.',
    r: 'lowess(x, y, f = 2/3)',
  },
  references: [{ text: 'Cleveland WS (1979) J Am Stat Assoc 74:829–836' }],
}

export const smoothingSpline: MethodCard = {
  id: 'smoothingSpline',
  name: 'Smoothing spline',
  shortName: 'Smoothing spline',
  question: 'What smooth curve follows the points, with smoothness set by the number of knots?',
  nullHypothesis: null,
  useWhen: 'Drawing a smooth curve through noisy data without a model.',
  instead: [{ card: 'lowess', when: 'you want a curve robust to outliers' }],
  assumptions: ['None for drawing; it gives no parameters and no P.'],
  reading: 'Fewer knots give a smoother curve; more knots follow the points more closely.',
  more: { formula: 'A cubic regression spline with the chosen knots.', r: 'smooth.spline(x, y)' },
  references: [{ text: 'de Boor C (1978) A Practical Guide to Splines' }],
}

export const splineThroughPoints: MethodCard = {
  id: 'splineThroughPoints',
  name: 'Curve through every point',
  shortName: 'Interpolating curve',
  question: 'What curve passes through every point?',
  nullHypothesis: null,
  useWhen:
    'Joining points that have little scatter (an Akima or cubic spline, or straight segments), for a smooth line on a graph or reading values between points.',
  instead: [{ card: 'lowess', when: 'the points are noisy' }],
  assumptions: ['None; it follows the noise as well as the trend.'],
  reading: 'Akima avoids the overshoot a cubic spline can show between widely spaced points.',
  more: {
    formula: 'Piecewise cubic (Akima, natural cubic) or linear interpolation.',
    r: 'spline(x, y); akima::aspline(x, y)',
  },
  references: [{ text: 'Akima H (1970) J ACM 17:589–602' }],
}

export const areaUnderCurve: MethodCard = {
  id: 'areaUnderCurve',
  name: 'Area under the curve',
  shortName: 'AUC',
  question: 'What is the area between the curve and a baseline, and where are its peaks?',
  nullHypothesis: null,
  useWhen:
    'Summarizing a time course or a trace by its total (drug exposure, glucose tolerance, a chromatogram peak).',
  instead: [{ card: 'nonlinearFit', when: 'a model describes the curve' }],
  assumptions: ['The points are joined by straight lines (the trapezoid rule).'],
  reading:
    'Read the total area, the peaks and their areas. With replicates or SD/SEM, the area also has an SE and CI.',
  more: { formula: 'Trapezoid rule above the baseline.', r: 'pracma::trapz(x, y - baseline)' },
  references: [
    { text: 'Matthews JNS et al. (1990) BMJ 300:230–235', doi: '10.1136/bmj.300.6719.230' },
  ],
}

export const RELATIONSHIP_CARDS: readonly MethodCard[] = [
  pearson,
  spearman,
  linearRegression,
  deming,
  simpleLogistic,
  nonlinearFit,
  robustFit,
  rout,
  modelComparison,
  lowess,
  smoothingSpline,
  splineThroughPoints,
  areaUnderCurve,
]
