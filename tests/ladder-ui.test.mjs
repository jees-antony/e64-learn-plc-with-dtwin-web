// Every ladder editing action, driven through the real editor the way a learner uses it (TIA-style workflow):
// select a connection or an instruction, then insert from the favorites bar, a shortcut or the API.
// The checklist this follows is docs/ladder-test-checklist.md (IDs in the test names).
import test from 'node:test'
import assert from 'node:assert/strict'
import { NC, NO, coil, editorWith, net, projectWith } from './support/dom-harness.mjs'

const two = () => projectWith([net([NO('A'), NO('B')], [coil('Y')]), net([NO('C')], [coil('Z')])])
const gap = (index, path = []) => ({ path, index })
const clone = (x) => JSON.parse(JSON.stringify(x))
const iface = (input = [], output = [], rest = {}) => ({ input, output, inout: [], static: [], temp: [], ...rest })
/** A function block "Motor" (Start -> Running) and a function "Scale" (Raw -> Scaled) to call from the editor. */
const MOTOR = () => ({ id: 'fb1', kind: 'FB', name: 'Motor', number: 1, lang: 'LAD', interface: iface([{ name: 'Start', type: 'Bool' }], [{ name: 'Running', type: 'Bool' }]), networks: [net()], comment: '' })
const SCALE = () => ({ id: 'fc1', kind: 'FC', name: 'Scale', number: 1, lang: 'LAD', interface: iface([{ name: 'Raw', type: 'Int' }], [{ name: 'Scaled', type: 'Int' }]), networks: [net()], comment: '' })
const withCallees = (p) => { p.blocks.push(MOTOR(), SCALE()); return p }
const opRows = (t) => t.$$('.op-list .op-row').map((r) => [...r.cells].map((c) => c.textContent))
const typeIn = async (t, text) => { const i = t.input(); i.value = text; i.dispatchEvent(new t.document.defaultView.Event('input', { bubbles: true })); await t.wait(5) }
const field = (t, label) => t.dialog().querySelector(`[aria-label="${label}"]`)
const REMOVED = ['.gap-plus', '.quick-menu', '.ghost-coil', '.coil-plus', '.net-plus', '.net-gap', '.rung-add', '.add-network', '.rung-tip', '.rung-warning', '.tag-bubble', '.pill']

function dragEvent(t, type, payload) {
  const ev = new t.document.defaultView.Event(type, { bubbles: true, cancelable: true })
  const data = payload ? { 'text/plain': JSON.stringify(payload) } : {}
  Object.defineProperty(ev, 'clientX', { value: 0 }); Object.defineProperty(ev, 'clientY', { value: 0 })
  Object.defineProperty(ev, 'dataTransfer', { value: { setData: (k, v) => { data[k] = v }, getData: (k) => data[k] ?? '', effectAllowed: '', dropEffect: '' } })
  return ev
}

/* ===================================================== new TIA workflow (T..) == */

test('T01 favorites bar offers the six TIA favorites and Insert network, in order', async () => {
  const t = await editorWith(two())
  assert.deepEqual(t.$$('.fav-bar .fav').map((b) => b.getAttribute('aria-label')),
    ['Normally open contact', 'Normally closed contact', 'Assignment', 'Empty box', 'Open branch', 'Close branch', 'Insert network'])
})

test('T02 the removed controls are gone: no "+", quick menu, ghost coil, network gaps, header buttons, tips or banners', async () => {
  for (const p of [projectWith([net()]), two(), projectWith([net(Array.from({ length: 11 }, () => NO('A')), [coil('Y')])])]) {
    const t = await editorWith(p)
    for (const sel of REMOVED) assert.equal(t.$(sel), null, `${sel} must not exist`)
    assert.equal(t.document.body.textContent.includes('Add instruction'), false)
    assert.equal(t.document.body.textContent.includes('Add output'), false)
  }
})

test('T03 an empty box inserted from the favorites bar shows "??" and opens a list of instructions and blocks', async () => {
  const t = await editorWith(withCallees(two()))
  await t.clickSlot(0, gap(1)); await t.fav('Empty box')
  assert.deepEqual(t.networks()[0].elements.map((e) => e.k), ['NO', 'empty', 'NO'])
  assert.equal(t.$('[data-boxname]', t.net(0)).textContent, '??')
  assert.ok(t.input(), 'name box open')
  const names = opRows(t).map((r) => r[0])
  for (const n of ['TON', 'TOF', 'TP', 'CTU', 'CTD', 'SR', 'RS', 'CMP ==', 'MOVE', 'ADD', 'SUB', 'MUL', 'DIV', 'Motor', 'Scale']) assert.ok(names.includes(n), `${n} offered`)
})

test('T04 typing TON into an empty box converts it in place and opens the preset', async () => {
  const t = await editorWith(two())
  await t.clickSlot(0, gap(1)); await t.fav('Empty box'); await t.type('TON')
  const e = t.networks()[0].elements[1]
  assert.deepEqual([e.k, e.fb], ['box', 'TON'])
  assert.equal(t.networks()[0].elements.length, 3, 'converted in place, nothing added')
  assert.equal(t.input()?.placeholder, 'e.g. T#5s', 'operand box opened on the preset')
  await t.type('T#2s')
  assert.equal(t.networks()[0].elements[1].args.PT, 'T#2s')
})

test('T05 an invalid name keeps the empty box open with a message; Esc leaves the box empty', async () => {
  const t = await editorWith(two())
  await t.clickSlot(0, gap(1)); await t.fav('Empty box'); await t.type('Foo')
  assert.ok(t.input(), 'still open')
  assert.match(t.toast(), /not an instruction or block/)
  t.key(t.input(), 'Escape'); await t.wait(10)
  assert.equal(t.networks()[0].elements[1].k, 'empty')
})

test('T06 an empty box takes MOVE, CMP > and ADD; typing a letter on a selected empty box starts the name', async () => {
  const t = await editorWith(projectWith([net([{ k: 'empty' }, { k: 'empty' }, { k: 'empty' }], [coil('Y')])]))
  t.select({ network: 0, path: [0] }); await t.shortcut('M')
  assert.equal(t.input()?.value, 'M', 'the typed key seeds the name')
  await t.type('MOVE'); assert.equal(t.networks()[0].elements[0].k, 'move')
  t.select({ network: 0, path: [1] }); await t.run('editOperand'); await t.wait(10)
  await t.type('CMP >')
  assert.deepEqual([t.networks()[0].elements[1].k, t.networks()[0].elements[1].op], ['cmp', '>'])
  t.select({ network: 0, path: [2] }); await t.run('editOperand'); await t.wait(10)
  await t.type('add')
  assert.deepEqual([t.networks()[0].elements[2].k, t.networks()[0].elements[2].op], ['math', 'add'])
})

test('T07 clicking the "??" of an empty box opens the name box', async () => {
  const t = await editorWith(projectWith([net([{ k: 'empty' }], [coil('Y')])]))
  assert.equal(t.input(), null)
  t.$('[data-boxname]', t.net(0)).click(); await t.wait(10)
  assert.ok(t.input(), 'name box open')
})

test('T08 an FC is inserted as a call directly, with no dialog; its pins are operands', async () => {
  const t = await editorWith(withCallees(projectWith([net([NO('A')], [coil('Y')])])))
  await t.clickSlot(0, gap(1))
  await t.api().insertCall('Scale'); await t.wait(40)
  assert.equal(t.dialog(), null, 'no Call options for an FC')
  assert.deepEqual(t.networks()[0].elements[1], { k: 'call', block: 'Scale', args: {} })
  assert.equal(t.store.state.project.blocks.some((b) => b.kind === 'DB'), false, 'no instance DB')
  assert.ok(t.input(), 'first operand opened')
})

