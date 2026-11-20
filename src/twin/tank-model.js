// Water tank digital twin: the plant, the control panel and every wire, as plain data,
// plus the process simulation. The 3D view, the wiring list and the PLC link all read from here.
//
// Plant:   500 L tank, fill valve Y1 (top), drain valve Y2 (bottom), level switches B1 (low) and B2 (high),
//          operator station with push buttons S1 (FILL) and S2 (DRAIN).
// Panel:   MCB F1 → power supply G1 (230 V AC / 24 V DC) → PLC A1 (CPU, 4 DI / 2 DQ used),
//          interface relays K1 and K2 switch 24 V to the solenoid valves, terminal strip X1 for field wiring.
// Units:   metres in 3D, litres and seconds in the process. Y is up.

export const TANK = {
  center: [-1.6, 0, 0], radius: 0.55, bottom: 0.45, height: 1.5,
  capacityL: 500, inflowLps: 15, outflowLps: 12,     // outflow scales with √level (gravity drain)
  lowAt: 0.2, highAt: 0.8,                            // B1 / B2 switching points (fraction of height)
}

/** A point just outside the tank wall; angle in radians from the front (+z) towards +x. */
function onWall(angle, y, gap = 0.03) { const d = TANK.radius + gap; return [TANK.center[0] + Math.sin(angle) * d, y, TANK.center[2] + Math.cos(angle) * d] }

/* ------------------------------------------------------------------ I/O -- */
export const IO = [
  { addr: '%I0.0', dir: 'in', tag: 'S1_Fill', type: 'Bool', device: 'S1', terminal: 'A1:DI0', comment: 'Fill push button S1 (NO): TRUE while pressed' },
  { addr: '%I0.1', dir: 'in', tag: 'S2_Drain', type: 'Bool', device: 'S2', terminal: 'A1:DI1', comment: 'Drain push button S2 (NO): TRUE while pressed' },
  { addr: '%I0.2', dir: 'in', tag: 'B1_LevelLow', type: 'Bool', device: 'B1', terminal: 'A1:DI2', comment: 'Low level switch B1: TRUE when the water is above 20 %' },
  { addr: '%I0.3', dir: 'in', tag: 'B2_LevelHigh', type: 'Bool', device: 'B2', terminal: 'A1:DI3', comment: 'High level switch B2: TRUE when the water is above 80 %' },
  { addr: '%Q0.0', dir: 'out', tag: 'K1_FillValve', type: 'Bool', device: 'K1', terminal: 'A1:DQ0', comment: 'Relay K1: opens fill valve Y1' },
  { addr: '%Q0.1', dir: 'out', tag: 'K2_DrainValve', type: 'Bool', device: 'K2', terminal: 'A1:DQ1', comment: 'Relay K2: opens drain valve Y2' },
]

/* -------------------------------------------------------------- devices -- */
// size = [w, h, d]; pos = centre of the front face's footprint on the mounting plate (panel devices)
// or centre in the plant.
export const PLATE_Z = -0.16          // mounting plate front face
export const CABINET = { x0: 0.9, x1: 1.9, y0: 0.2, y1: 1.8, z0: -0.2, z1: 0.2 }
const RAIL1 = 1.38, RAIL2 = 0.86

