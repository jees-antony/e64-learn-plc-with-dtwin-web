// Modal dialogs laid out like the S7 engineering tool: Add new block, Call options, Define tag, Rename tag.
// Each returns a Promise with the learner's choice, or null when cancelled.
import { IDENT, TYPES, freeName, iecAddress, nextBlockNumber } from '../core/model.js'
import { h, svg } from './dom.js'
import { state } from './store.js'

/* ------------------------------------------------------------- framework -- */
function modal(title, cls = '') {
  const dlg = h('dialog', { class: `tia-dlg ${cls}` })
  let settle = () => {}
  const result = new Promise((resolve) => { settle = resolve })
  const close = (value) => { if (dlg.open) dlg.close?.(); dlg.removeAttribute('open'); dlg.remove(); settle(value) }
  const head = h('div', { class: 'dhead' }, title, h('button', { type: 'button', 'aria-label': 'Close', onClick: () => close(null) }, '×'))
  const body = h('div', { class: 'dbody' }), foot = h('div', { class: 'dfoot' })
  dlg.append(head, body, foot)
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(null) })
  dlg.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); close(null) } })
  const show = () => { document.body.append(dlg); if (typeof dlg.showModal === 'function') { try { dlg.showModal() } catch { dlg.setAttribute('open', '') } } else dlg.setAttribute('open', '') }
  return { dlg, body, foot, close, show, result }
}
const btn = (label, onClick, primary = false) => h('button', { type: 'button', class: `btn${primary ? ' primary' : ''}`, onClick }, label)
const row = (label, ...field) => [h('label', null, label), h('div', { class: 'dfield' }, ...field)]
const err = () => h('div', { class: 'derr', role: 'alert' })

/** Block icons drawn for this app (shape language of the engineering tool, not its artwork). */
export function blockIcon(kind, size = 34) {
  const s = (...kids) => svg('svg', { class: `bicon ${kind.toLowerCase()}`, width: size, height: size, viewBox: '0 0 34 34' }, ...kids)
  const frame = svg('rect', { x: 3, y: 5, width: 28, height: 24, rx: 2 })
  const t = (txt) => svg('text', { x: 17, y: 22, 'text-anchor': 'middle' }, txt)
  if (kind === 'DB') return s(svg('rect', { x: 5, y: 4, width: 24, height: 26, rx: 2 }), svg('path', { d: 'M9 11h16M9 16h16M9 21h16M9 26h10' }))
  if (kind === 'single') return s(frame, svg('path', { d: 'M8 12h8M8 17h8M8 22h8' }), svg('rect', { x: 19, y: 10, width: 8, height: 14 }))
  if (kind === 'multi') return s(frame, svg('rect', { x: 7, y: 10, width: 9, height: 14 }), svg('rect', { x: 19, y: 10, width: 9, height: 14 }))
  return s(frame, t(kind))
}

/** Number field with the Manual / Automatic choice. */
function numberField(kind, project) {
  const auto = h('input', { type: 'radio', name: `num-${kind}`, checked: true })
  const manual = h('input', { type: 'radio', name: `num-${kind}` })
  const num = h('input', { class: 'in', type: 'number', min: '1', value: String(nextBlockNumber(project, kind)), disabled: true, style: { width: '80px' } })
  const sync = () => { num.disabled = auto.checked; if (auto.checked) num.value = String(nextBlockNumber(project, kind)) }
  auto.addEventListener('change', sync); manual.addEventListener('change', sync)
  return { el: h('div', { class: 'dnum' }, num, h('label', null, manual, ' Manual'), h('label', null, auto, ' Automatic')), value: () => Number(num.value) || nextBlockNumber(project, kind), auto: () => auto.checked }
}
const nameProblem = (project, name, except) => {
  if (!IDENT.test(name)) return 'Use letters, digits and _ only, with no spaces, and do not start with a digit.'
  const low = name.toLowerCase()
  if (project.blocks.some((b) => b.name.toLowerCase() === low && b !== except)) return `A block named "${name}" already exists.`
  if (project.tags.some((t) => t.name.toLowerCase() === low)) return `"${name}" is already a PLC tag.`
  return ''
}

