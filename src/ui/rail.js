// Left tab rail: switches the whole workspace between the Digital twin and PLC programming.
import { h, svg } from './dom.js'

const ICONS = {
  twin: 'M7 4h10v15a1 1 0 01-1 1H8a1 1 0 01-1-1zM7 12h10M3 7h4M17 16h4v4',
  plc: 'M4 4v16M20 4v16M4 9h4m3 0h2m3 0h4M8 6v6M11 6v6M16 9a2.5 2.5 0 015 0M4 16h16',
}
const KEY = 'plcweb.view'

export function buildRail({ twin, ide, onShow }) {
  const rail = document.getElementById('rail')
  const tabs = [['twin', 'Digital twin'], ['plc', 'PLC programming']]
  let current = null
  const show = (id) => {
    current = id
    document.body.dataset.view = id
    twin.hidden = id !== 'twin'; ide.hidden = id !== 'plc'
    for (const b of rail.querySelectorAll('.rail-tab')) b.classList.toggle('on', b.dataset.id === id)
    try { localStorage.setItem(KEY, id) } catch { /* storage blocked */ }
    onShow?.(id)
  }
  rail.replaceChildren(...tabs.map(([id, text]) => h('button', { class: 'rail-tab', dataset: { id }, title: text, onClick: () => show(id) },
    svg('svg', { viewBox: '0 0 24 24' }, svg('path', { d: ICONS[id] })), h('span', null, text))))
  let start = 'twin'
  try { start = localStorage.getItem(KEY) === 'plc' ? 'plc' : 'twin' } catch { /* default */ }
  show(start)
  return { show, get current() { return current } }
}
