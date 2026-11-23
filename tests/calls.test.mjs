// Block calls the TIA way: an FB dragged into a network gets an instance DB (or a multi-instance in an FB),
// an FC is called with every parameter connected, and global DBs hold data with start values.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileProject } from '../src/core/engine.js'
import { generate } from '../src/core/codegen.js'
import { newBlock, newNetwork } from '../src/core/model.js'

const lib = (n) => JSON.parse(readFileSync(new URL(`../node_modules/strucpp/libs/${n}.stlib`, import.meta.url), 'utf8'))
const LIBS = [lib('iec-std-functions'), lib('iec-standard-fb')]
let now = 0
const rig = (project) => {
  now = 0
  const r = compileProject(project, LIBS, { clock: () => now })
  assert.equal(r.ok, true, JSON.stringify(r.diagnostics, null, 1) + '\n' + (r.source ?? ''))
  const m = r.machine; m.reset()
  return { m, r, advance: (ms) => { for (let i = 0; i < ms; i++) { now += 1e6; m.step(now) } }, read: (n) => m.readGlobal(n), write: (n, v) => m.writeGlobal(n, v) }
}
const NO = (tag) => ({ k: 'NO', tag })
const coil = (tag) => ({ k: 'coil', tag })
const lad = (elements, coils = []) => ({ ...newNetwork('LAD'), elements, coils })

/** Project with a "Motor" FB (seal-in: Start latches Running until Stop) and a "Scale" FC (Y := X * 10). */
function project() {
  const motor = newBlock('FB', 'Motor', 'LAD', 1)
  motor.interface.input = [{ name: 'Start', type: 'Bool' }, { name: 'Stop', type: 'Bool' }]
  motor.interface.output = [{ name: 'Running', type: 'Bool' }]
  motor.networks = [lad([{ k: 'branch', branches: [[NO('Start')], [NO('Running')]] }, { k: 'NC', tag: 'Stop' }], [coil('Running')])]
  const scale = newBlock('FC', 'Scale', 'SCL', 1)
  scale.interface.input = [{ name: 'X', type: 'Int' }]; scale.interface.output = [{ name: 'Y', type: 'Int' }]
  scale.code = '  Y := X * 10;'
  const main = newBlock('OB', 'Main', 'LAD', 1)
  return {
    version: 1, name: 'Calls', plc: { name: 'PLC_1', cycleMs: 10 },
    tags: [{ name: 'S1', type: 'Bool', address: '%I0.0' }, { name: 'S2', type: 'Bool', address: '%I0.1' }, { name: 'K1', type: 'Bool', address: '%Q0.0' },
      { name: 'Raw', type: 'Int', address: '%MW10' }, { name: 'Scaled', type: 'Int', address: '%MW12' }],
    blocks: [motor, scale, main], watch: [],
  }
}
const main = (p) => p.blocks.find((b) => b.name === 'Main')

test('C01 an FB called from Main with a single-instance DB runs, and its outputs reach the tags', () => {
  const p = project()
  p.blocks.push(newBlock('DB', 'Motor_DB', null, 1, { instanceOf: 'Motor' }))
  main(p).networks = [lad([{ k: 'call', block: 'Motor', inst: 'Motor_DB', args: { Start: 'S1', Stop: 'S2', Running: 'K1' } }])]
  const { advance, read, write, m } = rig(p)
  write('S1', true); advance(30); write('S1', false); advance(30)
  assert.equal(read('K1'), true, 'Running latched and written to K1')
  assert.equal(m.frameOf('Main').MOTOR_DB.RUNNING, true, 'instance data lives with the call')
  write('S2', true); advance(30)
  assert.equal(read('K1'), false)
})

test('C02 EN: the FB only runs while the rung before it has power; ENO passes the power on', () => {
  const p = project()
  p.tags.push({ name: 'Enable', type: 'Bool', address: '%I0.2' }, { name: 'Done', type: 'Bool', address: '%Q0.1' })
  p.blocks.push(newBlock('DB', 'Motor_DB', null, 1, { instanceOf: 'Motor' }))
  main(p).networks = [lad([NO('Enable'), { k: 'call', block: 'Motor', inst: 'Motor_DB', args: { Start: 'S1', Running: 'K1' } }], [coil('Done')])]
  const { advance, read, write } = rig(p)
  write('S1', true); advance(30)
  assert.equal(read('K1'), false, 'not executed without EN')
  assert.equal(read('Done'), false)
  write('Enable', true); advance(30)
  assert.equal(read('K1'), true)
  assert.equal(read('Done'), true, 'ENO follows EN')
})

