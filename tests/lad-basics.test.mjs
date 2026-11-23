import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileProject } from '../src/core/engine.js';
import { generate } from '../src/core/codegen.js';
import { validateLadderNetwork } from '../src/core/ladder-edit.js';
import { sampleProject } from '../src/core/model.js';

const lib = n => JSON.parse(readFileSync(new URL(`../node_modules/strucpp/libs/${n}.stlib`, import.meta.url), 'utf8'));
const LIBS = [lib('iec-std-functions'), lib('iec-standard-fb')];
const B = (name, i) => ({ name, type: 'Bool', address: `%I0.${i}` });
function project(networks, extra = []) {
  const p = sampleProject();
  p.tags = [B('Go', 0), { name: 'Out', type: 'Bool', address: '%Q0.0' }, { name: 'Res', type: 'Bool', address: '%Q0.1' },
    { name: 'A', type: 'Int', address: '%MW10' }, { name: 'B', type: 'Int', address: '%MW12' }, { name: 'R', type: 'Int', address: '%MW14' },
    { name: 'X', type: 'Real', address: '' }, ...extra];
  p.blocks[0].networks = networks;
  return p;
}
const coilOut = { k: 'coil', tag: 'Out' };
const rig = (p) => {
  let now = 0;
  const r = compileProject(p, LIBS, { clock: () => now });
  assert.equal(r.ok, true, JSON.stringify(r.diagnostics) + '\n' + (r.source ?? ''));
  const m = r.machine; m.reset();
  return { m, advance: ms => { for (let i = 0; i < ms; i++) { now += 1e6; m.step(now); } } };
};
const errors = (p) => generate(p).errors;

test('Timer pin used in an earlier network resolves and follows the timer next scan', () => {
  const p = project([
    { elements: [{ k: 'NO', tag: 'T1.Q' }], coils: [{ k: 'coil', tag: 'Res' }] },
    { elements: [{ k: 'NO', tag: 'Go' }, { k: 'box', fb: 'TON', inst: 'T1', args: { PT: 'T#100ms' } }], coils: [coilOut] },
  ]);
  assert.deepEqual(errors(p), []);
  const { m, advance } = rig(p);
  m.writeGlobal('Go', true); advance(50);
  assert.equal(m.readGlobal('Res'), false);
  advance(200);
  assert.equal(m.readGlobal('Res'), true);
  assert.equal(m.readGlobal('Out'), true);
  m.writeGlobal('Go', false); advance(30);
  assert.equal(m.readGlobal('Res'), false);
});

test('Auto-named instances and edge elements can be referenced from an earlier network', () => {
  const p = project([
    { elements: [{ k: 'NO', tag: 'TON_1.Q' }], coils: [{ k: 'coil', tag: 'Res' }] },
    { elements: [{ k: 'NO', tag: 'Go' }, { k: 'box', fb: 'TON', args: { PT: 'T#50ms' } }], coils: [] },
  ]);
  assert.deepEqual(errors(p), []);
  const q = project([
    { elements: [{ k: 'NO', tag: 'E1.Q' }], coils: [{ k: 'coil', tag: 'Res' }] },
    { elements: [{ k: 'branch', branches: [[{ k: 'P', tag: 'Go', inst: 'E1' }], [{ k: 'NO', tag: 'Out' }]] }], coils: [coilOut] },
  ]);
  assert.deepEqual(errors(q), []);
});

test('A missing instance still reports an error that names the network', () => {
  const p = project([
    { elements: [{ k: 'NO', tag: 'Go' }], coils: [coilOut] },
    { elements: [{ k: 'NO', tag: 'Nope.Q' }], coils: [{ k: 'coil', tag: 'Res' }] },
  ]);
  const e = errors(p).filter(x => /Nope/.test(x.message));
  assert.equal(e.length, 1);
  assert.equal(e[0].network, 1);
  assert.match(e[0].message, /not defined/);
});

test('Math: ADD SUB MUL DIV act only while the rung is true, with literal and tag operands', () => {
  const rung = (op, a, b) => ({ elements: [{ k: 'NO', tag: 'Go' }, { k: 'math', op, a, b, dest: 'R' }], coils: [coilOut] });
  for (const [op, a, b, want] of [['add', 'A', 'B', 17], ['sub', 'A', '3', 7], ['mul', '4', 'B', 28], ['div', 'A', 'B', 1]]) {
    const p = project([rung(op, a, b)]);
    assert.deepEqual(errors(p), [], op);
    const { m, advance } = rig(p);
    m.writeGlobal('A', 10); m.writeGlobal('B', 7);
    advance(30);
    assert.equal(m.readGlobal('R'), 0, `${op} idle while rung is false`);
    m.writeGlobal('Go', true); advance(30);
    assert.equal(m.readGlobal('R'), want, op);
    m.writeGlobal('R', 99); m.writeGlobal('Go', false); advance(30);
    assert.equal(m.readGlobal('R'), 99, `${op} does not run when power is off`);
  }
});

