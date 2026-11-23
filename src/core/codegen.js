// Project -> one IEC Structured Text source, plus a line map back to blocks and networks.
// LAD and FBD networks are translated here; SCL is passed through. The ST is what the
// in-browser compiler (STruC++) checks and the virtual CPU runs.

import { COMPARE, DEFAULT_PIN, FB, LOGIC, MATH, ST_OP } from './catalog.js'
import { IDENT, TYPES, iecAddress, iecType } from './model.js'
import { callPins } from './operands.js'
import { checkType, validateInterfaces } from './types.js'
import { validateLadderNetwork } from './ladder-edit.js'

const LITERAL = /^(?:[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?|T#[0-9a-zA-Z_.]+|TRUE|FALSE|16#[0-9A-Fa-f]+|'[^']*')$/i
const WORD = /[A-Za-z_][A-Za-z0-9_]*/g
const NUMERIC = new Set(['SINT', 'INT', 'DINT', 'USINT', 'UINT', 'UDINT', 'REAL', 'LREAL', 'BYTE', 'WORD', 'DWORD'])

class Out {
  constructor() { this.lines = []; this.info = [] }
  add(text, info) { for (const l of String(text).split('\n')) { this.lines.push(l); this.info.push(info ?? null) } }
  get text() { return this.lines.join('\n') + '\n' }
}

/** Names visible in a block: tags + interface variables (interface wins). */
function scopeOf(project, block) {
  const local = new Set(Object.values(block.interface).flat().map((v) => v.name))
  const types = new Map(project.tags.map((t) => [t.name, iecType(t.type)]))
  for (const v of Object.values(block.interface).flat()) types.set(v.name, iecType(v.type))
  // Global DBs: name -> (VARIABLE -> IEC type). Instance DBs: name -> FB they belong to.
  const dbs = new Map(project.blocks.filter((b) => b.kind === 'DB' && !b.instanceOf).map((d) => [d.name, new Map((d.interface?.static ?? []).map((v) => [v.name.toUpperCase(), iecType(v.type)]))]))
  const instanceDbs = new Map(project.blocks.filter((b) => b.kind === 'DB' && b.instanceOf).map((d) => [d.name, d.instanceOf]))
  return { local, tags: new Set(project.tags.map((t) => t.name)), types, project, block, dbs, instanceDbs }
}

/** Declared IEC type name (upper case) of a tag or interface variable, or null when unknown. */
function typeOfName(scope, t) {
  return scope.types?.get(t) ?? null
}
function bool(text, scope, err) {
  const t = operand(text, scope, err)
  const ty = typeOfName(scope, String(text).trim())
  if (ty && ty !== 'BOOL') err(`"${String(text).trim()}" is ${ty}; a contact or coil needs a Bool tag`)
  return t
}

function operand(text, scope, err) {
  const t = String(text ?? '').trim()
  if (t === '') { err('Operand is missing'); return '0' }
  if (LITERAL.test(t)) return t
  const dotted = /^([A-Za-z_]\w*)\.([A-Za-z_]\w*)$/.exec(t)
  if (dotted && scope.instances?.has(dotted[1])) return t
  if (dotted && scope.local?.has(dotted[1])) return t   // a multi-instance (Static of an FB type): Inst.Out
  if (dotted && scope.dbs?.has(dotted[1])) {
    if (!scope.dbs.get(dotted[1]).has(dotted[2].toUpperCase())) err(`Data block "${dotted[1]}" has no variable "${dotted[2]}"`)
    return t
  }
  if (dotted && scope.instanceDbs?.has(dotted[1])) err(`"${dotted[1]}" is the instance data block of a ${scope.instanceDbs.get(dotted[1])} call in another block. Use its values in the block that makes the call.`)
  else if (dotted) err(`Tag "${t}" is not defined: this block has no timer, counter or data block named "${dotted[1]}"`)
  else if (!scope.local.has(t) && !scope.tags.has(t)) err(`Tag "${t}" is not defined`)
  return t
}

/* ------------------------------------------------------------------- LAD -- */
function ladNetwork(net, scope, ctx, err) {
  const pre = [], body = []
  const inst = (fb, wanted) => {
    let name = wanted && IDENT.test(wanted) ? wanted : `${fb}_${++ctx.auto}`
    if (!ctx.instances.has(name)) ctx.instances.set(name, fb)
    else if (ctx.instances.get(name) !== fb) err(`Instance "${name}" is already used by a ${ctx.instances.get(name)}`)
    return name
  }
  const series = (els, flowIn) => {
    let flow = flowIn
    for (const e of els ?? []) {
      switch (e.k) {
        case 'NO': flow = flow === 'TRUE' ? bool(e.tag, scope, err) : `${flow} AND ${bool(e.tag, scope, err)}`; break
        case 'NC': flow = flow === 'TRUE' ? `NOT ${bool(e.tag, scope, err)}` : `${flow} AND NOT ${bool(e.tag, scope, err)}`; break
        case 'P': case 'N': {
          const i = inst(e.k === 'P' ? 'R_TRIG' : 'F_TRIG', e.inst)
          pre.push(`${i}(CLK := ${bool(e.tag, scope, err)});`)
          flow = flow === 'TRUE' ? `${i}.Q` : `${flow} AND ${i}.Q`
          break
        }
        case 'cmp': {
          if (!COMPARE.includes(e.op)) err(`Unknown comparison ${e.op}`)
          const c = `(${operand(e.a, scope, err)} ${ST_OP[e.op] ?? '='} ${operand(e.b, scope, err)})`
          flow = flow === 'TRUE' ? c : `${flow} AND ${c}`
          break
        }
        case 'branch': {
          const parts = (e.branches ?? []).map((b) => series(b, flow))
          const any = parts.length ? parts.join(' OR ') : 'TRUE'
          const g = parts.length > 1 ? `(${any})` : any
          flow = flow === 'TRUE' ? g : `${flow} AND ${g}`
          break
        }
        case 'move': {
          body.push(`IF ${flow} THEN ${operand(e.dest, scope, err)} := ${operand(e.src, scope, err)}; END_IF;`)
          break
        }
        case 'math': {
          const a = operand(e.a, scope, err), b = operand(e.b, scope, err)
          if (!['add', 'sub', 'mul', 'div'].includes(e.op)) { err(`Unknown math operation ${e.op}`); break }
          if (e.op === 'div' && /^[-+]?0+(?:\.0*)?$/.test(String(e.b ?? '').trim())) err('Division by zero: the divisor is 0')
          const d = String(e.dest ?? '').trim()
          if (d === '') { err('Operand is missing: choose a tag to store the result in'); break }
          if (LITERAL.test(d) || /\./.test(d)) { err(`The result must be stored in a tag, not in "${d}"`); break }
          const dest = operand(d, scope, err), ty = typeOfName(scope, d)
          if (ty && !NUMERIC.has(ty)) err(`"${d}" is ${ty}; the result of a calculation needs a number tag (Int, DInt, Real ...)`)
          body.push(`IF ${flow} THEN ${dest} := ${a} ${MATH[e.op]} ${b}; END_IF;`)
          break
        }
        case 'box': {
          const def = FB[e.fb]
          if (!def) { err(`Unknown instruction ${e.fb}`); break }
          const i = inst(e.fb, e.inst)
          const args = [`${def.flowIn} := ${flow}`]
          for (const [pin, kind] of Object.entries(def.in)) {
            if (pin === def.flowIn) continue
            const v = e.args?.[pin]
            args.push(`${pin} := ${v === undefined || v === '' ? DEFAULT_PIN[kind] : operand(v, scope, err)}`)
          }
          pre.push(`${i}(${args.join(', ')});`)
          flow = `${i}.${def.flowOut}`
          break
        }
        case 'call': {
          // Block call with EN / ENO: the block runs while EN has power; ENO follows EN, so the rung continues unchanged.
          const callee = scope.project?.blocks.find((b) => (b.kind === 'FB' || b.kind === 'FC') && b.name === e.block)
          if (!callee) { err(`Block "${e.block}" does not exist any more. Delete this call or create the block.`); break }
          if (callee.id === scope.block.id) { err(`${callee.name} cannot call itself.`); break }
          const pins = callPins(callee), args = []
          const valueOf = (p) => String(e.args?.[p] ?? '').trim()
          for (const p of pins.inputs) {
            const v = valueOf(p.pin)
            if (v) args.push(`${p.pin} := ${operand(v, scope, err)}`)
            else if (callee.kind === 'FC') err(`Input "${p.pin}" of ${callee.name} is not connected. Every parameter of a function (FC) needs a value.`)
          }
          for (const p of pins.inouts) {
            const v = valueOf(p.pin)
            if (!v) err(`InOut "${p.pin}" of ${callee.name} is not connected. Connect it to a tag.`)
            else if (LITERAL.test(v)) err(`InOut "${p.pin}" of ${callee.name} needs a tag, not the constant ${v}.`)
            else args.push(`${p.pin} := ${operand(v, scope, err)}`)
          }
          for (const p of pins.outputs) {
            const v = valueOf(p.pin)
            if (!v) { if (callee.kind === 'FC') err(`Output "${p.pin}" of ${callee.name} is not connected. Every parameter of a function (FC) needs a tag.`); continue }
            if (LITERAL.test(v)) { err(`Output "${p.pin}" of ${callee.name} needs a tag to write to, not the constant ${v}.`); continue }
            args.push(`${p.pin} => ${operand(v, scope, err)}`)
          }
          let target = callee.name
          if (callee.kind === 'FB') {
            target = String(e.inst ?? '').trim()
            if (!IDENT.test(target)) { err(`The call of ${callee.name} has no instance. Delete it and drag the FB from the project tree again.`); break }
            if (e.multi) {
              const v = (scope.block.interface.static ?? []).find((x) => x.name === target)
              if (!v) err(`Multi-instance "${target}" is missing from the Static section of ${scope.block.name}.`)
              else if (String(v.type).toUpperCase() !== callee.name.toUpperCase()) err(`Multi-instance "${target}" is declared as ${v.type}, not as ${callee.name}.`)
            } else {
              const db = scope.project.blocks.find((b) => b.kind === 'DB' && b.name === target)
              if (!db) err(`Instance data block "${target}" does not exist. Delete the call and drag ${callee.name} in again.`)
              else if (db.instanceOf !== callee.name) err(`"${target}" is not an instance data block of ${callee.name}.`)
              if (!ctx.instances.has(target)) ctx.instances.set(target, callee.name)
              if (ctx.main && scope.dbUse) scope.dbUse.set(target, [...(scope.dbUse.get(target) ?? []), scope.block.name])
            }
          }
          const call = `${target}(${args.join(', ')});`
          pre.push(flow === 'TRUE' ? call : `IF ${flow} THEN ${call} END_IF;`)
          break
        }
        case 'empty': err('Empty box: click "??" and type the name of an instruction or block.'); break
        default: err(`Unknown element ${e.k}`)
      }
    }
    return flow
  }
  const flow = series(net.elements, 'TRUE')
  const stmts = [...pre]
  for (const c of net.coils ?? []) {
    const t = bool(c.tag, scope, err)
    if (c.k === 'coil') stmts.push(`${t} := ${flow};`)
    else if (c.k === 'ncoil') stmts.push(`${t} := NOT (${flow});`)
    else if (c.k === 'set') stmts.push(`IF ${flow} THEN ${t} := TRUE; END_IF;`)
    else if (c.k === 'reset') stmts.push(`IF ${flow} THEN ${t} := FALSE; END_IF;`)
    else err(`Unknown coil ${c.k}`)
  }
  return [...stmts, ...body]
}

/* ------------------------------------------------------------------- FBD -- */
function fbdNetwork(net, scope, ctx, err) {
  const pre = []
  const inst = (fb, wanted) => {
    const name = wanted && IDENT.test(wanted) ? wanted : `${fb}_${++ctx.auto}`
    if (!ctx.instances.has(name)) ctx.instances.set(name, fb)
    return name
  }
  const ex = (n) => {
    if (!n) return null
    switch (n.t) {
      case 'var': return operand(n.name, scope, err)
      case 'not': return `NOT (${ex(n.in?.[0]) ?? 'FALSE'})`
      case 'and': case 'or': case 'xor': return `(${(n.in ?? []).map((x) => ex(x) ?? 'FALSE').join(` ${LOGIC[n.t]} `) || 'FALSE'})`
      case 'cmp': return `(${ex(n.in?.[0]) ?? '0'} ${ST_OP[n.op] ?? '='} ${ex(n.in?.[1]) ?? '0'})`
      case 'add': case 'sub': case 'mul': case 'div': case 'mod': return `(${(n.in ?? []).map((x) => ex(x) ?? '0').join(` ${MATH[n.t]} `) || '0'})`
      case 'fb': {
        const def = FB[n.fb]
        if (!def) { err(`Unknown instruction ${n.fb}`); return 'FALSE' }
        const i = inst(n.fb, n.inst)
        const args = Object.entries(def.in).map(([pin, kind]) => `${pin} := ${ex(n.args?.[pin]) ?? DEFAULT_PIN[kind]}`)
        pre.push(`${i}(${args.join(', ')});`)
        return `${i}.${n.out && def.out[n.out] ? n.out : def.flowOut}`
      }
      default: err(`Unknown box ${n.t}`); return 'FALSE'
    }
  }
  const stmts = []
  if (!net.expr || !net.out?.tag) return stmts
  const value = ex(net.expr)
  const t = operand(net.out.tag, scope, err)
  stmts.push(...pre)
  if (net.out.mode === 'S') stmts.push(`IF ${value} THEN ${t} := TRUE; END_IF;`)
  else if (net.out.mode === 'R') stmts.push(`IF ${value} THEN ${t} := FALSE; END_IF;`)
  else stmts.push(`${t} := ${value};`)
  return stmts
}

/* ------------------------------------------------------------- the whole -- */
export function validateTags(project) {
  const errors = [], seen = new Set(), addresses = new Set()
  for (const t of project.tags) {
    const at = { where: 'tags', tag: t.name }
    const type = checkType(project, t.type)
    if (!type.ok) errors.push({ ...at, field: 'type', message: `${t.name}: ${type.message}` })
    if (!IDENT.test(t.name ?? '')) errors.push({ ...at, message: `Tag name "${t.name}" is not a valid identifier (letters, digits, underscore)` })
    if (seen.has(t.name)) errors.push({ ...at, message: `Tag "${t.name}" is defined twice` })
    seen.add(t.name)
    const a = iecAddress(t.address)
    if (a === null) errors.push({ ...at, message: `Address "${t.address}" of tag "${t.name}" is not valid (examples: %I0.0, %Q0.1, %MW10)` })
    else if (a) { if (addresses.has(a)) errors.push({ ...at, message: `Address ${t.address} is used by more than one tag` }); addresses.add(a) }
  }
  return errors
}

/** Instances a LAD/FBD block declares, found before generation so pins like T1.Q resolve from any network. */
function instancesOf(b, scope) {
  const ctx = { instances: new Map(), auto: 0 }
  for (const net of b.networks ?? []) (b.lang === 'FBD' ? fbdNetwork : ladNetwork)(net, scope, ctx, () => {})
  return ctx.instances
}

export function generate(project) {
  const out = new Out()
  const errors = [...validateTags(project), ...validateInterfaces(project)]
  const usedTagsByBlock = new Map()
  const dbUse = new Map()   // instance DB name -> blocks whose calls use it
  const blockText = (b) => {
    const scope = scopeOf(project, b)
    scope.dbUse = dbUse
    const ctx = { instances: new Map(), auto: 0, main: true }
    scope.instances = b.lang === 'SCL' ? ctx.instances : instancesOf(b, scope)
    const body = new Out()
    if (b.lang === 'SCL') {
      body.add(b.code ?? '', { block: b.id, scl: true })
    } else {
      (b.networks ?? []).forEach((net, i) => {
        const info = { block: b.id, network: i }
        const err = (message) => errors.push({ where: 'network', block: b.id, network: i, message })
        if (b.lang === 'LAD') for (const issue of validateLadderNetwork(net)) errors.push({ where: 'network', block: b.id, network: i, ...issue })
        body.add(`(* Network ${i + 1}${net.title ? `: ${String(net.title).replace(/\*\)/g, '')}` : ''} *)`, info)
        const stmts = b.lang === 'FBD' ? fbdNetwork(net, scope, ctx, err) : ladNetwork(net, scope, ctx, err)
        for (const s of stmts) body.add(s, info)
      })
    }
    // tags referenced by this block
    const text = body.lines.join('\n')
    const used = new Set(), usedDbs = new Set()
    for (const w of text.replace(/\(\*[\s\S]*?\*\)/g, ' ').replace(/\/\/[^\n]*/g, ' ').match(WORD) ?? []) {
      if (scope.tags.has(w) && !scope.local.has(w)) used.add(w)
      if (scope.dbs.has(w) && !scope.local.has(w)) usedDbs.add(w)
    }
    usedTagsByBlock.set(b.id, used)
    return { body, ctx, used, usedDbs }
  }

  const iface = (title, vars, type) => (vars.length ? [`  ${title}`, ...vars.map((v) => `    ${v.name} : ${iecType(v.type)}${v.init !== undefined && v.init !== '' ? ` := ${v.init}` : ''};`), '  END_VAR'] : [])
  const emitBlock = (b) => {
    const { body, ctx, used, usedDbs } = blockText(b)
    const head = b.kind === 'OB' ? `PROGRAM ${b.name}` : b.kind === 'FC' ? `FUNCTION ${b.name} : BOOL` : `FUNCTION_BLOCK ${b.name}`
    const end = b.kind === 'OB' ? 'END_PROGRAM' : b.kind === 'FC' ? 'END_FUNCTION' : 'END_FUNCTION_BLOCK'
    const first = out.lines.length
    out.add(head, { block: b.id, header: true })
    const I = b.interface
    const lines = [
      ...iface('VAR_INPUT', I.input), ...iface('VAR_OUTPUT', I.output), ...iface('VAR_IN_OUT', I.inout),
      ...iface('VAR', [...I.static, ...I.temp]),
      ...(used.size || usedDbs.size ? ['  VAR_EXTERNAL', ...[...used].map((n) => `    ${n} : ${iecType(project.tags.find((t) => t.name === n).type)};`), ...[...usedDbs].map((n) => `    ${n} : ${n}_T;`), '  END_VAR'] : []),
      ...(ctx.instances.size ? ['  VAR', ...[...ctx.instances].map(([n, t]) => `    ${n} : ${t};`), '  END_VAR'] : []),
    ]
    for (const l of lines) out.add(l, { block: b.id, header: true })
    for (let i = 0; i < body.lines.length; i++) { out.lines.push(body.lines[i]); out.info.push({ ...body.info[i], line: i + 1 }) }
    if (b.kind === 'FC') out.add(`  ${b.name} := TRUE;`, { block: b.id })
    out.add(end, { block: b.id })
    out.add('')
    void first
  }

  const names = new Set(), tagNames = new Set(project.tags.map((t) => t.name.toUpperCase()))
  for (const b of project.blocks) {
    if (!IDENT.test(b.name)) errors.push({ where: 'block', block: b.id, message: `Block name "${b.name}" is not a valid identifier` })
    if (names.has(b.name.toUpperCase())) errors.push({ where: 'block', block: b.id, message: `Block "${b.name}" is defined twice` })
    if (tagNames.has(b.name.toUpperCase())) errors.push({ where: 'block', block: b.id, message: `"${b.name}" is the name of a block and of a PLC tag. Rename one of them.` })
    names.add(b.name.toUpperCase())
  }

  /* data blocks: a global DB becomes a STRUCT type plus a global variable; an instance DB is declared by its call */
  const globalDbs = project.blocks.filter((b) => b.kind === 'DB' && !b.instanceOf)
  for (const d of project.blocks.filter((b) => b.kind === 'DB')) {
    if (d.instanceOf && !project.blocks.some((b) => b.kind === 'FB' && b.name === d.instanceOf)) errors.push({ where: 'block', block: d.id, message: `Instance data block "${d.name}" belongs to FB "${d.instanceOf}", which no longer exists.` })
    for (const v of d.instanceOf ? [] : d.interface?.static ?? []) {
      if (!IDENT.test(v.name)) errors.push({ where: 'block', block: d.id, message: `${d.name}: "${v.name}" is not a valid variable name` })
      if (!TYPES.some((t) => t.toUpperCase() === String(v.type).toUpperCase())) errors.push({ where: 'block', block: d.id, message: `${d.name}.${v.name}: a data block variable needs a basic data type (Bool, Int, Real, Time …)` })
    }
  }
  for (const d of globalDbs) {
    const vars = d.interface?.static ?? []
    if (!vars.length) continue
    out.add('TYPE', { block: d.id, header: true })
    out.add(`  ${d.name}_T : STRUCT`, { block: d.id, header: true })
    for (const v of vars) out.add(`    ${v.name} : ${iecType(v.type)};`, { block: d.id, header: true })
    out.add('  END_STRUCT;', { block: d.id, header: true })
    out.add('END_TYPE', { block: d.id, header: true })
    out.add('')
  }

  /* code blocks: a called FB / FC is emitted before its callers; calls in a loop are refused */
  const code = project.blocks.filter((b) => b.kind === 'FB' || b.kind === 'FC')
  const byName = new Map(code.map((b) => [b.name.toUpperCase(), b]))
  const depsOf = (b) => {
    const d = new Set(), add = (n) => { const k = String(n ?? '').toUpperCase(); if (byName.has(k)) d.add(k) }
    const walk = (list) => (list ?? []).forEach((e) => { if (e.k === 'call') add(e.block); e.branches?.forEach(walk) })
    for (const n of b.networks ?? []) walk(n.elements)
    for (const vars of Object.values(b.interface ?? {})) for (const v of vars) add(v.type)
    if (typeof b.code === 'string') for (const w of b.code.match(WORD) ?? []) if (w.toUpperCase() !== b.name.toUpperCase()) add(w)
    return d
  }
  const order = [], mark = new Map()
  const visit = (b, chain) => {
    const k = b.name.toUpperCase()
    if (mark.get(k) === 'done') return
    if (mark.get(k) === 'busy') { errors.push({ where: 'block', block: b.id, message: `Blocks call each other in a loop: ${[...chain, b.name].join(' → ')}. A block must not call itself, directly or through another block.` }); return }
    mark.set(k, 'busy')
    for (const dk of depsOf(b)) visit(byName.get(dk), [...chain, b.name])
    mark.set(k, 'done'); order.push(b)
  }
  for (const b of code) visit(b, [])
  const ordered = [...order, ...project.blocks.filter((b) => b.kind === 'OB')]
  for (const b of ordered) emitBlock(b)
  for (const [name, users] of dbUse) {
    if (users.length > 1) errors.push({ where: 'block', block: project.blocks.find((b) => b.name === name)?.id, message: `Instance data block "${name}" is used by ${users.length} calls (${users.join(', ')}). Every call of an FB needs its own instance data block.` })
  }
  const obs = project.blocks.filter((b) => b.kind === 'OB').sort((a, b) => a.number - b.number)
  if (!obs.length) errors.push({ where: 'project', message: 'The project has no organisation block (OB). Add a "Main" OB.' })

  out.add('CONFIGURATION Config0')
  const globals = project.tags.filter((t) => IDENT.test(t.name))
  const dbGlobals = globalDbs.filter((d) => IDENT.test(d.name) && (d.interface?.static ?? []).length)
  if (globals.length || dbGlobals.length) {
    out.add('  VAR_GLOBAL')
    for (const t of globals) {
      const a = iecAddress(t.address)
      out.add(`    ${t.name}${a ? ` AT ${a}` : ''} : ${iecType(t.type)};`, { tag: t.name })
    }
    for (const d of dbGlobals) {
      const inits = d.interface.static.filter((v) => v.init !== undefined && String(v.init).trim() !== '').map((v) => `${v.name} := ${String(v.init).trim()}`)
      out.add(`    ${d.name} : ${d.name}_T${inits.length ? ` := (${inits.join(', ')})` : ''};`, { block: d.id })
    }
    out.add('  END_VAR')
  }
  out.add('  RESOURCE Res0 ON PLC')
  out.add(`    TASK task0(INTERVAL := T#${Math.max(1, Number(project.plc.cycleMs) || 10)}ms, PRIORITY := 1);`)
  for (const b of obs) out.add(`    PROGRAM inst_${b.name} WITH task0 : ${b.name};`)
  out.add('  END_RESOURCE')
  out.add('END_CONFIGURATION')
  return { source: out.text, info: out.info, errors }
}

/** Translate a compiler diagnostic (line in the generated ST) to a block / network. */
export function locate(gen, line) {
  const info = gen.info[line - 1]
  if (!info) return null
  return { block: info.block, network: info.network, line: info.line, tag: info.tag }
}