test('T09 an FB call asks for Call options; OK creates the call with an instance DB', async () => {
  const t = await editorWith(withCallees(projectWith([net([NO('A')], [coil('Y')])])))
  await t.clickSlot(0, gap(1))
  const p = t.api().insertCall('Motor'); await t.wait(10)
  assert.ok(t.dialog()?.classList.contains('call-options'), 'Call options dialog')
  assert.equal(t.networks()[0].elements.length, 1, 'nothing inserted before OK')
  await t.dialogButton('OK'); await p
  assert.deepEqual(t.networks()[0].elements[1], { k: 'call', block: 'Motor', inst: 'Motor_DB', args: {} })
  const db = t.store.state.project.blocks.find((b) => b.kind === 'DB')
  assert.deepEqual([db.name, db.instanceOf], ['Motor_DB', 'Motor'])
  assert.equal(t.dialog(), null, 'dialog closed')
})

test('T10 Cancel in Call options inserts nothing and creates no DB', async () => {
  const t = await editorWith(withCallees(projectWith([net([NO('A')], [coil('Y')])])))
  const before = JSON.stringify(t.store.state.project)
  const p = t.api().insertCall('Motor'); await t.wait(10)
  await t.dialogButton('Cancel'); await p
  assert.equal(JSON.stringify(t.store.state.project), before)
})

test('T11 multi instance is only enabled in an FB: it adds a Static variable instead of a DB', async () => {
  const p = withCallees(projectWith([net([NO('A')], [coil('Y')])]))
  // in the OB the Multi instance tile is disabled
  let t = await editorWith(clone(p))
  let q = t.api().insertCall('Motor'); await t.wait(10)
  assert.equal(t.$('.dtile[data-kind="multi"]', t.dialog()).disabled, true)
  await t.dialogButton('Cancel'); await q
  // the same call made inside an FB
  const outer = { id: 'fb2', kind: 'FB', name: 'Line', number: 2, lang: 'LAD', interface: iface(), networks: [net([NO('A')], [coil('Y')])], comment: '' }
  const p2 = withCallees(projectWith([])); p2.blocks = [outer, ...p2.blocks.filter((b) => b.kind !== 'OB')]
  t = await editorWith(p2)
  q = t.api().insertCall('Motor'); await t.wait(10)
  const tile = t.$('.dtile[data-kind="multi"]', t.dialog())
  assert.equal(tile.disabled, false)
  tile.click(); await t.wait(5)
  await t.dialogButton('OK'); await q
  const line = t.lad()
  const call = line.networks[0].elements.find((e) => e.k === 'call')
  assert.deepEqual([call.block, call.multi, call.inst], ['Motor', true, 'Motor_Instance'])
  assert.deepEqual(line.interface.static, [{ name: 'Motor_Instance', type: 'Motor' }])
  assert.equal(t.store.state.project.blocks.some((b) => b.kind === 'DB'), false, 'no instance DB for a multi-instance')
})

test('T12 an empty box converted to an FB name runs the same Call options flow', async () => {
  const t = await editorWith(withCallees(projectWith([net([NO('A'), { k: 'empty' }], [coil('Y')])])))
  t.select({ network: 0, path: [1] }); await t.run('editOperand'); await t.wait(10)
  await t.type('Motor', 'Enter', {})
  assert.ok(t.dialog()?.classList.contains('call-options'))
  await t.dialogButton('OK')
  assert.deepEqual(t.networks()[0].elements[1], { k: 'call', block: 'Motor', inst: 'Motor_DB', args: {} })
  assert.ok(t.store.state.project.blocks.some((b) => b.kind === 'DB' && b.instanceOf === 'Motor'))
})

test('T13 dropping a block or an instruction on a network inserts it (drop payload and API)', async () => {
  const t = await editorWith(withCallees(projectWith([net([NO('A')], [coil('Y')]), net([NO('B')], [coil('Z')])])))
  t.net(1).dispatchEvent(dragEvent(t, 'drop', { block: 'Scale' })); await t.wait(40)
  assert.equal(t.networks()[1].elements.some((e) => e.k === 'call' && e.block === 'Scale'), true)
  t.net(0).dispatchEvent(dragEvent(t, 'drop', { lad: { k: 'NC' } })); await t.wait(40)
  assert.equal(t.networks()[0].elements.some((e) => e.k === 'NC'), true)
  t.select({ network: 0, gap: gap(0) }); t.api().drop({ lad: { k: 'NO' } }); await t.wait(40)
  assert.equal(t.networks()[0].elements.filter((e) => e.k === 'NO').length, 2)
  const q = t.api().drop({ block: 'Scale' }); await q; await t.wait(40)
  assert.equal(t.networks().flatMap((n) => n.elements).filter((e) => e.k === 'call').length >= 2, true)
})

test('T14 a call box shows the callee pins as operands: inputs left, outputs right, editable', async () => {
  const p = withCallees(projectWith([net([NO('A'), { k: 'call', block: 'Scale', args: {} }], [coil('Y')])]))
  const t = await editorWith(p)
  const raw = t.$('[data-op="Raw"]', t.net(0)), out = t.$('[data-op="Scaled"]', t.net(0))
  assert.ok(raw && out, 'a span for every pin')
  assert.ok(raw.closest('.tb-l'), 'input operand on the left') ; assert.ok(out.closest('.tb-r'), 'output operand on the right')
  raw.click(); await t.wait(10)           // a click on an empty operand opens it
  assert.ok(t.input(), 'operand box open')
  await t.type('N1')                      // Enter walks on to the next empty required operand
  assert.equal(t.networks()[0].elements[1].args.Raw, 'N1')
  assert.ok(t.input(), 'moved on to the output pin')
  await t.type('N1')
  assert.deepEqual(t.networks()[0].elements[1].args, { Raw: 'N1', Scaled: 'N1' })
  assert.equal(t.$('[data-op="Raw"]', t.net(0)).textContent, '"N1"')
  // an existing value is changed with a double-click
  await t.dbl(t.$('[data-op="Raw"]', t.net(0)))
  assert.equal(t.input()?.value, 'N1'); await t.type('N1', 'Escape')
})

test('T15 an FB call shows its instance DB number above the box', async () => {
  const p = withCallees(projectWith([net([NO('A'), { k: 'call', block: 'Motor', inst: 'Motor_DB', args: {} }], [coil('Y')])]))
  p.blocks.push({ id: 'db1', kind: 'DB', name: 'Motor_DB', number: 7, instanceOf: 'Motor', interface: { static: [] }, comment: '' })
  const t = await editorWith(p)
  const box = t.$('.call-el', t.net(0))
  assert.equal(t.$('.addr', box).textContent, '%DB7')
  assert.equal(t.$('.inst', box).textContent, '"Motor_DB"')
  assert.ok(t.$('[data-op="Start"]', box) && t.$('[data-op="Running"]', box))
})

