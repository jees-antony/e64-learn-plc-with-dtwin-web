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
  // A rung (top) with a parallel path dropping down and rejoining. `hot` thickens the side the command is about.
  branch: (hot = '') => { const w = (side) => (hot === side ? 3.5 : 2), c = (side) => (hot === side ? '#14845b' : '#222'), seg = (x1, y1, x2, y2, side) => svg('line', { x1, y1, x2, y2, stroke: c(side), 'stroke-width': w(side) })
    return S(34, L(0, 5, 34, 5), seg(7, 5, 7, 16, 'open'), seg(7, 16, 27, 16), seg(27, 16, 27, 5, 'close'), hot === 'path' ? L(7, 11, 27, 11) : null) },
}
export { icons }

/** Palette groups, named and ordered like the engineering tool's "Basic instructions".
 *  `tia` is the short name in the Name column, `name` the description; `lad` / `fbd` say where it can be used. */
export const PALETTE = [
  { group: 'General', items: [
    { tia: '??', name: 'Empty box', short: 'Shift+F5', icon: ['box', '??'], lad: { k: 'empty' } },
    { tia: '-->', name: 'Open branch', short: 'Shift+F8', icon: ['branch', 'open'], lad: { k: 'branch' } },
    { tia: '<--', name: 'Close branch', short: 'Shift+F9', icon: ['branch', 'close'], lad: { k: 'closeBranch' } },
  ] },
  { group: 'Bit logic operations', items: [
    { tia: '-| |-', name: 'Normally open contact', short: 'Shift+F2', icon: 'NO', lad: { k: 'NO' }, fbd: { t: 'var' } },
    { tia: '-|/|-', name: 'Normally closed contact', short: 'Shift+F3', icon: 'NC', lad: { k: 'NC' }, fbd: { t: 'not' } },
    { tia: '-( )-', name: 'Assignment', short: 'Shift+F7', icon: 'coil', lad: { coil: 'coil' } },
    { tia: '-(/)-', name: 'Negate assignment', icon: ['coil', '/'], lad: { coil: 'ncoil' } },
    { tia: '-(R)-', name: 'Reset output', short: 'Shift+F6', icon: ['coil', 'R'], lad: { coil: 'reset' }, fbd: { out: 'R' } },
    { tia: '-(S)-', name: 'Set output', short: 'Shift+F4', icon: ['coil', 'S'], lad: { coil: 'set' }, fbd: { out: 'S' } },
    { tia: 'SR', name: 'Set/reset flip-flop', icon: ['box', 'SR'], lad: { k: 'box', fb: 'SR' }, fbd: { t: 'fb', fb: 'SR' } },
    { tia: 'RS', name: 'Reset/set flip-flop', icon: ['box', 'RS'], lad: { k: 'box', fb: 'RS' }, fbd: { t: 'fb', fb: 'RS' } },
    { tia: '-|P|-', name: 'Scan operand for positive signal edge', icon: 'P', lad: { k: 'P' } },
    { tia: '-|N|-', name: 'Scan operand for negative signal edge', icon: 'N', lad: { k: 'N' } },
    { tia: 'R_TRIG', name: 'Detect positive signal edge', icon: ['box', 'R_TRIG'], fbd: { t: 'fb', fb: 'R_TRIG' }, ver: 'V1.0' },
    { tia: 'F_TRIG', name: 'Detect negative signal edge', icon: ['box', 'F_TRIG'], fbd: { t: 'fb', fb: 'F_TRIG' }, ver: 'V1.0' },
    { tia: '&', name: 'AND logic operation', icon: ['box', '&'], fbd: { t: 'and' } },
    { tia: '>=1', name: 'OR logic operation', icon: ['box', '≥1'], fbd: { t: 'or' } },
    { tia: 'X', name: 'EXCLUSIVE OR logic operation', icon: ['box', 'X'], fbd: { t: 'xor' } },
    { tia: 'NOT', name: 'Invert result', icon: ['box', '¬'], fbd: { t: 'not' } },
  ] },
  { group: 'Timer operations', items: [
    { tia: 'TP', name: 'Generate pulse', icon: ['box', 'TP'], lad: { k: 'box', fb: 'TP' }, fbd: { t: 'fb', fb: 'TP' }, ver: 'V1.0' },
    { tia: 'TON', name: 'Generate on-delay', icon: ['box', 'TON'], lad: { k: 'box', fb: 'TON' }, fbd: { t: 'fb', fb: 'TON' }, ver: 'V1.0' },
    { tia: 'TOF', name: 'Generate off-delay', icon: ['box', 'TOF'], lad: { k: 'box', fb: 'TOF' }, fbd: { t: 'fb', fb: 'TOF' }, ver: 'V1.0' },
  ] },
  { group: 'Counter operations', items: [
    { tia: 'CTU', name: 'Count up', icon: ['box', 'CTU'], lad: { k: 'box', fb: 'CTU' }, fbd: { t: 'fb', fb: 'CTU' }, ver: 'V1.0' },
    { tia: 'CTD', name: 'Count down', icon: ['box', 'CTD'], lad: { k: 'box', fb: 'CTD' }, fbd: { t: 'fb', fb: 'CTD' }, ver: 'V1.0' },
  ] },
  { group: 'Comparator operations', items: [['==', 'Equal'], ['<>', 'Not equal'], ['>=', 'Greater or equal'], ['<=', 'Less or equal'], ['>', 'Greater than'], ['<', 'Less than']].map(([op, d]) => ({ tia: `CMP ${op}`, name: d, short: op === '==' ? 'Shift+F10' : '', icon: ['box', op], lad: { k: 'cmp', op }, fbd: { t: 'cmp', op } })) },
  { group: 'Math functions', items: [
    { tia: 'ADD', name: 'Add', icon: ['box', '+'], lad: { k: 'math', op: 'add' }, fbd: { t: 'add' } },
    { tia: 'SUB', name: 'Subtract', icon: ['box', '−'], lad: { k: 'math', op: 'sub' }, fbd: { t: 'sub' } },
    { tia: 'MUL', name: 'Multiply', icon: ['box', '×'], lad: { k: 'math', op: 'mul' }, fbd: { t: 'mul' } },
    { tia: 'DIV', name: 'Divide', icon: ['box', '÷'], lad: { k: 'math', op: 'div' }, fbd: { t: 'div' } },
  ] },
  { group: 'Move operations', items: [
    { tia: 'MOVE', name: 'Move value', icon: ['box', 'MOVE'], lad: { k: 'move' } },
  ] },
]
export function iconFor(item) { const i = item.icon; return Array.isArray(i) ? icons[i[0]](i[1]) : icons[i]() }

/** Can this palette item be used in an editor of this language? Returns { ok, reason }. */
export function availability(item, lang) {
  if (lang === 'LAD') return item.lad ? { ok: true } : { ok: false, reason: 'Not available in ladder (LAD) — use this in a function block diagram (FBD) block' }
  if (lang === 'FBD') return item.fbd ? { ok: true } : { ok: false, reason: 'Not available in function block diagram (FBD) — use this in a ladder (LAD) block' }
  return { ok: false, reason: 'Instructions are for ladder and FBD blocks. In SCL, type the code.' }
}
