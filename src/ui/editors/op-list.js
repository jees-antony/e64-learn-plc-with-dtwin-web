// TIA-style operand list under the ladder operand box: a small table of tags (name, data type, address,
// initial value, comment) that filters as you type. Arrow keys move the highlight, Enter or a click takes it.
// options: [{ value, type, address?, init?, comment?, source?, other? }]   (other = does not fit this operand)
import { h } from '../dom.js'

const ICON = { 'PLC tag': 'tag', Instance: 'inst', Constant: 'const' }

export function opList(input, options, onPick) {
  let rows = [], at = -1
  const body = h('tbody')
  const el = h('div', { class: 'op-list', role: 'listbox', 'aria-label': 'Matching tags' },
    h('div', { class: 'op-scroll' }, h('table', null,
      h('thead', null, h('tr', null, h('th', { class: 'c-name' }, 'Name'), h('th', null, 'Data type'), h('th', null, 'Address'), h('th', null, 'Initial value'), h('th', { class: 'c-cmt' }, 'Comment'))),
      body)),
    h('div', { class: 'op-foot' }, h('span', null, '↑↓ choose · Enter take · Esc cancel'), h('span', { class: 'op-count' })))
  // Keep the focus (and the caret) in the text box while the learner clicks in the list.
  el.addEventListener('mousedown', (e) => e.preventDefault())

  const rank = (o, t) => {
    const n = o.value.toLowerCase()
    if (!t) return 0
    if (n === t) return 0
    if (n.startsWith(t)) return 1
    if (n.split(/[_.]/).some((w) => w.startsWith(t))) return 2
    return n.includes(t) || (o.comment ?? '').toLowerCase().includes(t) ? 3 : null
  }
  function fill() {
    const t = input.value.trim().toLowerCase()
    // While the box still shows the old value unchanged, list everything; after typing, filter.
    const filter = input.dataset.typed ? t : ''
    rows = options.map((o, i) => [o, rank(o, filter), i]).filter(([, s]) => s !== null)
      .sort((a, b) => (a[0].other ? 1 : 0) - (b[0].other ? 1 : 0) || a[1] - b[1] || a[2] - b[2]).map(([o]) => o)
    at = -1
    let other = false
    body.replaceChildren(...rows.flatMap((o, i) => {
      const sep = o.other && !other ? (other = true, h('tr', { class: 'op-sep' }, h('td', { colspan: '5' }, 'Other data types'))) : null
      const tr = h('tr', { class: `op-row${o.other ? ' other' : ''}${o.value === input.value.trim() ? ' current' : ''}`, role: 'option', title: o.source ?? '', onClick: () => onPick(o.value), onMousemove: () => { if (at !== i) highlight(i) } },
        h('td', { class: 'c-name' }, h('span', { class: `op-ico ${ICON[o.source] ?? 'local'}` }), o.value),
        h('td', null, o.type ?? ''), h('td', { class: 'mono' }, o.address ?? ''), h('td', { class: 'mono' }, o.init ?? ''), h('td', { class: 'c-cmt' }, o.comment ?? ''))
      return sep ? [sep, tr] : [tr]
    }))
    el.querySelector('.op-count').textContent = rows.length ? `${rows.length} tag${rows.length === 1 ? '' : 's'}` : ''
    el.hidden = !rows.length
    place()
  }
  function highlight(i) {
    at = Math.max(0, Math.min(rows.length - 1, i))
    const trs = body.querySelectorAll('.op-row')
    trs.forEach((tr, k) => tr.classList.toggle('hl', k === at))
    trs[at]?.scrollIntoView({ block: 'nearest' })
  }
  function place() {
    if (!input.isConnected) return
    const r = input.getBoundingClientRect(), w = el.offsetWidth, hgt = el.offsetHeight
    el.style.left = `${Math.max(4, Math.min(r.left, innerWidth - w - 4))}px`
    el.style.top = `${r.bottom + 2 + hgt > innerHeight - 4 && r.top - hgt - 2 > 4 ? r.top - hgt - 2 : r.bottom + 2}px`
  }
  input.addEventListener('input', () => { input.dataset.typed = '1'; fill() })
  fill()
  return {
    el, place,
    move: (d) => { if (!rows.length) return; highlight(at < 0 ? (d > 0 ? 0 : rows.length - 1) : at + d) },
    /** The highlighted row's name, or '' when the learner has not moved into the list. */
    picked: () => (at >= 0 ? rows[at]?.value ?? '' : ''),
  }
}
