// Block interface table, PLC tag table and watch table.
import { validateTags } from '../../core/codegen.js'
import { IDENT, iecAddress, uid } from '../../core/model.js'
import { parseTimeLiteral } from '../../runtime/values.mjs'
import { editor } from '../commands.js'
import { h, svg } from '../dom.js'
import { isOnline, readOperand, writeTag } from '../online.js'
import { blockById, edit, on, state } from '../store.js'
import { typePicker } from '../type-picker.js'

/* ------------------------------------------------------------ interface -- */
const SECTIONS = { OB: [['temp', 'Temp'], ['static', 'Static']], FB: [['input', 'Input'], ['output', 'Output'], ['inout', 'InOut'], ['static', 'Static'], ['temp', 'Temp']], FC: [['input', 'Input'], ['output', 'Output'], ['inout', 'InOut'], ['temp', 'Temp']] }

export function interfaceTable(blockId) {
  const wrap = h('details', { class: 'iface', open: true })
  let pickers = []
  const render = () => {
    const b = blockById(blockId); if (!b) return
    pickers.forEach(p => p.dispose()); pickers = []
    const rows = []
    for (const [key, title] of SECTIONS[b.kind]) {
      const vars = b.interface[key] ?? []
      vars.forEach((v, i) => {
        const bad = !IDENT.test(v.name)
        const picker = typePicker({ project: () => state.project, block: () => blockById(blockId), instances: true,
          value: () => blockById(blockId)?.interface[key]?.[i]?.type ?? '', label: `Data type for ${b.name} ${title} ${v.name}`,
          change: value => edit(p => { p.blocks.find(x => x.id === blockId).interface[key][i].type = value }, `if:${blockId}:${key}:${i}:type`) })
        pickers.push(picker)
        rows.push(h('tr', null,
          h('td', { class: 'ro' }, title),
          h('td', null, h('input', { value: v.name, class: bad ? 'bad' : '', onInput: (e) => edit((p) => { p.blocks.find((x) => x.id === blockId).interface[key][i].name = e.target.value }, `if:${blockId}:${key}:${i}:n`) })),
          h('td', null, picker.el),
          h('td', null, h('input', { value: v.init ?? '', placeholder: 'default', onInput: (e) => edit((p) => { p.blocks.find((x) => x.id === blockId).interface[key][i].init = e.target.value }, `if:${blockId}:${key}:${i}:i`) })),
          h('td', { class: 'ro', style: { width: '28px', textAlign: 'center', cursor: 'pointer', color: '#d03030' }, title: 'Delete', onClick: () => { edit((p) => p.blocks.find((x) => x.id === blockId).interface[key].splice(i, 1)); render() } }, '×')))
      })
      rows.push(h('tr', { class: 'add', onClick: () => { edit((p) => p.blocks.find((x) => x.id === blockId).interface[key].push({ name: `${title}_${vars.length + 1}`, type: 'Bool' })); render() } }, h('td', { class: 'ro' }, title), h('td', { colspan: 4 }, '<Add new>')))
    }
    wrap.replaceChildren(h('summary', null, `Interface of ${b.name}`), h('table', { class: 'grid' }, h('thead', null, h('tr', null, ['Section', 'Name', 'Data type', 'Default value', ''].map((x) => h('th', null, x)))), h('tbody', null, rows)))
  }
  render()
  return { el: wrap, render, refresh(reason) { if (reason === 'edit' && wrap.contains(document.activeElement)) pickers.forEach(p => p.refresh()); else render() }, dispose() { pickers.forEach(p => p.dispose()) } }
}