/* --------------------------------------------------------- Add new block -- */
const KINDS = [
  ['OB', 'Organization block', 'Organization blocks are called by the CPU itself. A "Program cycle" OB runs again and again for as long as the CPU is in RUN. Main [OB1] is the program cycle OB of every project.'],
  ['FB', 'Function block', 'A function block is a code block with memory. Its inputs, outputs and static variables keep their values in an instance data block from one call to the next. Use it for machines that have a state, such as a motor or a valve.'],
  ['FC', 'Function', 'A function is a code block without memory. Every parameter is passed in at each call and its temporary variables are lost afterwards. Use it for calculations and conversions.'],
  ['DB', 'Data block', 'A data block stores program data. A global DB can be read and written by every block. An instance DB belongs to one function block call and has the same variables as that FB.'],
]
const OB_EVENTS = ['Program cycle', 'Startup', 'Time delay interrupt', 'Cyclic interrupt', 'Hardware interrupt', 'Time error interrupt', 'Diagnostic error interrupt']

export function addBlockDialog(project = state.project, preset = 'OB') {
  const m = modal('Add new block', 'add-block')
  let kind = preset
  const tiles = h('div', { class: 'dtiles' })
  const right = h('div', { class: 'dright' })
  const openAfter = h('input', { type: 'checkbox', checked: true })
  const msg = err()
  let read = () => null
  const fbs = () => project.blocks.filter((b) => b.kind === 'FB')
  function render() {
    tiles.replaceChildren(...KINDS.map(([k, label]) => h('button', { type: 'button', class: `dtile${kind === k ? ' on' : ''}`, dataset: { kind: k }, onClick: () => { kind = k; render() } }, blockIcon(k), h('span', null, label))))
    const base = { OB: 'Main', FB: 'Block', FC: 'Block', DB: 'Data_block' }[kind]
    const name = h('input', { class: 'in', value: freeName(project, base === 'Main' ? 'Main' : `${base}_1`), 'aria-label': 'Name' })
    const nums = numberField(kind, project)
    const lang = h('select', { class: 'in', 'aria-label': 'Language' }, [['LAD', 'LAD'], ['FBD', 'FBD'], ['SCL', 'SCL']].map(([v, l]) => h('option', { value: v }, l)))
    const dbType = h('select', { class: 'in', 'aria-label': 'Type' }, h('option', { value: '' }, 'Global DB'), fbs().map((b) => h('option', { value: b.name }, `${b.name} (instance DB of FB${b.number})`)))
    dbType.addEventListener('change', () => { if (!name.dataset.touched) name.value = freeName(project, dbType.value ? `${dbType.value}_DB` : 'Data_block_1') })
    name.addEventListener('input', () => { name.dataset.touched = '1' })
    const events = h('div', { class: 'devents', role: 'listbox', 'aria-label': 'Event class' }, OB_EVENTS.map((e, i) => h('div', { class: `devent${i === 0 ? ' on' : ' na'}`, title: i ? 'Not available in Web PLC Studio' : '' }, e)))
    const desc = KINDS.find((x) => x[0] === kind)[2]
    right.replaceChildren(h('div', { class: 'props dprops' },
      ...row('Name:', name),
      ...(kind === 'OB' ? row('Type:', events) : []),
      ...(kind === 'DB' ? row('Type:', dbType) : row('Language:', lang)),
      ...row('Number:', nums.el)),
    h('p', { class: 'ddesc' }, desc), msg)
    read = () => {
      const n = name.value.trim(), bad = nameProblem(project, n)
      if (bad) { msg.textContent = bad; name.focus(); return null }
      const number = nums.value()
      if (project.blocks.some((b) => b.kind === kind && Number(b.number) === number)) { msg.textContent = `${kind}${number} already exists. Choose another number or "Automatic".`; return null }
      return { kind, name: n, number, lang: kind === 'DB' ? null : lang.value, instanceOf: kind === 'DB' ? dbType.value || undefined : undefined, open: openAfter.checked }
    }
    setTimeout(() => { name.focus(); name.select() })
  }
  m.body.append(h('div', { class: 'dsplit' }, tiles, right))
  m.foot.append(h('label', { class: 'dcheck' }, openAfter, ' Add new and open'), h('span', { class: 'grow' }), btn('OK', () => { const r = read(); if (r) m.close(r) }, true), btn('Cancel', () => m.close(null)))
  m.dlg.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName !== 'SELECT') { e.preventDefault(); const r = read(); if (r) m.close(r) } })
  render(); m.show()
  return m.result
}