export const DEVICES = [
  // panel
  { id: 'F1', kind: 'mcb', name: 'Miniature circuit breaker 2-pole C6', text: 'F1', pos: [1.03, RAIL1], size: [0.05, 0.1, 0.07] },
  { id: 'G1', kind: 'psu', name: 'Power supply 230 V AC / 24 V DC 2.5 A', text: 'G1\n24 V DC', pos: [1.16, RAIL1], size: [0.12, 0.14, 0.1] },
  { id: 'A1', kind: 'plc', name: 'PLC CPU (DI 24 V DC / DQ 24 V DC)', text: 'A1  PLC_1', pos: [1.5, RAIL1], size: [0.34, 0.16, 0.08] },
  { id: 'K1', kind: 'relay', name: 'Interface relay 24 V DC: switches the fill valve', text: 'K1', pos: [1.02, RAIL2], size: [0.036, 0.09, 0.07] },
  { id: 'K2', kind: 'relay', name: 'Interface relay 24 V DC: switches the drain valve', text: 'K2', pos: [1.07, RAIL2], size: [0.036, 0.09, 0.07] },
  { id: 'PE1', kind: 'earth', name: 'Protective earth bond to the cabinet', text: 'PE1', pos: [0.99, 1.69], size: [0.034, 0.04, 0.032] },
  // X1 terminals are generated below
  // plant
  { id: 'S1', kind: 'button', name: 'Push button FILL (green, NO contact 13-14)', text: 'S1 FILL', plant: true },
  { id: 'S2', kind: 'button', name: 'Push button DRAIN (black, NO contact 13-14)', text: 'S2 DRAIN', plant: true },
  { id: 'B1', kind: 'level', name: 'Level switch LOW (closes above 20 %)', text: 'B1 LOW', plant: true, angle: 1.0, pos: onWall(1.0, TANK.bottom + TANK.height * TANK.lowAt) },
  { id: 'B2', kind: 'level', name: 'Level switch HIGH (closes above 80 %)', text: 'B2 HIGH', plant: true, angle: 1.0, pos: onWall(1.0, TANK.bottom + TANK.height * TANK.highAt) },
  { id: 'Y1', kind: 'valve', name: 'Solenoid valve FILL, 24 V DC, normally closed', text: 'Y1 FILL', plant: true, pos: [-2.4, 2.25, 0] },
  { id: 'Y2', kind: 'valve', name: 'Solenoid valve DRAIN, 24 V DC, normally closed', text: 'Y2 DRAIN', plant: true, pos: [-0.78, 0.55, 0] },
]
export const X1 = { x0: 1.2, pitch: 0.024, y: RAIL2, size: [0.02, 0.07, 0.06], count: 12 }
export const OPERATOR_STATION = { pos: [0.35, 1.15, 0.55] }
export const SUPPLY = { pos: [1.03, 2.28, -0.08], size: [0.12, 0.07, 0.065] }

/* ------------------------------------------------------------ terminals -- */
// Each terminal: id 'DEV:name', position [x, y, z] and the side its wire leaves from ('top' | 'bottom').
const T = new Map()
function deviceTerminals(dev, top, bottom) {
  const [cx, cy] = dev.pos, [w, h, d] = dev.size, z = PLATE_Z + d * 0.55
  const place = (names, side) => names.forEach((n, i) => {
    if (!n) return
    const x = cx - w / 2 + (w * (i + 0.5)) / names.length
    T.set(`${dev.id}:${n}`, { id: `${dev.id}:${n}`, device: dev.id, name: n, pos: [x, side === 'top' ? cy + h / 2 : cy - h / 2, z], side })
  })
  place(top, 'top'); place(bottom, 'bottom')
}
const dev = (id) => DEVICES.find((d) => d.id === id)
deviceTerminals(dev('F1'), ['1', '3'], ['2', '4'])
deviceTerminals(dev('G1'), ['+', '+2', '-', '-2'], ['L', 'N'])   // two + and two − output terminals
deviceTerminals(dev('A1'), ['L+', 'M', '1M', 'DI0', 'DI1', 'DI2', 'DI3', null], ['3L+', '3M', 'DQ0', 'DQ1', null, null])
deviceTerminals(dev('K1'), ['A1', 'A2'], ['11', '14'])
deviceTerminals(dev('K2'), ['A1', 'A2'], ['11', '14'])
deviceTerminals(dev('PE1'), ['PE'], [])
for (let i = 1; i <= X1.count; i++) {
  const x = X1.x0 + (i - 1) * X1.pitch, z = PLATE_Z + X1.size[2] * 0.6
  T.set(`X1:${i}`, { id: `X1:${i}`, device: 'X1', name: String(i), pos: [x, X1.y + X1.size[1] / 2, z], side: 'top' })
  T.set(`X1:${i}f`, { id: `X1:${i}f`, device: 'X1', name: `${i} (field)`, pos: [x, X1.y - X1.size[1] / 2, z], side: 'bottom' })
}
function fieldTerminal(device, name, pos) {
  const id = `${device}:${name}`
  T.set(id, { id, device, name, pos, field: true })
}
const [ox, oy, oz] = OPERATOR_STATION.pos
for (const [id, x] of [['S1', ox - 0.065], ['S2', ox + 0.065]]) {
  fieldTerminal(id, '13', [x - 0.012, oy - 0.085, oz + 0.039])
  fieldTerminal(id, '14', [x + 0.012, oy - 0.085, oz + 0.039])
}
for (const id of ['B1', 'B2']) {
  const { pos: [x, y, z], angle } = dev(id)
  for (const [name, dx] of [['1', -0.012], ['2', 0.012]]) {
    fieldTerminal(id, name, [x + dx * Math.cos(angle) + 0.016 * Math.sin(angle), y - 0.03, z - dx * Math.sin(angle) + 0.016 * Math.cos(angle)])
  }
}
for (const id of ['Y1', 'Y2']) {
  const [x, y, z] = dev(id).pos
  fieldTerminal(id, '+', [x - 0.014, y + 0.0725, z + 0.052])
  fieldTerminal(id, '-', [x + 0.014, y + 0.0725, z + 0.052])
}
for (const [name, dx] of [['L', -0.034], ['N', 0], ['PE', 0.034]]) {
  fieldTerminal('Supply', name, [SUPPLY.pos[0] + dx, SUPPLY.pos[1] - SUPPLY.size[1] / 2, SUPPLY.pos[2]])
}
export const TERMINALS = T