test('T16 operands display formatted: global tag "A", block variable #x; stored without quotes', async () => {
  const p = projectWith([net([NO('A'), NO('')], [coil('Y')])])
  p.blocks[0].interface.temp.push({ name: 'x', type: 'Bool' })
  const t = await editorWith(p)
  assert.equal(t.$('[data-op="tag"]', t.$('[data-path="0"]', t.net(0))).textContent, '"A"')
  assert.equal(t.$('.addr', t.$('[data-path="0"]', t.net(0))).textContent, '%I0.0', 'absolute address above the operand')
  assert.equal(t.$('.coils [data-op="tag"]', t.net(0)).textContent, '"Y"')
  t.select({ network: 0, path: [1] }); await t.run('editOperand'); await t.wait(10)
  await t.type('#x')
  assert.equal(t.networks()[0].elements[1].tag, 'x')
  assert.equal(t.$('[data-op="tag"]', t.$('[data-path="1"]', t.net(0))).textContent, '#x')
  t.select({ network: 0, path: [0] }); await t.run('editOperand'); await t.wait(10)
  await t.type('"B"')
  assert.equal(t.networks()[0].elements[0].tag, 'B')
  assert.equal(t.$('[data-op="tag"]', t.$('[data-path="0"]', t.net(0))).textContent, '"B"')
})

test('T17 an unknown name is stored as typed, marked unknown, and a toast points to "Define tag…"; no tag is created', async () => {
  const t = await editorWith(projectWith([net([NO('')], [coil('Y')])]))
  t.select({ network: 0, path: [0] }); await t.run('editOperand'); await t.wait(10)
  await t.type('Start_PB')
  assert.equal(t.networks()[0].elements[0].tag, 'Start_PB')
  assert.ok(t.$('.unknown', t.net(0)), 'marked unknown')
  assert.match(t.toast(), /Define tag/)
  assert.equal(t.store.state.project.tags.some((x) => x.name === 'Start_PB'), false)
  assert.equal(t.bubble(), null, 'no tag bubble any more')
})

test('T18 right-click "Define tag…" on an unknown operand creates a global tag with its address', async () => {
  const t = await editorWith(projectWith([net([NO('Start_PB')], [coil('Y')])]))
  const span = t.$('[data-op="tag"]', t.net(0))
  const labels = await t.context(span)
  assert.deepEqual(labels.slice(0, 5), ['Cut', 'Copy', 'Paste', 'Delete', 'Define tag…'])
  assert.ok(labels.includes('Rewire tag…') && labels.includes('Insert network'))
  assert.equal(labels.includes('Rename tag…'), false)
  await t.menuPick('Define tag…')
  assert.ok(t.dialog()?.classList.contains('define-tag'))
  assert.equal(field(t, 'Name').value, 'Start_PB')
  assert.equal(field(t, 'Section').value, 'global')
  assert.equal(field(t, 'Data type').value, 'Bool')
  field(t, 'Address').value = '%I0.5'; field(t, 'Comment').value = 'Start button'
  await t.dialogButton('Define')
  assert.deepEqual(t.store.state.project.tags.find((x) => x.name === 'Start_PB'), { name: 'Start_PB', type: 'Bool', address: '%I0.5', comment: 'Start button' })
  assert.equal(t.$('.unknown', t.net(0)), null, 'no longer unknown')
  assert.equal(t.$('.addr', t.net(0)).textContent, '%I0.5')
})

test('T19 Define tag can create a local variable instead, and refuses an invalid address', async () => {
  const t = await editorWith(projectWith([net([NO('Local1')], [coil('Y')])]))
  await t.context(t.$('[data-op="tag"]', t.net(0))); await t.menuPick('Define tag…')
  field(t, 'Address').value = 'nonsense'
  await t.dialogButton('Define')
  assert.ok(t.dialog(), 'dialog stays open')
  assert.match(t.dialog().querySelector('.derr').textContent, /not a valid address/)
  const sec = field(t, 'Section'); sec.value = 'temp'; sec.dispatchEvent(new t.document.defaultView.Event('change', { bubbles: true }))
  await t.dialogButton('Define')
  assert.deepEqual(t.lad().interface.temp, [{ name: 'Local1', type: 'Bool' }])
  assert.equal(t.store.state.project.tags.some((x) => x.name === 'Local1'), false)
  assert.equal(t.$('[data-op="tag"]', t.net(0)).textContent, '#Local1')
})

test('T20 right-click "Rename tag…" renames the tag everywhere', async () => {
  const p = two(); p.blocks[0].networks[1].elements.push(NC('A')); p.watch = [{ name: 'w', rows: ['A', 'B'] }]
  const t = await editorWith(p)
  const labels = await t.context(t.$('[data-op="tag"]', t.$('[data-path="0"]', t.net(0))))
  assert.ok(labels.includes('Rename tag…') && labels.includes('Rewire tag…'))
  assert.equal(labels.includes('Define tag…'), false)
  await t.menuPick('Rename tag…')
  assert.ok(t.dialog()?.classList.contains('rename-tag'))
  const nm = field(t, 'New name'); nm.value = 'Start'
  await t.dialogButton('OK')
  const tags = t.store.state.project.tags.map((x) => x.name)
  assert.ok(tags.includes('Start') && !tags.includes('A'))
  assert.deepEqual(t.networks().flatMap((n) => n.elements).map((e) => e.tag), ['Start', 'B', 'C', 'Start'])
  assert.deepEqual(t.store.state.project.watch[0].rows, ['Start', 'B'])
  assert.equal(t.$('[data-op="tag"]', t.$('[data-path="0"]', t.net(0))).textContent, '"Start"')
})

test('T21 Rename tag refuses a name that is already used', async () => {
  const t = await editorWith(two())
  await t.context(t.$('[data-op="tag"]', t.$('[data-path="0"]', t.net(0)))); await t.menuPick('Rename tag…')
  field(t, 'New name').value = 'B'
  await t.dialogButton('OK')
  assert.ok(t.dialog(), 'still open')
  assert.match(t.dialog().querySelector('.derr').textContent, /already used/)
  await t.dialogButton('Cancel')
  assert.equal(t.networks()[0].elements[0].tag, 'A')
})

test('T22 context menu: element, timer box, wire and multi-selection offer the TIA items', async () => {
  const p = projectWith([net([NO('A'), { k: 'box', fb: 'TON', inst: 'TON_1', args: { PT: 'T#1s' } }, NO('B')], [coil('Y')])])
  const t = await editorWith(p)
  let labels = await t.context(t.$('[data-path="0"]', t.net(0)))
  assert.deepEqual(labels, ['Cut', 'Copy', 'Paste', 'Delete', 'Rename tag…', 'Rewire tag…', 'Insert network', 'Open branch'])
  labels = await t.context(t.$('[data-path="1"]', t.net(0)))
  assert.ok(labels.includes('Rename instance…'))
  await t.menuPick('Rename instance…')
  assert.ok(t.input()); await t.type('MyTimer')
  assert.equal(t.networks()[0].elements[1].inst, 'MyTimer')
  labels = await t.context(t.slot(0, gap(1)))
  assert.deepEqual(labels, ['Cut', 'Copy', 'Paste', 'Delete', 'Insert network', 'Open branch'])
  t.select({ network: 0, paths: ['0', '2'] })
  labels = await t.context(t.$('[data-path="0"]', t.net(0)))
  assert.deepEqual(labels, ['Cut', 'Copy', 'Paste', 'Delete', 'Open branch around selection', 'Insert network'])
})

test('T23 context menu "Rewire tag…" reopens the operand box on the operand; "Insert network" inserts below', async () => {
  const t = await editorWith(two())
  await t.context(t.$('[data-op="tag"]', t.$('[data-path="0"]', t.net(0)))); await t.menuPick('Rewire tag…')
  assert.equal(t.input()?.value, 'A'); await t.type('C')
  assert.equal(t.networks()[0].elements[0].tag, 'C')
  await t.context(t.$('[data-path="0"]', t.net(1))); await t.menuPick('Insert network')
  assert.equal(t.networks().length, 3)
})

