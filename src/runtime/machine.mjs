// SPDX-License-Identifier: GPL-3.0-only
// The virtual PLC: cyclic tasks, forcing, and the editor's debug-map addressing.

import { link } from './compiler.mjs'
import { RuntimeError, decodeWire, encodeWire } from './values.mjs'

const LOOP_BUDGET = 2_000_000
const packAddr = (arr, elem) => ((arr & 0xff) << 16) | (elem & 0xffff)

export class Machine {
  /**
   * @param {object[]} units      ASTs to link (user program + library sources)
   * @param {object} debugMap     strucpp DebugMapV2 (leaf paths -> packed addresses)
   * @param {{clock?: () => number}} options   clock returns nanoseconds
   */
  constructor(units, debugMap, options = {}) {
    this.units = units
    this.leaves = new Map((debugMap?.leaves ?? []).map((l) => [packAddr(l.arrayIdx, l.elemIdx), l]))
    this.clock = options.clock ?? (() => performance.now() * 1e6)
    this.forces = new Map()
    this.stopListeners = new Set()
    this.running = false
    this.scanCount = 0
    this.error = null
    this.timer = null
    this.paths = new Map()
  }

  /** Link a fresh copy of the program: every start begins from initial values. */
  reset() {
    this.t0 = this.clock()
    this.program = link(this.units, { now: () => this.clock() - this.t0 })
    this.instances = new Map(this.program.config.instances.map((i) => [i.name, this.program.createInstance(i.program)]))
    this.tasks = this.program.config.tasks.map((t) => ({ ...t, next: 0, instances: this.program.config.instances.filter((i) => i.task === t.name).map((i) => this.instances.get(i.name)) }))
      .sort((a, b) => a.priority - b.priority)
    this.paths.clear()
    this.scanCount = 0
    this.error = null
  }

  start() {
    if (this.running) return
    this.reset()
    this.running = true
    this.timer = setInterval(() => this.step(), 1)
  }

  stop(reason) {
    this.running = false
    clearInterval(this.timer)
    this.timer = null
    for (const cb of this.stopListeners) cb(reason)
  }

  /** Values by IEC name (case-insensitive): tags live in globals, block statics in `frameOf`. */
  get globals() { return this.program?.globals ?? {} }
  readGlobal(name) { return this.globals[String(name).toUpperCase()] }
  writeGlobal(name, value) { this.globals[String(name).toUpperCase()] = value }
  frameOf(block) { return this.instances?.get(`INST_${String(block).toUpperCase()}`)?.frame }

  onStopped(cb) { this.stopListeners.add(cb); return () => this.stopListeners.delete(cb) }

  /** Run every task that is due at `nowNs` (the host clock when omitted). Returns the scans executed. */
  step(nowNs = this.clock() - this.t0) {
    let ran = 0
    try {
      for (const t of this.tasks) {
        if (nowNs < t.next) continue
        t.next = nowNs - t.next > 5 * t.intervalNs ? nowNs + t.intervalNs : Math.max(t.next, nowNs - t.intervalNs) + t.intervalNs
        this.program.rt.budget = LOOP_BUDGET
        this.applyForces()
        for (const inst of t.instances) inst.def.run(inst.frame)
        this.applyForces()
        this.scanCount++
        ran++
      }
    } catch (e) {
      this.error = e instanceof RuntimeError ? e.message : `Runtime fault: ${e?.message ?? e}`
      this.stop(this.error)
    }
    return ran
  }

  /* ------------------------------------------------------- leaf addressing -- */
  /** Resolve `INSTANCE0.T.IN` / `ARR[2]` style debug paths to a getter/setter. */
  resolve(packed) {
    if (this.paths.has(packed)) return this.paths.get(packed)
    const leaf = this.leaves.get(packed)
    if (!leaf) return undefined
    const segments = leaf.path.split(/\.(?![^[]*\])/)
    const inst = this.instances.get(segments[0].toUpperCase())
    let root, type
    const chain = []
    const typeOfVar = (name) => (inst ? inst.def.vars.get(name)?.type : this.program.globalTypes.get(name))
    if (inst) { root = inst.frame; segments.shift() } else root = this.program.globals
    let current = null
    for (const seg of segments) {
      const m = /^([^[]+)(.*)$/.exec(seg), key = m[1].toUpperCase()
      if (current === null) type = typeOfVar(key)
      else type = current.kind === 'struct' ? current.fields.get(key) : current.kind === 'fb' ? current.def.vars.get(key)?.type : undefined
      chain.push({ key })
      for (const b of m[2].matchAll(/\[([^\]]+)\]/g)) {
        const dims = type?.kind === 'array' ? type.dims : []
        chain.push({ idx: b[1].split(',').map((x, d) => Number(x.trim()) - (dims[d]?.lo ?? 0)) })
        if (type?.kind === 'array') type = type.elem
      }
      current = type
    }
    const step = (v, c) => (c.key !== undefined ? v[c.key] : c.idx.reduce((a, i) => a[i], v))
    const get = () => chain.reduce(step, root)
    const set = (value) => {
      const parent = chain.slice(0, -1).reduce(step, root), last = chain.at(-1)
      if (last.key !== undefined) parent[last.key] = value
      else { const arr = last.idx.slice(0, -1).reduce((a, i) => a[i], parent); arr[last.idx.at(-1)] = value }
    }
    const r = { leaf, get, set }
    this.paths.set(packed, r)
    return r
  }

  /** Values for `indexes`, packed little-endian in request order (the debug wire format). */
  readValues(indexes) {
    const parts = []
    for (const index of indexes) {
      const r = this.resolve(index)
      if (!r) { parts.push(new Uint8Array(0)); continue }
      let value
      try { value = r.get() } catch { value = 0 }
      parts.push(encodeWire(r.leaf.type, r.leaf.size, value))
    }
    const data = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let off = 0
    for (const p of parts) { data.set(p, off); off += p.length }
    return { tick: this.scanCount, lastIndex: Math.max(0, indexes.length - 1), data }
  }

  force(index, enabled, bytes) {
    const r = this.resolve(index)
    if (!r) return { success: false, error: 'Unknown variable' }
    if (!enabled) { this.forces.delete(index); return { success: true } }
    if (!bytes) return { success: false, error: 'Missing value' }
    this.forces.set(index, decodeWire(r.leaf.type, bytes))
    this.applyForces()
    return { success: true }
  }

  applyForces() {
    for (const [index, value] of this.forces) { try { this.resolve(index)?.set(value) } catch { /* path not live */ } }
  }
}
