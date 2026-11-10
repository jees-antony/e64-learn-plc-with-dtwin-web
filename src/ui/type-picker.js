import { availableTypes, checkType } from '../core/types.js'
import { uid } from '../core/model.js'
import { h } from './dom.js'

// A real listbox, rather than a browser datalist that accepts invalid types silently.
export function typePicker({ project, value, change, label, instances = false, block }) {
  const id = uid('types'), errorId = id + '-error'
  let expanded = false, active = 0, choices = [], disposed = false, blurTimer, searching = false
  const input = h('input', { value: value(), role: 'combobox', 'aria-label': label, 'aria-autocomplete': 'list', 'aria-controls': id, 'aria-expanded': 'false', autocomplete: 'off', spellcheck: 'false' })
  const list = h('div', { id, class: 'type-options', role: 'listbox', 'aria-label': 'Available data types', hidden: true })
  const message = h('div', { id: errorId, class: 'type-error', role: 'status' })
  const arrow = h('button', { type: 'button', class: 'type-arrow', 'aria-label': `Choose ${label}`, 'aria-expanded': 'false', title: 'Choose a data type', onMousedown: e => e.preventDefault(), onClick: () => { const next = !expanded; input.focus(); expanded = next; renderList(false) } }, '▾')
  const el = h('div', { class: 'type-picker' }, h('div', { class: 'type-input' }, input, arrow), list, message)
  const options = () => ({ instances, block: block?.() })
  function validate() {
    const result = checkType(project(), input.value, options())
    input.classList.toggle('bad', !result.ok)
    input.setAttribute('aria-invalid', String(!result.ok))
    input.setAttribute('aria-describedby', errorId)
    message.textContent = result.ok ? '' : result.message
    return result
  }
  function choose(name) {
    input.value = name; expanded = false
    change(name); validate(); renderList(); input.focus()
  }
  function renderList(filter = searching) {
    const query = filter ? input.value.trim().toLowerCase() : ''
    choices = availableTypes(project(), options()).filter(t => !query || t.name.toLowerCase().includes(query))
    active = Math.max(0, Math.min(active, choices.length - 1))
    list.replaceChildren(...choices.map((t, i) => h('button', { type: 'button', id: `${id}-${i}`, role: 'option', 'aria-selected': String(i === active), class: i === active ? 'active' : '', tabindex: '-1', onMousedown: e => e.preventDefault(), onClick: () => choose(t.name) }, h('b', null, t.name), h('small', null, t.kind))))
    if (!choices.length) list.append(h('div', { class: 'type-empty' }, 'No matching data type. Clear the field to see all types.'))
    list.hidden = !expanded
    if (expanded) {
      if (list.parentNode !== document.body) document.body.append(list)
      const rect = input.getBoundingClientRect(), height = Math.min(230, Math.max(100, choices.length * 34 + 10)), below = innerHeight - rect.bottom
      Object.assign(list.style, { left: `${Math.max(4, Math.min(rect.left, innerWidth - 270))}px`, width: `${Math.max(260, rect.width + 26)}px`, top: `${below < Math.min(height, 150) ? Math.max(4, rect.top - height) : rect.bottom + 2}px`, maxHeight: `${height}px` })
    }
    input.setAttribute('aria-expanded', String(expanded)); arrow.setAttribute('aria-expanded', String(expanded))
    if (expanded && choices.length) { input.setAttribute('aria-activedescendant', `${id}-${active}`); list.children[active]?.scrollIntoView({ block: 'nearest' }) }
    else input.removeAttribute('aria-activedescendant')
  }
  input.addEventListener('input', () => { active = 0; expanded = true; searching = true; change(input.value); validate(); renderList() })
  input.addEventListener('focus', () => { clearTimeout(blurTimer); expanded = true; searching = false; active = Math.max(0, availableTypes(project(), options()).findIndex(t => t.name.toLowerCase() === input.value.trim().toLowerCase())); renderList(false) })
  input.addEventListener('blur', () => { blurTimer = setTimeout(() => { if (disposed) return; expanded = false; const result = validate(); if (result.ok && input.value !== result.name) { input.value = result.name; change(result.name) } renderList() }, 120) })
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation()
      if (!expanded) { expanded = true; renderList(false) }
      else { active = Math.max(0, Math.min(choices.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1))); renderList() }
    } else if (e.key === 'Enter' && expanded && choices[active]) { e.preventDefault(); e.stopPropagation(); choose(choices[active].name) }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); expanded = false; renderList() }
    else if (e.key === 'Tab') { expanded = false; renderList() }
  })
  validate()
  return { el, refresh() { if (document.activeElement !== input) input.value = value(); validate() }, dispose() { disposed = true; clearTimeout(blurTimer); list.remove() } }
}