test('T24 dropping a tag on an operand sets it; a tag dropped on the bare rung only explains', async () => {
  const t = await editorWith(projectWith([net([NO(''), NO('A')], [coil('')])]))
  t.store.dragging.payload = { tag: 'B' }
  const span = t.$('[data-op="tag"]', t.$('[data-path="0"]', t.net(0)))
  const over = dragEvent(t, 'dragover'); span.dispatchEvent(over)
  assert.ok(over.defaultPrevented, 'an operand accepts a tag')
  span.dispatchEvent(dragEvent(t, 'drop')); await t.wait(10)
  assert.equal(t.networks()[0].elements[0].tag, 'B')
  assert.equal(t.store.dragging.payload, null)
  // dropped on a filled operand it replaces the name; on a coil operand too
  t.store.dragging.payload = { tag: 'C' }
  t.$('[data-op="tag"]', t.$('[data-path="1"]', t.net(0))).dispatchEvent(dragEvent(t, 'drop')); await t.wait(10)
  assert.equal(t.networks()[0].elements[1].tag, 'C')
  t.store.dragging.payload = { tag: 'Z' }
  t.$('.coils [data-op="tag"]', t.net(0)).dispatchEvent(dragEvent(t, 'drop')); await t.wait(10)
  assert.equal(t.networks()[0].coils[0].tag, 'Z')
  // not on an operand
  t.store.dragging.payload = { tag: 'B' }
  const before = JSON.stringify(t.networks())
  t.net(0).dispatchEvent(dragEvent(t, 'drop')); await t.wait(10)
  assert.equal(JSON.stringify(t.networks()), before)
  assert.match(t.toast(), /Drop the tag onto an operand/)
})

// The learner's rung: a path started in front of S1 inside the seal-in, contact m on it, not joined yet.
const BOOLS = ['S1', 'K1', 'B2', 'S3', 'S4', 'S5', 'Man'].map((name) => ({ name, type: 'Bool', address: '' }))
const sealIn = (tags = BOOLS) => projectWith([net([{ k: 'branch', closed: true, branches: [[NO('S1')], [NO('K1')]] }, NC('B2')], [coil('K1')])], tags)
const openBeforeS1 = () => projectWith([net([{ k: 'branch', closed: true, branches: [[{ k: 'branch', closed: false, branches: [[], [NO('m')]] }, NO('S1')], [NO('K1')]] }, NC('B2')], [coil('K1')])], [...BOOLS, { name: 'm', type: 'Bool', address: '' }])
const joinTargets = (t) => t.$$('.wire-slot.join-target', t.net(0)).map((s) => s.dataset.gap)

test('T25 an open branch puts a "!" marker in the network header with the message in its title; closing removes it', async () => {
  const t = await editorWith(openBeforeS1())
  const err = t.$('.net-err', t.net(0))
  assert.ok(err, 'marker present'); assert.ok(t.$('.net-head .net-err', t.net(0)), 'in the network header')
  assert.ok(err.title.length > 0, 'message in the title')
  assert.equal(t.$('.rung-warning', t.net(0)), null, 'no banner')
  await t.clickSlot(0, gap(2, [0, 0])); await t.fav('Close branch')
  assert.equal(t.$('.net-err', t.net(0)), null, 'marker gone once the branch is closed')
})

test('T26 a complete network has no error marker', async () => {
  const t = await editorWith(two())
  assert.equal(t.$('.net-err', t.net(0)), null)
  assert.equal(t.$('.net-err', t.net(1)), null)
})

test('T27 shortcuts: Shift+F4 set, F5 empty box, F6 reset, F7 assignment, F8 open branch, F10 compare, Ctrl+R network', async () => {
  const t = await editorWith(projectWith([net([NO('A')])]))
  t.select({ network: 0, gap: gap(1) })
  await t.shortcut('F4', { shiftKey: true }); await t.type('Y')
  await t.shortcut('F6', { shiftKey: true }); await t.type('Z')
  await t.shortcut('F7', { shiftKey: true }); await t.type('Y')
  assert.deepEqual(t.networks()[0].coils.map((c) => c.k), ['set', 'reset', 'coil'])
  t.select({ network: 0, gap: gap(1) })
  await t.shortcut('F10', { shiftKey: true })
  assert.deepEqual([t.networks()[0].elements[1].k, t.networks()[0].elements[1].op], ['cmp', '=='])
  t.key(t.input(), 'Escape'); await t.wait(5)
  t.select({ network: 0, gap: gap(2) })
  await t.shortcut('F5', { shiftKey: true })
  assert.equal(t.networks()[0].elements[2].k, 'empty')
  assert.ok(t.input(), 'name box open'); t.key(t.input(), 'Escape'); await t.wait(5)
  t.select({ network: 0, gap: gap(0) })
  await t.shortcut('F8', { shiftKey: true })
  assert.equal(t.networks()[0].elements[0].k, 'branch')
  assert.equal(t.networks()[0].elements[0].closed, false)
  assert.ok(t.$('.net-err', t.net(0)))
  const n = t.networks().length
  await t.shortcut('r', { ctrlKey: true }); await t.wait(10)
  assert.equal(t.networks().length, n + 1)
})

test('T28 a click on an empty operand opens it; Enter / typing on a selected instruction edits it', async () => {
  const t = await editorWith(projectWith([net([NO(''), NO('A')], [coil('Y')])]))
  t.$('[data-op="tag"]', t.$('[data-path="0"]', t.net(0))).click(); await t.wait(10)
  assert.ok(t.input()); t.key(t.input(), 'Escape'); await t.wait(5)
  t.select({ network: 0, path: [1] }); await t.shortcut('B')
  assert.equal(t.input()?.value, 'B', 'typing seeds the box')
  await t.type('B')
  assert.equal(t.networks()[0].elements[1].tag, 'B')
})

/* ============================================ behaviour kept from the old editor == */

test('L01 an empty network is one selectable connection; there is no placeholder to click', async () => {
  const t = await editorWith(projectWith([net()]))
  const s = t.slot(0, gap(0))
  assert.ok(s, 'one connection')
  assert.equal(t.$$('[data-gap]', t.net(0)).length, 1)
  await t.clickSlot(0, gap(0))
  assert.deepEqual(t.store.state.selection.gap, gap(0))
  assert.ok(t.slot(0, gap(0)).classList.contains('sel'))
})

test('L03 a contact inserted at a connection lands exactly between its neighbours and opens the operand box', async () => {
  const t = await editorWith(two())
  await t.clickSlot(0, gap(1)); await t.fav('Normally closed contact')
  assert.deepEqual(t.networks()[0].elements.map((e) => e.k), ['NO', 'NC', 'NO'])
  assert.ok(t.input(), 'operand box open')
  await t.type('C')
  assert.equal(t.networks()[0].elements[1].tag, 'C')
  assert.equal(t.input(), null)
})

test('L03b inserting with an instruction selected puts the new one to its right', async () => {
  const t = await editorWith(two())
  t.select({ network: 0, path: [0] }); await t.fav('Normally closed contact'); await t.type('C')
  assert.deepEqual(t.networks()[0].elements.map((e) => e.tag), ['A', 'C', 'B'])
})

