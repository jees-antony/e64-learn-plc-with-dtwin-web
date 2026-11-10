// SPDX-License-Identifier: GPL-3.0-only
// In-browser back end: strucpp's typed AST -> JavaScript closures.
//
// The front end (lexing, parsing, type checking, diagnostics) is the real STruC++ compiler
// running in the browser; this module replaces its C++ code generator with an executable
// closure tree, so no C++ toolchain is needed. Closures (not `eval`) keep the page CSP-safe.
//
// Supported: PROGRAM / FUNCTION / FUNCTION_BLOCK, VAR blocks, TYPE (struct, enum, array,
// subrange, alias), IF / CASE / FOR / WHILE / REPEAT / EXIT / RETURN, FB and function calls
// (named, positional, `=>` outputs), standard functions and conversions, direct addresses.
// Not supported (reported as compile errors): pointers / REF_TO, methods, interfaces,
// properties, inheritance, VAR_IN_OUT on scalars is passed by copy-in / copy-out.

import { callStandard, isStandardFunction } from './stdlib.mjs'
import { ELEMENTARY, INT_BITS, RuntimeError, TIME_LIKE, coerce, defaultValue, parseTimeLiteral } from './values.mjs'

export class CompileError extends Error {
  constructor(message, node) {
    super(message)
    this.line = node?.sourceSpan?.startLine
    this.column = node?.sourceSpan?.startCol
  }
}

const CLASS = { VAR_INPUT: 'input', VAR_OUTPUT: 'output', VAR_IN_OUT: 'inout', VAR: 'local', VAR_TEMP: 'local', VAR_INST: 'local' }
const kindOfType = (t) => (!t ? 'other' : t.kind === 'int' || t.kind === 'real' || t.kind === 'bool' || t.kind === 'time' || t.kind === 'string' ? t.kind : 'other')
function kindOfResolved(t) {
  if (!t || t.typeKind !== 'elementary') return undefined
  const n = String(t.name).toUpperCase()
  if (n === 'BOOL') return { kind: 'bool' }
  if (INT_BITS[n]) return { kind: 'int', bits: INT_BITS[n][0], signed: INT_BITS[n][1], bitwise: /^(BYTE|WORD|DWORD|LWORD)$/.test(n) }
  if (n === 'REAL' || n === 'LREAL') return { kind: 'real' }
  if (TIME_LIKE.has(n)) return { kind: 'time' }
  if (n.includes('STRING')) return { kind: 'string' }
  return undefined
}

/**
 * Link compilation units into an executable program.
 * @param {object[]} units       strucpp CompilationUnit ASTs (user program first)
 * @param {{now: () => number}} services
 */