/* ----------------------------------------------------------- Call options -- */
/** Choose where a called FB keeps its data: its own instance DB, or a multi-instance inside the calling FB. */
export function callOptionsDialog({ callee, caller, project = state.project }) {
  const m = modal('Call options', 'call-options')
  const canMulti = caller?.kind === 'FB'
  let multi = false
  const tiles = h('div', { class: 'dtiles' }), right = h('div', { class: 'dright' }), msg = err()
  let read = () => null
  function render() {
    tiles.replaceChildren(
      h('button', { type: 'button', class: `dtile${!multi ? ' on' : ''}`, dataset: { kind: 'single' }, onClick: () => { multi = false; render() } }, blockIcon('single'), h('span', null, 'Single instance')),
      h('button', { type: 'button', class: `dtile${multi ? ' on' : ''}${canMulti ? '' : ' na'}`, dataset: { kind: 'multi' }, disabled: !canMulti, title: canMulti ? '' : 'Only a function block can hold multi-instances. This call is in an organization block or function.', onClick: () => { multi = true; render() } }, blockIcon('multi'), h('span', null, 'Multi instance')))
    const taken = new Set(Object.values(caller?.interface ?? {}).flat().map((v) => v.name.toLowerCase()))
    let suggestion = `${callee.name}_Instance`; for (let i = 1; taken.has(suggestion.toLowerCase()); i++) suggestion = `${callee.name}_Instance_${i}`
    const name = h('input', { class: 'in', 'aria-label': 'Name', value: multi ? suggestion : freeName(project, `${callee.name}_DB`) })
    const nums = numberField('DB', project)
    right.replaceChildren(h('div', { class: 'props dprops' }, ...row('Name:', name), ...(multi ? [] : row('Number:', nums.el))),
      h('p', { class: 'ddesc' }, multi
        ? `${callee.name} keeps its data as a static variable "${name.value}" inside the instance data of ${caller.name}. No extra data block is created.`
        : `${callee.name} keeps its data in its own instance data block. The data block is created now and appears under Program blocks.`), msg)
    read = () => {
      const n = name.value.trim()
      if (multi) {
        if (!IDENT.test(n)) { msg.textContent = 'Use letters, digits and _ only, with no spaces, and do not start with a digit.'; return null }
        if (taken.has(n.toLowerCase())) { msg.textContent = `${caller.name} already has a variable named "${n}".`; return null }
        return { multi: true, name: n }
      }
      const bad = nameProblem(project, n); if (bad) { msg.textContent = bad; return null }
      const number = nums.value()
      if (project.blocks.some((b) => b.kind === 'DB' && Number(b.number) === number)) { msg.textContent = `DB${number} already exists.`; return null }
      return { multi: false, name: n, number }
    }
    setTimeout(() => { name.focus(); name.select() })
  }
  m.body.append(h('div', { class: 'dsplit' }, tiles, right))
  m.foot.append(h('span', { class: 'grow' }), btn('OK', () => { const r = read(); if (r) m.close(r) }, true), btn('Cancel', () => m.close(null)))
  m.dlg.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const r = read(); if (r) m.close(r) } })
  render(); m.show()
  return m.result
}

