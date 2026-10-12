import type { FormText } from './types.ts'

// Roadmap 51a: the text of the XY analyses and curve fits.

const REPLICATES = {
  line: 'Are the replicates at each X independent experiments, or repeats of one sample?',
  card: 'Independent replicates (separate animals, separate experiments) are each a point. Repeated measurements of one sample (technical replicates) are not independent: fit their means, or the fit counts them as more evidence than they are.',
  options: {
    each: 'Each replicate is an independent point.',
    mean: 'Fit the mean at each X (technical replicates).',
  },
} as const

const DIAGNOSTICS = {
  'diagnostics.residuals': {
    line: 'The distance of each point from the curve, plotted and listed.',
  },
  'diagnostics.runsTest': {
    line: 'Do the points lie on one side of the curve in runs? Then the model is wrong.',
  },
  'diagnostics.replicatesTest': {
    line: 'Is the scatter around the curve larger than between replicates?',
  },
  'diagnostics.normality': { line: 'Tests whether the residuals look normal.' },
} as const

const INTERPOLATE = {
  line: 'Read unknowns off the standard curve: X from Y, or Y from X.',
  card: 'Rows below the standards with a Y but no X get an X from the curve; rows with an X but no Y get a Y. Unknowns outside the standards’ range are extrapolations.',
} as const

const NLFIT: FormText = {
  equation: {
    line: 'The model that describes your experiment (dose-response, binding, decay…).',
    card: 'Choose the model from the experiment, before looking at the fit. For dose-response, the “log” models expect X as log(concentration); the “[Agonist]” and “X is concentration” models expect concentrations.',
  },
  userEquation: { line: 'Your own model, written with X, Y and its parameters.' },
  equationByDataSet: { line: 'Fit some data sets with a different model.' },
  constraints: {
    line: 'Fix a parameter (Bottom = 0), share it between data sets, or let it vary.',
    card: 'Fixing a parameter to a value you know (Bottom = 0 for background-subtracted data, Top = 100 for normalized data) helps when the data don’t reach a plateau. Sharing a parameter fits one value to every data set.',
  },
  initialValues: { line: 'Where the fit starts; automatic values usually work.' },
  initialRules: { line: 'How the starting values of your equation’s parameters are found.' },
  limits: { line: 'Keep a parameter within a range during the fit.' },
  fitMethod: {
    line: 'Least squares, or a robust fit little affected by wild points.',
    options: {
      leastSquares: { line: 'The usual fit, with CIs and comparisons.', method: 'nonlinearFit' },
      robust: { line: 'Best-fit values only, little affected by outliers.', method: 'robustFit' },
    },
  },
  outliers: {
    line: 'Find outliers by the ROUT method, and optionally leave them out.',
    options: {
      none: 'Fit every point.',
      identify: { line: 'Flag outliers but fit every point.', method: 'rout' },
      eliminate: { line: 'Leave flagged outliers out of the fit.', method: 'rout' },
    },
  },
  routQ: {
    line: 'The share of flagged points you accept as wrongly flagged.',
    options: {
      '0.1': 'Flags only very clear outliers.',
      '0.5': 'Between 0.1% and 1%.',
      '1': {
        line: 'Flags few good points.',
        recommended: 'it balances finding real outliers against flagging good points',
      },
      '5': 'Flags more points, more of them wrongly.',
      '10': 'Flags many points; for exploring only.',
    },
  },
  weighting: {
    line: 'When the scatter grows with Y, give the larger values less weight.',
    options: {
      none: 'Scatter about the same at every Y.',
      relative: 'Scatter proportional to Y (a constant CV).',
      poisson: 'Scatter grows with the square root of Y (counts).',
      power: 'Scatter proportional to Y to a power K you set.',
      x: 'Weight by 1/X.',
      x2: 'Weight by 1/X².',
      sd: 'Weight by the SD entered for each point.',
    },
  },
  weightPower: { line: 'The power K of Y in the weights 1/Y^K.' },
  replicates: REPLICATES,
  ciMethod: {
    line: 'How the CIs of the parameters are computed.',
    options: {
      symmetric: 'Symmetric around the best fit: fast, approximate.',
      profile: 'Asymmetric, from the profile likelihood: more accurate for EC50s.',
    },
  },
  band: {
    line: 'Draw the curve alone, or with a band around it.',
    options: {
      none: 'The curve only.',
      confidence: 'Where the true curve lies (with the chosen confidence).',
      prediction: 'Where new points are expected (wider).',
    },
  },
  compareWith: {
    line: 'Does another model fit better? Decide which comparison before the fit.',
  },
  compareParams: {
    line: 'Does a parameter (an EC50) differ between data sets?',
    card: 'Fits the data sets with the parameter shared and separately, and compares the fits. Decide which parameter matters before looking at the curves.',
  },
  ...DIAGNOSTICS,
  weightingTest: { line: 'Does the scatter grow with Y? Then weighting may be needed.' },
  hougaard: { line: 'How far each parameter’s uncertainty is from symmetric.' },
  covariance: { line: 'How strongly the parameters depend on each other.' },
  interpolate: INTERPOLATE,
}

