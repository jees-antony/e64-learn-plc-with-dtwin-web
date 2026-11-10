// SPDX-License-Identifier: GPL-3.0-only
// Compile pipeline of the browser PLC:
//   ST text -> strucpp.compile() (parse + type check, runs in the browser) -> typed AST
//   -> Machine (closures) -> cyclic execution.

import { compile, parse } from 'strucpp'

import { Machine } from './machine.mjs'

const libraryUnits = new Map()
/** Parse the ST sources shipped inside .stlib archives (TON, CTU, R_TRIG ... are plain ST). */
function unitsOf(archive) {
  const key = `${archive.manifest.name}@${archive.manifest.version}`
  if (!libraryUnits.has(key)) {
    libraryUnits.set(key, (archive.sources ?? []).map((s) => {
      const r = parse(s.source)
      if (!r.ast) throw new Error(`Library ${archive.manifest.name}/${s.fileName}: ${r.errors[0]?.message ?? 'parse error'}`)
      return r.ast
    }))
  }
  return libraryUnits.get(key)
}

/**
 * @param {string} programSt        whole-project Structured Text (from the project transpiler)
 * @param {object[]} libraries      StlibArchive objects (standard function blocks etc.)
 * @returns {{ok: true, machine: Machine, debugMap: object, warnings: object[]} | {ok: false, errors: object[]}}
 */
export function buildMachine(programSt, libraries = [], options = {}) {
  const result = compile(programSt, { debug: true, libraries })
  const errors = result.errors ?? []
  if (!result.success || !result.ast) return { ok: false, errors: errors.length ? errors : [{ message: 'Compilation failed', line: 1, column: 1, severity: 'error' }] }
  const units = [result.ast, ...libraries.flatMap(unitsOf)]
  const machine = new Machine(units, result.debugMap, options)
  try {
    machine.reset() // links now so unsupported constructs are reported as compile errors
  } catch (e) {
    return { ok: false, errors: [{ message: e.message, line: e.line ?? 1, column: e.column ?? 1, severity: 'error' }] }
  }
  return { ok: true, machine, debugMap: result.debugMap, warnings: result.warnings ?? [] }
}