/* ------------------------------------------------------------- tag table -- */
const fmt = (v) => (v === undefined ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : typeof v === 'number' && Math.abs(v) >= 1e6 ? `T#${(v / 1e6).toFixed(0)}ms` : String(v))
export function mountTags(host) {
  const body = h('div', { class: 'ed-body' })
  let pickers = []
  host.append(h('div', { class: 'ed-head' }, h('span', { class: 'title' }, `${state.project.plc.name} › PLC tags › Default tag table`), h('span', { class: 'grow' })), body)
  const render = () => {
    pickers.forEach(p => p.dispose()); pickers = []
    const errs = validateTags(state.project)
    const bad = (i, kind) => errs.some((e) => e.tag === state.project.tags[i].name && (kind === 'name' ? /name|twice/.test(e.message) : /ddress/.test(e.message)))
    const live = isOnline()
    const rows = state.project.tags.map((t, i) => {
      const picker = typePicker({ project: () => state.project, value: () => state.project.tags[i]?.type ?? '', label: `Data type for tag ${t.name}`, change: value => edit(p => { p.tags[i].type = value }, `tag:${i}:type`) })
      pickers.push(picker)
      return h('tr', { dataset: { i } },
      h('td', { class: 'ro', style: { width: '30px', textAlign: 'center' } }, i + 1),
      h('td', null, h('input', { value: t.name, class: bad(i, 'name') ? 'bad' : '', onInput: (e) => { const old = state.project.tags[i].name; edit((p) => { p.tags[i].name = e.target.value; if (old !== e.target.value) p.watch.forEach((w) => { w.rows = w.rows.map((r) => (r === old ? e.target.value : r)) }) }, `tag:${i}:n`) } })),
      h('td', null, picker.el),
      h('td', null, h('input', { value: t.address ?? '', class: bad(i, 'addr') ? 'bad' : '', placeholder: '%I0.0', onInput: (e) => edit((p) => { p.tags[i].address = e.target.value }, `tag:${i}:a`) })),
      live ? h('td', { class: `val ${t.type === 'Bool' ? (readOperand('', t.name) ? 't' : 'f') : ''}`, dataset: { mon: t.name } }, fmt(readOperand('', t.name))) : null,
      h('td', null, h('input', { value: t.comment ?? '', onInput: (e) => edit((p) => { p.tags[i].comment = e.target.value }, `tag:${i}:c`) })),
      h('td', { class: 'ro', style: { width: '28px', textAlign: 'center', cursor: 'pointer', color: '#d03030' }, title: 'Delete tag', onClick: () => { edit((p) => p.tags.splice(i, 1)); render() } }, '×'))
    })
    rows.push(h('tr', { class: 'add', onClick: () => { edit((p) => p.tags.push({ name: `Tag_${p.tags.length + 1}`, type: 'Bool', address: '', comment: '' })); render(); body.querySelector('tbody tr:nth-last-child(2) input')?.select() } }, h('td', { class: 'ro' }, '✚'), h('td', { colspan: live ? 6 : 5 }, '<Add new>')))
    body.replaceChildren(h('table', { class: 'grid' }, h('thead', null, h('tr', null, ['', 'Name', 'Data type', 'Address', live ? 'Monitor value' : null, 'Comment', ''].map((x) => (x === null ? null : h('th', null, x))))), h('tbody', null, rows)), h('div', { class: 'insert-hint' }, 'Addresses: %I0.0 inputs, %Q0.0 outputs, %M0.0 memory bits, %MW10 memory words. A tag without an address is an internal variable.'),
      errs.length ? h('div', { class: 'insert-hint', style: { color: '#d03030' } }, errs.map((e) => e.message).join(' · ')) : null)
  }
  render()
  const offs = [on('project', ({ reason } = {}) => { if (reason !== 'edit') render(); else pickers.forEach(p => p.refresh()) }), on('online', render), on('tick', () => { for (const c of body.querySelectorAll('[data-mon]')) { const v = readOperand('', c.dataset.mon); c.textContent = fmt(v); if (typeof v === 'boolean') c.className = `val ${v ? 't' : 'f'}` } })]
  return { dispose: () => { offs.forEach(f => f()); pickers.forEach(p => p.dispose()) } }
}

