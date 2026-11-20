// Every ladder editing action, driven through the real editor the way a learner uses it.
// The checklist this follows is docs/ladder-test-checklist.md (IDs in the test names).
import test from 'node:test'
import assert from 'node:assert/strict'
import { NC, NO, coil, editorWith, net, projectWith } from './support/dom-harness.mjs'

const two = () => projectWith([net([NO('A'), NO('B')], [coil('Y')]), net([NO('C')], [coil('Z')])])
const gap = (index, path = []) => ({ path, index })

test('L01 empty network shows "+ Add instruction" and the "Add output" placeholder', async () => {
  const t = await editorWith(projectWith([net()]))
  assert.equal(t.$('.gap-plus.pill', t.net(0))?.textContent, '+ Add instruction')
  assert.ok(t.$('.ghost-coil', t.net(0)), 'Add output placeholder')
})

test('L02 clicking + opens the quick menu with the basics in order', async () => {
  const t = await editorWith(two())
  await t.clickPlus(0, gap(1))
  assert.deepEqual(t.menuRows().slice(0, 8), ['Normally open contact', 'Normally closed contact', 'Output coil', 'Set coil (S)', 'Reset coil (R)', 'On-delay timer (TON)', 'Up counter (CTU)', 'Parallel path (OR)'])
  assert.ok(t.menuRows().includes('New network below') && t.menuRows().includes('More instructions…'))
})

test('L03 a contact picked from + lands exactly between the two contacts and opens the operand box', async () => {
  const t = await editorWith(two())
  await t.clickPlus(0, gap(1))
  await t.pick('Normally closed contact')
  assert.deepEqual(t.networks()[0].elements.map((e) => e.k), ['NO', 'NC', 'NO'])
  assert.ok(t.input(), 'operand box open')
  await t.type('C')
  assert.equal(t.networks()[0].elements[1].tag, 'C')
  assert.equal(t.input(), null)
})

test('L04 + before the first instruction and after the last one', async () => {
  const t = await editorWith(two())
  await t.clickPlus(0, gap(0)); await t.pick('Normally open contact'); await t.type('C')
  await t.clickPlus(0, gap(3)); await t.pick('Normally open contact'); await t.type('C')
  assert.deepEqual(t.networks()[0].elements.map((e) => e.tag), ['C', 'A', 'B', 'C'])
})

test('L05 building contact → coil in an empty network needs only clicks and two names', async () => {
  const t = await editorWith(projectWith([net()]))
  t.$('.gap-plus.pill', t.net(0)).click(); await t.wait(5)
  await t.pick('Normally open contact'); await t.type('A')
  t.$('.ghost-coil', t.net(0)).click(); await t.wait(40)
  await t.type('Y')
  assert.deepEqual(t.networks()[0], { ...t.networks()[0], elements: [NO('A')], coils: [coil('Y')] })
})

test('L06 an unknown name asks to create the tag; Create adds it with a sensible type', async () => {
  const t = await editorWith(projectWith([net()]))
  t.$('.gap-plus.pill', t.net(0)).click(); await t.wait(5)
  await t.pick('Normally open contact'); await t.type('Start_PB')
  assert.match(t.bubble()?.textContent ?? '', /Start_PB.*does not exist/)
  t.key(t.bubble(), 'Enter'); await t.wait(30)
  assert.deepEqual(t.store.state.project.tags.find((x) => x.name === 'Start_PB'), { name: 'Start_PB', type: 'Bool', address: '', comment: '' })
  assert.match(t.toast(), /created as Bool/)
})

