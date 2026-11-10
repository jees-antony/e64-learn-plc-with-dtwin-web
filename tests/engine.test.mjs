import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileProject } from '../src/core/engine.js';
import { newBlock, newNetwork, sampleProject } from '../src/core/model.js';

const lib = n => JSON.parse(readFileSync(new URL(`../node_modules/strucpp/libs/${n}.stlib`, import.meta.url), 'utf8'));
const LIBS = [lib('iec-std-functions'), lib('iec-standard-fb')];
let now = 0;
const rig = (project) => {
  now = 0;
  const r = compileProject(project, LIBS, { clock: () => now });
  assert.equal(r.ok, true, JSON.stringify(r.diagnostics) + '\n' + (r.source ?? ''));
  const m = r.machine; m.reset();
  const advance = ms => { for (let i = 0; i < ms; i++) { now += 1e6; m.step(now); } };
  return { m, r, advance, read: n => m.readGlobal(n), write: (n, v) => m.writeGlobal(n, v) };
};

test('Sample LAD project: seal-in motor, on-delay lamp, rising-edge element', () => {
  const { advance, read, write } = rig(sampleProject());
  advance(30);
  assert.equal(read('Motor'), false);
  write('Start', true); advance(30); write('Start', false); advance(30);
  assert.equal(read('Motor'), true, 'seal-in holds after Start is released');
  assert.equal(read('Lamp'), false, 'lamp waits 3 s');
  advance(3100);
  assert.equal(read('Lamp'), true);
  assert.equal(read('Count'), 1, 'CTU counted one start');
  write('Stop', true); advance(30);
  assert.equal(read('Motor'), false);
  assert.equal(read('Lamp'), false);
});

test('FBD network with a counter box and comparison, and SCL block', () => {
  const p = sampleProject();
  p.tags.push({ name: 'Pulse', type: 'Bool', address: '%I0.2', comment: '' }, { name: 'Full', type: 'Bool', address: '%Q0.2', comment: '' }, { name: 'Reset', type: 'Bool', address: '%I0.3', comment: '' });
  const fbd = newBlock('OB', 'Counting', 'FBD', 2);
  fbd.networks = [{ id: 'n1', title: 'Count pulses', comment: '', out: { tag: 'Full', mode: '=' },
    expr: { t: 'fb', fb: 'CTU', inst: 'PulseCnt', out: 'Q', args: { CU: { t: 'var', name: 'Pulse' }, R: { t: 'var', name: 'Reset' }, PV: { t: 'var', name: '3' } } } }];
  const scl = newBlock('OB', 'Maths', 'SCL', 3);
  scl.code = '  Count := Count + 1;\n  IF Count > 100 THEN Count := 0; END_IF;';
  p.blocks.push(fbd, scl);
  const { advance, read, write } = rig(p);
  for (let i = 0; i < 3; i++) { write('Pulse', true); advance(30); write('Pulse', false); advance(30); }
  assert.equal(read('Full'), true, 'counter reached PV');
  write('Reset', true); advance(30);
  assert.equal(read('Full'), false);
  assert.ok(read('Count') > 0, 'SCL block runs each cycle');
});

test('Interface variables, FB block and FC block compile and run', () => {
  const p = sampleProject();
  p.blocks = [];
  const fb = newBlock('FB', 'Blinker', 'SCL', 10);
  fb.interface.input = [{ name: 'Enable', type: 'Bool' }]; fb.interface.output = [{ name: 'Out', type: 'Bool' }];
  fb.interface.static = [{ name: 'Tick', type: 'Int' }];
  fb.code = '  IF Enable THEN Tick := Tick + 1; Out := (Tick MOD 4) < 2; ELSE Out := FALSE; END_IF;';
  const main = newBlock('OB', 'Main', 'SCL', 1);
  main.interface.static = [{ name: 'B', type: 'Blinker' }];
  main.code = '  B(Enable := Start);\n  Lamp := B.Out;';
  p.blocks.push(fb, main);
  const { advance, read, write } = rig(p);
  write('Start', true); advance(10 * 5);
  assert.ok(read('Lamp') === true || read('Lamp') === false);
  const seen = new Set(); for (let i = 0; i < 40; i++) { advance(10); seen.add(read('Lamp')); }
  assert.equal(seen.size, 2, 'lamp blinks');
});

test('Diagnostics point at the block and network', () => {
  const p = sampleProject();
  p.blocks[0].networks[1].elements[0].tag = 'Nope';
  const r = compileProject(p, LIBS);
  assert.equal(r.ok, false);
  assert.equal(r.diagnostics[0].network, 1);
  assert.match(r.diagnostics[0].message, /Nope/);
  const q = sampleProject(); q.tags[0].address = '%Z9';
  assert.match(compileProject(q, LIBS).diagnostics[0].message, /Address/);
  const s = sampleProject(); s.blocks[0] = Object.assign(newBlock('OB', 'Main', 'SCL', 1), { code: '  Motor := Strat;' });
  const d = compileProject(s, LIBS);
  assert.equal(d.ok, false);
  assert.equal(d.diagnostics[0].block, s.blocks[0].id);
});

test('A contact or coil on a non-Bool tag is rejected with the network number', () => {
  const p = sampleProject();
  p.blocks[0].networks[0].coils[0].tag = 'Count';
  const r = compileProject(p, LIBS);
  assert.equal(r.ok, false);
  assert.match(r.diagnostics[0].message, /Bool/);
  assert.equal(r.diagnostics[0].network, 0);
});