/* ------------------------------------------------------------ data block -- */
/** Editor of a data block: an editable grid for a global DB, a read-only grid of the FB's variables for an instance DB. */
export function mountDb(host, tab) {
  const id = tab.id
  const db = () => blockById(id)
  let pickers = []
  const b0 = db()
  const body = h('div', { class: 'ed-body' })
  const sub = h('span', { class: 'tag-app' })
  host.append(h('div', { class: 'ed-head' }, h('span', { class: 'title' }, `${b0.name} [DB${b0.number}]`), sub, h('span', { class: 'grow' })), body)
  const fbOf = (b) => state.project.blocks.find((x) => x.kind === 'FB' && x.name === b.instanceOf)
  const monCell = (b, v) => { const val = readOperand('', `${b.name}.${v.name}`); return h('td', { class: `val ${val === true ? 't' : val === false ? 'f' : ''}`, dataset: { mon: `${b.name}.${v.name}` } }, fmt(val)) }
  const render = () => {
    const b = db(); if (!b) return
    pickers.forEach((p) => p.dispose()); pickers = []
    const live = isOnline()
    sub.textContent = b.instanceOf ? `Instance DB of ${b.instanceOf}` : 'Global DB'
    if (b.instanceOf) {
      const fb = fbOf(b)
      if (!fb) { body.replaceChildren(h('div', { class: 'insert-hint', style: { color: '#d03030' } }, `The function block "${b.instanceOf}" no longer exists, so this instance data block has no variables.`)); return }
      const rows = [['input', 'Input'], ['output', 'Output'], ['inout', 'InOut'], ['static', 'Static']].flatMap(([k, t]) => (fb.interface[k] ?? []).map((v) =>
        h('tr', null, h('td', { class: 'ro' }, t), h('td', { class: 'ro' }, v.name), h('td', { class: 'ro' }, v.type), h('td', { class: 'ro' }, v.init ?? ''), live ? monCell(b, v) : null)))
      body.replaceChildren(h('table', { class: 'grid' }, h('thead', null, h('tr', null, ['Section', 'Name', 'Data type', 'Start value', live ? 'Monitor value' : null].map((x) => (x === null ? null : h('th', null, x))))), h('tbody', null, rows)),
        h('div', { class: 'insert-hint' }, `The variables of an instance data block are defined by the interface of ${fb.name}. Change them there.`))
      return
    }
    const vars = b.interface.static
    const rows = vars.map((v, i) => {
      const picker = typePicker({ project: () => state.project, instances: false, value: () => db()?.interface.static[i]?.type ?? '', label: `Data type for ${b.name} ${v.name}`, change: (value) => edit((p) => { p.blocks.find((x) => x.id === id).interface.static[i].type = value }, `db:${id}:${i}:type`) })
      pickers.push(picker)
      const set = (key, coalesce) => (e) => edit((p) => { p.blocks.find((x) => x.id === id).interface.static[i][key] = e.target.value }, `db:${id}:${i}:${coalesce}`)
      return h('tr', { dataset: { i } },
        h('td', { class: 'ro', style: { width: '30px', textAlign: 'center' } }, i + 1),
        h('td', null, h('input', { value: v.name, class: IDENT.test(v.name) ? '' : 'bad', onInput: set('name', 'n') })),
        h('td', null, picker.el),
        h('td', null, h('input', { value: v.init ?? '', placeholder: 'default', onInput: set('init', 'i') })),
        live ? monCell(b, v) : null,
        h('td', null, h('input', { value: v.comment ?? '', onInput: set('comment', 'c') })),
        h('td', { class: 'ro', style: { width: '28px', textAlign: 'center', cursor: 'pointer', color: '#d03030' }, title: 'Delete variable', onClick: () => { edit((p) => p.blocks.find((x) => x.id === id).interface.static.splice(i, 1)); render() } }, '×'))
    })
    rows.push(h('tr', { class: 'add', onClick: () => { edit((p) => p.blocks.find((x) => x.id === id).interface.static.push({ name: `Static_${vars.length + 1}`, type: 'Bool' })); render(); body.querySelector('tbody tr:nth-last-child(2) input')?.select() } }, h('td', { class: 'ro' }, '✚'), h('td', { colspan: live ? 6 : 5 }, '<Add new>')))
    body.replaceChildren(h('table', { class: 'grid' }, h('thead', null, h('tr', null, ['', 'Name', 'Data type', 'Start value', live ? 'Monitor value' : null, 'Comment', ''].map((x) => (x === null ? null : h('th', null, x))))), h('tbody', null, rows)),
      h('div', { class: 'insert-hint' }, 'A global data block can be read and written by every block as DBname.Variable. The start value is used when the program is downloaded.'))
  }
  render()
  const offs = [
    on('project', ({ reason } = {}) => { if (reason !== 'edit' || db()?.instanceOf) render(); else pickers.forEach((p) => p.refresh()) }),
    on('online', render),
    on('tick', () => { for (const c of body.querySelectorAll('[data-mon]')) { const v = readOperand('', c.dataset.mon); c.textContent = fmt(v); c.className = `val ${v === true ? 't' : v === false ? 'f' : ''}` } }),
  ]
  return { dispose: () => { offs.forEach((f) => f()); pickers.forEach((p) => p.dispose()) } }
}