export function link(units, services) {
  const rt = { now: services.now, budget: 0, depth: 0 }
  const typeDecls = new Map(), typeCache = new Map(), enumMembers = new Map()
  const fbDefs = new Map(), funcDefs = new Map(), progDefs = new Map()
  const globals = {}, globalTypes = new Map()

  for (const u of units) {
    for (const t of u.types ?? []) typeDecls.set(t.name.toUpperCase(), t)
    for (const f of u.functionBlocks ?? []) {
      if (f.methods?.length || f.properties?.length || f.extends) throw new CompileError(`${f.name}: methods, properties and inheritance are not supported by the browser runtime`, f)
      fbDefs.set(f.name.toUpperCase(), { decl: f, name: f.name.toUpperCase() })
    }
    for (const f of u.functions ?? []) funcDefs.set(f.name.toUpperCase(), { decl: f, name: f.name.toUpperCase() })
    for (const p of u.programs ?? []) progDefs.set(p.name.toUpperCase(), { decl: p, name: p.name.toUpperCase() })
  }

  /* ----------------------------------------------------------------- types -- */
  const constEval = (expr) => ce(expr, { vars: new Map() }).f({})
  function typeFromRef(ref) {
    if (ref.isReference || (ref.referenceKind && ref.referenceKind !== 'none')) throw new CompileError('Pointers and references are not supported by the browser runtime', ref)
    if (ref.arrayDimensions?.length) return { kind: 'array', dims: ref.arrayDimensions.map((d) => ({ lo: d.start, hi: d.end })), elem: typeFromName(ref.elementTypeName, ref) }
    return typeFromName(ref.name, ref)
  }
  function typeFromName(name, ref) {
    const up = String(name).toUpperCase()
    if (typeCache.has(up)) return typeCache.get(up)
    if (typeDecls.has(up)) return resolveDecl(up)
    let t
    if (up === 'BOOL') t = { kind: 'bool', name: up }
    else if (INT_BITS[up]) t = { kind: 'int', name: up, bits: INT_BITS[up][0], signed: INT_BITS[up][1] }
    else if (up === 'REAL' || up === 'LREAL') t = { kind: 'real', name: up, bits: up === 'REAL' ? 32 : 64 }
    else if (TIME_LIKE.has(up)) t = { kind: 'time', name: up }
    else if (up === 'STRING' || up === 'WSTRING' || up === 'CHAR' || up === 'WCHAR') t = { kind: 'string', name: up, max: typeof ref?.maxLength === 'number' ? ref.maxLength : undefined }
    else if (fbDefs.has(up)) return fbType(up)
    else if (up.startsWith('__INLINE_ARRAY')) throw new CompileError(`Unresolved array type ${name}`, ref)
    else throw new CompileError(`Type ${name} is not supported by the browser runtime`, ref)
    if (!(up === 'STRING' && ref?.maxLength)) typeCache.set(up, t)
    return t
  }
  function resolveDecl(up) {
    const decl = typeDecls.get(up), def = decl.definition
    let t
    typeCache.set(up, { kind: 'int', name: up, bits: 16, signed: true }) // recursion guard
    if (def.kind === 'StructDefinition') {
      t = { kind: 'struct', name: up, fields: new Map() }
      typeCache.set(up, t)
      for (const f of def.fields) for (const n of f.names) t.fields.set(n.toUpperCase(), typeFromRef(f.type))
      t.inits = def.fields.filter((f) => f.initialValue).flatMap((f) => f.names.map((n) => ({ name: n.toUpperCase(), expr: f.initialValue })))
    } else if (def.kind === 'EnumDefinition') {
      t = { kind: 'enum', name: up, values: [] }
      let next = 0
      for (const m of def.members) {
        const v = m.value ? Number(constEval(m.value)) : next
        next = v + 1
        t.values.push([m.name.toUpperCase(), v])
        enumMembers.set(m.name.toUpperCase(), { value: v, type: t })
        enumMembers.set(`${up}#${m.name.toUpperCase()}`, { value: v, type: t })
      }
      if (def.defaultValue) t.initial = t.values.find(([n]) => n === def.defaultValue.toUpperCase())?.[1] ?? 0
    } else if (def.kind === 'ArrayDefinition') {
      t = { kind: 'array', dims: def.dimensions.map((d) => ({ lo: Number(constEval(d.start)), hi: Number(constEval(d.end)) })), elem: typeFromRef(def.elementType) }
    } else if (def.kind === 'SubrangeDefinition') t = { ...typeFromRef(def.baseType), name: up }
    else t = typeFromRef(def)
    typeCache.set(up, t)
    return t
  }
  function fbType(up) {
    const def = fbDefs.get(up)
    return { kind: 'fb', name: up, def, create: () => instantiate(def) }
  }
  // Resolve a POU's variables once; bodies compile in a second pass.
  function resolveVars(def) {
    if (def.vars) return def
    def.vars = new Map(); def.order = { input: [], output: [], inout: [] }; def.inits = []; def.consts = new Set()
    for (const block of def.decl.varBlocks ?? []) {
      if (block.blockType === 'VAR_EXTERNAL' || block.blockType === 'VAR_GLOBAL') continue
      const cls = CLASS[block.blockType] ?? 'local'
      for (const d of block.declarations) for (const n of d.names) {
        const name = n.toUpperCase(), type = typeFromRef(d.type)
        def.vars.set(name, { type, cls, address: d.address })
        if (cls !== 'local') def.order[cls].push(name)
        if (block.isConstant) def.consts.add(name)
        if (d.initialValue) def.inits.push({ name, type, expr: d.initialValue })
      }
    }
    if (def.decl.kind === 'FunctionDeclaration') def.vars.set(def.name, { type: typeFromRef(def.decl.returnType), cls: 'return' })
    return def
  }
  function instantiate(def) {
    resolveVars(def)
    const o = {}
    for (const [name, v] of def.vars) o[name] = defaultValue(v.type)
    for (const i of def.inits) o[i.name] = initValue(i.type, i.expr, def, o)
    return o
  }
  function initValue(type, expr, def, frame) {
    const scope = { vars: def?.vars ?? new Map() }
    if (expr.kind === 'ArrayLiteralExpression' && type.kind === 'array') {
      const arr = defaultValue(type), flat = []
      const walk = (a) => (Array.isArray(a) ? a.forEach(walk) : flat.push(a))
      expr.elements.forEach((e) => flat.push(initValue(type.elem, e, def, frame)))
      let i = 0
      const fill = (a) => { for (let k = 0; k < a.length && i < flat.length; k++) { if (Array.isArray(a[k])) fill(a[k]); else a[k] = flat[i++] } }
      fill(arr); void walk
      return arr
    }
    if (expr.kind === 'StructInitializerExpression' && type.kind === 'struct') {
      const o = defaultValue(type)
      for (const e of expr.elements) { const ft = type.fields.get(e.name.toUpperCase()); if (ft) o[e.name.toUpperCase()] = initValue(ft, e.value, def, frame) }
      return o
    }
    return coerce(type, ce(expr, scope).f(frame ?? {}))
  }

  /* ------------------------------------------------------------ variables -- */
  function lookup(name, sc, node) {
    const v = sc.vars.get(name)
    if (v) return { type: v.type, get: (f) => f[name], set: (f, x) => { f[name] = x }, constant: sc.consts?.has(name) }
    if (globalTypes.has(name)) return { type: globalTypes.get(name), get: () => globals[name], set: (_f, x) => { globals[name] = x } }
    throw new CompileError(`Unknown variable ${name}`, node)
  }
  function access(e, sc) {
    const name = e.name.toUpperCase()
    let chain = e.accessChain
    if (!chain) chain = [...(e.subscripts?.length ? [{ kind: 'subscript', indices: e.subscripts }] : []), ...(e.fieldAccess ?? []).map((n) => ({ kind: 'field', name: n }))]
    if (!sc.vars.has(name) && !globalTypes.has(name)) {
      const direct = enumMembers.get(name) ?? (chain[0]?.kind === 'field' ? enumMembers.get(`${name}#${chain[0].name.toUpperCase()}`) : undefined)
      if (direct) {
        const used = enumMembers.get(name) ? 0 : 1
        return { type: direct.type, get: () => direct.value, set: () => { throw new CompileError(`${name} is a constant`, e) }, rest: chain.slice(used) }
      }
    }
    const base = lookup(name, sc, e)
    let { type, get } = base
    let parentGet = null, key = null, keyFn = null
    for (const step of chain) {
      if (step.kind === 'field') {
        const fname = step.name.toUpperCase()
        const ft = type.kind === 'struct' ? type.fields.get(fname) : type.kind === 'fb' ? (resolveVars(type.def), type.def.vars.get(fname)?.type) : undefined
        if (!ft) throw new CompileError(`${name} has no member ${step.name}`, e)
        const g = get
        parentGet = g; key = fname; keyFn = null
        get = (f) => g(f)[fname]
        type = ft
      } else if (step.kind === 'subscript') {
        if (type.kind !== 'array') throw new CompileError(`${name} is not an array`, e)
        const idx = step.indices.map((i) => ce(i, sc).f), dims = type.dims, g = get
        const offset = (f) => idx.map((fn, d) => {
          const k = Math.trunc(fn(f)) - dims[d].lo
          if (k < 0 || k > dims[d].hi - dims[d].lo) throw new RuntimeError(`Array index ${k + dims[d].lo} out of range ${dims[d].lo}..${dims[d].hi} in ${name}`)
          return k
        })
        parentGet = (f) => { let a = g(f); const o = offset(f); for (let d = 0; d < o.length - 1; d++) a = a[o[d]]; return a }
        keyFn = (f) => offset(f).at(-1); key = null
        get = (f) => { let a = g(f); for (const k of offset(f)) a = a[k]; return a }
        type = type.elem
      } else throw new CompileError('Pointer dereference is not supported by the browser runtime', e)
    }
    const set = chain.length === 0 ? base.set : (f, v) => { parentGet(f)[keyFn ? keyFn(f) : key] = v }
    return { type, get, set, constant: base.constant && chain.length === 0 }
  }

  /* ---------------------------------------------------------- expressions -- */
  const num = (x) => (typeof x === 'boolean' ? (x ? 1 : 0) : x)
  function ce(e, sc) {
    switch (e.kind) {
      case 'ParenthesizedExpression': return ce(e.expression, sc)
      case 'LiteralExpression': return literal(e)
      case 'VariableExpression': {
        const a = access(e, sc)
        const k = kindOfResolved(e.resolvedType) ?? { kind: kindOfType(a.type) }
        return { f: a.get, ...k, type: a.type }
      }
      case 'UnaryExpression': {
        const o = ce(e.operand, sc), k = kindOfResolved(e.resolvedType) ?? o
        if (e.operator === 'NOT') return o.kind === 'bool' ? { f: (f) => !o.f(f), kind: 'bool' } : { f: (f) => ~num(o.f(f)) & (k.bits >= 32 ? -1 : 2 ** (k.bits ?? 16) - 1), ...k }
        if (e.operator === '-') return { f: (f) => -num(o.f(f)), ...k }
        return o
      }
      case 'BinaryExpression': return binary(e, sc)
      case 'FunctionCallExpression': return call(e, sc, false)
      case 'ArrayLiteralExpression': { const els = e.elements.map((x) => ce(x, sc).f); return { f: (f) => els.map((fn) => fn(f)), kind: 'other' } }
      default: throw new CompileError(`${e.kind.replace('Expression', '')} expressions are not supported by the browser runtime`, e)
    }
  }
  function literal(e) {
    let v = e.value
    switch (e.literalType) {
      case 'BOOL': v = e.value === true || String(e.rawValue).toUpperCase() === 'TRUE'; return { f: () => v, kind: 'bool' }
      case 'INT': return { f: () => Number(v), kind: 'int', bits: 64, signed: true, literal: true }
      case 'REAL': return { f: () => Number(v), kind: 'real' }
      case 'TIME': { const ns = parseTimeLiteral(String(e.rawValue)); return { f: () => ns, kind: 'time' } }
      case 'STRING': case 'WSTRING': { const s = String(v).replace(/^'(.*)'$/s, '$1').replace(/^"(.*)"$/s, '$1'); return { f: () => s, kind: 'string' } }
      case 'NULL': return { f: () => null, kind: 'other' }
      default: return { f: () => 0, kind: 'time' } // DATE / TOD / DT literals are not modelled
    }
  }
  function binary(e, sc) {
    const a = ce(e.left, sc), b = ce(e.right, sc), op = e.operator
    const k = kindOfResolved(e.resolvedType) ?? (a.kind === 'real' || b.kind === 'real' ? { kind: 'real' } : { kind: a.kind === 'other' ? b.kind : a.kind })
    const A = a.f, B = b.f
    switch (op) {
      case 'AND': return a.kind === 'bool' || b.kind === 'bool' ? { f: (f) => !!A(f) && !!B(f), kind: 'bool' } : { f: (f) => Number(BigInt(num(A(f))) & BigInt(num(B(f)))), ...k }
      case 'OR': return a.kind === 'bool' || b.kind === 'bool' ? { f: (f) => !!A(f) || !!B(f), kind: 'bool' } : { f: (f) => Number(BigInt(num(A(f))) | BigInt(num(B(f)))), ...k }
      case 'XOR': return a.kind === 'bool' || b.kind === 'bool' ? { f: (f) => !!A(f) !== !!B(f), kind: 'bool' } : { f: (f) => Number(BigInt(num(A(f))) ^ BigInt(num(B(f)))), ...k }
      case '=': return { f: (f) => A(f) === B(f) || (typeof A(f) !== typeof B(f) && num(A(f)) === num(B(f))), kind: 'bool' }
      case '<>': return { f: (f) => !(A(f) === B(f) || (typeof A(f) !== typeof B(f) && num(A(f)) === num(B(f)))), kind: 'bool' }
      case '<': return { f: (f) => A(f) < B(f), kind: 'bool' }
      case '>': return { f: (f) => A(f) > B(f), kind: 'bool' }
      case '<=': return { f: (f) => A(f) <= B(f), kind: 'bool' }
      case '>=': return { f: (f) => A(f) >= B(f), kind: 'bool' }
      case '+': return { f: (f) => num(A(f)) + num(B(f)), ...k }
      case '-': return { f: (f) => num(A(f)) - num(B(f)), ...k }
      case '*': return { f: (f) => num(A(f)) * num(B(f)), ...k }
      case '**': return { f: (f) => num(A(f)) ** num(B(f)), kind: 'real' }
      case '/': return { f: (f) => { const d = num(B(f)); if (d === 0 && k.kind !== 'real') throw new RuntimeError('Division by zero'); const q = num(A(f)) / d; return k.kind === 'int' ? Math.trunc(q) : q }, ...k }
      case 'MOD': return { f: (f) => { const d = num(B(f)); if (d === 0) throw new RuntimeError('Division by zero'); return num(A(f)) % d }, ...k }
      default: throw new CompileError(`Operator ${op} is not supported`, e)
    }
  }

  /* ---------------------------------------------------------------- calls -- */
  function bindArgs(args, names, sc, typeOf, node) {
    const bound = []
    let pos = 0
    for (const a of args) {
      const name = (a.name ?? names[pos++])?.toUpperCase()
      if (!name) throw new CompileError('Too many arguments in call', node)
      bound.push({ name, out: a.isOutput, expr: a.value, type: typeOf(name, node) })
    }
    return bound
  }
  function call(e, sc, asStatement) {
    const name = e.functionName.toUpperCase()
    const callNode = e
    const variable = e.instance ? undefined : sc.vars.get(name) ?? (globalTypes.has(name) ? { type: globalTypes.get(name) } : undefined)
    if (e.instance || variable?.type?.kind === 'fb') {
      const target = e.instance ? access(e.instance, sc) : lookup(name, sc, e)
      return fbCall(e, target, sc)
    }
    if (funcDefs.has(name)) return funcCall(e, funcDefs.get(name), sc)
    if (isStandardFunction(name)) return stdCall(e, name, sc)
    throw new CompileError(`Function ${e.functionName} is not available in the browser runtime`, callNode)
  }
  function fbCall(e, target, sc) {
    const def = target.type.def
    resolveVars(def)
    const inputs = [...def.order.input, ...def.order.inout], outs = []
    const ins = []
    const bound = bindArgs(e.arguments, inputs, sc, (n, node) => { const v = def.vars.get(n); if (!v) throw new CompileError(`${def.name} has no parameter ${n}`, node); return v.type }, e)
    for (const b of bound) {
      if (b.out) outs.push({ name: b.name, set: access(b.expr, sc).set })
      else ins.push({ name: b.name, type: b.type, f: ce(b.expr, sc).f })
    }
    return {
      kind: 'other',
      f: (fr) => {
        const inst = target.get(fr)
        for (const i of ins) inst[i.name] = coerce(i.type, i.f(fr))
        def.run(inst)
        for (const o of outs) o.set(fr, inst[o.name])
      },
    }
  }
  function funcCall(e, def, sc) {
    resolveVars(def)
    const params = [...def.order.input, ...def.order.inout]
    const bound = bindArgs(e.arguments, params, sc, (n, node) => { const v = def.vars.get(n); if (!v) throw new CompileError(`${def.name} has no parameter ${n}`, node); return v.type }, e)
    const ins = bound.filter((b) => !b.out).map((b) => ({ name: b.name, type: b.type, f: ce(b.expr, sc).f, back: def.vars.get(b.name).cls === 'inout' ? tryAccess(b.expr, sc) : undefined }))
    const outs = bound.filter((b) => b.out).map((b) => ({ name: b.name, set: access(b.expr, sc).set }))
    const ret = def.vars.get(def.name).type
    return {
      ...(kindOfResolved(e.resolvedType) ?? { kind: kindOfType(ret) }),
      f: (fr) => {
        if (++rt.depth > 64) { rt.depth = 0; throw new RuntimeError(`Call depth exceeded in ${def.name}`) }
        try {
          const inst = instantiate(def)
          for (const i of ins) inst[i.name] = coerce(i.type, i.f(fr))
          def.run(inst)
          for (const i of ins) if (i.back) i.back.set(fr, inst[i.name])
          for (const o of outs) o.set(fr, inst[o.name])
          return inst[def.name]
        } finally { rt.depth = Math.max(0, rt.depth - 1) }
      },
    }
  }
  function tryAccess(expr, sc) { return expr.kind === 'VariableExpression' ? access(expr, sc) : undefined }
  function stdCall(e, name, sc) {
    const args = e.arguments.map((a) => ce(a.value, sc))
    const res = kindOfResolved(e.resolvedType) ?? {}
    const info = { bits: res.bits, signed: res.signed, isBool: res.kind === 'bool' || (args[0]?.kind === 'bool' && /^(AND|OR|XOR|NOT)$/.test(name)), isInt: res.kind === 'int', now: rt.now }
    const target = e.resolvedType?.typeKind === 'elementary' ? typeFromName(e.resolvedType.name) : undefined
    return {
      ...res, kind: res.kind ?? args[0]?.kind ?? 'other',
      f: (fr) => {
        const v = callStandard(name, args.map((a) => a.f(fr)), info)
        return target && target.kind !== 'time' ? coerce(target, v) : v
      },
    }
  }

  /* ----------------------------------------------------------- statements -- */
  const EXIT = 1, RETURN = 2
  function block(list, sc) {
    const fns = list.map((s) => cs(s, sc)).filter(Boolean)
    return (f) => { for (let i = 0; i < fns.length; i++) { const r = fns[i](f); if (r) return r } return 0 }
  }
  const tick = () => { if (--rt.budget < 0) throw new RuntimeError('Scan exceeded its loop budget (possible endless loop)') }
  function cs(s, sc) {
    switch (s.kind) {
      case 'AssignmentStatement': {
        const t = access(s.target, sc), v = ce(s.value, sc)
        if (t.constant) throw new CompileError(`Cannot assign to constant ${s.target.name}`, s)
        const type = t.type, copy = type.kind === 'struct' || type.kind === 'array'
        return (f) => { t.set(f, copy ? structuredClone(v.f(f)) : coerce(type, v.f(f))); return 0 }
      }
      case 'IfStatement': {
        const branches = [{ c: ce(s.condition, sc).f, b: block(s.thenStatements, sc) }, ...s.elsifClauses.map((c) => ({ c: ce(c.condition, sc).f, b: block(c.statements, sc) }))]
        const other = block(s.elseStatements ?? [], sc)
        return (f) => { for (const br of branches) if (br.c(f)) return br.b(f); return other(f) }
      }
      case 'CaseStatement': {
        const sel = ce(s.selector, sc).f
        const cases = s.cases.map((c) => ({ labels: c.labels.map((l) => ({ a: ce(l.start, sc).f, b: l.end ? ce(l.end, sc).f : null })), b: block(c.statements, sc) }))
        const other = block(s.elseStatements ?? [], sc)
        return (f) => {
          const v = num(sel(f))
          for (const c of cases) if (c.labels.some((l) => (l.b ? v >= l.a(f) && v <= l.b(f) : v === num(l.a(f))))) return c.b(f)
          return other(f)
        }
      }
      case 'ForStatement': {
        const v = access({ kind: 'VariableExpression', name: s.controlVariable, subscripts: [], fieldAccess: [] }, sc)
        const from = ce(s.start, sc).f, to = ce(s.end, sc).f, by = s.step ? ce(s.step, sc).f : () => 1, body = block(s.body, sc)
        return (f) => {
          const end = to(f), step = by(f)
          if (step === 0) throw new RuntimeError('FOR loop step is zero')
          for (let i = from(f); step > 0 ? i <= end : i >= end; i += step) {
            tick(); v.set(f, coerce(v.type, i))
            const r = body(f)
            if (r === EXIT) break
            if (r === RETURN) return RETURN
          }
          return 0
        }
      }
      case 'WhileStatement': {
        const c = ce(s.condition, sc).f, body = block(s.body, sc)
        return (f) => { while (c(f)) { tick(); const r = body(f); if (r === EXIT) break; if (r === RETURN) return RETURN } return 0 }
      }
      case 'RepeatStatement': {
        const c = ce(s.condition, sc).f, body = block(s.body, sc)
        return (f) => { do { tick(); const r = body(f); if (r === EXIT) break; if (r === RETURN) return RETURN } while (!c(f)); return 0 }
      }
      case 'ExitStatement': return () => EXIT
      case 'ReturnStatement': return () => RETURN
      case 'FunctionCallStatement': { const c = call(s.call, sc, true); return (f) => { c.f(f); return 0 } }
      case 'ExternalCodePragma': return undefined
      default: throw new CompileError(`${s.kind.replace('Statement', '')} statements are not supported by the browser runtime`, s)
    }
  }

  /* -------------------------------------------------------------- globals -- */
  const globalBlocks = [...units.flatMap((u) => u.globalVarBlocks ?? []), ...units.flatMap((u) => (u.configurations ?? []).flatMap((c) => c.varBlocks ?? []))]
  const globalInits = []
  for (const block of globalBlocks) for (const d of block.declarations) for (const n of d.names) {
    const name = n.toUpperCase(), type = typeFromRef(d.type)
    globalTypes.set(name, type)
    globals[name] = defaultValue(type)
    if (d.initialValue) globalInits.push({ name, type, expr: d.initialValue })
  }
  for (const i of globalInits) globals[i.name] = initValue(i.type, i.expr, null, {})

  // Make sure every declared type (and so every enum member) is resolved before bodies compile.
  for (const name of typeDecls.keys()) typeFromName(name)
  for (const def of [...fbDefs.values(), ...funcDefs.values(), ...progDefs.values()]) resolveVars(def)
  // User code compiles now (so errors surface at build time); library bodies compile on first use,
  // so an unsupported function inside an unused library block never blocks the build.
  const userUnit = units[0]
  const isUser = (def) => [...(userUnit.functionBlocks ?? []), ...(userUnit.functions ?? []), ...(userUnit.programs ?? [])].includes(def.decl)
  for (const def of [...fbDefs.values(), ...funcDefs.values(), ...progDefs.values()]) {
    const compileBody = () => {
      const body = block(def.decl.body ?? [], { vars: def.vars, consts: def.consts })
      def.run = (frame) => { body(frame) }
    }
    if (isUser(def)) compileBody()
    else def.run = (frame) => { compileBody(); def.run(frame) }
  }

  /* --------------------------------------------------------------- config -- */
  const config = { tasks: [], instances: [] }
  const resource = units.flatMap((u) => u.configurations ?? []).flatMap((c) => c.resources ?? [])[0]
  const cfgScope = { vars: new Map() }
  if (resource) {
    for (const t of resource.tasks) {
      const p = t.properties instanceof Map ? t.properties : new Map(Object.entries(t.properties ?? {}))
      const interval = p.get('INTERVAL') ?? p.get('interval')
      config.tasks.push({ name: t.name.toUpperCase(), intervalNs: interval ? Number(ce(interval, cfgScope).f({})) : 20e6, priority: p.get('PRIORITY') ? Number(ce(p.get('PRIORITY'), cfgScope).f({})) : 1 })
    }
    for (const i of resource.programInstances) config.instances.push({ name: i.instanceName.toUpperCase(), program: i.programType.toUpperCase(), task: i.taskName?.toUpperCase() })
  } else if (progDefs.size) {
    const first = [...progDefs.keys()][0]
    config.tasks.push({ name: 'DEFAULT', intervalNs: 20e6, priority: 1 })
    config.instances.push({ name: 'INSTANCE0', program: first, task: 'DEFAULT' })
  }
  for (const i of config.instances) if (!progDefs.has(i.program)) throw new CompileError(`Program ${i.program} is not defined`)

  return {
    rt, globals, globalTypes, config,
    programs: progDefs,
    createInstance: (programName) => { const def = progDefs.get(programName); return { def, frame: instantiate(def) } },
  }
}

