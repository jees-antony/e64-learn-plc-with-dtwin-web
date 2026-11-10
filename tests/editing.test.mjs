import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { sampleProject, newBlock } from '../src/core/model.js'
import { availableTypes, checkType, validateInterfaces } from '../src/core/types.js'
import { startBranch, closeBranch, addParallelPath, insertAtGap, removeBranch, validateLadderNetwork } from '../src/core/ladder-edit.js'
import { compileProject } from '../src/core/engine.js'

const libraries = ['iec-std-functions', 'iec-standard-fb'].map(n => JSON.parse(readFileSync(new URL(`../node_modules/strucpp/libs/${n}.stlib`, import.meta.url))))
const contact = tag => ({ k: 'NO', tag })
const network = () => ({ elements: [contact('A'), contact('B'), contact('C'), contact('D')], coils: [{ k: 'coil', tag: 'Out' }] })
function projectWith(net) {
  const p = sampleProject()
  p.tags = [...'ABCDE'].map((name, i) => ({ name, type: 'Bool', address: `%I0.${i}` }))
  p.tags.push({ name: 'Out', type: 'Bool', address: '%Q0.0' })
  p.blocks[0].networks = [net]
  return p
}
test('Type choices accept supported aliases and offer project FB instances only where allowed', () => {
  const p = sampleProject(), fb = newBlock('FB', 'MotorControl', 'SCL', 2); p.blocks.push(fb)
  assert.equal(checkType(p, 'BOOL').name, 'Bool')
  assert.equal(checkType(p, '  real ').name, 'Real')
  assert.equal(checkType(p, 'Boool').ok, false)
  assert.match(checkType(p, '').message, /Choose/)
  assert.equal(checkType(p, 'MotorControl').ok, false, 'A global tag cannot silently become an FB instance')
  assert.equal(checkType(p, 'motorcontrol', { instances: true }).name, 'MotorControl')
  assert.equal(availableTypes(p, { instances: true, block: fb }).some(t => t.name === fb.name), false, 'No recursive self-instance')
  assert.ok(availableTypes(p, { instances: true }).some(t => t.name === 'TON'))
})
test('Unknown interface types stop compilation with the exact block, section and variable', () => {
  const p = sampleProject(); p.blocks[0].interface.temp.push({ name: 'Speed', type: 'Interger' })
  const r = compileProject(p, libraries)
  assert.equal(r.ok, false)
  const d = r.diagnostics.find(d => d.where === 'interface')
  assert.equal(d.block, p.blocks[0].id); assert.equal(d.section, 'temp'); assert.equal(d.variable, 'Speed')
  assert.match(d.message, /Unknown data type.*Interger/)
})
test('Invalid types from imported tag tables are rejected before runtime creation', () => {
  const p = sampleProject(); p.tags[0].type = 'NotAType'
  const r = compileProject(p, libraries)
  assert.equal(r.ok, false); assert.equal(r.diagnostics[0].field, 'type'); assert.match(r.diagnostics[0].message, /NotAType/)
})
test('Removing or renaming a referenced FB type invalidates its declaration', () => {
  const p = sampleProject(), fb = newBlock('FB', 'ValveControl', 'SCL', 2); p.blocks.push(fb)
  p.blocks[0].interface.static.push({ name: 'Valve', type: 'ValveControl' })
  assert.equal(validateInterfaces(p).length, 0)
  fb.name = 'ValveControl2'
  assert.match(validateInterfaces(p)[0].message, /ValveControl/)
})
test('Instructions insert before the first, between existing instructions and at the end', () => {
  const n = network()
  insertAtGap(n, { path: [], index: 0 }, contact('First'))
  insertAtGap(n, { path: [], index: 3 }, contact('Middle'))
  insertAtGap(n, { path: [], index: n.elements.length }, contact('Last'))
  assert.deepEqual(n.elements.map(e => e.tag), ['First', 'A', 'B', 'Middle', 'C', 'D', 'Last'])
})
test('A new branch can start before the first instruction and remains a persisted invalid draft', () => {
  const n = network(), lower = startBranch(n, { path: [], index: 0 })
  insertAtGap(n, lower, contact('E'))
  const imported = JSON.parse(JSON.stringify(n))
  const r = compileProject(projectWith(imported), libraries)
  assert.equal(r.ok, false); assert.match(r.diagnostics[0].message, /not closed/)
  assert.equal(r.diagnostics[0].network, 0)
  closeBranch(imported, { path: [], index: 2 })
  assert.equal(validateLadderNetwork(imported).length, 0)
})
test('A branch captures multiple instructions between the selected start and return wire', () => {
  const n = network(), lower = startBranch(n, { path: [], index: 1 })
  insertAtGap(n, lower, contact('E'))
  closeBranch(n, { path: [], index: 4 })
  assert.deepEqual(n.elements.map(e => e.k), ['NO', 'branch', 'NO'])
  assert.deepEqual(n.elements[1].branches.map(b => b.map(e => e.tag)), [['B', 'C'], ['E']])
  assert.equal(n.elements[2].tag, 'D'); assert.equal(n.elements[1].closed, true)
})
test('Closing a branch preserves the complete Boolean circuit for every input combination', () => {
  const n = network(), lower = startBranch(n, { path: [], index: 1 })
  insertAtGap(n, lower, contact('E')); closeBranch(n, { path: [], index: 4 })
  const r = compileProject(projectWith(n), libraries, { clock: () => 0 })
  assert.equal(r.ok, true, JSON.stringify(r.diagnostics))
  let time = 0
  for (let bits = 0; bits < 32; bits++) {
    const values = [...'ABCDE'].map((name, i) => { const v = !!(bits & (1 << i)); r.machine.writeGlobal(name, v); return v })
    time += 1e7; r.machine.step(time)
    const [a,b,c,d,e] = values
    assert.equal(r.machine.readGlobal('Out'), a && ((b && c) || e) && d, `Input mask ${bits}`)
  }
})
test('Branch around a selected contact can be filled and closed at its current edge', () => {
  const n = network(), lower = startBranch(n, { path: [], index: 1 }, true)
  insertAtGap(n, lower, contact('E')); closeBranch(n, { path: lower.path, index: 1 })
  assert.deepEqual(n.elements[1].branches.map(b => b.map(e => e.tag)), [['B'], ['E']])
})
test('Nested branches close within the parent lane and compile', () => {
  const n = network(), lower = startBranch(n, { path: [], index: 1 }, true)
  insertAtGap(n, lower, contact('E')); closeBranch(n)
  const inner = startBranch(n, { path: [1, 0], index: 0 }, true)
  insertAtGap(n, inner, contact('C')); closeBranch(n)
  assert.equal(validateLadderNetwork(n).length, 0)
  assert.equal(compileProject(projectWith(n), libraries).ok, true)
})
test('Empty paths and crossing/backward joins are rejected without changing the network', () => {
  const n = network(); startBranch(n, { path: [], index: 1 })
  const before = JSON.stringify(n)
  assert.throws(() => closeBranch(n, { path: [], index: 0 }), /after the branch start/)
  assert.throws(() => closeBranch(n, { path: [], index: 3 }), /empty/)
  assert.equal(JSON.stringify(n), before)
  assert.throws(() => startBranch(n, { path: [], index: 0 }), /unfinished branch/)
  insertAtGap(n, { path: [1, 1], index: 0 }, contact('E'))
  assert.throws(() => closeBranch(n, { path: [1, 0], index: 0 }), /empty/)
})
test('An extra parallel path requires instructions and an explicit close', () => {
  const n = network(), lower = startBranch(n, { path: [], index: 1 }, true)
  insertAtGap(n, lower, contact('E')); closeBranch(n)
  const third = addParallelPath(n, [1]); assert.match(validateLadderNetwork(n)[0].message, /not closed/)
  insertAtGap(n, third, contact('C')); closeBranch(n)
  assert.equal(n.elements[1].branches.length, 3)
  assert.equal(compileProject(projectWith(n), libraries).ok, true)
  removeBranch(n, [1]); assert.deepEqual(n.elements.map(e => e.tag), ['A','B','C','D'])
})
test('Old closed branches remain compatible; empty bypasses and contact-only rungs warn', () => {
  const p = sampleProject(); assert.equal(compileProject(p, libraries).ok, true)
  const n = network(); n.elements = [{ k: 'branch', branches: [[contact('A')], []] }]
  assert.match(validateLadderNetwork(n)[0].message, /would bypass/)
  assert.equal(compileProject(projectWith(n), libraries).ok, false)
  assert.match(validateLadderNetwork({ elements: [contact('A')], coils: [] })[0].message, /no output/)
  assert.deepEqual(validateLadderNetwork({ elements: [], coils: [] }), [], 'A blank spare network is permitted')
})
test('A timer inside a branch receives the upstream condition', () => {
  const p = projectWith({ elements: [contact('A'), { k: 'branch', branches: [[{ k: 'box', fb: 'TON', inst: 'Wait', args: { PT: 'T#20ms' } }], [contact('E')]] }], coils: [{ k: 'coil', tag: 'Out' }] })
  const r = compileProject(p, libraries, { clock: () => 0 }); assert.equal(r.ok, true, JSON.stringify(r.diagnostics))
  r.machine.writeGlobal('A', false); r.machine.writeGlobal('E', false)
  for (let t = 1; t < 10; t++) r.machine.step(t * 1e7)
  assert.equal(r.machine.frameOf('Main').WAIT.Q, false, 'Timer must not run behind an open upstream condition')
})