/* ---------------------------------------------------------------- nets -- */
// A net is one electrical potential. Colours follow common panel practice; signal nets show their own colour.
export const NETS = {
  L: { name: 'L  230 V AC phase', color: '#7b4a21', live: 'power' },
  N: { name: 'N  neutral', color: '#59a7e0', live: 'never' },
  PE: { name: 'PE  protective earth', color: '#7b9d27', live: 'never' },
  P24: { name: '+24 V DC', color: '#d42a2a', live: 'power' },
  M: { name: '0 V (M)', color: '#1d3f9e', live: 'never' },
  S1: { name: 'S1 → DI0 (FILL button)', color: '#e07b00', live: 'S1' },
  S2: { name: 'S2 → DI1 (DRAIN button)', color: '#e07b00', live: 'S2' },
  B1: { name: 'B1 → DI2 (low level)', color: '#e07b00', live: 'B1' },
  B2: { name: 'B2 → DI3 (high level)', color: '#e07b00', live: 'B2' },
  DQ0: { name: 'DQ0 → K1 coil', color: '#8a3fc0', live: 'Q0' },
  DQ1: { name: 'DQ1 → K2 coil', color: '#8a3fc0', live: 'Q1' },
  K1: { name: 'K1 14 → Y1 (fill valve +)', color: '#c2187a', live: 'K1' },
  K2: { name: 'K2 14 → Y2 (drain valve +)', color: '#c2187a', live: 'K2' },
}

/* --------------------------------------------------------------- wires -- */
// Panel wiring, point to point, numbered like a wiring list. Field wiring uses cables W1..W5 below.
const w = (n, from, to, net) => ({ id: `${n}`, from, to, net })
export const WIRES = [
  // 230 V
  w(1, 'F1:2', 'G1:L', 'L'), w(2, 'F1:4', 'G1:N', 'N'),
  // 24 V distribution
  w(3, 'G1:+', 'A1:L+', 'P24'), w(4, 'A1:L+', 'A1:3L+', 'P24'), w(5, 'G1:+2', 'K1:11', 'P24'), w(6, 'K1:11', 'K2:11', 'P24'),
  w(7, 'G1:+2', 'X1:1', 'P24'), w(8, 'X1:1', 'X1:3', 'P24'), w(9, 'X1:3', 'X1:5', 'P24'), w(10, 'X1:5', 'X1:7', 'P24'),
  // 0 V distribution
  w(11, 'G1:-', 'A1:M', 'M'), w(12, 'A1:M', 'A1:1M', 'M'), w(13, 'A1:1M', 'A1:3M', 'M'), w(14, 'G1:-2', 'K1:A2', 'M'), w(15, 'K1:A2', 'K2:A2', 'M'),
  w(16, 'G1:-2', 'X1:10', 'M'), w(17, 'X1:10', 'X1:12', 'M'),
  // PLC inputs from the terminal strip
  w(18, 'X1:2', 'A1:DI0', 'S1'), w(19, 'X1:4', 'A1:DI1', 'S2'), w(20, 'X1:6', 'A1:DI2', 'B1'), w(21, 'X1:8', 'A1:DI3', 'B2'),
  // PLC outputs to the relay coils
  w(22, 'A1:DQ0', 'K1:A1', 'DQ0'), w(23, 'A1:DQ1', 'K2:A1', 'DQ1'),
  // relay contacts to the valve terminals
  w(24, 'K1:14', 'X1:9', 'K1'), w(25, 'K2:14', 'X1:11', 'K2'),
]

