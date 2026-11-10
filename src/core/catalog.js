// Instruction catalogue: function blocks available as LAD boxes / FBD boxes.
// pins.in  : name -> kind ('bool' | 'time' | 'int' | 'any')   pins.out: name -> kind

export const FB = {
  TON: { label: 'TON', title: 'On-delay timer', in: { IN: 'bool', PT: 'time' }, out: { Q: 'bool', ET: 'time' }, flowIn: 'IN', flowOut: 'Q' },
  TOF: { label: 'TOF', title: 'Off-delay timer', in: { IN: 'bool', PT: 'time' }, out: { Q: 'bool', ET: 'time' }, flowIn: 'IN', flowOut: 'Q' },
  TP: { label: 'TP', title: 'Pulse timer', in: { IN: 'bool', PT: 'time' }, out: { Q: 'bool', ET: 'time' }, flowIn: 'IN', flowOut: 'Q' },
  CTU: { label: 'CTU', title: 'Count up', in: { CU: 'bool', R: 'bool', PV: 'int' }, out: { Q: 'bool', CV: 'int' }, flowIn: 'CU', flowOut: 'Q' },
  CTD: { label: 'CTD', title: 'Count down', in: { CD: 'bool', LD: 'bool', PV: 'int' }, out: { Q: 'bool', CV: 'int' }, flowIn: 'CD', flowOut: 'Q' },
  R_TRIG: { label: 'R_TRIG', title: 'Rising edge', in: { CLK: 'bool' }, out: { Q: 'bool' }, flowIn: 'CLK', flowOut: 'Q' },
  F_TRIG: { label: 'F_TRIG', title: 'Falling edge', in: { CLK: 'bool' }, out: { Q: 'bool' }, flowIn: 'CLK', flowOut: 'Q' },
  SR: { label: 'SR', title: 'Set dominant flip-flop', in: { S1: 'bool', R: 'bool' }, out: { Q1: 'bool' }, flowIn: 'S1', flowOut: 'Q1' },
  RS: { label: 'RS', title: 'Reset dominant flip-flop', in: { S: 'bool', R1: 'bool' }, out: { Q1: 'bool' }, flowIn: 'S', flowOut: 'Q1' },
}

export const COMPARE = ['==', '<>', '>', '>=', '<', '<=']
export const ST_OP = { '==': '=', '<>': '<>', '>': '>', '>=': '>=', '<': '<', '<=': '<=' }
export const MATH = { add: '+', sub: '-', mul: '*', div: '/', mod: 'MOD' }
export const LOGIC = { and: 'AND', or: 'OR', xor: 'XOR' }

/** Value shown for an unconnected / default pin. */
export const DEFAULT_PIN = { bool: 'FALSE', time: 'T#0s', int: '0', any: '0' }
