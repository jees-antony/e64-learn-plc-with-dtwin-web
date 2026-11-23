// Pure helpers for the operands a learner fills in on ladder instructions (no DOM).
import { FB } from './catalog.js'

// Same literal rule as codegen.js, so "known to the editor" and "accepted by the compiler" agree.
const LITERAL = /^(?:[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?|T#[0-9a-zA-Z_.]+|TRUE|FALSE|16#[0-9A-Fa-f]+|'[^']*')$/i
const EDGE_FB = { P: 'R_TRIG', N: 'F_TRIG' }
const has = (c, k) => (c?.has ? c.has(k) : !!c?.includes?.(k))
const slot = (kind) => (kind === 'bool' ? 1 : 0)

// A call box (k: 'call') shows the parameters of the block it calls, so its operands depend on the project.
// The editor installs a resolver (block name -> block); without one a call has no operands.
let resolveBlock = () => null
export function setBlockResolver(fn) { resolveBlock = typeof fn === 'function' ? fn : () => null }
export const pinKind = (type) => (type === 'Bool' ? 'bool' : type === 'Time' ? 'time' : 'any')
/** Parameters of an FB or FC: { inputs, inouts, outputs } each [{ pin, type, kind }]. */
export function callPins(callee) {
  const I = callee?.interface ?? {}
  const list = (vars) => (vars ?? []).map((v) => ({ pin: v.name, type: v.type, kind: pinKind(v.type) }))
  return { inputs: list(I.input), inouts: list(I.inout), outputs: list(I.output) }
}

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
    case 'call': {
      // Inputs, then InOuts, then outputs (left side top to bottom, then right side). An FC needs every
      // parameter connected; an FB keeps its last value, so its inputs and outputs are optional.
      const callee = resolveBlock(e.block); if (!callee) return []
      const p = callPins(callee), fc = callee.kind === 'FC'
      return [
        ...p.inputs.map((x) => ({ pin: x.pin, kind: x.kind, type: x.type, label: x.pin, dir: 'in', ...(fc ? {} : { optional: true }) })),
        ...p.inouts.map((x) => ({ pin: x.pin, kind: x.kind, type: x.type, label: x.pin, dir: 'inout' })),
        ...p.outputs.map((x) => ({ pin: x.pin, kind: x.kind, type: x.type, label: x.pin, dir: 'out', ...(fc ? {} : { optional: true }) })),
      ]
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
    const fb = e.k === 'box' ? e.fb : e.k === 'call' ? e.block : EDGE_FB[e.k]
    if (fb && e.inst && !found.has(e.inst)) found.set(e.inst, fb)
    e.branches?.forEach(walk)
  })
  for (const net of block?.networks ?? []) walk(net.elements)
  return [...found].map(([name, fb]) => ({ name, fb }))
}
/** Output pins of a function block (standard or project FB), for suggestions such as TON_1.Q: [{ pin, kind }]. */
export function pinNames(fb) {
  if (FB[fb]) return Object.entries(FB[fb].out).map(([pin, kind]) => ({ pin, kind }))
  return callPins(resolveBlock(fb)).outputs.map((x) => ({ pin: x.pin, kind: x.kind }))
}

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
  return found?.type ?? PLC_TYPE[found?.kind] ?? 'Int'
}

const OPERAND_KEYS = ['tag', 'a', 'b', 'src', 'dest']
/** Rename a PLC tag everywhere it is used (ladder operands, call parameters, FBD, SCL text, watch tables). Mutates. */
export function renameTag(project, oldName, newName) {
  const word = new RegExp(`\\b${oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')
  const swap = (v) => (v === oldName ? newName : typeof v === 'string' && v.startsWith(`${oldName}.`) ? newName + v.slice(oldName.length) : v)
  const lad = (e) => {
    for (const k of OPERAND_KEYS) if (typeof e[k] === 'string') e[k] = swap(e[k])
    if (e.args) for (const p of Object.keys(e.args)) if (typeof e.args[p] === 'string') e.args[p] = swap(e.args[p])
    e.branches?.forEach((l) => l.forEach(lad))
  }
  const fbd = (n) => { if (!n || typeof n !== 'object') return; if (n.t === 'var') n.name = swap(n.name); n.in?.forEach(fbd); if (n.args) Object.values(n.args).forEach(fbd) }
  for (const b of project.blocks) {
    for (const net of b.networks ?? []) { (net.elements ?? []).forEach(lad); (net.coils ?? []).forEach(lad); fbd(net.expr); if (net.out?.tag) net.out.tag = swap(net.out.tag) }
    if (typeof b.code === 'string') b.code = b.code.replace(word, newName)
  }
  for (const w of project.watch ?? []) w.rows = w.rows.map(swap)
  const t = project.tags.find((x) => x.name === oldName); if (t) t.name = newName
}
/** Rename a block: calls of an FB/FC, instance DBs of an FB, multi-instance types, and calls that use a DB as instance. Mutates. */
export function renameBlock(project, oldName, newName) {
  const each = (e) => { if (e.k === 'call') { if (e.block === oldName) e.block = newName; if (e.inst === oldName) e.inst = newName } e.branches?.forEach((l) => l.forEach(each)) }
  for (const b of project.blocks) {
    if (b.name === oldName) b.name = newName
    if (b.instanceOf === oldName) b.instanceOf = newName
    for (const vars of Object.values(b.interface ?? {})) for (const v of vars) if (v.type === oldName) v.type = newName
    for (const net of b.networks ?? []) (net.elements ?? []).forEach(each)
  }
}

/** Names a learner can type into an empty box ("??"), as in the engineering tool. */
export const BOX_INSTRUCTIONS = [
  ['TON', 'Generate on-delay'], ['TOF', 'Generate off-delay'], ['TP', 'Generate pulse'],
  ['CTU', 'Count up'], ['CTD', 'Count down'], ['SR', 'Set/reset flip-flop'], ['RS', 'Reset/set flip-flop'],
  ['CMP ==', 'Equal'], ['CMP <>', 'Not equal'], ['CMP >', 'Greater than'], ['CMP >=', 'Greater or equal'], ['CMP <', 'Less than'], ['CMP <=', 'Less or equal'],
  ['MOVE', 'Move value'], ['ADD', 'Add'], ['SUB', 'Subtract'], ['MUL', 'Multiply'], ['DIV', 'Divide'],
]
/** Element kind for an empty-box name: 'box:TON', 'cmp:==', 'move', 'math:add', 'call:<block>' or null. */
export function boxKindFor(name, project) {
  const n = String(name ?? '').trim(), up = n.toUpperCase()
  if (FB[up] && !['R_TRIG', 'F_TRIG'].includes(up)) return `box:${up}`
  const cmp = /^CMP\s*(==|<>|>=|<=|>|<)$/i.exec(n); if (cmp) return `cmp:${cmp[1]}`
  if (up === 'MOVE') return 'move'
  if (['ADD', 'SUB', 'MUL', 'DIV'].includes(up)) return `math:${up.toLowerCase()}`
  const blk = project?.blocks.find((b) => (b.kind === 'FB' || b.kind === 'FC') && b.name.toLowerCase() === n.toLowerCase())
  return blk ? `call:${blk.name}` : null
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
