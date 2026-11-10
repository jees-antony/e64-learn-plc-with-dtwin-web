// Project model of Web PLC Studio. Plain JSON so it can be stored, exported and diffed.
// Vocabulary follows the S7 engineering world: PLC tags with absolute addresses, organisation
// blocks (OB), function blocks (FB), functions (FC), networks in LAD / FBD, and SCL text.

export const TYPES = ['Bool', 'Byte', 'Word', 'DWord', 'SInt', 'Int', 'DInt', 'USInt', 'UInt', 'UDInt', 'Real', 'LReal', 'Time', 'String']
const IEC = { Bool: 'BOOL', Byte: 'BYTE', Word: 'WORD', DWord: 'DWORD', SInt: 'SINT', Int: 'INT', DInt: 'DINT', USInt: 'USINT', UInt: 'UINT', UDInt: 'UDINT', Real: 'REAL', LReal: 'LREAL', Time: 'TIME', String: 'STRING' }
export const iecType = (t) => IEC[t] ?? String(t).toUpperCase()

/** `%I0.0` -> `%IX0.0`, `%MW10` stays; returns '' for an empty address, null when malformed. */
export function iecAddress(address) {
  const a = String(address ?? '').trim().toUpperCase()
  if (!a) return ''
  let m = /^%([IQM])(\d+)\.([0-7])$/.exec(a)
  if (m) return `%${m[1]}X${m[2]}.${m[3]}`
  m = /^%([IQM])([BWD])(\d+)$/.exec(a)
  if (m) return `%${m[1]}${m[2]}${m[3]}`
  return null
}

export const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/
let counter = 0
export const uid = (p = 'id') => `${p}${Date.now().toString(36)}${(counter++).toString(36)}`

export function newNetwork(lang) {
  return lang === 'FBD'
    ? { id: uid('n'), title: '', comment: '', out: { tag: '', mode: '=' }, expr: null }
    : { id: uid('n'), title: '', comment: '', elements: [], coils: [] }
}

export function newBlock(kind, name, lang, number) {
  return {
    id: uid('b'), kind, name, number, lang,
    interface: { input: [], output: [], inout: [], static: [], temp: [] },
    networks: lang === 'SCL' ? undefined : [newNetwork(lang)],
    code: lang === 'SCL' ? '' : undefined,
    comment: '',
  }
}

/** Starting project for the water tank twin: I/O tags at the wired addresses and a fill / drain program. */
export function tankProject() {
  const p = {
    version: 1, name: 'Tank_T1',
    plc: { name: 'PLC_1', cycleMs: 10 },
    tags: [
      { name: 'S1_Fill', type: 'Bool', address: '%I0.0', comment: 'Fill push button S1 (NO): TRUE while pressed' },
      { name: 'S2_Drain', type: 'Bool', address: '%I0.1', comment: 'Drain push button S2 (NO): TRUE while pressed' },
      { name: 'B1_LevelLow', type: 'Bool', address: '%I0.2', comment: 'Low level switch B1: TRUE when the water is above 20 %' },
      { name: 'B2_LevelHigh', type: 'Bool', address: '%I0.3', comment: 'High level switch B2: TRUE when the water is above 80 %' },
      { name: 'K1_FillValve', type: 'Bool', address: '%Q0.0', comment: 'Relay K1: opens fill valve Y1' },
      { name: 'K2_DrainValve', type: 'Bool', address: '%Q0.1', comment: 'Relay K2: opens drain valve Y2' },
    ],
    blocks: [],
    watch: [{ id: uid('w'), name: 'Watch table_1', rows: ['S1_Fill', 'S2_Drain', 'B1_LevelLow', 'B2_LevelHigh', 'K1_FillValve', 'K2_DrainValve'] }],
  }
  const main = newBlock('OB', 'Main', 'LAD', 1)
  main.comment = 'Tank T1: fill with S1 until the high level switch, drain with S2 until the low level switch.'
  main.networks = [
    { id: uid('n'), title: 'Fill the tank', comment: 'S1 starts filling (seal-in). Filling stops at the high level (B2) or when S2 is pressed.',
      elements: [{ k: 'branch', branches: [[{ k: 'NO', tag: 'S1_Fill' }], [{ k: 'NO', tag: 'K1_FillValve' }]] }, { k: 'NC', tag: 'B2_LevelHigh' }, { k: 'NC', tag: 'S2_Drain' }],
      coils: [{ k: 'coil', tag: 'K1_FillValve' }] },
    { id: uid('n'), title: 'Drain the tank', comment: 'S2 starts draining (seal-in). Draining stops below the low level (B1) or when S1 is pressed.',
      elements: [{ k: 'branch', branches: [[{ k: 'NO', tag: 'S2_Drain' }], [{ k: 'NO', tag: 'K2_DrainValve' }]] }, { k: 'NO', tag: 'B1_LevelLow' }, { k: 'NC', tag: 'S1_Fill' }],
      coils: [{ k: 'coil', tag: 'K2_DrainValve' }] },
  ]
  p.blocks.push(main)
  return p
}

/** A small, working starting project: a start/stop motor with an on-delay lamp. */
export function sampleProject() {
  const p = {
    version: 1, name: 'Project1',
    plc: { name: 'PLC_1', cycleMs: 10 },
    tags: [
      { name: 'Start', type: 'Bool', address: '%I0.0', comment: 'Start push button (NO)' },
      { name: 'Stop', type: 'Bool', address: '%I0.1', comment: 'Stop push button (TRUE while pressed)' },
      { name: 'Motor', type: 'Bool', address: '%Q0.0', comment: 'Motor contactor' },
      { name: 'Lamp', type: 'Bool', address: '%Q0.1', comment: 'Running for 3 s' },
      { name: 'Count', type: 'Int', address: '%MW10', comment: 'Starts counted' },
    ],
    blocks: [],
    watch: [{ id: uid('w'), name: 'Watch table_1', rows: ['Start', 'Stop', 'Motor', 'Lamp', 'Count'] }],
  }
  const main = newBlock('OB', 'Main', 'LAD', 1)
  main.comment = 'Main program, runs every cycle'
  main.networks = [
    { id: uid('n'), title: 'Motor start / stop', comment: 'Seal-in: Start latches the motor, Stop releases it.',
      elements: [{ k: 'NC', tag: 'Stop' }, { k: 'branch', branches: [[{ k: 'NO', tag: 'Start' }], [{ k: 'NO', tag: 'Motor' }]] }],
      coils: [{ k: 'coil', tag: 'Motor' }] },
    { id: uid('n'), title: 'Running lamp', comment: 'Lamp follows the motor after 3 seconds.',
      elements: [{ k: 'NO', tag: 'Motor' }, { k: 'box', fb: 'TON', inst: 'RunTimer', args: { PT: 'T#3s' } }],
      coils: [{ k: 'coil', tag: 'Lamp' }] },
    { id: uid('n'), title: 'Count starts', comment: 'CTU counts every start of the motor.',
      elements: [{ k: 'NO', tag: 'Motor' }, { k: 'box', fb: 'CTU', inst: 'StartCounter', args: { PV: '100' } }], coils: [] },
    { id: uid('n'), title: 'Show the count', comment: '',
      elements: [{ k: 'move', dest: 'Count', src: 'StartCounter.CV' }], coils: [] },
  ]
  p.blocks.push(main)
  return p
}
