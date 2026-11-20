import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyOperand, instancesOf, operandFields, operandSequence, pinNames, renameInstance, suggestedTagType } from '../src/core/operands.js';

const names = (e) => operandFields(e).map((f) => f.field ?? f.pin);

test('operandFields lists the operands of every element kind in fill-in order', () => {
  assert.deepEqual(names({ k: 'NO' }), ['tag']);
  assert.deepEqual(names({ k: 'reset' }), ['tag']);
  assert.deepEqual(names({ k: 'cmp' }), ['a', 'b']);
  assert.deepEqual(names({ k: 'move' }), ['src', 'dest']);
  assert.deepEqual(names({ k: 'math' }), ['a', 'b', 'dest']);
  assert.deepEqual(names({ k: 'box', fb: 'TON' }), ['PT']);
  assert.deepEqual(names({ k: 'box', fb: 'CTU' }), ['PV', 'R']);
  assert.deepEqual(names({ k: 'box', fb: 'CTD' }), ['PV', 'LD']);
  assert.deepEqual(names({ k: 'box', fb: 'SR' }), ['R']);
  assert.deepEqual(names({ k: 'box', fb: 'RS' }), ['R1']);
  assert.deepEqual(names({ k: 'box', fb: 'R_TRIG' }), []);
  assert.deepEqual(names({ k: 'box', fb: 'NOPE' }), []);
  assert.equal(operandFields({ k: 'box', fb: 'CTU' })[0].kind, 'int');
});

test('classifyOperand tells tags, locals, literals, instance pins and unknown names apart', () => {
  const ctx = { tags: new Set(['Start', 'Level']), locals: new Set(['tmp']), instances: new Map([['TON_1', 'TON']]) };
  const c = (t) => classifyOperand(t, ctx);
  assert.equal(c(''), 'empty'); assert.equal(c('   '), 'empty'); assert.equal(c(undefined), 'empty');
  assert.equal(c('Start'), 'tag'); assert.equal(c('tmp'), 'local');
  for (const lit of ['10', '-3.5', '1e3', 'T#5s', 'TRUE', 'false', '16#FF', "'hi'"]) assert.equal(c(lit), 'literal', lit);
  assert.equal(c('TON_1.Q'), 'pin'); assert.equal(c('TON_1.ET'), 'pin');
  assert.equal(c('TON_1.Nope'), 'unknown'); assert.equal(c('TON_2.Q'), 'unknown');
  assert.equal(c('Strat'), 'unknown'); assert.equal(c('2fast'), 'unknown');
  assert.equal(classifyOperand('A.Q', { instances: new Set(['A']) }), 'pin');
});

test('suggestedTagType follows the operand kind', () => {
  assert.equal(suggestedTagType({ k: 'NO' }, 'tag'), 'Bool');
  assert.equal(suggestedTagType({ k: 'coil' }, { field: 'tag' }), 'Bool');
  assert.equal(suggestedTagType({ k: 'P' }, 'tag'), 'Bool');
  assert.equal(suggestedTagType({ k: 'cmp' }, 'a'), 'Int');
  assert.equal(suggestedTagType({ k: 'move' }, 'dest'), 'Int');
  assert.equal(suggestedTagType({ k: 'math' }, 'dest'), 'Int');
  assert.equal(suggestedTagType({ k: 'box', fb: 'TON' }, 'PT'), 'Time');
  assert.equal(suggestedTagType({ k: 'box', fb: 'CTU' }, 'PV'), 'Int');
  assert.equal(suggestedTagType({ k: 'box', fb: 'CTU' }, { pin: 'R' }), 'Bool');
});

const block = { networks: [
  { elements: [{ k: 'NO', tag: 'A' }, { k: 'box', fb: 'TON', inst: 'TON_1', args: { PT: 'T#1s' } },
    { k: 'branch', closed: true, branches: [[{ k: 'P', tag: 'B', inst: 'P_1' }], [{ k: 'branch', branches: [[{ k: 'box', fb: 'CTU', inst: 'CTU_1', args: {} }], []] }]] }], coils: [{ k: 'coil', tag: 'TON_1.Q' }] },
  { elements: [{ k: 'NO', tag: 'TON_1.Q' }, { k: 'cmp', op: '>', a: 'CTU_1.CV', b: '3' }, { k: 'box', fb: 'TON', inst: 'TON_1' }], coils: [] },
] };

test('instancesOf finds boxes and edges, also inside parallel paths, once each', () => {
  assert.deepEqual(instancesOf(block), [{ name: 'TON_1', fb: 'TON' }, { name: 'P_1', fb: 'R_TRIG' }, { name: 'CTU_1', fb: 'CTU' }]);
  assert.deepEqual(instancesOf({}), []);
  assert.deepEqual(pinNames('TON'), [{ pin: 'Q', kind: 'bool' }, { pin: 'ET', kind: 'time' }]);
  assert.deepEqual(pinNames('XX'), []);
});

test('operandSequence is reading order: main rung, branch lanes top to bottom, then coils', () => {
  const seq = operandSequence(block.networks[0]).map((o) => `${o.at.coil !== undefined ? `c${o.at.coil}` : o.at.path.join('.')}:${o.name}`);
  assert.deepEqual(seq, ['0:tag', '1:PT', '2.0.0:tag', '2.1.0.0.0:PV', '2.1.0.0.0:R', 'c0:tag']);
});

test('renameInstance renames the box and every pin reference in the block, but not other names', () => {
  const b = JSON.parse(JSON.stringify(block));
  renameInstance(b, 'TON_1', 'FillTimer');
  assert.equal(b.networks[0].elements[1].inst, 'FillTimer');
  assert.equal(b.networks[0].coils[0].tag, 'FillTimer.Q');
  assert.equal(b.networks[1].elements[0].tag, 'FillTimer.Q');
  assert.equal(b.networks[1].elements[2].inst, 'FillTimer');
  assert.equal(b.networks[1].elements[1].a, 'CTU_1.CV');
  assert.equal(b.networks[0].elements[0].tag, 'A');
});
