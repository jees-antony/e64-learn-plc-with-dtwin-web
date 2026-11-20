import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileProject } from '../src/core/engine.js';
import { tankProject } from '../src/core/model.js';
import { CABINET, CABLE_GLANDS, CABLE_PATHS, CABLES, GLAND_HALF_LENGTH, IO, TANK, TERMINALS, TankProcess, WIRES, routeCore, routeFieldCore, routeWire, wiringList } from '../src/twin/tank-model.js';

const lib = n => JSON.parse(readFileSync(new URL(`../node_modules/strucpp/libs/${n}.stlib`, import.meta.url), 'utf8'));
const LIBS = [lib('iec-std-functions'), lib('iec-standard-fb')];

/** Closed loop: the tank program on the virtual CPU against the plant model, 10 ms steps. */
function loop() {
  let now = 0;
  const r = compileProject(tankProject(), LIBS, { clock: () => now });
  assert.equal(r.ok, true, JSON.stringify(r.diagnostics));
  const m = r.machine; m.reset();
  const plant = new TankProcess(); plant.cpuRun = true;
  const tagOf = addr => tankProject().tags.find(t => t.address === addr).name;
  const run = (seconds) => {
    for (let i = 0; i < seconds * 100; i++) {
      for (const io of IO.filter(x => x.dir === 'in')) m.writeGlobal(tagOf(io.addr), plant.inputs[io.addr]);
      now += 10e6; m.step(now);
      plant.q.Q0 = m.readGlobal(tagOf('%Q0.0')) === true; plant.q.Q1 = m.readGlobal(tagOf('%Q0.1')) === true;
      plant.step(0.01);
    }
  };
  const tap = (id) => { plant.buttons[id] = true; run(0.2); plant.buttons[id] = false; };
  return { plant, run, tap };
}

test('Tank program: S1 fills until the high level switch, S2 drains until the low level switch', () => {
  const { plant, run, tap } = loop();
  plant.level = 0.1; run(1);
  assert.equal(plant.valves.Y1, false, 'nothing happens without a button');
  tap('S1'); run(1);
  assert.equal(plant.valves.Y1, true, 'S1 latches the fill valve');
  run(40);
  assert.equal(plant.valves.Y1, false, 'B2 stops filling');
  assert.ok(Math.abs(plant.level - TANK.highAt) < 0.02, `stops at the high switch, got ${plant.level}`);
  tap('S2'); run(1);
  assert.equal(plant.valves.Y2, true, 'S2 latches the drain valve');
  run(80);
  assert.equal(plant.valves.Y2, false, 'B1 stops draining');
  assert.ok(Math.abs(plant.level - TANK.lowAt) < 0.02, `stops at the low switch, got ${plant.level}`);
});

test('Valves close when the CPU stops, and the tank overflows if filling never stops', () => {
  const p = new TankProcess(); p.cpuRun = true; p.q.Q0 = true;
  assert.equal(p.valves.Y1, true);
  p.cpuRun = false; assert.equal(p.valves.Y1, false, 'outputs drop in STOP');
  p.cpuRun = true; p.level = 0.99; p.step(2);
  assert.equal(p.level, 1); assert.equal(p.overflow, true);
});

test('Wiring data: every wire lands on a real terminal and no terminal joins two potentials', () => {
  const netAt = new Map();
  const land = (t, net, what) => {
    assert.ok(TERMINALS.has(t), `${what}: unknown terminal ${t}`);
    const base = t.replace(/f$/, '');
    if (netAt.has(base)) assert.equal(netAt.get(base), net, `${what}: ${base} would join ${netAt.get(base)} and ${net}`);
    netAt.set(base, net);
  };
  for (const w of WIRES) { land(w.from, w.net, `wire ${w.id}`); land(w.to, w.net, `wire ${w.id}`); assert.ok(routeWire(w.from, w.to).length >= 4); }
  for (const c of CABLES) for (const k of c.cores) {
    land(k.at, k.net, `${c.id}.${k.core}`);
    land(k.to, k.net, `${c.id}.${k.core}`);
  }
  for (const io of IO) assert.ok(TERMINALS.has(io.terminal), `${io.addr} terminal ${io.terminal}`);
});

test('Every tank cable joins its own cabinet gland to both sets of termination points', () => {
  const glands = new Set();
  const fieldPins = new Set();
  const rows = new Map(wiringList().map(row => [row.id, row]));
  for (const cable of CABLES) {
    const [x, y, z] = CABLE_GLANDS[cable.id];
    const face = cable.top ? 1 : -1;
    const [outer, ...jacket] = CABLE_PATHS[cable.id];
    assert.equal(y, cable.top ? CABINET.y1 : CABINET.y0);
    assert.equal(glands.has(x), false);
    glands.add(x);
    assert.deepEqual(outer, [x, y + face * GLAND_HALF_LENGTH, z]);
    for (const core of cable.cores) {
      const panelRoute = routeCore(cable, core.at);
      const fieldRoute = routeFieldCore(cable, core.to);
      assert.deepEqual(panelRoute[0], TERMINALS.get(core.at).pos);
      assert.deepEqual(panelRoute.at(-1), [x, y - face * GLAND_HALF_LENGTH, z]);
      assert.deepEqual(fieldRoute[0], jacket.at(-1));
      assert.deepEqual(fieldRoute.at(-1), TERMINALS.get(core.to).pos);
      assert.equal(TERMINALS.get(core.to).field, true);
      assert.equal(fieldPins.has(core.to), false);
      fieldPins.add(core.to);
      const row = rows.get(`${cable.id}.${core.core}`);
      assert.deepEqual([row.from, row.to], [core.at, core.to]);
    }
  }
  assert.deepEqual(CABLES.find(c => c.id === 'W0').cores.map(core => core.net), ['L', 'N', 'PE']);
});