test('L04 insert before the first and after the last instruction', async () => {
  const t = await editorWith(two())
  await t.clickSlot(0, gap(0)); await t.fav('Normally open contact'); await t.type('C')
  await t.clickSlot(0, gap(3)); await t.fav('Normally open contact'); await t.type('C')
  assert.deepEqual(t.networks()[0].elements.map((e) => e.tag), ['C', 'A', 'B', 'C'])
})

test('L05 building contact → assignment in an empty network needs only the favorites and two names', async () => {
  const t = await editorWith(projectWith([net()]))
  await t.clickSlot(0, gap(0)); await t.fav('Normally open contact'); await t.type('A')
  await t.fav('Assignment'); await t.type('Y')
  assert.deepEqual(t.networks()[0], { ...t.networks()[0], elements: [NO('A')], coils: [coil('Y')] })
})

test('L07 an unknown name is kept without creating a tag, and the operand is marked unknown', async () => {
  const t = await editorWith(projectWith([net()]))
  await t.clickSlot(0, gap(0)); await t.fav('Normally open contact'); await t.type('Typo1')
  assert.equal(t.networks()[0].elements[0].tag, 'Typo1')
  assert.equal(t.store.state.project.tags.some((x) => x.name === 'Typo1'), false)
  assert.ok(t.$('.tagname.unknown', t.net(0)), 'unknown operand is marked')
})

test('L08 an invalid name is refused and the box stays open', async () => {
  const t = await editorWith(projectWith([net([NO('')])]))
  t.select({ network: 0, path: [0] }); await t.run('editOperand'); await t.wait(10)
  await t.type('2 bad')
  assert.ok(t.input(), 'still open')
  assert.match(t.toast(), /not a valid tag name/)
})

test('L09 assignments go to the output column; Set/Reset shortcuts too, and the rung itself is unchanged', async () => {
  const t = await editorWith(projectWith([net([NO('A')])]))
  t.select({ network: 0 }); await t.fav('Assignment'); await t.type('Y')
  await t.fav('Assignment'); await t.type('Z')
  t.select({ network: 0, gap: gap(0) }); await t.shortcut('F4', { shiftKey: true }); await t.type('Y')
  assert.deepEqual(t.networks()[0].coils.map((c) => `${c.k}:${c.tag}`), ['coil:Y', 'coil:Z', 'set:Y'])
  assert.deepEqual(t.networks()[0].elements, [NO('A')], 'the rung itself is unchanged')
})

test('L10 timer opens on its preset; counter on PV, Tab reaches R and Shift+Tab goes back', async () => {
  const t = await editorWith(projectWith([net([NO('A')], [coil('Y')])]))
  await t.clickSlot(0, gap(1)); t.api().insert('box:TON'); await t.wait(40)
  assert.equal(t.input()?.placeholder, 'e.g. T#5s')
  await t.type('T#3s')
  assert.equal(t.networks()[0].elements[1].args.PT, 'T#3s')
  await t.clickSlot(0, gap(2)); t.api().insert('box:CTU'); await t.wait(40)
  await t.type('5', 'Tab')
  assert.equal(t.networks()[0].elements[2].args.PV, '5')
  assert.ok(t.input(), 'Tab opened the next operand (R)')
  await t.type('B', 'Tab', { shiftKey: true })
  assert.equal(t.networks()[0].elements[2].args.R, 'B')
  assert.equal(t.input()?.value, '5', 'Shift+Tab went back to PV')
})

test('L11 Tab walks operands in reading order and never stops on a wire', async () => {
  const t = await editorWith(projectWith([net([NO('A'), { k: 'branch', closed: true, branches: [[NO('B')], [NO('C')]] }], [coil('Y')])]))
  t.select({ network: 0, path: [0] }); await t.run('editOperand'); await t.wait(10)
  const seen = []
  for (let i = 0; i < 4; i++) { seen.push(t.input()?.value); await t.type(t.input().value, 'Tab') }
  assert.deepEqual(seen, ['A', 'B', 'C', 'Y'])
  assert.equal(t.input(), null, 'Tab after the last operand stops')
  assert.equal(t.$('.quick-menu'), null, 'no menu opened on a wire')
})

test('L12 Esc cancels an operand edit and keeps the old value', async () => {
  const t = await editorWith(two())
  t.select({ network: 0, path: [0] }); await t.run('editOperand'); await t.wait(10)
  await t.type('B', 'Escape')
  assert.equal(t.networks()[0].elements[0].tag, 'A')
})

test('L13 keyboard shortcuts insert at the selected connection (Shift+F2/F3/F7)', async () => {
  const t = await editorWith(two())
  t.select({ network: 0, gap: gap(1) }); await t.wait(5)
  await t.shortcut('F3', { shiftKey: true }); await t.type('C')
  assert.deepEqual(t.networks()[0].elements.map((e) => `${e.k}:${e.tag}`), ['NO:A', 'NC:C', 'NO:B'])
  t.select({ network: 1, gap: gap(1) }); await t.wait(5)
  await t.shortcut('F7', { shiftKey: true }); await t.type('Y')
  assert.equal(t.networks()[1].coils.length, 2)
})

test('L16 an empty box converted to ADD becomes a math box and its three operands can be filled', async () => {
  const t = await editorWith(projectWith([net([NO('A')], [coil('Y')])]))
  await t.clickSlot(0, gap(1)); await t.fav('Empty box'); await t.type('add')
  const e = t.networks()[0].elements[1]
  assert.deepEqual([e.k, e.op], ['math', 'add'])
  await t.type('N1', 'Tab'); await t.type('1', 'Tab'); await t.type('N1')
  assert.deepEqual(['a', 'b', 'dest'].map((x) => t.networks()[0].elements[1][x]), ['N1', '1', 'N1'])
})

test('L17 parallel path around a contact: start from the contact, add to the lower path, close from the connection', async () => {
  const t = await editorWith(projectWith([net([NO('A'), NC('B')], [coil('Y')])]))
  t.select({ network: 0, path: [0] }); await t.run('insBranch'); await t.wait(10)
  t.select({ network: 0, gap: gap(0, [0, 1]) }); await t.shortcut('F2', { shiftKey: true }); await t.type('Y')
  await t.clickSlot(0, gap(1))
  const labels = await t.context(t.slot(0, gap(1)))
  assert.ok(labels.includes('Close branch'), 'close offered on a valid connection')
  assert.equal(labels.includes('Open branch'), false, 'no second open while one is unfinished')
  await t.menuPick('Close branch')
  const br = t.networks()[0].elements[0]
  assert.deepEqual([br.k, br.closed, br.branches.map((l) => l.map((e) => e.tag))], ['branch', true, [['A'], ['Y']]])
  assert.equal(t.$('.net-err', t.net(0)), null)
})

test('L18 parallel path from the context menu, then add a third path and remove one', async () => {
  const t = await editorWith(projectWith([net([NO('A'), { k: 'branch', closed: true, branches: [[NO('B')], [NO('C')]] }], [coil('Y')])]))
  t.select({ network: 0, path: [1, 0, 0] }); t.api().insert('addPath'); await t.wait(10)
  assert.equal(t.networks()[0].elements[1].branches.length, 3)
  t.select({ network: 0, gap: gap(0, [1, 2]) }); await t.shortcut('F2', { shiftKey: true }); await t.type('A')
  await t.run('closeBranch'); await t.wait(10)
  assert.equal(t.networks()[0].elements[1].closed, true)
  t.select({ network: 0, path: [1, 2, 0] }); t.api().insert('removeBranch'); await t.wait(10)
  assert.deepEqual(t.networks()[0].elements.map((e) => e.tag), ['A', 'B'], 'remove keeps the top path')
})