test('Math passes power through and generates one IF statement', () => {
  const p = project([{ elements: [{ k: 'NO', tag: 'Go' }, { k: 'math', op: 'add', a: 'A', b: '1', dest: 'A' }], coils: [coilOut] }]);
  const g = generate(p);
  assert.ok(g.source.includes('IF Go THEN A := A + 1; END_IF;'));
  assert.ok(g.source.includes('Out := Go;'), 'power flows through unchanged');
});

test('Math validation errors name the network', () => {
  const net = (m) => ({ elements: [{ k: 'NO', tag: 'Go' }, { k: 'math', op: 'add', a: 'A', b: '1', dest: 'R', ...m }], coils: [coilOut] });
  const check = (m, re) => {
    const e = errors(project([{ elements: [], coils: [] }, net(m)])).filter(x => re.test(x.message));
    assert.equal(e.length, 1, `${JSON.stringify(m)} -> ${re}`);
    assert.equal(e[0].network, 1);
  };
  check({ a: '' }, /Operand is missing/);
  check({ b: '' }, /Operand is missing/);
  check({ dest: '' }, /Operand is missing/);
  check({ a: 'Ghost' }, /Tag "Ghost" is not defined/);
  check({ dest: 'Ghost' }, /Tag "Ghost" is not defined/);
  check({ dest: '5' }, /stored in a tag/);
  check({ dest: 'Res' }, /needs a number tag/);
  check({ op: 'div', b: '0' }, /Division by zero/);
  check({ op: 'div', b: '0.0' }, /Division by zero/);
  check({ op: 'pow' }, /Unknown math operation/);
  assert.deepEqual(errors(project([net({ op: 'div', b: 'B' })])), [], 'a tag divisor is not rejected');
  assert.deepEqual(errors(project([net({ dest: 'X' })])), [], 'Real destination is allowed');
});

test('Instructions availability follows the open editor', async () => {
  globalThis.Element ??= class {};
  const { availability, PALETTE } = await import('../src/ui/palette.js');
  const item = n => PALETTE.flatMap(g => g.items).find(i => i.name === n || i.tia === n);
  assert.equal(availability(item('Assignment'), 'LAD').ok, true);
  assert.equal(availability(item('&'), 'FBD').ok, true);
  const no = availability(item('&'), 'LAD');
  assert.equal(no.ok, false);
  assert.equal(no.reason, 'Not available in ladder (LAD) — use this in a function block diagram (FBD) block');
  assert.equal(availability(item('MOVE'), 'FBD').ok, false);
  assert.match(availability(item('MOVE'), 'FBD').reason, /ladder \(LAD\) block/);
  for (const lang of ['SCL', null]) assert.equal(availability(item('Assignment'), lang).ok, false);
  const neg = item('Negate assignment');
  assert.deepEqual(neg.lad, { coil: 'ncoil' });
  assert.equal(availability(neg, 'LAD').ok, true);
  // the six items that have no ladder form yet are exactly the ones dimmed in LAD
  const dimmed = PALETTE.flatMap(g => g.items).filter(i => !availability(i, 'LAD').ok).map(i => i.tia);
  assert.deepEqual(dimmed, ['R_TRIG', 'F_TRIG', '&', '>=1', 'X', 'NOT']);
});

test('A rung "contact -> ADD" counts as having an output and runs the math while powered', () => {
  const net = { elements: [{ k: 'NO', tag: 'Go' }, { k: 'math', op: 'add', a: 'A', b: '5', dest: 'R' }], coils: [] };
  assert.deepEqual(validateLadderNetwork(net), []);
  assert.equal(validateLadderNetwork({ elements: [{ k: 'NO', tag: 'Go' }], coils: [] }).length, 1);
  const p = project([net]);
  assert.deepEqual(errors(p), []);
  const { m, advance } = rig(p);
  m.writeGlobal('A', 2); advance(30);
  assert.equal(m.readGlobal('R'), 0);
  m.writeGlobal('Go', true); advance(30);
  assert.equal(m.readGlobal('R'), 7);
});
