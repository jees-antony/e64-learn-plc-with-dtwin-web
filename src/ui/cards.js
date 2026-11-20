// Right-hand task cards: Instructions, Online tools (CPU panel) and Simulation (I/O).
import { editor, toast } from './commands.js'
import { h } from './dom.js'
import { download, goOffline, goOnline, isOnline, runCpu, startSimulation, stopCpu, writeTag, readOperand } from './online.js'
import { availability, iconFor, PALETTE } from './palette.js'
import { press, twinInput } from '../twin/link.js'
import { blockById, emit, on, state } from './store.js'

/** Language of the open editor: 'LAD' | 'FBD' | 'SCL', or null for tables and other tabs. */
const activeLang = () => { const k = state.active ?? ''; return k.startsWith('block:') ? blockById(k.slice(6))?.lang ?? null : null }

export function instructionsCard() {
  const el = h('div', null)
  const note = h('div', { class: 'insert-hint' }, 'Instructions are for ladder and FBD blocks. In SCL, type the code.')
  const rows = []
  const groups = PALETTE.map((g, gi) => {
    const d = h('details', { class: 'pal-group', open: gi < 2 }, h('summary', null, g.group))
    for (const it of g.items) {
      const item = h('div', { class: 'pal-item', draggable: 'true' }, iconFor(it), h('span', null, it.name), it.short ? h('small', null, it.short) : null)
      item.addEventListener('dragstart', (e) => { if (item.classList.contains('na')) return e.preventDefault(); e.dataTransfer.setData('text/plain', JSON.stringify({ lad: it.lad, fbd: it.fbd })); e.dataTransfer.effectAllowed = 'copy' })
      item.addEventListener('dblclick', () => { const a = availability(it, activeLang()); if (a.ok) editor.api?.drop?.({ lad: it.lad, fbd: it.fbd }); else toast(a.reason) })
      rows.push([it, item]); d.append(item)
    }
    return d
  })
  const refresh = () => {
    const lang = activeLang()
    note.hidden = lang === 'LAD' || lang === 'FBD'
    for (const [it, item] of rows) {
      const a = availability(it, lang)
      item.classList.toggle('na', !a.ok)
      item.draggable = a.ok
      item.title = a.ok ? `${it.name}${it.short ? ` (${it.short})` : ''}\nDrag onto a network, or double-click to insert at the selection.` : a.reason
    }
  }
  el.append(note, ...groups)
  refresh()
  on('tabs', refresh)
  return el
}

export function onlineCard() {
  const el = h('div', { class: 'cpu' })
  const render = () => {
    const o = state.online, m = o.machine
    const mode = o.mode, run = mode === 'run', stop = mode === 'stop'
    el.replaceChildren(
      h('div', { class: 'cpu-box' },
        h('div', { style: { fontWeight: 600, marginBottom: '6px' } }, `${state.project.plc.name}  (virtual CPU)`),
        h('div', { class: 'leds' }, h('div', { class: `led run${run ? ' on' : ''}` }, h('i'), 'RUN'), h('div', { class: `led stop${stop ? ' on' : ''}` }, h('i'), 'STOP'), h('div', { class: `led err${o.error ? ' on' : ''}` }, h('i'), 'ERROR')),
        h('div', { style: { marginTop: '8px', color: 'var(--muted)' }, id: 'cpu-info' }, mode === 'offline' ? (m ? 'Offline (program in CPU)' : 'Offline — no program downloaded') : `Online · ${run ? 'RUN' : 'STOP'}`)),
      h('div', { class: 'cpu-box' }, h('div', { class: 'cpu-btns' },
        h('button', { class: 'btn primary', onClick: () => { download(); emit('inspector', 'info') }, title: 'Compile and download (Ctrl+L)' }, 'Download'),
        h('button', { class: 'btn', disabled: !m || run, onClick: runCpu }, 'RUN'), h('button', { class: 'btn', disabled: !run, onClick: stopCpu }, 'STOP')),
        h('div', { class: 'cpu-btns', style: { marginTop: '6px' } }, h('button', { class: 'btn', disabled: !m || mode !== 'offline', onClick: goOnline }, 'Go online'), h('button', { class: 'btn', disabled: mode === 'offline', onClick: goOffline }, 'Go offline')),
        h('button', { class: 'btn', style: { width: '100%', marginTop: '6px' }, onClick: () => { startSimulation(); emit('inspector', 'info') }, title: 'Download and start (Ctrl+Shift+X)' }, 'Start simulation')),
      h('div', { class: 'cpu-box', style: { color: 'var(--muted)' } }, `Cycle time ${state.project.plc.cycleMs} ms`, h('br'), h('span', { id: 'cpu-scan' }, m ? `Scans: ${m.scanCount}` : 'Scans: –')))
  }
  render()
  on('online', render); on('project', ({ reason } = {}) => { if (reason !== 'edit') render() })
  on('tick', () => { const s = el.querySelector('#cpu-scan'); if (s && state.online.machine) s.textContent = `Scans: ${state.online.machine.scanCount}` })
  return el
}

