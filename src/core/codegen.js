// Project -> one IEC Structured Text source, plus a line map back to blocks and networks.
// LAD and FBD networks are translated here; SCL is passed through. The ST is what the
// in-browser compiler (STruC++) checks and the virtual CPU runs.

import { COMPARE, DEFAULT_PIN, FB, LOGIC, MATH, ST_OP } from './catalog.js'
import { IDENT, iecAddress, iecType } from './model.js'

const LITERAL = /^(?:[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?|T#[0-9a-zA-Z_.]+|TRUE|FALSE|16#[0-9A-Fa-f]+|'[^']*')$/i
const WORD = /[A-Za-z_][A-Za-z0-9_]*/g

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
  return { local, tags: new Set(project.tags.map((t) => t.name)), types }
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
  if (!scope.local.has(t) && !scope.tags.has(t)) err(`Tag "${t}" is not defined`)
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
          const parts = (e.branches ?? []).map((b) => { const f = series(b, 'TRUE'); return f })
          const any = parts.length ? parts.join(' OR ') : 'TRUE'
          const g = parts.length > 1 ? `(${any})` : any
          flow = flow === 'TRUE' ? g : `${flow} AND ${g}`
          break
        }
        case 'move': {
          body.push(`IF ${flow} THEN ${operand(e.dest, scope, err)} := ${operand(e.src, scope, err)}; END_IF;`)
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
    if (!IDENT.test(t.name ?? '')) errors.push({ ...at, message: `Tag name "${t.name}" is not a valid identifier (letters, digits, underscore)` })
    if (seen.has(t.name)) errors.push({ ...at, message: `Tag "${t.name}" is defined twice` })
    seen.add(t.name)
    const a = iecAddress(t.address)
    if (a === null) errors.push({ ...at, message: `Address "${t.address}" of tag "${t.name}" is not valid (examples: %I0.0, %Q0.1, %MW10)` })
    else if (a) { if (addresses.has(a)) errors.push({ ...at, message: `Address ${t.address} is used by more than one tag` }); addresses.add(a) }
  }
  return errors
}

export function generate(project) {
  const out = new Out()
  const errors = [...validateTags(project)]
  const usedTagsByBlock = new Map()
  const blockText = (b) => {
    const scope = scopeOf(project, b)
    const ctx = { instances: new Map(), auto: 0 }
    scope.instances = ctx.instances
    const body = new Out()
    if (b.lang === 'SCL') {
      body.add(b.code ?? '', { block: b.id, scl: true })
    } else {
      (b.networks ?? []).forEach((net, i) => {
        const info = { block: b.id, network: i }
        const err = (message) => errors.push({ where: 'network', block: b.id, network: i, message })
        body.add(`(* Network ${i + 1}${net.title ? `: ${String(net.title).replace(/\*\)/g, '')}` : ''} *)`, info)
        const stmts = b.lang === 'FBD' ? fbdNetwork(net, scope, ctx, err) : ladNetwork(net, scope, ctx, err)
        for (const s of stmts) body.add(s, info)
      })
    }
    // tags referenced by this block
    const text = body.lines.join('\n')
    const used = new Set()
    for (const w of text.replace(/\(\*[\s\S]*?\*\)/g, ' ').replace(/\/\/[^\n]*/g, ' ').match(WORD) ?? []) if (scope.tags.has(w) && !scope.local.has(w)) used.add(w)
    usedTagsByBlock.set(b.id, used)
    return { body, ctx, used }
  }

  const iface = (title, vars, type) => (vars.length ? [`  ${title}`, ...vars.map((v) => `    ${v.name} : ${iecType(v.type)}${v.init !== undefined && v.init !== '' ? ` := ${v.init}` : ''};`), '  END_VAR'] : [])
  const emitBlock = (b) => {
    const { body, ctx, used } = blockText(b)
    const head = b.kind === 'OB' ? `PROGRAM ${b.name}` : b.kind === 'FC' ? `FUNCTION ${b.name} : BOOL` : `FUNCTION_BLOCK ${b.name}`
    const end = b.kind === 'OB' ? 'END_PROGRAM' : b.kind === 'FC' ? 'END_FUNCTION' : 'END_FUNCTION_BLOCK'
    const first = out.lines.length
    out.add(head, { block: b.id, header: true })
    const I = b.interface
    const lines = [
      ...iface('VAR_INPUT', I.input), ...iface('VAR_OUTPUT', I.output), ...iface('VAR_IN_OUT', I.inout),
      ...iface('VAR', [...I.static, ...I.temp]),
      ...(used.size ? ['  VAR_EXTERNAL', ...[...used].map((n) => `    ${n} : ${iecType(project.tags.find((t) => t.name === n).type)};`), '  END_VAR'] : []),
      ...(ctx.instances.size ? ['  VAR', ...[...ctx.instances].map(([n, t]) => `    ${n} : ${t};`), '  END_VAR'] : []),
    ]
    for (const l of lines) out.add(l, { block: b.id, header: true })
    for (let i = 0; i < body.lines.length; i++) { out.lines.push(body.lines[i]); out.info.push({ ...body.info[i], line: i + 1 }) }
    if (b.kind === 'FC') out.add(`  ${b.name} := TRUE;`, { block: b.id })
    out.add(end, { block: b.id })
    out.add('')
    void first
  }

  const names = new Set()
  for (const b of project.blocks) {
    if (!IDENT.test(b.name)) errors.push({ where: 'block', block: b.id, message: `Block name "${b.name}" is not a valid identifier` })
    if (names.has(b.name)) errors.push({ where: 'block', block: b.id, message: `Block "${b.name}" is defined twice` })
    names.add(b.name)
  }
  const ordered = [...project.blocks.filter((b) => b.kind === 'FB'), ...project.blocks.filter((b) => b.kind === 'FC'), ...project.blocks.filter((b) => b.kind === 'OB')]
  for (const b of ordered) emitBlock(b)
  const obs = project.blocks.filter((b) => b.kind === 'OB').sort((a, b) => a.number - b.number)
  if (!obs.length) errors.push({ where: 'project', message: 'The project has no organisation block (OB). Add a "Main" OB.' })

  out.add('CONFIGURATION Config0')
  const globals = project.tags.filter((t) => IDENT.test(t.name))
  if (globals.length) {
    out.add('  VAR_GLOBAL')
    for (const t of globals) {
      const a = iecAddress(t.address)
      out.add(`    ${t.name}${a ? ` AT ${a}` : ''} : ${iecType(t.type)};`, { tag: t.name })
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