// Field cables: cores land on the X1 field side; `to` names the device terminal at the far end.
export const CABLES = [
  { id: 'W0', name: 'Supply 3G1.5 (230 V AC in)', device: 'Supply', cores: [
    { core: 'BN', at: 'F1:1', to: 'Supply:L', net: 'L' }, { core: 'BU', at: 'F1:3', to: 'Supply:N', net: 'N' },
    { core: 'GNYE', at: 'PE1:PE', to: 'Supply:PE', net: 'PE' }], top: true },
  { id: 'W1', name: 'Operator station 4×0.75', device: 'S1', cores: [
    { core: '1', at: 'X1:1f', to: 'S1:13', net: 'P24' }, { core: '2', at: 'X1:2f', to: 'S1:14', net: 'S1' },
    { core: '3', at: 'X1:3f', to: 'S2:13', net: 'P24' }, { core: '4', at: 'X1:4f', to: 'S2:14', net: 'S2' }] },
  { id: 'W2', name: 'Level switch B1 2×0.75', device: 'B1', cores: [{ core: 'BN', at: 'X1:5f', to: 'B1:1', net: 'P24' }, { core: 'BK', at: 'X1:6f', to: 'B1:2', net: 'B1' }] },
  { id: 'W3', name: 'Level switch B2 2×0.75', device: 'B2', cores: [{ core: 'BN', at: 'X1:7f', to: 'B2:1', net: 'P24' }, { core: 'BK', at: 'X1:8f', to: 'B2:2', net: 'B2' }] },
  { id: 'W4', name: 'Fill valve Y1 2×1.0', device: 'Y1', cores: [{ core: '1', at: 'X1:9f', to: 'Y1:+', net: 'K1' }, { core: '2', at: 'X1:10f', to: 'Y1:-', net: 'M' }] },
  { id: 'W5', name: 'Drain valve Y2 2×1.0', device: 'Y2', cores: [{ core: '1', at: 'X1:11f', to: 'Y2:+', net: 'K2' }, { core: '2', at: 'X1:12f', to: 'Y2:-', net: 'M' }] },
]
// Order the exits by the devices' leftward reach so the floor routes do not cross.
const FIELD_ORDER = ['W1', 'W5', 'W3', 'W2', 'W4']
export const CABLE_GLANDS = {
  W0: [1.03, CABINET.y1, -0.08],
  ...Object.fromEntries(FIELD_ORDER.map((id, i) => [id, [1.25 + i * 0.085, CABINET.y0, 0.142]])),
}

/* ------------------------------------------------------------- routing -- */
// Wires run from a terminal straight up/down into the nearest wiring duct, along it, through a vertical
// side duct when they change level, and back out to the other terminal.
export const DUCTS = { top: 1.6, mid: 1.13, bottom: 0.6, left: 0.94, right: 1.86 }
function ductY(t) {
  const y = t.pos[1]
  if (y > 1.2) return t.side === 'top' ? DUCTS.top : DUCTS.mid
  return t.side === 'top' ? DUCTS.mid : DUCTS.bottom
}
export function routeWire(a, b, lane = 0) {
  const ta = T.get(a), tb = T.get(b)
  const z = PLATE_Z + 0.03 + (lane % 6) * 0.007, j = ((lane % 5) - 2) * 0.007
  const ya = ductY(ta) + j, yb = ductY(tb) + j
  const pts = [ta.pos, [ta.pos[0], ya, z]]
  if (Math.abs(ya - yb) > 0.02) {
    const side = (ta.pos[0] + tb.pos[0]) / 2 < 1.4 ? DUCTS.left : DUCTS.right
    pts.push([side + j, ya, z], [side + j, yb, z])
  }
  pts.push([tb.pos[0], yb, z], tb.pos)
  return pts
}
/** Inside the panel: field core from the X1 field side (or F1 top) to the cable gland. */
export const GLAND_HALF_LENGTH = 0.018
function panelEnd(cable, outside) {
  const [x, y, z] = CABLE_GLANDS[cable.id]
  const sign = Boolean(cable.top) === outside ? 1 : -1
  return [x, y + sign * GLAND_HALF_LENGTH, z]
}
export function routeCore(cable, at, lane = 0) {
  const t = T.get(at), z = PLATE_Z + 0.03 + (lane % 6) * 0.007
  const end = panelEnd(cable, false), [x, , gz] = end
  const y = cable.top ? DUCTS.top + (lane % 3) * 0.008 : DUCTS.bottom + (lane % 3) * 0.008
  if (at === 'PE1:PE') return [t.pos, [t.pos[0], 1.74, t.pos[2]], [x, 1.74, gz], end]
  return [t.pos, [t.pos[0], y, z], [x, y, z], [x, y, gz], end]
}
// The field end of each sheath is the start of its exposed conductors.
function breakout(id, offset) {
  const [x, y, z] = dev(id).pos
  return [x + offset[0], y + offset[1], z + offset[2]]
}
const CABLE_BREAKOUTS = {
  W0: [SUPPLY.pos[0], SUPPLY.pos[1] - 0.10, SUPPLY.pos[2]],
  W1: [ox, oy - 0.16, oz + 0.039],
  W2: breakout('B1', [0.052, -0.092, 0.027]),
  W3: breakout('B2', [0.088, -0.092, 0.057]),
  W4: breakout('Y1', [0, 0.043, 0.115]),
  W5: breakout('Y2', [0, 0.043, 0.115]),
}
const FLOOR_LANES = [0.62, 0.70, 0.78, 0.86, 0.94]
export const CABLE_PATHS = Object.fromEntries(CABLES.map((c) => {
  const start = panelEnd(c, true), end = CABLE_BREAKOUTS[c.id]
  if (c.top) return [c.id, [start, end]]
  const [x, , z] = start, [ex, , ez] = end, lane = FLOOR_LANES[FIELD_ORDER.indexOf(c.id)]
  return [c.id, [start, [x, 0.03, z], [x, 0.03, lane], [ex, 0.03, lane], [ex, 0.03, ez], end]]
}))
export function routeFieldCore(cable, to) {
  const start = CABLE_BREAKOUTS[cable.id], end = T.get(to).pos
  const [x, y, z] = end, [, sy, sz] = start
  return [start, [x, (sy + y) / 2, sz], [x, y - 0.013, z], end]
}

