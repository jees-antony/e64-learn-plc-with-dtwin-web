// Command registry: one place for actions, their shortcuts and where each shortcut comes from.
// `src: 'tia'` marks bindings taken from the S7 engineering-tool convention (assigned from memory of
// that tool — check them against the tool you know); `src: 'app'` marks bindings this app adds.
import { newBlock, sampleProject } from '../core/model.js'
import { compile, download, goOffline, goOnline, runCpu, say, startSimulation, stopCpu } from './online.js'
import { closeTab, edit, emit, openTab, persist, redo, replaceProject, state, undo } from './store.js'
import { keyString } from './dom.js'

export const editor = { api: null }   // set by the active editor: { insert(kind), remove(), insertNetwork(), copy(), cut(), paste(), edit(), move(dir), zoom(delta) }
export const commands = new Map()

function def(id, label, keys, src, run, opts = {}) { commands.set(id, { id, label, keys, src, run, ...opts }) }

export function toast(text) {
  document.querySelector('.toast')?.remove()
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = text
  document.body.append(t); setTimeout(() => t.remove(), 2200)
}
const E = () => editor.api

/* file */
def('save', 'Save project', 'Ctrl+S', 'tia', () => { persist(true); state.dirty = false; emit('project', { reason: 'saved' }); toast('Project saved in this browser') }, { global: true })
def('export', 'Export project…', '', 'app', () => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([JSON.stringify(state.project, null, 2)], { type: 'application/json' }))
  a.download = `${state.project.name}.plcproj.json`; a.click(); URL.revokeObjectURL(a.href)
})
def('import', 'Open / import project…', 'Ctrl+O', 'tia', () => {
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json'
  input.onchange = async () => { try { const p = JSON.parse(await input.files[0].text()); if (!p.blocks || !p.tags) throw new Error('not a project file'); replaceProject(p); toast(`Opened ${p.name}`) } catch (e) { toast(`Cannot open: ${e.message}`) } }
  input.click()
}, { global: true })
def('example', 'New project from example', '', 'app', () => { if (!state.dirty || confirm('Replace the current project with the example?')) replaceProject(sampleProject()) })

/* edit */
def('undo', 'Undo', 'Ctrl+Z', 'tia', () => undo())
def('redo', 'Redo', 'Ctrl+Y', 'tia', () => redo())
def('copy', 'Copy', 'Ctrl+C', 'tia', () => E()?.copy?.())
def('cut', 'Cut', 'Ctrl+X', 'tia', () => E()?.cut?.())
def('paste', 'Paste', 'Ctrl+V', 'tia', () => E()?.paste?.())
def('delete', 'Delete', 'Delete', 'tia', () => E()?.remove?.())
def('rename', 'Rename', 'F2', 'tia', () => emit('rename'))
def('editOperand', 'Edit operand', 'Enter', 'tia', () => E()?.edit?.())
def('escape', 'Cancel / clear selection', 'Escape', 'tia', () => E()?.escape?.())

/* online */
def('compile', 'Compile', 'Ctrl+B', 'tia', () => { compile(); emit('inspector', 'info') }, { global: true })
def('download', 'Download to device', 'Ctrl+L', 'tia', () => { download(); emit('inspector', 'info') }, { global: true })
def('goOnline', 'Go online', 'Ctrl+K', 'tia', () => goOnline(), { global: true })
def('goOffline', 'Go offline', 'Ctrl+M', 'tia', () => goOffline(), { global: true })
def('simulate', 'Start simulation', 'Ctrl+Shift+X', 'tia', () => { startSimulation(); emit('inspector', 'info') }, { global: true })
def('run', 'Start CPU', '', 'app', () => runCpu())
def('stop', 'Stop CPU', '', 'app', () => stopCpu())
def('monitor', 'Monitoring on / off', 'Ctrl+Shift+M', 'app', () => { state.monitor = state.monitor === false; emit('tick'); emit('online') }, { global: true })

/* insert (LAD / FBD) */
def('insertNetwork', 'Insert network', 'Ctrl+R', 'tia', () => E()?.insertNetwork?.())
def('insNO', 'Normally open contact', 'Shift+F2', 'tia', () => E()?.insert?.('NO'))
def('insNC', 'Normally closed contact', 'Shift+F3', 'tia', () => E()?.insert?.('NC'))
def('insSet', 'Set output coil', 'Shift+F4', 'app', () => E()?.insert?.('set'))
def('insBox', 'Empty box (choose instruction)', 'Shift+F5', 'tia', () => E()?.insert?.('box?'))
def('insReset', 'Reset output coil', 'Shift+F6', 'app', () => E()?.insert?.('reset'))
def('insCoil', 'Output coil', 'Shift+F7', 'tia', () => E()?.insert?.('coil'))
def('insBranch', 'Open branch', 'Shift+F8', 'tia', () => E()?.insert?.('branch'))
def('insCmp', 'Comparison', 'Shift+F10', 'app', () => E()?.insert?.('cmp'))

/* navigation / view */
def('left', 'Select previous element', 'ArrowLeft', 'tia', () => E()?.move?.('left'))
def('right', 'Select next element', 'ArrowRight', 'tia', () => E()?.move?.('right'))
def('up', 'Select element above / previous network', 'ArrowUp', 'tia', () => E()?.move?.('up'))
def('down', 'Select element below / next network', 'ArrowDown', 'tia', () => E()?.move?.('down'))
def('closeTab', 'Close editor', 'Ctrl+F4', 'tia', () => state.active && closeTab(state.active))
def('help', 'Keyboard shortcuts', 'F1', 'tia', () => emit('shortcuts'), { global: true })
def('toggleLeft', 'Show / hide project tree', '', 'app', () => emit('layout', 'left'))
def('toggleRight', 'Show / hide task cards', '', 'app', () => emit('layout', 'right'))
def('toggleBottom', 'Show / hide inspector window', '', 'app', () => emit('layout', 'bottom'))

export function addBlock(kind, lang, name, number) {
  const b = newBlock(kind, name, lang, number)
  edit((p) => p.blocks.push(b))
  openTab({ type: 'block', id: b.id })
  return b
}

/* ---------------------------------------------------------- keyboard ---- */
const byKeys = new Map()
export function indexKeys() { byKeys.clear(); for (const c of commands.values()) if (c.keys) byKeys.set(c.keys, c) }

const inText = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable || t.closest?.('.cm-editor'))
export function installKeyboard() {
  indexKeys()
  addEventListener('keydown', (e) => {
    const k = keyString(e)
    if (!k) return
    const c = byKeys.get(k)
    if (!c) return
    const typing = inText(e.target)
    if (typing && !c.global) return
    if (document.querySelector('dialog[open]') && c.id !== 'help') return
    e.preventDefault()
    e.stopPropagation()
    c.run()
  }, true)
  // Ctrl+wheel zoom in editors (same gesture as the engineering tool)
  addEventListener('wheel', (e) => { if (e.ctrlKey && e.target.closest?.('#editor')) { e.preventDefault(); editor.api?.zoom?.(e.deltaY < 0 ? 0.1 : -0.1) } }, { passive: false })
  void say
}
