// Block editor: header, interface table and the language editor (LAD / FBD / SCL).
import { h } from '../dom.js'
import { blockById } from '../store.js'
import { mountFbd } from './fbd.js'
import { mountLadder } from './lad.js'
import { mountScl } from './scl.js'
import { interfaceTable } from './tables.js'

export function mountBlock(host, tab) {
  const b = blockById(tab.id)
  if (!b) { host.append(h('div', { class: 'empty' }, 'Block not found')); return { dispose() {} } }
  const head = h('div', { class: 'ed-head' }, h('span', { class: 'title' }, `${b.name} [${b.kind}${b.number}]`), h('span', { class: 'tag-app' }, `${b.lang === 'LAD' ? 'Ladder' : b.lang === 'FBD' ? 'Function block diagram' : 'SCL'}`), h('span', { class: 'grow' }))
  const iface = interfaceTable(b.id)
  const content = h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } })
  host.append(head, iface.el, content)
  const inner = b.lang === 'LAD' ? mountLadder(content, tab) : b.lang === 'FBD' ? mountFbd(content, tab) : mountScl(content, tab)
  return { dispose() { inner.dispose?.() }, focus() { inner.focus?.() } }
}
