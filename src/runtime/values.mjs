// SPDX-License-Identifier: GPL-3.0-only
// Value model of the in-browser PLC runtime.
//
//   BOOL -> boolean            integers / REAL -> number        TIME -> nanoseconds (number)
//   STRING -> string           ARRAY -> nested JS arrays        STRUCT / FB instance -> object
//
// All identifiers are upper-case (the strucpp front end normalises them).

export const INT_BITS = {
  SINT: [8, true], INT: [16, true], DINT: [32, true], LINT: [64, true],
  USINT: [8, false], UINT: [16, false], UDINT: [32, false], ULINT: [64, false],
  BYTE: [8, false], WORD: [16, false], DWORD: [32, false], LWORD: [64, false],
}
export const TIME_LIKE = new Set(['TIME', 'LTIME', 'DATE', 'TOD', 'TIME_OF_DAY', 'DT', 'DATE_AND_TIME', 'LDT', 'LTOD'])
export const ELEMENTARY = new Set(['BOOL', 'REAL', 'LREAL', 'STRING', 'WSTRING', 'CHAR', 'WCHAR', ...Object.keys(INT_BITS), ...TIME_LIKE])

export class RuntimeError extends Error {}

export function wrapInt(value, bits, signed) {
  if (!Number.isFinite(value)) return 0
  const v = Math.trunc(value)
  if (bits >= 64) {
    const big = BigInt(v)
    return Number(signed ? BigInt.asIntN(64, big) : BigInt.asUintN(64, big))
  }
  const m = 2 ** bits
  let x = v % m
  if (x < 0) x += m
  return signed && x >= m / 2 ? x - m : x
}

/** Round half away from zero, the IEC REAL -> integer rule. */
export const roundHalfAway = (v) => (v < 0 ? -Math.round(-v) : Math.round(v))

/** Coerce a JS value to a runtime type (`typeinfo.kind` decides). */
export function coerce(type, value) {
  switch (type.kind) {
    case 'bool': return !!value
    case 'int': {
      const n = typeof value === 'boolean' ? (value ? 1 : 0) : Number(value)
      return wrapInt(Number.isInteger(n) ? n : roundHalfAway(n), type.bits, type.signed)
    }
    case 'real': { const n = typeof value === 'boolean' ? (value ? 1 : 0) : Number(value); return type.bits === 32 ? Math.fround(n) : n }
    case 'time': return Math.trunc(Number(value) || 0)
    case 'string': return typeof value === 'string' ? (type.max ? value.slice(0, type.max) : value) : String(value ?? '')
    case 'enum': return typeof value === 'number' ? value : Number(value) || 0
    default: return value
  }
}

const UNITS = { D: 86400e9, H: 3600e9, M: 60e9, S: 1e9, MS: 1e6, US: 1e3, NS: 1 }
/** `T#1h2m3s4ms` / `TIME#-5s` -> nanoseconds. */
export function parseTimeLiteral(text) {
  const m = /^(?:L?T(?:IME)?)#(-)?([0-9_.A-Z]+)$/i.exec(String(text).trim())
  if (!m) throw new RuntimeError(`Invalid TIME literal ${text}`)
  let ns = 0, matched = ''
  for (const [, num, unit] of m[2].toUpperCase().replace(/_/g, '').matchAll(/(\d+(?:\.\d+)?)(MS|US|NS|D|H|M|S)/g)) {
    ns += Number(num) * UNITS[unit]; matched += num + unit
  }
  if (!matched || matched !== m[2].toUpperCase().replace(/_/g, '')) throw new RuntimeError(`Invalid TIME literal ${text}`)
  return Math.round(m[1] ? -ns : ns)
}

/** Fresh default value of a type (FB instances are built by the linker, not here). */
export function defaultValue(type) {
  switch (type.kind) {
    case 'bool': return false
    case 'int': case 'real': case 'time': case 'enum': return type.initial ?? 0
    case 'string': return ''
    case 'array': return makeArray(type.dims, 0, type.elem)
    case 'struct': { const o = {}; for (const [k, t] of type.fields) o[k] = defaultValue(t); return o }
    case 'fb': return type.create()
    default: return 0
  }
}
function makeArray(dims, level, elem) {
  const len = dims[level].hi - dims[level].lo + 1
  return Array.from({ length: Math.max(0, len) }, () => (level + 1 < dims.length ? makeArray(dims, level + 1, elem) : defaultValue(elem)))
}

/** Little-endian wire encoding used by the editor's debug protocol. */
export function encodeWire(typeName, size, value) {
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  const T = typeName.toUpperCase()
  if (T === 'BOOL') out[0] = value ? 1 : 0
  else if (T === 'REAL') view.setFloat32(0, Number(value), true)
  else if (T === 'LREAL') view.setFloat64(0, Number(value), true)
  else if (INT_BITS[T] || TIME_LIKE.has(T)) {
    const [bits, signed] = INT_BITS[T] ?? [64, true]
    const n = Math.trunc(Number(value) || 0)
    if (bits === 8) out[0] = n & 0xff
    else if (bits === 16) view.setUint16(0, n & 0xffff, true)
    else if (bits === 32) view.setUint32(0, n >>> 0, true)
    else view.setBigInt64(0, signed ? BigInt.asIntN(64, BigInt(n)) : BigInt.asIntN(64, BigInt.asUintN(64, BigInt(n))), true)
  }
  return out
}
export function decodeWire(typeName, bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const T = typeName.toUpperCase()
  if (T === 'BOOL') return bytes[0] !== 0
  if (T === 'REAL') return view.getFloat32(0, true)
  if (T === 'LREAL') return view.getFloat64(0, true)
  const [bits, signed] = INT_BITS[T] ?? [64, true]
  if (bits === 8) return signed ? view.getInt8(0) : view.getUint8(0)
  if (bits === 16) return signed ? view.getInt16(0, true) : view.getUint16(0, true)
  if (bits === 32) return signed ? view.getInt32(0, true) : view.getUint32(0, true)
  return Number(signed ? view.getBigInt64(0, true) : view.getBigUint64(0, true))
}