test('L07 "Not now" keeps the name but creates no tag, and the operand is marked unknown', async () => {
  const t = await editorWith(projectWith([net()]))
  t.$('.gap-plus.pill', t.net(0)).click(); await t.wait(5)
  await t.pick('Normally open contact'); await t.type('Typo1')
  t.key(t.bubble(), 'Escape'); await t.wait(30)
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

test('L09 coils: Add output, + under the last coil, and Set/Reset from the menu go to the output column', async () => {
  const t = await editorWith(projectWith([net([NO('A')])]))
  t.$('.ghost-coil', t.net(0)).click(); await t.wait(40); await t.type('Y')
  t.$('.coil-plus', t.net(0)).click(); await t.wait(40); await t.type('Z')
  await t.clickPlus(0, gap(0)); await t.pick('Set coil (S)'); await t.type('Y')
  assert.deepEqual(t.networks()[0].coils.map((c) => `${c.k}:${c.tag}`), ['coil:Y', 'coil:Z', 'set:Y'])
  assert.deepEqual(t.networks()[0].elements, [NO('A')], 'the rung itself is unchanged')
})

test('L10 timer opens on its preset; counter on PV, Tab reaches R and Shift+Tab goes back', async () => {
  const t = await editorWith(projectWith([net([NO('A')], [coil('Y')])]))
  await t.clickPlus(0, gap(1)); await t.pick('On-delay timer (TON)')
  assert.equal(t.input()?.placeholder, 'e.g. T#5s')
  await t.type('T#3s')
  assert.equal(t.networks()[0].elements[1].args.PT, 'T#3s')
  await t.clickPlus(0, gap(2)); await t.pick('Up counter (CTU)')
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
  assert.equal(t.a.quickIsOpen(), false, 'no menu opened on a wire')
})

test('L12 Esc cancels an operand edit and keeps the old value', async () => {
  const t = await editorWith(two())
  t.select({ network: 0, path: [0] }); await t.run('editOperand'); await t.wait(10)
  await t.type('B', 'Escape')
  assert.equal(t.networks()[0].elements[0].tag, 'A')
})

test('L13 keyboard shortcuts insert at the selected wire (Shift+F2/F3/F7)', async () => {
  const t = await editorWith(two())
  t.select({ network: 0, gap: gap(1) }); await t.wait(5)
  await t.shortcut('F3', { shiftKey: true }); await t.type('C')
  assert.deepEqual(t.networks()[0].elements.map((e) => `${e.k}:${e.tag}`), ['NO:A', 'NC:C', 'NO:B'])
  t.select({ network: 1, gap: gap(1) }); await t.wait(5)
  await t.shortcut('F7', { shiftKey: true }); await t.type('Y')
  assert.equal(t.networks()[1].coils.length, 2)
})

test('L14 Shift+F2 works while the quick menu is open and closes it', async () => {
  const t = await editorWith(two())
  await t.clickPlus(0, gap(2))
  t.key(t.$('.quick-menu .qm-row'), 'F2', { shiftKey: true }); await t.wait(40)
  assert.equal(t.a.quickIsOpen(), false)
  assert.equal(t.networks()[0].elements.length, 3)
})

test('L15 quick menu: arrow keys move, Enter picks, Esc closes without inserting', async () => {
  const t = await editorWith(two())
  await t.clickPlus(0, gap(2))
  const rows = t.$$('.quick-menu .qm-row')
  t.key(rows[0], 'ArrowDown'); await t.wait(5)
  assert.equal(t.document.activeElement, rows[1])
  t.key(rows[1], 'Escape'); await t.wait(5)
  assert.equal(t.a.quickIsOpen(), false)
  assert.equal(t.networks()[0].elements.length, 2)
  await t.clickPlus(0, gap(2))
  const r2 = t.$$('.quick-menu .qm-row'); t.key(r2[0], 'ArrowDown'); t.key(t.document.activeElement, 'Enter'); await t.wait(40)
  assert.equal(t.networks()[0].elements[2].k, 'NC')
})

test('L16 "More instructions…" filters and inserts any ladder instruction (ADD)', async () => {
  const t = await editorWith(projectWith([net([NO('A')], [coil('Y')])]))
  await t.clickPlus(0, gap(1)); await t.pick('More instructions…')
  const f = t.$('.qm-filter'); f.value = 'add'; f.dispatchEvent(new t.a.window.Event('input', { bubbles: true })); await t.wait(5)
  t.key(f, 'Enter'); await t.wait(40)
  const e = t.networks()[0].elements[1]
  assert.deepEqual([e.k, e.op], ['math', 'add'])
  await t.type('N1', 'Tab'); await t.type('1', 'Tab'); await t.type('N1')
  assert.deepEqual([e.k, ...['a', 'b', 'dest'].map((x) => t.networks()[0].elements[1][x])], ['math', 'N1', '1', 'N1'])
})

test('L17 parallel path around a contact: start from the contact, add to the lower path, close from +', async () => {
  const t = await editorWith(projectWith([net([NO('A'), NC('B')], [coil('Y')])]))
  t.select({ network: 0, path: [0] }); await t.run('insBranch'); await t.wait(10)
  t.select({ network: 0, gap: gap(0, [0, 1]) }); await t.shortcut('F2', { shiftKey: true }); await t.type('Y')
  await t.clickPlus(0, gap(1))
  assert.equal(t.menuRows()[0], 'Close the parallel path here', 'close offered first on a valid wire')
  await t.pick('Close the parallel path here')
  const br = t.networks()[0].elements[0]
  assert.deepEqual([br.k, br.closed, br.branches.map((l) => l.map((e) => e.tag))], ['branch', true, [['A'], ['Y']]])
  assert.equal(t.$('.rung-warning', t.net(0)), null)
})

test('L18 parallel path from a wire on the menu, then add a third path and remove one', async () => {
  const t = await editorWith(projectWith([net([NO('A'), { k: 'branch', closed: true, branches: [[NO('B')], [NO('C')]] }], [coil('Y')])]))
  t.select({ network: 0, path: [1, 0, 0] }); t.api().insert('addPath'); await t.wait(10)
  assert.equal(t.networks()[0].elements[1].branches.length, 3)
  t.select({ network: 0, gap: gap(0, [1, 2]) }); await t.shortcut('F2', { shiftKey: true }); await t.type('A')
  await t.run('closeBranch'); await t.wait(10)
  assert.equal(t.networks()[0].elements[1].closed, true)
  t.select({ network: 0, path: [1, 2, 0] }); t.api().insert('removeBranch'); await t.wait(10)
  assert.deepEqual(t.networks()[0].elements.map((e) => e.tag), ['A', 'B'], 'remove keeps the top path')
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

test('L22 Delete on a wire deletes nothing and records no undo step', async () => {
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

test('L24 new networks: header button, "+ Network" between, Ctrl+R below, menu above, and at the end', async () => {
  const t = await editorWith(two())
  const titles = () => t.networks().map((n) => n.title || '-')
  t.networks()[0].title = 'one'; t.networks()[1].title = 'two'
  t.$('.rung-add', t.net(0)).click(); await t.wait(10)
  assert.deepEqual(titles(), ['one', '-', 'two'])
  t.$$('.net-gap .net-plus')[0].click(); await t.wait(10)
  assert.deepEqual(titles(), ['-', 'one', '-', 'two'])
  assert.deepEqual(t.store.state.selection.gap, gap(0), 'first wire of the new network is selected')
  t.select({ network: 1 }); await t.run('insertNetwork'); await t.wait(10)
  assert.equal(t.networks().length, 5); assert.equal(titles()[2], '-')
  t.select({ network: 1 }); t.api().insertNetwork(false); await t.wait(10)
  assert.equal(titles()[1], '-'); assert.equal(titles()[2], 'one')
  t.$('.add-network').click(); await t.wait(10)
  assert.equal(t.networks().length, 7); assert.equal(titles().at(-2), 'two')
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
  assert.deepEqual(t.networks()[1].elements.map((e) => e.tag), ['A', 'C'], 'instruction pasted at the selected wire')
  t.select({ network: 0, path: [1] }); await t.run('cut'); await t.wait(10)
  assert.deepEqual(t.networks()[0].elements.map((e) => e.tag), ['A'], 'cut removed only the instruction')
  t.select({ network: 1, path: [1] }); await t.run('paste'); await t.wait(10)
  assert.deepEqual(t.networks()[1].elements.map((e) => e.tag), ['A', 'C', 'B'], 'pasted after the selected instruction')
  t.select({ network: 0, coil: 0 }); await t.run('copy'); t.select({ network: 1, coil: 0 }); await t.run('paste'); await t.wait(10)
  assert.deepEqual(t.networks()[1].coils.map((c) => c.tag), ['Z', 'Y'])
})

test('L27 arrow keys walk wires and instructions left to right and networks up and down', async () => {
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

const opRows = (t) => t.$$('.op-list .op-row').map((r) => [...r.cells].map((c) => c.textContent))
const typeIn = async (t, text) => { const i = t.input(); i.value = text; i.dispatchEvent(new t.document.defaultView.Event('input', { bubbles: true })); await t.wait(5) }

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

test('L30 a long rung shows the split tip, but no warning', async () => {
  const t = await editorWith(projectWith([net(Array.from({ length: 11 }, () => NO('A')), [coil('Y')])]))
  assert.ok(t.$('.rung-tip', t.net(0)))
  assert.equal(t.$('.rung-warning', t.net(0)), null)
})

test('L31 a program built only through the editor compiles without errors', async () => {
  const t = await editorWith(projectWith([net()]))
  t.$('.gap-plus.pill', t.net(0)).click(); await t.wait(5)
  await t.pick('Normally open contact'); await t.type('A')
  await t.clickPlus(0, gap(1)); await t.pick('On-delay timer (TON)'); await t.type('T#2s')
  t.$('.ghost-coil', t.net(0)).click(); await t.wait(40); await t.type('Lamp')
  t.key(t.bubble(), 'Enter'); await t.wait(30)
  const r = t.a.online.compile()
  assert.equal(r.ok, true, JSON.stringify(r.diagnostics))
})

test('L32 favorites bar above the editor inserts at the selection (contact, timer, network)', async () => {
  const t = await editorWith(two())
  const fav = (name) => t.$$('.fav-bar .fav').find((b) => b.getAttribute('aria-label') === name)
  assert.ok(fav('Normally open contact') && fav('Output coil') && fav('TON  On-delay'), 'basic favorites are present')
  t.select({ network: 0, gap: gap(1) }); fav('Normally closed contact').click(); await t.wait(40); await t.type('C')
  assert.deepEqual(t.networks()[0].elements.map((e) => `${e.k}:${e.tag}`), ['NO:A', 'NC:C', 'NO:B'])
  t.select({ network: 1, gap: gap(1) }); fav('TON  On-delay').click(); await t.wait(40); await t.type('T#1s')
  assert.equal(t.networks()[1].elements[1].fb, 'TON')
  t.select({ network: 1 }); t.$$('.fav-bar .fav.text')[0].click(); await t.wait(10)
  assert.equal(t.networks().length, 3)
})

// ---- Everyday parallel-path patterns on a seal-in rung:  (S1 OR K1) AND NOT B2 -> K1 ----
const BOOLS = ['S1', 'K1', 'B2', 'S3', 'S4', 'S5', 'Man'].map((name) => ({ name, type: 'Bool', address: '' }))
const sealIn = (tags = BOOLS) => projectWith([net([{ k: 'branch', closed: true, branches: [[NO('S1')], [NO('K1')]] }, NC('B2')], [coil('K1')])], tags)
/** Power at the coil for the given inputs, straight from the ladder model (independent of the code generator). */
function power(list, on) {
  return list.every((e) => e.k === 'branch' ? e.branches.some((l) => power(l, on)) : e.k === 'NC' ? !on[e.tag] : !!on[e.tag])
}
/** Truth table over the given tags, as a string of 0/1, so a wrong structure shows up as a different logic function. */
const table = (els, tags) => Array.from({ length: 1 << tags.length }, (_, m) => +power(els, Object.fromEntries(tags.map((tg, i) => [tg, !!(m >> i & 1)])))).join('')
const expectTable = (els, tags, fn) => assert.equal(table(els, tags), Array.from({ length: 1 << tags.length }, (_, m) => +fn(...tags.map((_, i) => !!(m >> i & 1)))).join(''))
async function clean(t) {
  assert.equal(t.$('.rung-warning', t.net(0)), null, 'no warning on the rung')
  const r = t.a.online.compile(); assert.equal(r.ok, true, JSON.stringify(r.diagnostics))
}

test('L33 OR around one contact inside the top path of a seal-in (select S1, Shift+F8, close from +)', async () => {
  const t = await editorWith(sealIn())
  t.select({ network: 0, path: [0, 0, 0] }); await t.run('insBranch'); await t.wait(10)
  t.select({ network: 0, gap: gap(0, [0, 0, 0, 1]) }); await t.shortcut('F2', { shiftKey: true }); await t.type('S3')
  await t.clickPlus(0, gap(1, [0, 0]))
  assert.equal(t.menuRows()[0], 'Close the parallel path here')
  await t.pick('Close the parallel path here')
  const els = t.networks()[0].elements
  assert.deepEqual(els[0].branches[0][0].branches.map((l) => l.map((e) => e.tag)), [['S1'], ['S3']])
  expectTable(els, ['S1', 'S3', 'K1', 'B2'], (s1, s3, k1, b2) => (s1 || s3 || k1) && !b2)
  await clean(t)
})

test('L34 parallel path from the "+" before S1 inside the top path, closed after S1', async () => {
  const t = await editorWith(sealIn())
  await t.clickPlus(0, gap(0, [0, 0])); await t.pick('Parallel path (OR)')
  await t.shortcut('F2', { shiftKey: true }); await t.type('S3')
  await t.clickPlus(0, gap(2, [0, 0]))
  assert.equal(t.menuRows()[0], 'Close the parallel path here')
  await t.pick('Close the parallel path here')
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
  await t.clickPlus(0, gap(1, [0, 1])); await t.pick('Normally open contact'); await t.type('S4')
  t.select({ network: 0, path: [1] }); await t.run('insBranch'); await t.wait(10)
  t.select({ network: 0, gap: gap(0, [1, 1]) }); await t.shortcut('F3', { shiftKey: true }); await t.type('S5')
  await t.clickPlus(0, gap(2)); await t.pick('Close the parallel path here')
  const els = t.networks()[0].elements
  assert.deepEqual(els.map((e) => e.k), ['branch', 'branch'])
  expectTable(els, ['S1', 'K1', 'S4', 'B2', 'S5'], (s1, k1, s4, b2, s5) => (s1 || (k1 && s4)) && (!b2 || !s5))
  await clean(t)
})

test('L37 bypass around the whole seal-in and B2, started from the first wire of the rung', async () => {
  const t = await editorWith(sealIn())
  await t.clickPlus(0, gap(0)); await t.pick('Parallel path (OR)')
  await t.shortcut('F2', { shiftKey: true }); await t.type('Man')
  await t.clickPlus(0, gap(3)); await t.pick('Close the parallel path here')
  const els = t.networks()[0].elements
  assert.equal(els.length, 1)
  expectTable(els, ['S1', 'K1', 'B2', 'Man'], (s1, k1, b2, man) => ((s1 || k1) && !b2) || man)
  await clean(t)
})

test('L38 a nested path cannot be closed on the outer rung; the menu does not offer it and Shift+F9 refuses', async () => {
  const t = await editorWith(sealIn())
  t.select({ network: 0, path: [0, 0, 0] }); await t.run('insBranch'); await t.wait(10)
  t.select({ network: 0, gap: gap(0, [0, 0, 0, 1]) }); await t.shortcut('F2', { shiftKey: true }); await t.type('S3')
  await t.clickPlus(0, gap(2))
  assert.notEqual(t.menuRows()[0], 'Close the parallel path here')
  t.key(t.document.activeElement, 'Escape'); await t.wait(5)
  const before = JSON.stringify(t.networks())
  t.select({ network: 0, gap: gap(2) }); await t.run('closeBranch'); await t.wait(10)
  assert.equal(JSON.stringify(t.networks()), before)
  assert.match(t.toast(), /same parent rung/i)
})

test('L39 a new tag name survives moving on without answering the "does not exist" bubble', async () => {
  const t = await editorWith(sealIn(BOOLS.filter((x) => x.name !== 'S3' && x.name !== 'S4')))
  t.select({ network: 0, path: [0, 1, 0] }); await t.run('insBranch'); await t.wait(10)
  t.select({ network: 0, gap: gap(0, [0, 1, 0, 1]) }); await t.shortcut('F2', { shiftKey: true }); await t.type('S3')
  assert.ok(t.bubble(), 'bubble offered')
  assert.equal(t.networks()[0].elements[0].branches[1][0].branches[1][0].tag, 'S3', 'name written before the bubble is answered')
  await t.run('closeBranch'); await t.wait(10)   // Shift+F9 straight away
  assert.equal(t.bubble(), null)
  assert.deepEqual(t.networks()[0].elements[0].branches[1][0].branches.map((l) => l.map((e) => e.tag)), [['K1'], ['S3']])
  assert.equal(t.store.state.project.tags.some((x) => x.name === 'S3'), false, 'moving on is "Not now": no tag created')
  // Esc on the bubble also keeps the name (Create is covered by L06)
  await t.clickPlus(0, gap(1, [0, 0])); await t.pick('Normally open contact'); await t.type('S4')
  t.key(t.bubble(), 'Escape'); await t.wait(10)
  assert.equal(t.networks()[0].elements[0].branches[0][1].tag, 'S4')
})

// The learner's rung: a path started from the "+" in front of S1 inside the seal-in, contact m on it, not joined yet.
const openBeforeS1 = () => projectWith([net([{ k: 'branch', closed: true, branches: [[{ k: 'branch', closed: false, branches: [[], [NO('m')]] }, NO('S1')], [NO('K1')]] }, NC('B2')], [coil('K1')])], [...BOOLS, { name: 'm', type: 'Bool', address: '' }])
const joinTargets = (t) => t.$$('.wire-slot.join-target', t.net(0)).map((s) => s.dataset.gap)
function dragEvent(t, type) {
  const ev = new t.document.defaultView.Event(type, { bubbles: true, cancelable: true })
  const data = {}
  Object.defineProperty(ev, 'clientX', { value: 0 }); Object.defineProperty(ev, 'clientY', { value: 0 })
  Object.defineProperty(ev, 'dataTransfer', { value: { setData: (k, v) => { data[k] = v }, getData: (k) => data[k] ?? '', effectAllowed: '', dropEffect: '' } })
  return ev
}

test('L40 an open path marks only the wires where it may join (here: just after S1)', async () => {
  const t = await editorWith(openBeforeS1())
  assert.deepEqual(joinTargets(t), [JSON.stringify(gap(2, [0, 0]))])
  await t.clickPlus(0, gap(2, [0, 0]))
  assert.equal(t.menuRows()[0], 'Close the parallel path here')
  await t.pick('Close the parallel path here')
  const els = t.networks()[0].elements
  expectTable(els, ['S1', 'm', 'K1', 'B2'], (s1, m, k1, b2) => (s1 || m || k1) && !b2)
  assert.deepEqual(joinTargets(t), [], 'markers go away once joined')
  await clean(t)
})

test('L41 dropping "Drag to join" anywhere in the network snaps to the nearest join wire', async () => {
  const t = await editorWith(openBeforeS1())
  t.$('.branch-end', t.net(0)).dispatchEvent(dragEvent(t, 'dragstart'))
  const over = dragEvent(t, 'dragover'); t.net(0).dispatchEvent(over)
  assert.ok(over.defaultPrevented, 'drop allowed away from the exact wire')
  assert.equal(t.$('.join-near', t.net(0))?.dataset.gap, JSON.stringify(gap(2, [0, 0])))
  t.net(0).dispatchEvent(dragEvent(t, 'drop')); await t.wait(10)
  assert.equal(t.networks()[0].elements[0].branches[0][0].closed, true)
  assert.equal(t.$('.join-near', t.document.body), null)
  await clean(t)
})