test('L18b a selected branch offers "Insert parallel path" in its context menu', async () => {
  const t = await editorWith(projectWith([net([NO('A'), { k: 'branch', closed: true, branches: [[NO('B')], [NO('C')]] }], [coil('Y')])]))
  t.select({ network: 0, branch: [1] }); await t.wait(5)
  const labels = await t.context(t.$('.branch', t.net(0)))
  assert.ok(labels.includes('Insert parallel path'))
  await t.menuPick('Insert parallel path')
  assert.equal(t.networks()[0].elements[1].branches.length, 3)
})

test('L19 closing a path that is still empty is refused and changes nothing', async () => {
  const t = await editorWith(projectWith([net([NO('A')], [coil('Y')])]))
  t.select({ network: 0, gap: gap(1) }); await t.run('insBranch'); await t.wait(10)
  const before = JSON.stringify(t.networks())
  await t.run('closeBranch'); await t.wait(10)
  assert.equal(JSON.stringify(t.networks()), before)
  assert.match(t.toast(), /empty/i)
})

test('L20 delete an instruction, a coil, a whole branch, then undo and redo each', async () => {
  const t = await editorWith(projectWith([net([NO('A'), { k: 'branch', closed: true, branches: [[NO('B')], [NO('C')]] }], [coil('Y'), coil('Z')])]))
  const snap = () => JSON.stringify(t.networks())
  const s0 = snap()
  t.select({ network: 0, path: [0] }); await t.run('delete'); await t.wait(10)
  assert.equal(t.networks()[0].elements[0].k, 'branch')
  const s1 = snap()
  t.select({ network: 0, coil: 1 }); await t.run('delete'); await t.wait(10)
  assert.equal(t.networks()[0].coils.length, 1)
  t.select({ network: 0, branch: [0] }); await t.run('delete'); await t.wait(10)
  assert.deepEqual(t.networks()[0].elements, [NO('B')])
  await t.run('undo'); await t.run('undo'); await t.wait(10)
  assert.equal(snap(), s1)
  await t.run('undo'); await t.wait(10)
  assert.equal(snap(), s0)
  await t.run('redo'); await t.wait(10)
  assert.equal(snap(), s1)
})

test('L21 deleting the only contact of a parallel path removes the empty path, not the rung', async () => {
  const t = await editorWith(projectWith([net([NO('A'), { k: 'branch', closed: true, branches: [[NO('B')], [NO('C')]] }], [coil('Y')])]))
  t.select({ network: 0, path: [1, 1, 0] }); await t.run('delete'); await t.wait(10)
  assert.deepEqual(t.networks()[0].elements.map((e) => e.tag), ['A', 'B'])
})

test('L22 Delete on a connection deletes nothing and records no undo step', async () => {
  const t = await editorWith(two())
  const undo = t.store.state.undo.length
  t.select({ network: 0, gap: gap(1) }); await t.run('delete'); await t.wait(10)
  assert.equal(t.networks()[0].elements.length, 2)
  assert.equal(t.store.state.undo.length, undo)
})

test('L23 deleting a selected network explains how to undo', async () => {
  const t = await editorWith(two())
  t.select({ network: 1 }); await t.run('delete'); await t.wait(10)
  assert.equal(t.networks().length, 1)
  assert.match(t.toast(), /Ctrl\+Z/)
})

test('L24 new networks: favorites button below, Ctrl+R below, context menu, API above; the new network\'s first connection is selected', async () => {
  const t = await editorWith(two())
  const titles = () => t.networks().map((n) => n.title || '-')
  t.networks()[0].title = 'one'; t.networks()[1].title = 'two'
  t.select({ network: 0 }); await t.fav('Insert network')
  assert.deepEqual(titles(), ['one', '-', 'two'])
  assert.deepEqual(t.store.state.selection.gap, gap(0), 'first connection of the new network is selected')
  assert.equal(t.store.state.selection.network, 1)
  t.select({ network: 2 }); await t.run('insertNetwork'); await t.wait(10)
  assert.deepEqual(titles(), ['one', '-', 'two', '-'])
  t.select({ network: 0 }); await t.context(t.net(0)); await t.menuPick('Insert network')
  assert.deepEqual(titles(), ['one', '-', '-', 'two', '-'])
  t.select({ network: 1 }); t.api().insertNetwork(false); await t.wait(10)
  assert.equal(titles()[1], '-'); assert.equal(titles()[2], '-'); assert.equal(titles()[0], 'one')
  assert.equal(t.networks().length, 6)
})

test('L25 copy and paste a network: timer gets a new instance and the pasted network follows it', async () => {
  const p = projectWith([net([NO('A'), { k: 'box', fb: 'TON', inst: 'TON_1', args: { PT: 'T#1s' } }], [coil('Y')]), net([NO('TON_1.Q')], [coil('Z')])])
  p.blocks[0].networks[0].elements.push({ k: 'NO', tag: 'TON_1.Q' })
  const t = await editorWith(p)
  t.select({ network: 0 }); await t.run('copy'); await t.run('paste'); await t.wait(10)
  const pasted = t.networks()[1]
  assert.equal(pasted.elements[1].inst, 'TON_2')
  assert.equal(pasted.elements[2].tag, 'TON_2.Q', 'reference inside the pasted network follows the new timer')
  assert.equal(t.networks()[2].elements[0].tag, 'TON_1.Q', 'other networks keep pointing at the original')
})

test('L26 copy, cut and paste a single instruction and a single coil', async () => {
  const t = await editorWith(two())
  t.select({ network: 0, path: [0] }); await t.run('copy')
  t.select({ network: 1, gap: gap(0) }); await t.run('paste'); await t.wait(10)
  assert.deepEqual(t.networks()[1].elements.map((e) => e.tag), ['A', 'C'], 'instruction pasted at the selected connection')
  t.select({ network: 0, path: [1] }); await t.run('cut'); await t.wait(10)
  assert.deepEqual(t.networks()[0].elements.map((e) => e.tag), ['A'], 'cut removed only the instruction')
  t.select({ network: 1, path: [1] }); await t.run('paste'); await t.wait(10)
  assert.deepEqual(t.networks()[1].elements.map((e) => e.tag), ['A', 'C', 'B'], 'pasted after the selected instruction')
  t.select({ network: 0, coil: 0 }); await t.run('copy'); t.select({ network: 1, coil: 0 }); await t.run('paste'); await t.wait(10)
  assert.deepEqual(t.networks()[1].coils.map((c) => c.tag), ['Z', 'Y'])
})

test('L27 arrow keys walk connections and instructions left to right and networks up and down', async () => {
  const t = await editorWith(two())
  t.select({ network: 0, gap: gap(0) })
  const seq = []
  for (let i = 0; i < 4; i++) { await t.shortcut('ArrowRight'); const s = t.store.state.selection; seq.push(s.gap ? `g${s.gap.index}` : s.path ? `e${s.path}` : `c${s.coil}`) }
  assert.deepEqual(seq, ['e0', 'g1', 'e1', 'g2'])
  await t.shortcut('ArrowDown'); assert.equal(t.store.state.selection.network, 1)
})

