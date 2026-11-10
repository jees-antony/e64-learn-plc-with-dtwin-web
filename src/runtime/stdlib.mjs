// SPDX-License-Identifier: GPL-3.0-only
// IEC 61131-3 standard functions for the in-browser runtime.
// `call(name, args, info)` -> value, or undefined when the name is not a standard function.
// info = { bits, signed, now } describing the call's result type and the clock.

import { INT_BITS, RuntimeError, TIME_LIKE, roundHalfAway, wrapInt } from './values.mjs'

const mask = (bits) => (bits >= 53 ? Infinity : 2 ** bits - 1)
const toBig = (v) => BigInt(Math.trunc(v))

function shift(kind, args, { bits = 32 }) {
  const [v, n] = args, b = Math.min(bits, 64), big = BigInt.asUintN(b, toBig(v))
  const k = ((Math.trunc(n) % b) + b) % b
  let r
  if (kind === 'SHL') r = big << BigInt(Math.trunc(n))
  else if (kind === 'SHR') r = big >> BigInt(Math.trunc(n))
  else if (kind === 'ROL') r = (big << BigInt(k)) | (big >> BigInt(b - k))
  else r = (big >> BigInt(k)) | (big << BigInt(b - k))
  return Number(BigInt.asUintN(b, r))
}

const FUNCS = {
  ABS: ([x]) => Math.abs(x),
  SQRT: ([x]) => Math.sqrt(x),
  LN: ([x]) => Math.log(x),
  LOG: ([x]) => Math.log10(x),
  EXP: ([x]) => Math.exp(x),
  SIN: ([x]) => Math.sin(x), COS: ([x]) => Math.cos(x), TAN: ([x]) => Math.tan(x),
  ASIN: ([x]) => Math.asin(x), ACOS: ([x]) => Math.acos(x), ATAN: ([x]) => Math.atan(x), ATAN2: ([y, x]) => Math.atan2(y, x),
  EXPT: ([a, b]) => a ** b,
  TRUNC: ([x]) => Math.trunc(x),
  ADD: (a) => a.reduce((x, y) => x + y),
  MUL: (a) => a.reduce((x, y) => x * y),
  SUB: ([a, b]) => a - b,
  DIV: ([a, b], i) => { if (b === 0) throw new RuntimeError('Division by zero'); return i.isInt ? Math.trunc(a / b) : a / b },
  MOD: ([a, b]) => { if (b === 0) throw new RuntimeError('Division by zero'); return a % b },
  MOVE: ([a]) => a,
  SEL: ([g, a, b]) => (g ? b : a),
  MAX: (a) => a.reduce((x, y) => (y > x ? y : x)),
  MIN: (a) => a.reduce((x, y) => (y < x ? y : x)),
  LIMIT: ([mn, v, mx]) => (v < mn ? mn : v > mx ? mx : v),
  MUX: ([k, ...a]) => { if (k < 0 || k >= a.length) throw new RuntimeError('MUX selector out of range'); return a[k] },
  GT: (a) => a.every((v, i) => i === 0 || a[i - 1] > v),
  GE: (a) => a.every((v, i) => i === 0 || a[i - 1] >= v),
  EQ: (a) => a.every((v, i) => i === 0 || a[i - 1] === v),
  LE: (a) => a.every((v, i) => i === 0 || a[i - 1] <= v),
  LT: (a) => a.every((v, i) => i === 0 || a[i - 1] < v),
  NE: ([a, b]) => a !== b,
  AND: (a, i) => (i.isBool ? a.every(Boolean) : a.reduce((x, y) => Number(BigInt(x) & BigInt(y)))),
  OR: (a, i) => (i.isBool ? a.some(Boolean) : a.reduce((x, y) => Number(BigInt(x) | BigInt(y)))),
  XOR: (a, i) => (i.isBool ? a.reduce((x, y) => x !== !!y, false) : a.reduce((x, y) => Number(BigInt(x) ^ BigInt(y)))),
  NOT: ([a], i) => (i.isBool ? !a : Number(BigInt.asUintN(i.bits ?? 16, ~toBig(a)))),
  SHL: (a, i) => shift('SHL', a, i), SHR: (a, i) => shift('SHR', a, i), ROL: (a, i) => shift('ROL', a, i), ROR: (a, i) => shift('ROR', a, i),
  // strings (1-based positions)
  LEN: ([s]) => s.length,
  LEFT: ([s, n]) => s.slice(0, Math.max(0, n)),
  RIGHT: ([s, n]) => (n <= 0 ? '' : s.slice(-n)),
  MID: ([s, l, p]) => s.slice(Math.max(0, p - 1), Math.max(0, p - 1) + Math.max(0, l)),
  CONCAT: (a) => a.join(''),
  FIND: ([s, sub]) => s.indexOf(sub) + 1,
  INSERT: ([s, ins, p]) => s.slice(0, p) + ins + s.slice(p),
  DELETE: ([s, l, p]) => s.slice(0, Math.max(0, p - 1)) + s.slice(Math.max(0, p - 1) + l),
  REPLACE: ([s, r, l, p]) => s.slice(0, Math.max(0, p - 1)) + r + s.slice(Math.max(0, p - 1) + l),
  TIME: (_a, i) => i.now(),
}

const CONVERSION = /^([A-Z_0-9]+?)_TO_([A-Z_0-9]+)$/
function convert(from, to, v) {
  const source = from.toUpperCase(), target = to.toUpperCase()
  if (target === 'BOOL') return typeof v === 'string' ? v.toUpperCase() === 'TRUE' || v === '1' : v !== 0 && !!v
  if (target === 'STRING' || target === 'WSTRING') return typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v)
  let n = typeof v === 'string' ? Number(v) : typeof v === 'boolean' ? (v ? 1 : 0) : v
  // TIME is nanoseconds internally; integer / REAL conversions use milliseconds.
  if (source === 'TIME' && !TIME_LIKE.has(target)) n = n / 1e6
  if (INT_BITS[target]) { const [bits, signed] = INT_BITS[target]; return wrapInt(Number.isInteger(n) ? n : roundHalfAway(n), bits, signed) }
  if (target === 'REAL') return Math.fround(n)
  if (target === 'LREAL') return n
  if (TIME_LIKE.has(target)) return source === 'TIME' ? n : Math.trunc(n * 1e6)
  return n
}

export function isStandardFunction(name) {
  return name in FUNCS || (CONVERSION.test(name) && name !== 'NOT_TO_BOOL')
}

export function callStandard(name, args, info) {
  const fn = FUNCS[name]
  if (fn) return fn(args, info)
  const m = CONVERSION.exec(name)
  return m ? convert(m[1], m[2], args[0]) : undefined
}
export { mask }
