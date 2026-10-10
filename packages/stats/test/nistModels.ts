import type { CurveModel } from '../src/index.ts'

/**
 * The 27 NIST StRD nonlinear regression models as CurveModels with analytic gradients.
 * https://www.itl.nist.gov/div898/strd/nls/nls_main.shtml
 *
 * Nelson has two predictors and a log response; its "x" is the row index into (x1, x2), and the
 * caller fits log(y).
 */

type Fn = (x: number, b: ArrayLike<number>) => number
type Grad = (x: number, b: ArrayLike<number>, g: Float64Array) => void

function model(id: string, nParams: number, f: Fn, grad: Grad): CurveModel {
  return {
    id,
    params: Array.from({ length: nParams }, (_, i) => `b${i + 1}`),
    f,
    grad,
    initial: () => {
      throw new Error('NIST fits use the certified starting values')
    },
  }
}

const exp1: [Fn, Grad] = [
  (x, b) => b[0]! * (1 - Math.exp(-b[1]! * x)),
  (x, b, g) => {
    const e = Math.exp(-b[1]! * x)
    g[0] = 1 - e
    g[1] = b[0]! * x * e
  },
]

const chwirut: [Fn, Grad] = [
  (x, b) => Math.exp(-b[0]! * x) / (b[1]! + b[2]! * x),
  (x, b, g) => {
    const d = b[1]! + b[2]! * x
    const f = Math.exp(-b[0]! * x) / d
    g[0] = -x * f
    g[1] = -f / d
    g[2] = (-x * f) / d
  },
]

const lanczos: [Fn, Grad] = [
  (x, b) =>
    b[0]! * Math.exp(-b[1]! * x) + b[2]! * Math.exp(-b[3]! * x) + b[4]! * Math.exp(-b[5]! * x),
  (x, b, g) => {
    for (let k = 0; k < 3; k++) {
      const e = Math.exp(-b[2 * k + 1]! * x)
      g[2 * k] = e
      g[2 * k + 1] = -x * b[2 * k]! * e
    }
  },
]

const gauss: [Fn, Grad] = [
  (x, b) =>
    b[0]! * Math.exp(-b[1]! * x) +
    b[2]! * Math.exp(-((x - b[3]!) ** 2) / b[4]! ** 2) +
    b[5]! * Math.exp(-((x - b[6]!) ** 2) / b[7]! ** 2),
  (x, b, g) => {
    const e = Math.exp(-b[1]! * x)
    g[0] = e
    g[1] = -x * b[0]! * e
    for (const o of [2, 5]) {
      const d = x - b[o + 1]!
      const s = b[o + 2]!
      const q = Math.exp(-(d * d) / (s * s))
      g[o] = q
      g[o + 1] = (b[o]! * q * 2 * d) / (s * s)
      g[o + 2] = (b[o]! * q * 2 * d * d) / (s * s * s)
    }
  },
]

/** (Σ b_k x^k, k < nNum) / (1 + Σ b_{nNum+k} x^(k+1)). */
function rational(nNum: number, nDen: number): [Fn, Grad] {
  const parts = (x: number, b: ArrayLike<number>): [number, number] => {
    let num = 0
    let xp = 1
    for (let k = 0; k < nNum; k++, xp *= x) num += b[k]! * xp
    let den = 1
    xp = x
    for (let k = 0; k < nDen; k++, xp *= x) den += b[nNum + k]! * xp
    return [num, den]
  }
  return [
    (x, b) => {
      const [num, den] = parts(x, b)
      return num / den
    },
    (x, b, g) => {
      const [num, den] = parts(x, b)
      let xp = 1
      for (let k = 0; k < nNum; k++, xp *= x) g[k] = xp / den
      xp = x
      for (let k = 0; k < nDen; k++, xp *= x) g[nNum + k] = (-num * xp) / (den * den)
    },
  ]
}

