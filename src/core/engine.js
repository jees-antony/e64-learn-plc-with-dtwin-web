// Compile pipeline: project -> ST -> STruC++ (in the page) -> virtual CPU.
import { buildMachine } from '../runtime/frontend.mjs'
import { generate, locate } from './codegen.js'

/**
 * @returns {{ok: true, machine, source, gen, warnings} | {ok: false, source?, gen?, diagnostics: Array<{message, block?, network?, line?, severity}>}}
 */
export function compileProject(project, libraries, options = {}) {
  const gen = generate(project)
  if (gen.errors.length) return { ok: false, gen, source: gen.source, diagnostics: gen.errors.map((e) => ({ severity: 'error', ...e })) }
  const built = buildMachine(gen.source, libraries, options)
  if (!built.ok) {
    return { ok: false, gen, source: gen.source, diagnostics: built.errors.map((e) => ({ severity: e.severity ?? 'error', message: e.message, stLine: e.line, ...(locate(gen, e.line) ?? { where: 'project' }) })) }
  }
  return { ok: true, machine: built.machine, source: gen.source, gen, warnings: (built.warnings ?? []).map((w) => ({ severity: 'warning', message: w.message, stLine: w.line, ...(locate(gen, w.line) ?? {}) })) }
}
