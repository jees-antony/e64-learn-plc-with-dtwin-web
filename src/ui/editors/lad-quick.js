// Small keyboard-friendly popover opened from the ladder "+" buttons.
// rows: [{ label, desc, keys, icon, hot, keep, run }]   groups: [{ group, items: [{ label, keys, icon, run }] }]
import { h } from '../dom.js'

let current = null
let lastOutside = null   // lets a second click on the same "+" close the menu instead of re-opening it
export const closeQuick = () => current?.close()
export const quickIsOpen = () => !!current

export function openQuick({ anchor, rows, groups, startMore = false, restore }) {
  if (lastOutside && lastOutside.anchor === anchor && performance.now() - lastOutside.t < 400) { lastOutside = null; return }
  closeQuick()
  const pop = h('div', { class: 'quick-menu', role: 'menu', style: { visibility: 'hidden' } })
  const slot = anchor.closest('.wire-slot')
  slot?.classList.add('menu-open')
  let view = startMore ? 'more' : 'main'

  const row = (it, cls = '') => h('button', {
    type: 'button', class: `qm-row${it.hot ? ' hot' : ''} ${cls}`, role: 'menuitem', tabindex: '-1',
    onClick: () => { if (it.keep) it.run(); else { close(); it.run() } },
  }, h('span', { class: 'qm-ico' }, it.icon ?? null), h('span', { class: 'qm-txt' }, h('b', null, it.label), it.desc ? h('small', null, it.desc) : null), it.keys ? h('kbd', null, it.keys) : null)

  function place() {
    if (!anchor.isConnected) { close(); return }
    const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, hgt = pop.offsetHeight
    const left = Math.max(4, Math.min(r.left - 8, innerWidth - w - 4))
    let top = r.bottom + 4
    if (top + hgt > innerHeight - 4) top = r.top - hgt - 4 >= 4 ? r.top - hgt - 4 : Math.max(4, innerHeight - hgt - 4)
    pop.style.left = `${left}px`; pop.style.top = `${top}px`; pop.style.visibility = ''
  }

  function showMain() {
    view = 'main'
    pop.replaceChildren(h('div', { class: 'qm-list' }, rows.map((r) => row(r.more ? { ...r, keep: true, run: showMore } : r, r.more ? 'qm-more' : ''))))
    place(); pop.querySelector('.qm-row')?.focus()
  }
  // How well an instruction matches the filter: exact name first, then a name starting with it, then a word
  // starting with it, then anywhere (also in the group). Lower is better; null = no match.
  const score = (i, g, t) => {
    const name = i.label.toLowerCase(), words = name.split(/[\s_()]+/)
    if (!t) return 4
    if (name === t) return 0
    if (words[0] === t) return 1
    if (name.startsWith(t)) return 2
    if (words.some((w) => w.startsWith(t))) return 3
    return `${g.group} ${name}`.toLowerCase().includes(t) ? 4 : null
  }
  let best = null   // the row Enter picks in the filter box
  function fillList(list, q) {
    const t = q.trim().toLowerCase()
    let bestScore = Infinity; best = null
    list.replaceChildren(h('button', { type: 'button', class: 'qm-row back', role: 'menuitem', tabindex: '-1', onClick: showMain }, h('span', { class: 'qm-ico' }, '‹'), h('span', { class: 'qm-txt' }, h('b', null, 'Back'))),
      groups.map((g) => {
        const items = g.items.map((i) => [i, score(i, g, t)]).filter(([, s]) => s !== null)
        return items.length ? [h('div', { class: 'qm-group' }, g.group), items.map(([i, s]) => { const r = row(i, 'pick'); if (s < bestScore) { bestScore = s; best = r } return r })] : null
      }), !t || best ? null : h('div', { class: 'qm-empty' }, 'No instruction matches.'))
    list.querySelectorAll('.best').forEach((x) => x.classList.remove('best'))
    if (t) best?.classList.add('best')
    place()
  }
  function showMore() {
    view = 'more'
    const list = h('div', { class: 'qm-list' })
    const input = h('input', { class: 'qm-filter', type: 'text', placeholder: 'Type to filter instructions…', 'aria-label': 'Filter instructions', onInput: () => fillList(list, input.value) })
    pop.replaceChildren(input, list)
    fillList(list, ''); input.focus()
  }

  const onKey = (e) => {
    const items = [...pop.querySelectorAll('.qm-row')], i = items.indexOf(document.activeElement)
    const input = pop.querySelector('.qm-filter'), inInput = document.activeElement === input
    const to = (n) => { const t = items[Math.max(0, Math.min(items.length - 1, n))]; t?.focus(); t?.scrollIntoView({ block: 'nearest' }) }
    const stop = () => { e.preventDefault(); e.stopPropagation() }
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) { stop(); if (inInput) to(0); else to(i + 1) }
    else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) { stop(); if (i <= 0 && input) input.focus(); else to(i - 1) }
    else if (e.key === 'Home' && !inInput) { stop(); to(0) }
    else if (e.key === 'End' && !inInput) { stop(); to(items.length - 1) }
    else if (e.key === 'Escape') { stop(); close(); restore?.() }
    else if (e.key === 'Enter' && inInput) { stop(); (best ?? pop.querySelector('.qm-row.pick'))?.click() }
    else if ((e.key === 'Enter' || e.key === ' ') && !inInput) { stop(); items[i]?.click() }
    else if (e.key === 'Backspace' && inInput && !input.value) { stop(); showMain() }
    else if (view === 'more' && !inInput && e.key.length === 1) input?.focus()
  }
  const outside = (e) => { if (!pop.contains(e.target)) { lastOutside = { anchor, t: performance.now() }; close() } }
  let raf = 0
  const follow = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(place) }
  function close() {
    if (current?.pop !== pop) return
    current = null; pop.remove(); slot?.classList.remove('menu-open')
    removeEventListener('mousedown', outside, true); removeEventListener('scroll', follow, true); removeEventListener('resize', follow)
  }
  // commands.js leaves plain keys inside .quick-menu alone; chords such as Shift+F2 are not ours to handle.
  pop.addEventListener('keydown', (e) => { if (!(e.ctrlKey || e.metaKey || e.altKey || /^F\d/.test(e.key))) onKey(e) })
  document.body.append(pop)
  addEventListener('mousedown', outside, true); addEventListener('scroll', follow, true); addEventListener('resize', follow)
  current = { pop, close, onKey }
  if (startMore) showMore(); else showMain()
}
