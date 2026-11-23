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
  const el = h('div', { class: 'ins-card' })
  const note = h('div', { class: 'insert-hint' }, 'Instructions are for ladder and FBD blocks. In SCL, type the code.')
  const rows = []   // [item, element] pairs whose availability is refreshed
  let selected = null

  // Shared wiring for tree rows and favorites buttons.
  const wire = (it, node) => {
    node.addEventListener('dragstart', (e) => { if (node.classList.contains('na')) return e.preventDefault(); e.dataTransfer.setData('text/plain', JSON.stringify({ lad: it.lad, fbd: it.fbd })); e.dataTransfer.effectAllowed = 'copy' })
    node.addEventListener('dblclick', () => { const a = availability(it, activeLang()); if (a.ok) editor.api?.drop?.({ lad: it.lad, fbd: it.fbd }); else toast(a.reason) })
    rows.push([it, node])
  }
  const twisty = (open) => h('span', { class: 'ins-tw' }, open ? '▼' : '▶')
  const folderIcon = () => h('span', { class: 'ins-folder' })

  // Collapsible pane with a grey header; returns { pane, body }.
  const pane = (title, open, ...content) => {
    const tw = twisty(open)
    const body = h('div', { class: 'ins-pane-body' }, ...content)
    body.hidden = !open
    const head = h('div', { class: 'ins-pane-head', role: 'button', tabindex: '0' }, tw, h('span', null, title))
    const toggle = () => { body.hidden = !body.hidden; tw.textContent = body.hidden ? '▶' : '▼' }
    head.addEventListener('click', toggle)
    head.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } })
    return h('div', { class: 'ins-pane' }, head, body)
  }

  // Favorites
  const favTia = ['-| |-', '-|/|-', '-( )-', '??', '-->', '<--']
  const all = PALETTE.flatMap((g) => g.items)
  const favs = h('div', { class: 'ins-favs' })
  for (const t of favTia) {
    const it = all.find((x) => x.tia === t); if (!it) continue
    const b = h('div', { class: 'pal-item fav-btn', draggable: 'true' }, iconFor(it))
    wire(it, b); favs.append(b)
  }

  // Basic instructions tree
  const tree = h('div', { class: 'ins-tree' })
  PALETTE.forEach((g, gi) => {
    const open = gi < 2
    const tw = twisty(open)
    const kids = h('div', { class: 'ins-kids' })
    kids.hidden = !open
    const folder = h('div', { class: 'ins-row ins-folder-row' }, h('span', { class: 'ins-name' }, tw, folderIcon(), h('span', { class: 'ins-label' }, g.group)), h('span'), h('span'))
    folder.addEventListener('click', () => { kids.hidden = !kids.hidden; tw.textContent = kids.hidden ? '▶' : '▼' })
    for (const it of g.items) {
      const row = h('div', { class: 'pal-item ins-row ins-item', draggable: 'true' },
        h('span', { class: 'ins-name' }, h('span', { class: 'ins-ico' }, iconFor(it)), h('span', { class: 'ins-label' }, it.tia)),
        h('span', { class: 'ins-desc' }, it.name), h('span', { class: 'ins-ver' }, it.ver ?? ''))
      row.addEventListener('click', () => { selected?.classList.remove('sel'); selected = row; row.classList.add('sel') })
      wire(it, row); kids.append(row)
    }
    tree.append(folder, kids)
  })
  const colHead = h('div', { class: 'ins-row ins-colhead' }, h('span', null, 'Name'), h('span', null, 'Description'), h('span', null, 'Version'))

  const stub = (title) => pane(title, false, h('div', { class: 'ins-na' }, 'Not available in Web PLC Studio'))

  const refresh = () => {
    const lang = activeLang()
    note.hidden = lang === 'LAD' || lang === 'FBD'
    for (const [it, item] of rows) {
      const a = availability(it, lang)
      item.classList.toggle('na', !a.ok)
      item.draggable = a.ok
      item.title = a.ok ? `${it.name}${it.short ? ` (${it.short})` : ''}\nDrag onto a network, or double-click to insert at the selected position.` : a.reason
    }
  }
  el.append(
    h('div', { class: 'ins-options' }, 'Options'),
    note,
    pane('Favorites', true, favs),
    pane('Basic instructions', true, colHead, tree),
    stub('Extended instructions'), stub('Technology'), stub('Communication'), stub('Optional packages'))
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
