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