test('C03 an FC call with every parameter connected; a missing one is a clear error', () => {
  const p = project()
  main(p).networks = [lad([{ k: 'call', block: 'Scale', args: { X: 'Raw', Y: 'Scaled' } }])]
  const { advance, read, write } = rig(p)
  write('Raw', 7); advance(20)
  assert.equal(read('Scaled'), 70)
  main(p).networks[0].elements[0].args = { X: 'Raw' }
  const r = compileProject(p, LIBS)
  assert.equal(r.ok, false)
  assert.match(r.diagnostics.map((d) => d.message).join('\n'), /Output "Y" of Scale is not connected/)
})

test('C04 a multi-instance: FB "Line" holds a Motor in its Static section; Line is called from Main', () => {
  const p = project()
  const line = newBlock('FB', 'Line', 'LAD', 2)
  line.interface.input = [{ name: 'Go', type: 'Bool' }]; line.interface.output = [{ name: 'Busy', type: 'Bool' }]
  line.interface.static = [{ name: 'Conveyor', type: 'Motor' }]
  line.networks = [lad([{ k: 'call', block: 'Motor', inst: 'Conveyor', multi: true, args: { Start: 'Go', Running: 'Busy' } }])]
  p.blocks.unshift(line)   // declared before Motor: the generator must still emit Motor first
  p.blocks.push(newBlock('DB', 'Line_DB', null, 1, { instanceOf: 'Line' }))
  main(p).networks = [lad([{ k: 'call', block: 'Line', inst: 'Line_DB', args: { Go: 'S1', Busy: 'K1' } }])]
  const { advance, read, write, r } = rig(p)
  assert.ok(r.source.indexOf('FUNCTION_BLOCK Motor') < r.source.indexOf('FUNCTION_BLOCK Line'), 'callee first')
  write('S1', true); advance(20); write('S1', false); advance(20)
  assert.equal(read('K1'), true, 'the nested Motor latched')
})

test('C05 a global DB: start values, written by one network and read by another', () => {
  const p = project()
  const db = newBlock('DB', 'Settings', null, 2)
  db.interface.static = [{ name: 'Speed', type: 'Int', init: '25' }, { name: 'Ready', type: 'Bool' }]
  p.blocks.push(db)
  main(p).networks = [
    lad([NO('S1')], [coil('Settings.Ready')]),
    lad([NO('Settings.Ready'), { k: 'move', src: 'Settings.Speed', dest: 'Raw' }]),
  ]
  const { advance, read, write } = rig(p)
  advance(10)
  assert.equal(read('Settings').SPEED, 25, 'start value')
  write('S1', true); advance(20)
  assert.equal(read('Settings').READY, true)
  assert.equal(read('Raw'), 25)
})

test('C06 learner mistakes give clear messages', () => {
  const msgs = (p) => generate(p).errors.map((e) => e.message).join('\n')
  // one instance DB for two calls
  let p = project(); p.blocks.push(newBlock('DB', 'Motor_DB', null, 1, { instanceOf: 'Motor' }))
  main(p).networks = [lad([{ k: 'call', block: 'Motor', inst: 'Motor_DB', args: {} }]), lad([{ k: 'call', block: 'Motor', inst: 'Motor_DB', args: {} }])]
  assert.match(msgs(p), /used by 2 calls/)
  // the called block was deleted
  p = project(); main(p).networks = [lad([{ k: 'call', block: 'Gone', args: {} }])]
  assert.match(msgs(p), /"Gone" does not exist/)
  // a loop: Motor calls Line, Line calls Motor
  p = project()
  const line = newBlock('FB', 'Line', 'LAD', 2); line.interface.static = [{ name: 'M', type: 'Motor' }]
  line.networks = [lad([{ k: 'call', block: 'Motor', inst: 'M', multi: true, args: {} }])]
  p.blocks.find((b) => b.name === 'Motor').interface.static = [{ name: 'L', type: 'Line' }]
  p.blocks.push(line)
  assert.match(msgs(p), /loop/)
  // empty box and a missing data block variable
  p = project(); p.blocks.push(Object.assign(newBlock('DB', 'Settings', null, 2), { interface: { static: [{ name: 'Speed', type: 'Int' }] } }))
  main(p).networks = [lad([{ k: 'empty' }]), lad([{ k: 'move', src: 'Settings.Nope', dest: 'Raw' }])]
  const m = msgs(p)
  assert.match(m, /Empty box/)
  assert.match(m, /"Settings" has no variable "Nope"/)
})
