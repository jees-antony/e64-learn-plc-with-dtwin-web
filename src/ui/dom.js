// Minimal DOM helpers (no framework).
// replaceChildren would print "null" for empty slots; skip them so views can write `cond ? node : null`.
const nativeReplace = Element.prototype.replaceChildren
Element.prototype.replaceChildren = function (...nodes) { return nativeReplace.apply(this, nodes.flat(Infinity).filter((n) => n !== null && n !== undefined && n !== false)) }

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue
    if (k === 'class') el.className = v
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v)
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v)
    else if (k === 'dataset') Object.assign(el.dataset, v)
    else if (v === true) el.setAttribute(k, '')
    else el.setAttribute(k, v)
  }
  append(el, children)
  return el
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue
    el.append(c instanceof Node ? c : document.createTextNode(String(c)))
  }
}
export const svg = (tag, attrs, ...children) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag)
  for (const [k, v] of Object.entries(attrs ?? {})) if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v)
  append(el, children)
  return el
}
export const clear = (el) => { el.textContent = ''; return el }
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/** Normalised key string for an event: `Ctrl+Shift+F2`, `Delete`, `Ctrl+Z`. */
export function keyString(e) {
  const parts = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  let k = e.key
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(k)) return ''
  if (k.length === 1) k = k.toUpperCase()
  if (k === ' ') k = 'Space'
  if (k === 'Esc') k = 'Escape'
  parts.push(k)
  return parts.join('+')
}

export function contextMenu(x, y, items) {
  document.querySelector('.ctx')?.remove()
  const menu = h('div', { class: 'ctx', role: 'menu' })
  for (const it of items) {
    if (it === '-') { menu.append(h('div', { class: 'ctx-sep' })); continue }
    menu.append(h('button', { class: 'ctx-item', disabled: it.disabled, onClick: () => { menu.remove(); it.run?.() } }, h('span', null, it.label), it.keys ? h('kbd', null, it.keys) : null))
  }
  document.body.append(menu)
  const r = menu.getBoundingClientRect()
  menu.style.left = `${Math.min(x, innerWidth - r.width - 4)}px`
  menu.style.top = `${Math.min(y, innerHeight - r.height - 4)}px`
  const close = (e) => { if (!menu.contains(e.target) || e.type === 'contextmenu') { menu.remove(); removeEventListener('mousedown', close, true); removeEventListener('contextmenu', close, true); removeEventListener('keydown', esc2, true) } }
  const esc2 = (e) => { if (e.key === 'Escape') close({ target: document.body, type: 'x' }) }
  setTimeout(() => { addEventListener('mousedown', close, true); addEventListener('contextmenu', close, true); addEventListener('keydown', esc2, true) })
  return menu
}