/* ------------------------------------------------------------- Define tag -- */
const LOCAL_SECTIONS = { OB: [['temp', 'Temp'], ['static', 'Static']], FB: [['input', 'Input'], ['output', 'Output'], ['inout', 'InOut'], ['static', 'Static'], ['temp', 'Temp']], FC: [['input', 'Input'], ['output', 'Output'], ['inout', 'InOut'], ['temp', 'Temp']] }
/** Create a PLC tag (Global) or a block variable (Local) for an operand that does not exist yet. */
export function defineTagDialog({ name = '', type = 'Bool', block, project = state.project }) {
  const m = modal('Define tag', 'define-tag')
  const nm = h('input', { class: 'in', value: name, 'aria-label': 'Name' })
  const section = h('select', { class: 'in', 'aria-label': 'Section' }, h('option', { value: 'global' }, 'Global (PLC tag)'), (LOCAL_SECTIONS[block?.kind] ?? []).map(([k, l]) => h('option', { value: k }, `Local · ${l}`)))
  const dt = h('select', { class: 'in', 'aria-label': 'Data type' }, TYPES.map((t) => h('option', { value: t, selected: t === type }, t)))
  const addr = h('input', { class: 'in', placeholder: '%I0.0, %Q0.0, %M0.0, %MW10 or empty', 'aria-label': 'Address' })
  const cmt = h('input', { class: 'in', 'aria-label': 'Comment' })
  const msg = err()
  const addrRow = row('Address:', addr)
  section.addEventListener('change', () => { addrRow.forEach((x) => { x.hidden = section.value !== 'global' }) })
  m.body.append(h('div', { class: 'props dprops' }, ...row('Name:', nm), ...row('Section:', section), ...row('Data type:', dt), ...addrRow, ...row('Comment:', cmt)), msg)
  const read = () => {
    const n = nm.value.trim()
    if (!IDENT.test(n)) { msg.textContent = 'Use letters, digits and _ only, with no spaces, and do not start with a digit.'; return null }
    if (section.value === 'global') {
      if (project.tags.some((t) => t.name.toLowerCase() === n.toLowerCase())) { msg.textContent = `The PLC tag "${n}" already exists.`; return null }
      if (iecAddress(addr.value) === null) { msg.textContent = `"${addr.value}" is not a valid address. Examples: %I0.0, %Q0.1, %M2.0, %MW10.`; return null }
      if (addr.value.trim() && project.tags.some((t) => iecAddress(t.address) === iecAddress(addr.value))) { msg.textContent = `Address ${addr.value.trim()} is already used.`; return null }
    } else if (Object.values(block?.interface ?? {}).flat().some((v) => v.name.toLowerCase() === n.toLowerCase())) { msg.textContent = `${block.name} already has a variable "${n}".`; return null }
    return { section: section.value, name: n, type: dt.value, address: section.value === 'global' ? addr.value.trim() : '', comment: cmt.value.trim() }
  }
  m.foot.append(h('span', { class: 'grow' }), btn('Define', () => { const r = read(); if (r) m.close(r) }, true), btn('Cancel', () => m.close(null)))
  m.dlg.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName !== 'SELECT') { e.preventDefault(); const r = read(); if (r) m.close(r) } })
  m.show(); setTimeout(() => (name ? addr : nm).focus())
  return m.result
}

/* ------------------------------------------------------------- Rename tag -- */
export function renameTagDialog(oldName, project = state.project) {
  const m = modal('Rename tag', 'rename-tag')
  const nm = h('input', { class: 'in', value: oldName, 'aria-label': 'New name' }), msg = err()
  m.body.append(h('div', { class: 'props dprops' }, ...row('Old name:', h('span', { class: 'mono' }, `"${oldName}"`)), ...row('New name:', nm)),
    h('p', { class: 'ddesc' }, 'The tag is renamed in the PLC tag table and at every place in the program where it is used.'), msg)
  const read = () => {
    const n = nm.value.trim()
    if (n === oldName) return n
    if (!IDENT.test(n)) { msg.textContent = 'Use letters, digits and _ only, with no spaces, and do not start with a digit.'; return null }
    if (project.tags.some((t) => t.name.toLowerCase() === n.toLowerCase()) || project.blocks.some((b) => b.name.toLowerCase() === n.toLowerCase())) { msg.textContent = `"${n}" is already used.`; return null }
    return n
  }
  m.foot.append(h('span', { class: 'grow' }), btn('OK', () => { const r = read(); if (r) m.close(r) }, true), btn('Cancel', () => m.close(null)))
  m.dlg.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const r = read(); if (r) m.close(r) } })
  m.show(); setTimeout(() => { nm.focus(); nm.select() })
  return m.result
}
