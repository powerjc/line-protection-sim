// Minimal complex arithmetic for the phasor solver — no React dependencies.
// A complex number is { re, im }.

export const C = (re, im = 0) => ({ re, im })
export const ZERO = C(0)
export const ONE = C(1)

export const add = (a, b) => C(a.re + b.re, a.im + b.im)
export const sub = (a, b) => C(a.re - b.re, a.im - b.im)
export const mul = (a, b) => C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re)
export const scale = (a, k) => C(a.re * k, a.im * k)
export const conj = a => C(a.re, -a.im)
export const abs = a => Math.hypot(a.re, a.im)
export const arg = a => Math.atan2(a.im, a.re)
export const polar = (mag, rad) => C(mag * Math.cos(rad), mag * Math.sin(rad))

export function div(a, b) {
  const d = b.re * b.re + b.im * b.im
  return C((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d)
}
export const inv = a => div(ONE, a)

// Solve A·x = b in place (Gaussian elimination, partial pivoting).
// A: n×n array of complex, b: length-n array of complex.
export function solveLinear(A, b) {
  const n = b.length
  for (let k = 0; k < n; k++) {
    let p = k
    for (let i = k + 1; i < n; i++) if (abs(A[i][k]) > abs(A[p][k])) p = i
    if (abs(A[p][k]) === 0) throw new Error('Singular network matrix')
    ;[A[k], A[p]] = [A[p], A[k]]
    ;[b[k], b[p]] = [b[p], b[k]]
    for (let i = k + 1; i < n; i++) {
      const f = div(A[i][k], A[k][k])
      if (f.re === 0 && f.im === 0) continue
      for (let j = k; j < n; j++) A[i][j] = sub(A[i][j], mul(f, A[k][j]))
      b[i] = sub(b[i], mul(f, b[k]))
    }
  }
  const x = new Array(n)
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i]
    for (let j = i + 1; j < n; j++) s = sub(s, mul(A[i][j], x[j]))
    x[i] = div(s, A[i][i])
  }
  return x
}
