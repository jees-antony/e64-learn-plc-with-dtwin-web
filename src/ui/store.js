// Application state: the project, selection, tabs, online session. Views subscribe to events.
import { tankProject } from '../core/model.js'

const KEY = 'plcweb.project.v2'   // v2: the water tank twin project (v1 projects stay in storage untouched)
const listeners = new Map()
export const on = (event, fn) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); return () => listeners.get(event).delete(fn) }
export const emit = (event, data) => { for (const fn of listeners.get(event) ?? []) fn(data) }

function load() {
  try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw) } catch { /* corrupt or unavailable */ }
  return tankProject()
}

export const state = {
  project: load(),
  dirty: false,
  tabs: [],              // [{ type:'block'|'tags'|'watch'|'cpu', id }]
  active: null,          // tab key
  selection: null,       // { block, network, path? }
  diagnostics: [],
  online: { machine: null, source: '', mode: 'offline', downloaded: false, error: null }, // mode: offline | stop | run
  undo: [], redo: [],
  clipboard: null,
}

let saveTimer = null
export function persist(now = false) {
  clearTimeout(saveTimer)
  const write = () => { try { localStorage.setItem(KEY, JSON.stringify(state.project)) } catch { /* storage full or blocked */ } }
  if (now) write(); else saveTimer = setTimeout(write, 400)
}

let lastKey = null, lastAt = 0
/** Apply a change to the project with undo support. `coalesce` merges rapid edits of one thing (typing). */
export function edit(fn, coalesce = null) {
  const before = JSON.stringify(state.project)
  const now = Date.now()
  if (!(coalesce && coalesce === lastKey && now - lastAt < 1200)) { state.undo.push(before); if (state.undo.length > 100) state.undo.shift() }
  lastKey = coalesce; lastAt = now
  state.redo.length = 0
  fn(state.project)
  state.dirty = true
  persist()
  emit('project', { reason: 'edit' })
}
export function undo() { step(state.undo, state.redo) }
export function redo() { step(state.redo, state.undo) }
function step(from, to) {
  if (!from.length) return
  to.push(JSON.stringify(state.project))
  state.project = JSON.parse(from.pop())
  lastKey = null
  state.dirty = true
  persist()
  emit('project', { reason: 'undo' })
}
export function replaceProject(p) {
  state.project = p; state.undo.length = 0; state.redo.length = 0; state.tabs = []; state.active = null; state.selection = null; state.dirty = false
  persist(true)
  emit('project', { reason: 'replace' })
  emit('tabs')
}

export const blockById = (id) => state.project.blocks.find((b) => b.id === id)
export const tabKey = (t) => `${t.type}:${t.id ?? ''}`

export function openTab(tab) {
  const key = tabKey(tab)
  if (!state.tabs.some((t) => tabKey(t) === key)) state.tabs.push(tab)
  state.active = key
  emit('tabs')
}
export function closeTab(key) {
  const i = state.tabs.findIndex((t) => tabKey(t) === key)
  if (i < 0) return
  state.tabs.splice(i, 1)
  if (state.active === key) state.active = state.tabs[Math.max(0, i - 1)] ? tabKey(state.tabs[Math.max(0, i - 1)]) : null
  emit('tabs')
}
export function select(sel) { state.selection = sel; emit('selection', sel) }