/* ------------------------------------------------------------- process -- */
export class TankProcess {
  constructor() { this.reset() }
  reset(level = 0.1) {
    this.level = level                 // 0..1 of the tank height
    this.buttons = { S1: false, S2: false }
    this.q = { Q0: false, Q1: false }  // PLC outputs as written by the CPU
    this.cpuRun = false
    this.power = true
    this.overflow = false
    this.flowIn = 0; this.flowOut = 0
  }
  get litres() { return this.level * TANK.capacityL }
  get relays() { const on = this.power && this.cpuRun; return { K1: on && this.q.Q0, K2: on && this.q.Q1 } }
  get valves() { const r = this.relays; return { Y1: r.K1, Y2: r.K2 } }
  /** Digital inputs as the PLC sees them, by address. */
  get inputs() {
    const p = this.power
    return { '%I0.0': p && this.buttons.S1, '%I0.1': p && this.buttons.S2, '%I0.2': p && this.level >= TANK.lowAt, '%I0.3': p && this.level >= TANK.highAt }
  }
  /** Advance the plant by dt seconds. */
  step(dt) {
    const v = this.valves
    this.flowIn = v.Y1 ? TANK.inflowLps : 0
    this.flowOut = v.Y2 && this.level > 0 ? TANK.outflowLps * Math.sqrt(Math.max(this.level, 0.02)) : 0
    let litres = this.litres + (this.flowIn - this.flowOut) * dt
    this.overflow = litres > TANK.capacityL && this.flowIn > 0
    litres = Math.min(TANK.capacityL, Math.max(0, litres))
    this.level = litres / TANK.capacityL
  }
  /** Is a net carrying voltage / a TRUE signal right now? (0 V and N never "light up".) */
  netLive(net) {
    const live = NETS[net]?.live, r = this.relays, i = this.inputs
    switch (live) {
      case 'power': return this.power
      case 'S1': return i['%I0.0']
      case 'S2': return i['%I0.1']
      case 'B1': return i['%I0.2']
      case 'B2': return i['%I0.3']
      case 'Q0': return this.power && this.cpuRun && this.q.Q0
      case 'Q1': return this.power && this.cpuRun && this.q.Q1
      case 'K1': return r.K1
      case 'K2': return r.K2
      default: return false
    }
  }
}

/** Human-readable wiring list (panel wires and field cable cores). */
export function wiringList() {
  const rows = WIRES.map((x) => ({ id: x.id, from: x.from, to: x.to, net: x.net, kind: 'panel' }))
  for (const c of CABLES) for (const k of c.cores) rows.push({ id: `${c.id}.${k.core}`, from: k.at, to: k.to, net: k.net, kind: c.id })
  return rows
}