export function nistModel(name: string, input: Record<string, number[]>): CurveModel {
  switch (name) {
    case 'Misra1a':
    case 'BoxBOD':
      return model(name, 2, ...exp1)
    case 'Chwirut1':
    case 'Chwirut2':
      return model(name, 3, ...chwirut)
    case 'Lanczos1':
    case 'Lanczos2':
    case 'Lanczos3':
      return model(name, 6, ...lanczos)
    case 'Gauss1':
    case 'Gauss2':
    case 'Gauss3':
      return model(name, 8, ...gauss)
    case 'DanWood':
      return model(
        name,
        2,
        (x, b) => b[0]! * x ** b[1]!,
        (x, b, g) => {
          const p = x ** b[1]!
          g[0] = p
          g[1] = b[0]! * p * Math.log(x)
        },
      )
    case 'Misra1b':
      return model(
        name,
        2,
        (x, b) => b[0]! * (1 - (1 + (b[1]! * x) / 2) ** -2),
        (x, b, g) => {
          const u = 1 + (b[1]! * x) / 2
          g[0] = 1 - u ** -2
          g[1] = b[0]! * x * u ** -3
        },
      )
    case 'Misra1c':
      return model(
        name,
        2,
        (x, b) => b[0]! * (1 - (1 + 2 * b[1]! * x) ** -0.5),
        (x, b, g) => {
          const u = 1 + 2 * b[1]! * x
          g[0] = 1 - u ** -0.5
          g[1] = b[0]! * x * u ** -1.5
        },
      )
    case 'Misra1d':
      return model(
        name,
        2,
        (x, b) => (b[0]! * b[1]! * x) / (1 + b[1]! * x),
        (x, b, g) => {
          const u = 1 + b[1]! * x
          g[0] = (b[1]! * x) / u
          g[1] = (b[0]! * x) / (u * u)
        },
      )
    case 'Kirby2':
      return model(name, 5, ...rational(3, 2))
    case 'Hahn1':
    case 'Thurber':
      return model(name, 7, ...rational(4, 3))
    case 'Nelson': {
      const x1 = input.x1!
      const x2 = input.x2!
      return model(
        name,
        3,
        (i, b) => b[0]! - b[1]! * x1[i]! * Math.exp(-b[2]! * x2[i]!),
        (i, b, g) => {
          const e = Math.exp(-b[2]! * x2[i]!)
          g[0] = 1
          g[1] = -x1[i]! * e
          g[2] = b[1]! * x1[i]! * x2[i]! * e
        },
      )
    }
    case 'MGH17':
      return model(
        name,
        5,
        (x, b) => b[0]! + b[1]! * Math.exp(-x * b[3]!) + b[2]! * Math.exp(-x * b[4]!),
        (x, b, g) => {
          const e4 = Math.exp(-x * b[3]!)
          const e5 = Math.exp(-x * b[4]!)
          g[0] = 1
          g[1] = e4
          g[2] = e5
          g[3] = -x * b[1]! * e4
          g[4] = -x * b[2]! * e5
        },
      )
    case 'Roszman1':
      return model(
        name,
        4,
        (x, b) => b[0]! - b[1]! * x - Math.atan(b[2]! / (x - b[3]!)) / Math.PI,
        (x, b, g) => {
          const d = x - b[3]!
          const u = b[2]! / d
          const k = 1 / (1 + u * u) / Math.PI
          g[0] = 1
          g[1] = -x
          g[2] = -k / d
          g[3] = (-k * b[2]!) / (d * d)
        },
      )
    case 'ENSO':
      return model(
        name,
        9,
        (x, b) => {
          const a = (2 * Math.PI * x) / 12
          const a4 = (2 * Math.PI * x) / b[3]!
          const a7 = (2 * Math.PI * x) / b[6]!
          return (
            b[0]! +
            b[1]! * Math.cos(a) +
            b[2]! * Math.sin(a) +
            b[4]! * Math.cos(a4) +
            b[5]! * Math.sin(a4) +
            b[7]! * Math.cos(a7) +
            b[8]! * Math.sin(a7)
          )
        },
        (x, b, g) => {
          const a = (2 * Math.PI * x) / 12
          g[0] = 1
          g[1] = Math.cos(a)
          g[2] = Math.sin(a)
          for (const o of [3, 6]) {
            const p = b[o]!
            const ap = (2 * Math.PI * x) / p
            const c = Math.cos(ap)
            const s = Math.sin(ap)
            g[o + 1] = c
            g[o + 2] = s
            g[o] = (-b[o + 1]! * s + b[o + 2]! * c) * (-ap / p)
          }
        },
      )
    case 'MGH09':
      return model(
        name,
        4,
        (x, b) => (b[0]! * (x * x + x * b[1]!)) / (x * x + x * b[2]! + b[3]!),
        (x, b, g) => {
          const num = x * x + x * b[1]!
          const den = x * x + x * b[2]! + b[3]!
          g[0] = num / den
          g[1] = (b[0]! * x) / den
          g[2] = (-b[0]! * num * x) / (den * den)
          g[3] = (-b[0]! * num) / (den * den)
        },
      )
    case 'MGH10':
      return model(
        name,
        3,
        (x, b) => b[0]! * Math.exp(b[1]! / (x + b[2]!)),
        (x, b, g) => {
          const d = x + b[2]!
          const e = Math.exp(b[1]! / d)
          g[0] = e
          g[1] = (b[0]! * e) / d
          g[2] = (-b[0]! * e * b[1]!) / (d * d)
        },
      )
    case 'Eckerle4':
      return model(
        name,
        3,
        (x, b) => (b[0]! / b[1]!) * Math.exp(-0.5 * ((x - b[2]!) / b[1]!) ** 2),
        (x, b, g) => {
          const z = (x - b[2]!) / b[1]!
          const e = Math.exp(-0.5 * z * z)
          g[0] = e / b[1]!
          g[1] = ((b[0]! * e) / (b[1]! * b[1]!)) * (z * z - 1)
          g[2] = ((b[0]! / b[1]!) * e * z) / b[1]!
        },
      )
    case 'Rat42':
      return model(
        name,
        3,
        (x, b) => b[0]! / (1 + Math.exp(b[1]! - b[2]! * x)),
        (x, b, g) => {
          const e = Math.exp(b[1]! - b[2]! * x)
          const u = 1 + e
          g[0] = 1 / u
          g[1] = (-b[0]! * e) / (u * u)
          g[2] = (b[0]! * x * e) / (u * u)
        },
      )
    case 'Rat43':
      return model(
        name,
        4,
        (x, b) => b[0]! / (1 + Math.exp(b[1]! - b[2]! * x)) ** (1 / b[3]!),
        (x, b, g) => {
          const e = Math.exp(b[1]! - b[2]! * x)
          const u = 1 + e
          const p = u ** (-1 / b[3]!)
          g[0] = p
          g[1] = (((b[0]! * -1) / b[3]!) * p * e) / u
          g[2] = (((b[0]! * 1) / b[3]!) * p * x * e) / u
          g[3] = (b[0]! * p * Math.log(u)) / (b[3]! * b[3]!)
        },
      )
    case 'Bennett5':
      return model(
        name,
        3,
        (x, b) => b[0]! * (b[1]! + x) ** (-1 / b[2]!),
        (x, b, g) => {
          const u = b[1]! + x
          const p = u ** (-1 / b[2]!)
          g[0] = p
          g[1] = (-b[0]! / b[2]!) * (p / u)
          g[2] = (b[0]! * p * Math.log(u)) / (b[2]! * b[2]!)
        },
      )
    default:
      throw new Error(`no NIST model for ${name}`)
  }
}

/** The data as fitted: Nelson's x is the row index and its response log(y). */
export function nistData(
  name: string,
  input: Record<string, number[]>,
): { x: number[]; y: number[] } {
  if (name === 'Nelson') {
    return { x: input.y!.map((_, i) => i), y: input.y!.map(Math.log) }
  }
  return { x: input.x!, y: input.y! }
}
