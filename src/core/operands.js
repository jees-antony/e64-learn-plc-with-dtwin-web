// Pure helpers for the operands a learner fills in on ladder instructions (no DOM).
import { FB } from './catalog.js'

// Same literal rule as codegen.js, so "known to the editor" and "accepted by the compiler" agree.
const LITERAL = /^(?:[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?|T#[0-9a-zA-Z_.]+|TRUE|FALSE|16#[0-9A-Fa-f]+|'[^']*')$/i
const EDGE_FB = { P: 'R_TRIG', N: 'F_TRIG' }
const has = (c, k) => (c?.has ? c.has(k) : !!c?.includes?.(k))
const slot = (kind) => (kind === 'bool' ? 1 : 0)

/** Operands of one element in the order a learner fills them in: { field | pin, kind, label, optional? }. */
export function operandFields(e) {
  if (!e) return []
  switch (e.k) {
    case 'NO': case 'NC': case 'P': case 'N': case 'coil': case 'ncoil': case 'set': case 'reset':
      return [{ field: 'tag', kind: 'bool', label: 'Tag' }]
    case 'cmp': return [{ field: 'a', kind: 'any', label: 'IN1' }, { field: 'b', kind: 'any', label: 'IN2' }]
    case 'move': return [{ field: 'src', kind: 'any', label: 'IN' }, { field: 'dest', kind: 'any', label: 'OUT' }]
    case 'math': return [{ field: 'a', kind: 'any', label: 'IN1' }, { field: 'b', kind: 'any', label: 'IN2' }, { field: 'dest', kind: 'any', label: 'OUT' }]
    case 'box': {
      const def = FB[e.fb]; if (!def) return []
      // Values (time, number) before the extra Bool pins; sort is stable, so the catalog order breaks ties.
      return Object.entries(def.in).filter(([p]) => p !== def.flowIn)
        .map(([pin, kind]) => ({ pin, kind, label: pin, ...(kind === 'bool' ? { optional: true } : {}) }))
        .sort((x, y) => slot(x.kind) - slot(y.kind))
    }
    default: return []
  }
}
export const fieldName = (f) => f.field ?? f.pin
export const valueOf = (e, f) => (f.pin ? e.args?.[f.pin] : e[f.field]) ?? ''

/** Every operand of a network in reading order: main rung left to right, parallel paths top to bottom, then coils. */
export function operandSequence(net) {
  const out = []
  const push = (e, at) => operandFields(e).forEach((field) => out.push({ at, name: fieldName(field), field }))
  const walk = (list, base) => list.forEach((e, i) => {
    const path = [...base, i]
    if (e.k === 'branch') e.branches.forEach((lane, li) => walk(lane, [...path, li]))
    else push(e, { path })
  })
  walk(net.elements ?? [], [])
  ;(net.coils ?? []).forEach((c, i) => push(c, { coil: i }))
  return out
}

/** Timer / counter / edge instances in a block, including inside parallel paths: [{ name, fb }]. */
export function instancesOf(block) {
  const found = new Map()
  const walk = (list) => (list ?? []).forEach((e) => {
    const fb = e.k === 'box' ? e.fb : EDGE_FB[e.k]
    if (fb && e.inst && !found.has(e.inst)) found.set(e.inst, fb)
    e.branches?.forEach(walk)
  })
  for (const net of block?.networks ?? []) walk(net.elements)
  return [...found].map(([name, fb]) => ({ name, fb }))
}
/** Output pins of a function block, for suggestions such as TON_1.Q: [{ pin, kind }]. */
export function pinNames(fb) { return Object.entries(FB[fb]?.out ?? {}).map(([pin, kind]) => ({ pin, kind })) }

/**
 * What an operand text is: 'empty' | 'tag' | 'local' | 'literal' | 'pin' | 'unknown'.
 * tags / locals are Sets (or arrays) of names; instances is a Map name -> FB type (or a Set of names).
 */
export function classifyOperand(text, { tags, locals, instances } = {}) {
  const t = String(text ?? '').trim()
  if (!t) return 'empty'
  if (LITERAL.test(t)) return 'literal'
  if (has(locals, t)) return 'local'
  if (has(tags, t)) return 'tag'
  const m = /^([A-Za-z_]\w*)\.([A-Za-z_]\w*)$/.exec(t)
  if (m && has(instances, m[1])) {
    const fb = instances.get?.(m[1])
    return !fb || !FB[fb] || m[2] in FB[fb].out || m[2] in FB[fb].in ? 'pin' : 'unknown'
  }
  return 'unknown'
}

const PLC_TYPE = { bool: 'Bool', int: 'Int', time: 'Time', any: 'Int' }
/** PLC type a new tag created for this operand should get. */
export function suggestedTagType(e, f) {
  const pin = typeof f === 'string' ? f : f?.pin ?? f?.field
  const found = operandFields(e).find((x) => fieldName(x) === pin)
  return PLC_TYPE[found?.kind] ?? 'Int'
}

/** Rename an instance and the `<old>.<pin>` operands that point at it. Mutates the networks. */
export function renameInstance(block, oldName, newName) {
  const fix = (o, key) => { if (typeof o[key] === 'string' && o[key].startsWith(`${oldName}.`)) o[key] = newName + o[key].slice(oldName.length) }
  const each = (e) => {
    if (e.inst === oldName) e.inst = newName
    for (const f of operandFields(e)) f.pin ? e.args && fix(e.args, f.pin) : fix(e, f.field)
    e.branches?.forEach((l) => l.forEach(each))
  }
  for (const net of block.networks ?? []) { (net.elements ?? []).forEach(each); (net.coils ?? []).forEach(each) }
}