/* ----------------------------------------------------------- watch table -- */
function parseFor(type, text) {
  const s = String(text).trim()
  if (type === 'Bool') return /^(1|true)$/i.test(s)
  if (type === 'Time') return /^t#/i.test(s) ? parseTimeLiteral(s) : Number(s) * 1e6
  const n = Number(s); if (!Number.isFinite(n)) throw new Error(`"${s}" is not a number`); return n
}
export function mountWatch(host, tab) {
  const id = tab.id
  const wt = () => state.project.watch.find((w) => w.id === id)
  const body = h('div', { class: 'ed-body' })
  const modify = new Map()   // row index -> { text, on }
  const modifyNow = () => {
    wt().rows.forEach((name, i) => { const m = modify.get(i); const tag = state.project.tags.find((t) => t.name === name); if (m?.on && tag) { try { writeTag(name, parseFor(tag.type, m.text)) } catch (e) { alert(e.message) } } })
  }
  // "Monitor all" (TIA glasses button): per table, off until the user switches it on; Ctrl+Shift+M toggles it while this table is active.
  const monBtn = h('button', { class: 'btn mon', title: 'Monitor all (Ctrl+Shift+M)', onClick: () => toggleMonitor() },
    svg('svg', { viewBox: '0 0 24 24' }, svg('path', { d: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zM12 9a3 3 0 100 6 3 3 0 000-6z' })), 'Monitor all')
  const toggleMonitor = () => { watchMonitor.set(id, !watchMonitor.get(id)); render() }
  host.append(h('div', { class: 'ed-head' }, h('span', { class: 'title' }, `${state.project.plc.name} › Watch and force tables › ${wt().name}`), h('span', { class: 'grow' }),
    monBtn, h('button', { class: 'btn', title: 'Modify all checked values once', onClick: modifyNow }, 'Modify now')), body)
  editor.api = { monitor: toggleMonitor }
  const render = () => {
    const w = wt(); if (!w) return
    const monitoring = !!watchMonitor.get(id)
    monBtn.classList.toggle('on', monitoring)
    const live = isOnline() && monitoring
    const rows = w.rows.map((name, i) => {
      const tag = state.project.tags.find((t) => t.name === name)
      return h('tr', null, h('td', { class: 'ro', style: { width: '30px', textAlign: 'center' } }, i + 1),
        h('td', null, h('input', { value: name, list: 'dl-watch', class: tag ? '' : 'bad', onChange: (e) => { edit((p) => { p.watch.find((x) => x.id === id).rows[i] = e.target.value }); render() } })),
        h('td', { class: 'ro mono' }, tag?.address ?? ''), h('td', { class: 'ro' }, tag?.type ?? ''),
        h('td', { class: 'val', dataset: { mon: name } }, live ? fmt(readOperand('', name)) : ''),
        h('td', null, h('input', { value: modify.get(i)?.text ?? '', placeholder: tag?.type === 'Bool' ? 'TRUE / FALSE' : 'value', onInput: (e) => modify.set(i, { ...modify.get(i), text: e.target.value }) })),
        h('td', { style: { textAlign: 'center', width: '40px' } }, h('input', { type: 'checkbox', checked: !!modify.get(i)?.on, onChange: (e) => modify.set(i, { ...modify.get(i), on: e.target.checked }) })),
        h('td', { class: 'ro', style: { width: '28px', textAlign: 'center', cursor: 'pointer', color: '#d03030' }, onClick: () => { edit((p) => p.watch.find((x) => x.id === id).rows.splice(i, 1)); render() } }, '×'))
    })
    rows.push(h('tr', { class: 'add', onClick: () => { edit((p) => p.watch.find((x) => x.id === id).rows.push(p.tags[0]?.name ?? '')); render() } }, h('td', { class: 'ro' }, '✚'), h('td', { colspan: 7 }, '<Add new>')))
    body.replaceChildren(h('datalist', { id: 'dl-watch' }, state.project.tags.map((t) => h('option', { value: t.name }))), h('table', { class: 'grid' }, h('thead', null, h('tr', null, ['', 'Name', 'Address', 'Data type', 'Monitor value', 'Modify value', 'Modify', ''].map((x) => h('th', null, x)))), h('tbody', null, rows)),
      h('div', { class: 'insert-hint' }, !monitoring
        ? (isOnline() ? 'Monitoring is off. Press "Monitor all" (Ctrl+Shift+M) to show the current value of every tag.' : 'Monitoring is off. Press "Monitor all" (Ctrl+Shift+M) and download to the CPU (Ctrl+L) to show current values.')
        : live ? 'Monitoring: values refresh ten times a second. Tick "Modify" and press "Modify now" to write a value once; outputs written by the program are overwritten on the next scan.'
          : 'Monitor all is on, but the CPU is offline. Download to the CPU (Ctrl+L) to see values.'))
  }
  render()
  const offs = [on('project', ({ reason } = {}) => { if (reason !== 'edit') render() }), on('online', render), on('tick', () => { if (!watchMonitor.get(id) || !isOnline()) return; for (const c of body.querySelectorAll('[data-mon]')) { const v = readOperand('', c.dataset.mon); c.textContent = fmt(v); c.className = `val ${v === true ? 't' : v === false ? 'f' : ''}` } })]
  return { dispose: () => { offs.forEach((f) => f()); if (editor.api?.monitor === toggleMonitor) editor.api = null } }
}
const watchMonitor = new Map()   // watch table id -> monitoring on (kept while the page is open)
export { uid, iecAddress }
