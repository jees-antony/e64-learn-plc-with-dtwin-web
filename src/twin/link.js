// Connects the tank twin to the virtual CPU. Runs all the time, whichever tab is shown:
// every 50 ms it reads the PLC outputs (%Q), advances the plant, and writes the PLC inputs (%I).
// Like real wiring, the link goes by address: whatever tag the program declares at %I0.2 receives B1.
import { iecAddress } from '../core/model.js'
import { emit, state } from '../ui/store.js'
import { IO, TankProcess } from './tank-model.js'

export const plant = new TankProcess()
const OUT_KEY = { '%Q0.0': 'Q0', '%Q0.1': 'Q1' }
const BUTTON_AT = { '%I0.0': 'S1', '%I0.1': 'S2' }

/** The PLC tag declared at an address, if the program has one. */
export function tagAt(addr) {
  const want = iecAddress(addr)
  return state.project.tags.find((t) => iecAddress(t.address) === want) ?? null
}

/** I/O rows with the tag the program uses and the live value on the wire. */
export function ioRows() {
  const inputs = plant.inputs
  return IO.map((io) => ({ ...io, tagName: tagAt(io.addr)?.name ?? null, value: io.dir === 'in' ? inputs[io.addr] : plant.netLive(io.addr === '%Q0.0' ? 'DQ0' : 'DQ1') }))
}

/** Inputs the twin drives: push buttons can be operated from elsewhere, sensors cannot. */
export function twinInput(addr) {
  const a = iecAddress(addr)
  const io = IO.find((x) => x.dir === 'in' && iecAddress(x.addr) === a)
  if (!io) return null
  return BUTTON_AT[io.addr] ? { kind: 'button', id: BUTTON_AT[io.addr] } : { kind: 'sensor', id: io.device }
}
// A real push button stays closed for at least its travel time, so even a very quick click
// lasts longer than a few PLC scans.
const MIN_PRESS_MS = 150, pressedAt = {}
export function press(id, down) {
  if (!(id in plant.buttons)) return
  if (down) { pressedAt[id] = performance.now(); plant.buttons[id] = true; sync(0); return }
  const left = MIN_PRESS_MS - (performance.now() - (pressedAt[id] ?? 0))
  if (left > 0) { setTimeout(() => press(id, false), left); return }
  plant.buttons[id] = false; sync(0)
}

let last = performance.now()
export function sync(dt) {
  const m = state.online.machine, run = !!m?.running
  plant.cpuRun = run
  for (const io of IO) {
    if (io.dir !== 'out') continue
    const t = tagAt(io.addr)
    plant.q[OUT_KEY[io.addr]] = !!(run && t && m.readGlobal(t.name) === true)
  }
  plant.step(dt)
  if (run) {
    const inputs = plant.inputs
    for (const io of IO) {
      if (io.dir !== 'in') continue
      const t = tagAt(io.addr)
      if (t && t.type === 'Bool') m.writeGlobal(t.name, inputs[io.addr])
    }
  }
  emit('twin')
}
setInterval(() => { const now = performance.now(); sync(Math.min(0.25, (now - last) / 1000)); last = now }, 50)