test('L28 renaming a timer updates every reference in the block, in one undo step', async () => {
  const p = projectWith([net([NO('A'), { k: 'box', fb: 'TON', inst: 'TON_1', args: { PT: 'T#1s' } }], [coil('Y')]), net([NO('TON_1.Q')], [coil('Z')])])
  const t = await editorWith(p)
  await t.dbl(t.$('.tagname.inst', t.net(0))); await t.type('FillTimer')
  assert.equal(t.networks()[0].elements[1].inst, 'FillTimer')
  assert.equal(t.networks()[1].elements[0].tag, 'FillTimer.Q')
  await t.run('undo'); await t.wait(10)
  assert.equal(t.networks()[1].elements[0].tag, 'TON_1.Q')
})

test('L29 timer and counter pins are offered as suggestions', async () => {
  const t = await editorWith(projectWith([net([NO('A'), { k: 'box', fb: 'TON', inst: 'TON_1', args: { PT: 'T#1s' } }], [coil('Y')]), net([NO('')], [coil('Z')])]))
  t.select({ network: 1, path: [0] }); await t.run('editOperand'); await t.wait(10)
  const opts = t.$$('.op-list .op-row').map((r) => r.querySelector('.c-name').textContent)
  assert.ok(opts.includes('TON_1.Q'))
})

test('L42 the operand list is a tag table: name, data type, address, initial value, comment; Bool tags first', async () => {
  const p = projectWith([net([NO('')], [coil('Y')])], [{ name: 'Count', type: 'Int', address: '%MW20', comment: 'Pieces' }])
  p.blocks[0].interface.static.push({ name: 'Ready', type: 'Bool', init: 'TRUE', comment: 'Local flag' })
  const t = await editorWith(p)
  t.select({ network: 0, path: [0] }); await t.run('editOperand'); await t.wait(10)
  assert.deepEqual(t.$$('.op-list th').map((x) => x.textContent), ['Name', 'Data type', 'Address', 'Initial value', 'Comment'])
  const rows = opRows(t)
  assert.deepEqual(rows[0], ['A', 'Bool', '%I0.0', '', ''])
  assert.deepEqual(rows.find((r) => r[0] === 'Ready'), ['Ready', 'Bool', '', 'TRUE', 'Local flag'])
  assert.ok(rows.findIndex((r) => r[0] === 'Count') > rows.findIndex((r) => r[0] === 'Ready'), 'other data types after the Bool tags')
  assert.ok(t.$('.op-list .op-sep'), '"Other data types" separator')
})

test('L43 typing filters the list; arrows + Enter take a row; a click takes a row; Enter without arrows keeps the typed text', async () => {
  const t = await editorWith(projectWith([net([NO(''), NO('')], [coil('Y')])], [{ name: 'Start_PB', type: 'Bool', address: '%I1.0', comment: 'Start button' }]))
  t.select({ network: 0, path: [0] }); await t.run('editOperand'); await t.wait(10)
  await typeIn(t, 'start')
  assert.deepEqual(opRows(t).map((r) => r[0]), ['Start_PB'])
  t.key(t.input(), 'ArrowDown'); t.key(t.input(), 'Enter'); await t.wait(40)
  assert.equal(t.networks()[0].elements[0].tag, 'Start_PB')
  assert.equal(t.$('.op-list'), null, 'list closes with the box')
  t.select({ network: 0, path: [1] }); await t.run('editOperand'); await t.wait(10)
  t.$$('.op-list .op-row').find((r) => r.cells[0].textContent === 'B').click(); await t.wait(40)
  assert.equal(t.networks()[0].elements[1].tag, 'B')
  t.select({ network: 0, path: [1] }); await t.run('editOperand'); await t.wait(10)
  await typeIn(t, 'C'); t.key(t.input(), 'Enter'); await t.wait(40)
  assert.equal(t.networks()[0].elements[1].tag, 'C', 'typed text wins when no row was chosen')
})

test('L30 a long rung shows no tip, no warning and no error marker', async () => {
  const t = await editorWith(projectWith([net(Array.from({ length: 11 }, () => NO('A')), [coil('Y')])]))
  assert.equal(t.$('.rung-tip', t.net(0)), null)
  assert.equal(t.$('.rung-warning', t.net(0)), null)
  assert.equal(t.$('.net-err', t.net(0)), null)
})

test('L31 a program built only through the editor compiles without errors', async () => {
  const t = await editorWith(projectWith([net()]))
  await t.clickSlot(0, gap(0)); await t.fav('Normally open contact'); await t.type('A')
  t.api().insert('box:TON'); await t.wait(40); await t.type('T#2s')
  await t.fav('Assignment'); await t.type('Lamp')
  assert.match(t.toast(), /Define tag/)
  await t.context(t.$('.coils [data-op="tag"]', t.net(0))); await t.menuPick('Define tag…')
  await t.dialogButton('Define')
  assert.equal(t.store.state.project.tags.some((x) => x.name === 'Lamp'), true)
  const r = t.a.online.compile()
  assert.equal(r.ok, true, JSON.stringify(r.diagnostics))
})

test('L32 favorites bar inserts at the selection: contact, empty box, assignment, network', async () => {
  const t = await editorWith(two())
  t.select({ network: 0, gap: gap(1) }); await t.fav('Normally closed contact'); await t.type('C')
  assert.deepEqual(t.networks()[0].elements.map((e) => `${e.k}:${e.tag}`), ['NO:A', 'NC:C', 'NO:B'])
  await t.fav('Empty box')
  assert.deepEqual(t.networks()[0].elements.map((e) => e.k), ['NO', 'NC', 'empty', 'NO'], 'new instruction goes to the right of the selected one')
  t.key(t.input(), 'Escape'); await t.wait(5)
  t.select({ network: 1 }); await t.fav('Assignment'); await t.type('Y')
  assert.deepEqual(t.networks()[1].coils.map((c) => c.tag), ['Z', 'Y'])
  t.select({ network: 1 }); await t.fav('Insert network')
  assert.equal(t.networks().length, 3)
})

// ---- Everyday parallel-path patterns on a seal-in rung:  (S1 OR K1) AND NOT B2 -> K1 ----
/** Power at the coil for the given inputs, straight from the ladder model (independent of the code generator). */
function power(list, on) {
  return list.every((e) => e.k === 'branch' ? e.branches.some((l) => power(l, on)) : e.k === 'NC' ? !on[e.tag] : !!on[e.tag])
}
/** Truth table over the given tags, as a string of 0/1, so a wrong structure shows up as a different logic function. */
const table = (els, tags) => Array.from({ length: 1 << tags.length }, (_, m) => +power(els, Object.fromEntries(tags.map((tg, i) => [tg, !!(m >> i & 1)])))).join('')
const expectTable = (els, tags, fn) => assert.equal(table(els, tags), Array.from({ length: 1 << tags.length }, (_, m) => +fn(...tags.map((_, i) => !!(m >> i & 1)))).join(''))
async function clean(t) {
  assert.equal(t.$('.net-err', t.net(0)), null, 'no error marker on the network')
  const r = t.a.online.compile(); assert.equal(r.ok, true, JSON.stringify(r.diagnostics))
}

test('L33 OR around one contact inside the top path of a seal-in (select S1, Shift+F8, close from the connection)', async () => {
  const t = await editorWith(sealIn())
  t.select({ network: 0, path: [0, 0, 0] }); await t.run('insBranch'); await t.wait(10)
  t.select({ network: 0, gap: gap(0, [0, 0, 0, 1]) }); await t.shortcut('F2', { shiftKey: true }); await t.type('S3')
  await t.clickSlot(0, gap(1, [0, 0]))
  assert.ok((await t.context(t.slot(0, gap(1, [0, 0])))).includes('Close branch'))
  await t.menuPick('Close branch')
  const els = t.networks()[0].elements
  assert.deepEqual(els[0].branches[0][0].branches.map((l) => l.map((e) => e.tag)), [['S1'], ['S3']])
  expectTable(els, ['S1', 'S3', 'K1', 'B2'], (s1, s3, k1, b2) => (s1 || s3 || k1) && !b2)
  await clean(t)
})

