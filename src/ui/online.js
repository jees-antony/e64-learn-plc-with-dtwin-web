// Compile / download / go online / run-stop / monitoring for the virtual CPU.
import additionalFb from 'strucpp/libs/additional-function-blocks.stlib'
import iecStdFb from 'strucpp/libs/iec-standard-fb.stlib'
import iecStdFunctions from 'strucpp/libs/iec-std-functions.stlib'

import { compileProject } from '../core/engine.js'
import { emit, state } from './store.js'

const LIBRARIES = [iecStdFunctions, iecStdFb, additionalFb]
export const log = []
export function say(text, level = 'info') {
  log.push({ at: new Date(), text, level })
  if (log.length > 300) log.shift()
  emit('log')
}

let ticker = null
function startTicker() { if (!ticker) ticker = setInterval(() => emit('tick'), 100) }
function stopTicker() { clearInterval(ticker); ticker = null }

export function compile() {
  say(`Compiling ${state.project.plc.name}…`)
  const r = compileProject(state.project, LIBRARIES)
  const diags = r.ok ? r.warnings : r.diagnostics
  state.diagnostics = diags
  const errors = diags.filter((d) => d.severity === 'error').length, warnings = diags.length - errors
  say(`Compiling finished (errors: ${errors}; warnings: ${warnings})`, errors ? 'error' : 'ok')
  emit('diagnostics')
  return r
}

export function download({ run = true } = {}) {
  const r = compile()
  if (!r.ok) { say('Download cancelled: the program has errors.', 'error'); return false }
  disposeMachine()
  const o = state.online
  o.machine = r.machine; o.source = r.source; o.downloaded = true; o.error = null; o.mode = 'stop'
  r.machine.onStopped((reason) => {
    if (o.machine !== r.machine) return
    o.mode = 'stop'
    if (reason) { o.error = reason; say(`CPU stopped: ${reason}`, 'error'); state.diagnostics = [{ severity: 'error', message: `CPU stopped: ${reason}`, where: 'cpu' }, ...state.diagnostics]; emit('diagnostics') }
    emit('online')
  })
  say(`Download to ${state.project.plc.name} finished`, 'ok')
  startTicker()
  emit('online')
  if (run) runCpu()
  return true
}

export function runCpu() {
  const o = state.online
  if (!o.machine) { say('Download the program first (Ctrl+L).', 'warn'); return }
  o.error = null
  o.machine.start()
  o.mode = 'run'
  say(`${state.project.plc.name}: RUN`, 'ok')
  emit('online')
}
export function stopCpu() {
  const o = state.online
  if (!o.machine || o.mode !== 'run') return
  o.machine.stop()
  o.mode = 'stop'
  say(`${state.project.plc.name}: STOP`)
  emit('online')
}
export function goOffline() {
  const o = state.online
  if (o.mode === 'offline') return
  o.prevMode = o.mode
  o.mode = 'offline'
  say('Disconnected from the CPU (offline).')
  emit('online')
}
export function goOnline() {
  const o = state.online
  if (!o.machine) { say('No program in the CPU. Download first (Ctrl+L).', 'warn'); return }
  if (o.mode !== 'offline') return
  o.mode = o.machine.running ? 'run' : 'stop'
  say('Connected to the CPU (online).', 'ok')
  emit('online')
}
function disposeMachine() {
  const o = state.online
  if (o.machine) { const m = o.machine; o.machine = null; m.stop() }
}
export function startSimulation() { return download({ run: true }) }

/* ------------------------------------------------------------ live values -- */
const up = (s) => String(s).toUpperCase()
/** Current value of an operand text as seen in `blockName` (tag, interface variable or instance.pin). */
export function readOperand(blockName, text) {
  const m = state.online.machine
  if (!m || state.online.mode === 'offline') return undefined
  const t = String(text ?? '').trim()
  if (!t) return undefined
  if (/^(TRUE|FALSE)$/i.test(t)) return /^TRUE$/i.test(t)
  if (/^[-+]?\d/.test(t)) return Number(t)
  const parts = t.replace(/^#/, '').replace(/"/g, '').split('.')
  const frame = m.frameOf(blockName)
  let v = frame?.[up(parts[0])]
  if (v === undefined) v = m.readGlobal(parts[0])
  // An instance data block lives in the block that calls it: look through the running program instances.
  if (v === undefined) for (const inst of m.instances?.values() ?? []) { const x = inst.frame?.[up(parts[0])]; if (x !== undefined) { v = x; break } }
  for (const p of parts.slice(1)) v = v?.[up(p)]
  return v
}
export function writeTag(name, value) {
  const m = state.online.machine
  if (!m) return false
  m.writeGlobal(name, value)
  emit('tick')
  return true
}
export const isOnline = () => state.online.mode !== 'offline' && !!state.online.machine
