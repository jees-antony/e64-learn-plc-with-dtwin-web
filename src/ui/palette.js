// Instruction palette ("Instructions" task card) and the drag payloads the editors accept.
import { svg } from './dom.js'

const S = (w, ...kids) => svg('svg', { width: w, height: 22, viewBox: `0 0 ${w} 22`, class: 'pi' }, ...kids)
const L = (x1, y1, x2, y2) => svg('line', { x1, y1, x2, y2, stroke: '#222', 'stroke-width': 2 })
const icons = {
  NO: () => S(34, L(0, 11, 11, 11), L(11, 3, 11, 19), L(23, 3, 23, 19), L(23, 11, 34, 11)),
  NC: () => S(34, L(0, 11, 11, 11), L(11, 3, 11, 19), L(23, 3, 23, 19), L(23, 11, 34, 11), L(9, 18, 25, 4)),
  P: () => S(34, L(0, 11, 9, 11), svg('rect', { x: 9, y: 3, width: 16, height: 16, fill: 'none', stroke: '#222', 'stroke-width': 2 }), svg('text', { x: 17, y: 15, 'text-anchor': 'middle', 'font-size': 10, 'font-weight': 700 }, 'P'), L(25, 11, 34, 11)),
  N: () => S(34, L(0, 11, 9, 11), svg('rect', { x: 9, y: 3, width: 16, height: 16, fill: 'none', stroke: '#222', 'stroke-width': 2 }), svg('text', { x: 17, y: 15, 'text-anchor': 'middle', 'font-size': 10, 'font-weight': 700 }, 'N'), L(25, 11, 34, 11)),
  coil: (t = '') => S(34, L(0, 11, 9, 11), svg('path', { d: 'M13 3 Q7 11 13 19 M21 3 Q27 11 21 19', fill: 'none', stroke: '#222', 'stroke-width': 2 }), svg('text', { x: 17, y: 15, 'text-anchor': 'middle', 'font-size': 10, 'font-weight': 700 }, t), L(25, 11, 34, 11)),
  box: (t) => S(34, svg('rect', { x: 3, y: 2, width: 28, height: 18, fill: '#fff', stroke: '#222', 'stroke-width': 2 }), svg('text', { x: 17, y: 15, 'text-anchor': 'middle', 'font-size': t.length > 3 ? 8 : 10, 'font-weight': 700 }, t)),
  branch: () => S(34, L(2, 6, 32, 6), L(2, 17, 32, 17), L(2, 6, 2, 17), L(32, 6, 32, 17)),
}
export { icons }

/** Palette groups. `drop` is what editors receive; `lad` / `fbd` say where it can be used. */
export const PALETTE = [
  { group: 'Bit logic', items: [
    { name: 'Normally open contact', short: 'Shift+F2', icon: 'NO', lad: { k: 'NO' }, fbd: { t: 'var' } },
    { name: 'Normally closed contact', short: 'Shift+F3', icon: 'NC', lad: { k: 'NC' }, fbd: { t: 'not' } },
    { name: 'Output coil', short: 'Shift+F7', icon: 'coil', lad: { coil: 'coil' } },
    { name: 'Set output', short: 'Shift+F4', icon: ['coil', 'S'], lad: { coil: 'set' }, fbd: { out: 'S' } },
    { name: 'Reset output', short: 'Shift+F6', icon: ['coil', 'R'], lad: { coil: 'reset' }, fbd: { out: 'R' } },
    { name: 'Positive edge', icon: 'P', lad: { k: 'P' } },
    { name: 'Negative edge', icon: 'N', lad: { k: 'N' } },
    { name: 'Open branch', short: 'Shift+F8', icon: 'branch', lad: { k: 'branch' } },
    { name: 'AND', icon: ['box', '&'], fbd: { t: 'and' } },
    { name: 'OR', icon: ['box', '≥1'], fbd: { t: 'or' } },
    { name: 'XOR', icon: ['box', 'X'], fbd: { t: 'xor' } },
    { name: 'NOT', icon: ['box', '¬'], fbd: { t: 'not' } },
    { name: 'SR flip-flop', icon: ['box', 'SR'], lad: { k: 'box', fb: 'SR' }, fbd: { t: 'fb', fb: 'SR' } },
    { name: 'RS flip-flop', icon: ['box', 'RS'], lad: { k: 'box', fb: 'RS' }, fbd: { t: 'fb', fb: 'RS' } },
  ] },
  { group: 'Timer operations', items: [
    { name: 'TON  On-delay', icon: ['box', 'TON'], lad: { k: 'box', fb: 'TON' }, fbd: { t: 'fb', fb: 'TON' } },
    { name: 'TOF  Off-delay', icon: ['box', 'TOF'], lad: { k: 'box', fb: 'TOF' }, fbd: { t: 'fb', fb: 'TOF' } },
    { name: 'TP  Pulse', icon: ['box', 'TP'], lad: { k: 'box', fb: 'TP' }, fbd: { t: 'fb', fb: 'TP' } },
  ] },
  { group: 'Counter operations', items: [
    { name: 'CTU  Count up', icon: ['box', 'CTU'], lad: { k: 'box', fb: 'CTU' }, fbd: { t: 'fb', fb: 'CTU' } },
    { name: 'CTD  Count down', icon: ['box', 'CTD'], lad: { k: 'box', fb: 'CTD' }, fbd: { t: 'fb', fb: 'CTD' } },
    { name: 'R_TRIG  Rising edge', icon: ['box', 'R_TRIG'], fbd: { t: 'fb', fb: 'R_TRIG' } },
    { name: 'F_TRIG  Falling edge', icon: ['box', 'F_TRIG'], fbd: { t: 'fb', fb: 'F_TRIG' } },
  ] },
  { group: 'Comparator operations', items: ['==', '<>', '>', '>=', '<', '<='].map((op) => ({ name: `Compare  ${op}`, short: op === '==' ? 'Shift+F10' : '', icon: ['box', op], lad: { k: 'cmp', op }, fbd: { t: 'cmp', op } })) },
  { group: 'Move and math', items: [
    { name: 'MOVE', icon: ['box', 'MOVE'], lad: { k: 'move' } },
    { name: 'ADD', icon: ['box', '+'], fbd: { t: 'add' } }, { name: 'SUB', icon: ['box', '−'], fbd: { t: 'sub' } },
    { name: 'MUL', icon: ['box', '×'], fbd: { t: 'mul' } }, { name: 'DIV', icon: ['box', '÷'], fbd: { t: 'div' } },
  ] },
]
export function iconFor(item) { const i = item.icon; return Array.isArray(i) ? icons[i[0]](i[1]) : icons[i]() }