export function simulationCard() {
  const el = h('div', null)
  const bits = (kind) => state.project.tags.filter((t) => t.type === 'Bool' && new RegExp(`^%${kind}\\d+\\.[0-7]$`, 'i').test(t.address ?? '')).sort((a, b) => a.address.localeCompare(b.address, undefined, { numeric: true }))
  const render = () => {
    const live = !!state.online.machine
    el.replaceChildren(
      h('div', { class: 'io-title' }, 'Inputs'),
      h('div', { class: 'io' }, bits('I').map((t) => {
        const sw = h('div', { class: 'sw', dataset: { tag: t.name }, title: `${t.name} ${t.address}\nClick: toggle · Alt+hold: push button` }, h('div', { class: 'knob' }), h('span', { class: 'nm' }, t.name), h('span', { class: 'ad' }, t.address.toUpperCase()))
        const ti = twinInput(t.address)
        if (ti) sw.title = ti.kind === 'button' ? `${t.name} ${t.address}\nWired to push button ${ti.id} in the digital twin: hold to press.` : `${t.name} ${t.address}\nWired to level switch ${ti.id}: the tank level sets it.`
        sw.addEventListener('mousedown', (e) => {
          if (ti) { if (ti.kind === 'button') { press(ti.id, true); const up = () => { press(ti.id, false); removeEventListener('mouseup', up) }; addEventListener('mouseup', up) } return }
          if (!live) return; const now = !!readOperand('', t.name); if (e.altKey) { writeTag(t.name, true); const up = () => { writeTag(t.name, false); removeEventListener('mouseup', up) }; addEventListener('mouseup', up) } else writeTag(t.name, !now) })
        return sw
      }), bits('I').length ? null : h('div', { class: 'insert-hint', style: { gridColumn: '1 / -1' } }, 'No Bool tags with %I addresses.')),
      h('div', { class: 'io-title' }, 'Outputs'),
      h('div', { class: 'io' }, bits('Q').map((t) => h('div', { class: 'sw lamp', dataset: { tag: t.name } }, h('div', { class: 'bulb' }), h('span', { class: 'nm' }, t.name), h('span', { class: 'ad' }, t.address.toUpperCase())))),
      live ? null : h('div', { class: 'insert-hint' }, 'Download to the CPU (Ctrl+L) to use the switches.'))
    paint()
  }
  const paint = () => {
    for (const n of el.querySelectorAll('.sw[data-tag]')) { const v = !!readOperand('', n.dataset.tag); n.classList.toggle('on', isOnline() && v) }
  }
  render()
  on('project', ({ reason } = {}) => { if (reason !== 'edit') render(); else render() }); on('online', render); on('tick', paint)
  return el
}