export const XY_TEXT: Readonly<Record<string, FormText>> = {
  linearRegression: {
    throughOrigin: { line: 'Only if Y must be 0 when X is 0, known from the method.' },
    throughPoint: { line: 'Force the line through a point you know it must pass.' },
    pointX: { line: 'X of the point the line must pass through.' },
    pointY: { line: 'Y of the point the line must pass through.' },
    replicates: REPLICATES,
    compare: {
      line: 'Test whether the data sets’ slopes differ; intercepts if the slopes don’t.',
    },
    interpolate: INTERPOLATE,
    band: {
      line: 'Draw the line alone, or with a band around it.',
      options: {
        none: 'The line only.',
        confidence: 'Where the true line lies (with the chosen confidence).',
        prediction: 'Where new points are expected (wider).',
      },
    },
    ...DIAGNOSTICS,
  },
  deming: {
    errors: {
      line: 'How uncertain X is compared with Y.',
      options: {
        equal: 'Both methods equally precise, in the same units.',
        sd: 'Enter the SD of each method’s errors.',
      },
    },
    sdX: { line: 'The SD of repeated measurements by the X method.' },
    sdY: {
      line: 'The SD of repeated measurements by the Y method; only the ratio matters.',
    },
    xForY: { line: 'An X at which to report the line’s Y, with its CI.' },
  },
  simpleLogistic: {
    ciMethod: {
      line: 'How the CIs of the odds ratio and slope are computed.',
      options: {
        profile: {
          line: 'From the profile likelihood.',
          recommended:
            'it stays accurate with few subjects or extreme probabilities, where Wald’s doesn’t',
        },
        wald: 'Estimate ± z·SE: fast, rough with few subjects.',
      },
    },
    roc: { line: 'How well X separates the two outcomes (area under the ROC curve).' },
    rowPrediction: { line: 'The predicted probability for each subject’s X.' },
    range: {
      line: 'Where the fitted curve is drawn.',
      options: {
        data: 'From the smallest to the largest X.',
        custom: 'Over a range you enter.',
      },
    },
    rangeMin: { line: 'The X where the curve starts.' },
    rangeMax: { line: 'The X where the curve ends.' },
  },
  nonlinearFit: NLFIT,
  nonlinearFitMV: {
    ...NLFIT,
    x: { line: 'The variable on the X axis (dose, time).' },
    y: { line: 'The variable the curve predicts (the response).' },
    group: { line: 'A variable whose values each get their own curve (optional).' },
  },
  fitSpline: {
    method: {
      line: 'A smooth trend, or a curve through every point? None gives parameters.',
      options: {
        lowess: { line: 'Follows the trend, robust to outliers.', method: 'lowess' },
        smoothingSpline: {
          line: 'Smoothness set by the number of knots.',
          method: 'smoothingSpline',
        },
        akima: { line: 'Through every point, without overshoot.', method: 'splineThroughPoints' },
        cubicSpline: { line: 'Through every point, smooth.', method: 'splineThroughPoints' },
        pointToPoint: { line: 'Straight lines between the points.', method: 'splineThroughPoints' },
      },
    },
    lowess: {
      line: 'How closely the curve follows the points.',
      options: {
        coarse: 'The broad trend.',
        medium: 'Between the two.',
        fine: 'Local wiggles (and noise).',
      },
    },
    knots: { line: 'Fewer knots, a smoother curve.' },
    segments: {
      line: 'How finely the curve is drawn: at least four per data point.',
      card: 'LOWESS curves join the fitted values at the data.',
    },
    table: { line: 'A table of the curve’s X and Y values, to graph or analyze.' },
  },
  areaUnderCurve: {
    baseline: { line: 'The Y from which the area is measured.' },
    minPeakHeight: { line: 'Ignore small bumps: peaks lower than this share of the Y range.' },
    minPeakPoints: { line: 'Ignore peaks made of fewer points than this.' },
    direction: {
      line: 'Count only peaks above the baseline, or dips below it as well.',
      options: {
        above: 'Peaks above the baseline only.',
        both: 'Peaks above and dips below the baseline.',
      },
    },
  },
}