test('L34 parallel path opened at the connection before S1 inside the top path, closed after S1', async () => {
  const t = await editorWith(sealIn())
  await t.clickSlot(0, gap(0, [0, 0])); await t.fav('Open branch')
  await t.shortcut('F2', { shiftKey: true }); await t.type('S3')
  await t.clickSlot(0, gap(2, [0, 0]))
  assert.ok((await t.context(t.slot(0, gap(2, [0, 0])))).includes('Close branch'))
  await t.menuPick('Close branch')
  const els = t.networks()[0].elements
  assert.deepEqual(els[0].branches[0].map((e) => e.k), ['branch'], 'S1 moved into the new OR, no leftovers')
  expectTable(els, ['S1', 'S3', 'K1', 'B2'], (s1, s3, k1, b2) => (s1 || s3 || k1) && !b2)
  await clean(t)
})

test('L35 OR inside the lower (holding) path: select K1, Shift+F8, add, Shift+F9', async () => {
  const t = await editorWith(sealIn())
  t.select({ network: 0, path: [0, 1, 0] }); await t.run('insBranch'); await t.wait(10)
  t.select({ network: 0, gap: gap(0, [0, 1, 0, 1]) }); await t.shortcut('F2', { shiftKey: true }); await t.type('S3')
  await t.run('closeBranch'); await t.wait(10)
  const els = t.networks()[0].elements
  assert.deepEqual(els[0].branches[1][0].branches.map((l) => l.map((e) => e.tag)), [['K1'], ['S3']])
  expectTable(els, ['S1', 'S3', 'K1', 'B2'], (s1, s3, k1, b2) => (s1 || s3 || k1) && !b2)
  await clean(t)
})

test('L36 series contact in the holding path, then a second OR on the main rung after the seal-in', async () => {
  const t = await editorWith(sealIn())
  await t.clickSlot(0, gap(1, [0, 1])); await t.fav('Normally open contact'); await t.type('S4')
  t.select({ network: 0, path: [1] }); await t.run('insBranch'); await t.wait(10)
  t.select({ network: 0, gap: gap(0, [1, 1]) }); await t.shortcut('F3', { shiftKey: true }); await t.type('S5')
  await t.clickSlot(0, gap(2)); await t.fav('Close branch')
  const els = t.networks()[0].elements
  assert.deepEqual(els.map((e) => e.k), ['branch', 'branch'])
  expectTable(els, ['S1', 'K1', 'S4', 'B2', 'S5'], (s1, k1, s4, b2, s5) => (s1 || (k1 && s4)) && (!b2 || !s5))
  await clean(t)
})

test('L37 bypass around the whole seal-in and B2, opened at the first connection of the rung', async () => {
  const t = await editorWith(sealIn())
  await t.clickSlot(0, gap(0)); await t.fav('Open branch')
  await t.shortcut('F2', { shiftKey: true }); await t.type('Man')
  await t.clickSlot(0, gap(3)); await t.fav('Close branch')
  const els = t.networks()[0].elements
  assert.equal(els.length, 1)
  expectTable(els, ['S1', 'K1', 'B2', 'Man'], (s1, k1, b2, man) => ((s1 || k1) && !b2) || man)
  await clean(t)
})

test('L38 a nested path cannot be closed on the outer rung; the menu does not offer it and Shift+F9 refuses', async () => {
  const t = await editorWith(sealIn())
  t.select({ network: 0, path: [0, 0, 0] }); await t.run('insBranch'); await t.wait(10)
  t.select({ network: 0, gap: gap(0, [0, 0, 0, 1]) }); await t.shortcut('F2', { shiftKey: true }); await t.type('S3')
  await t.clickSlot(0, gap(2))
  assert.equal((await t.context(t.slot(0, gap(2)))).includes('Close branch'), false)
  await t.shortcut('Escape')
  const before = JSON.stringify(t.networks())
  t.select({ network: 0, gap: gap(2) }); await t.run('closeBranch'); await t.wait(10)
  assert.equal(JSON.stringify(t.networks()), before)
  assert.match(t.toast(), /same parent rung/i)
})

test('L39 a new tag name survives moving on: it stays as an unknown operand, no bubble, no tag created', async () => {
  const t = await editorWith(sealIn(BOOLS.filter((x) => x.name !== 'S3' && x.name !== 'S4')))
  t.select({ network: 0, path: [0, 1, 0] }); await t.run('insBranch'); await t.wait(10)
  t.select({ network: 0, gap: gap(0, [0, 1, 0, 1]) }); await t.shortcut('F2', { shiftKey: true }); await t.type('S3')
  assert.equal(t.bubble(), null, 'no bubble to answer')
  assert.equal(t.networks()[0].elements[0].branches[1][0].branches[1][0].tag, 'S3', 'name written right away')
  await t.run('closeBranch'); await t.wait(10)   // Shift+F9 straight away
  assert.deepEqual(t.networks()[0].elements[0].branches[1][0].branches.map((l) => l.map((e) => e.tag)), [['K1'], ['S3']])
  assert.equal(t.store.state.project.tags.some((x) => x.name === 'S3'), false, 'no tag created')
  assert.ok(t.$('.tagname.unknown', t.net(0)), 'S3 is marked unknown')
  await t.clickSlot(0, gap(1, [0, 0])); await t.fav('Normally open contact'); await t.type('S4')
  assert.equal(t.networks()[0].elements[0].branches[0][1].tag, 'S4')
})

const dragStartEnd = (t) => t.$('.branch-end', t.net(0)).dispatchEvent(dragEvent(t, 'dragstart'))

test('L40 an open path marks only the connections where it may join (here: just after S1)', async () => {
  const t = await editorWith(openBeforeS1())
  assert.deepEqual(joinTargets(t), [JSON.stringify(gap(2, [0, 0]))])
  await t.clickSlot(0, gap(2, [0, 0]))
  const labels = await t.context(t.slot(0, gap(2, [0, 0])))
  assert.equal(labels.includes('Close branch'), true)
  await t.menuPick('Close branch')
  const els = t.networks()[0].elements
  expectTable(els, ['S1', 'm', 'K1', 'B2'], (s1, m, k1, b2) => (s1 || m || k1) && !b2)
  assert.deepEqual(joinTargets(t), [], 'markers go away once joined')
  await clean(t)
})

test('L41 dropping the branch-end handle anywhere in the network snaps to the nearest join connection', async () => {
  const t = await editorWith(openBeforeS1())
  assert.ok(t.$('.branch-end svg', t.net(0)), 'the handle is an arrow')
  dragStartEnd(t)
  const over = dragEvent(t, 'dragover'); t.net(0).dispatchEvent(over)
  assert.ok(over.defaultPrevented, 'drop allowed away from the exact connection')
  assert.equal(t.$('.join-near', t.net(0))?.dataset.gap, JSON.stringify(gap(2, [0, 0])))
  t.net(0).dispatchEvent(dragEvent(t, 'drop')); await t.wait(10)
  assert.equal(t.networks()[0].elements[0].branches[0][0].closed, true)
  assert.equal(t.$('.join-near', t.document.body), null)
  await clean(t)
})
