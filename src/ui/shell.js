// The window: title bar, menus, toolbar, project tree, editor tabs, task cards, inspector, status bar.
import { IDENT, uid } from '../core/model.js'
import { instructionsCard, onlineCard, simulationCard } from './cards.js'
import { addBlock, commands, editor, installKeyboard, toast } from './commands.js'
import { clear, contextMenu, h, svg } from './dom.js'
import { mountBlock } from './editors/block.js'
import { mountTags, mountWatch } from './editors/tables.js'
import { log } from './online.js'
import { blockById, closeTab, edit, emit, on, openTab, select, state, tabKey } from './store.js'

const $ = (id) => document.getElementById(id)
const icon = (d) => svg('svg', { viewBox: '0 0 24 24' }, svg('path', { d }))
const ICON = {
  save: 'M5 3h12l3 3v15H5zM8 3v6h8V3M8 21v-7h8v7',
  undo: 'M9 7L4 12l5 5M4 12h10a6 6 0 010 12', redo: 'M15 7l5 5-5 5M20 12H10a6 6 0 000 12',
  compile: 'M5 12l4 4 10-10', download: 'M12 3v12m0 0l-4-4m4 4l4-4M5 20h14',
  online: 'M4 12h4l2-5 4 10 2-5h4', offline: 'M4 12h4m8 0h4M9 8l6 8', run: 'M7 4l12 8-12 8z', stop: 'M6 6h12v12H6z', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zM12 9a3 3 0 100 6 3 3 0 000-6z',
  net: 'M4 6h16M4 18h16M4 12h4M16 12h4M8 9v6M16 9v6', no: 'M3 12h6M9 6v12M15 6v12M15 12h6', nc: 'M3 12h6M9 6v12M15 6v12M15 12h6M8 17l8-10', coil: 'M3 12h4M17 12h4M9 6q-4 6 0 12M15 6q4 6 0 12', branch: 'M4 7h16M4 17h16M4 7v10M20 7v10', cmp: 'M5 5h14v14H5zM9 10h6M9 14h6',
  help: 'M9 9a3 3 0 116 0c0 2-3 2-3 5M12 18v.5',
}

/* ------------------------------------------------------------- title bar -- */
function titlebar() {
  const el = $('titlebar'), conn = h('div', { id: 'conn' })
  const render = () => {
    const o = state.online, p = state.project
    const cls = o.error ? 'err' : o.mode === 'run' ? 'run' : o.mode === 'stop' ? 'stop' : 'offline'
    el.replaceChildren(h('div', { id: 'brand' }, 'PL'), h('div', { id: 'projname' }, `${p.name}${state.dirty ? ' *' : ''}`, h('small', null, `${p.plc.name} · virtual CPU`)),
      h('div', { id: 'conn' }, h('span', { class: `pill ${cls}` }, h('i'), o.error ? 'CPU error' : o.mode === 'run' ? 'ONLINE · RUN' : o.mode === 'stop' ? 'ONLINE · STOP' : 'OFFLINE')))
    void conn
  }
  render(); on('online', render); on('project', render)
}

/* ------------------------------------------------------------------ menus -- */
const MENUS = [
  ['Project', ['example', 'import', 'export', '-', 'save']],
  ['Edit', ['undo', 'redo', '-', 'cut', 'copy', 'paste', 'delete', '-', 'rename']],
  ['View', ['toggleLeft', 'toggleRight', 'toggleBottom', '-', 'help']],
  ['Insert', ['insertNetwork', '-', 'insNO', 'insNC', 'insCoil', 'insSet', 'insReset', 'insBranch', 'insBox', 'insCmp']],
  ['Online', ['goOnline', 'goOffline', '-', 'download', 'simulate', '-', 'run', 'stop', '-', 'monitor']],
  ['Tools', ['compile']],
  ['Help', ['help']],
]
function menubar() {
  const bar = $('menubar')
  for (const [name, ids] of MENUS) {
    const b = h('button', { class: 'm' }, name)
    b.addEventListener('click', (e) => {
      const r = b.getBoundingClientRect(); b.classList.add('open')
      const m = contextMenu(r.left, r.bottom, ids.map((id) => (id === '-' ? '-' : { label: commands.get(id).label, keys: commands.get(id).keys, run: () => commands.get(id).run() })))
      new MutationObserver((_, ob) => { if (!document.body.contains(m)) { b.classList.remove('open'); ob.disconnect() } }).observe(document.body, { childList: true })
      e.stopPropagation()
    })
    bar.append(b)
  }
}

/* ----------------------------------------------------------------- toolbar -- */
function toolbar() {
  const el = $('toolbar')
  const btn = (id, ico, label, cls = '') => { const c = commands.get(id); return h('button', { class: `tb ${cls}`, title: `${c.label}${c.keys ? ` (${c.keys})` : ''}`, dataset: { cmd: id }, onClick: () => c.run() }, icon(ICON[ico]), label) }
  const render = () => {
    const o = state.online
    el.replaceChildren(btn('save', 'save', ''), btn('undo', 'undo', ''), btn('redo', 'redo', ''), h('div', { class: 'sep' }),
      btn('compile', 'compile', 'Compile', 'compile'), btn('download', 'download', 'Download'), h('div', { class: 'sep' }),
      btn('goOnline', 'online', 'Go online'), btn('goOffline', 'offline', 'Go offline'), btn('run', 'run', 'Start CPU', 'run'), btn('stop', 'stop', 'Stop CPU', 'halt'),
      h('button', { class: `tb${state.monitor === false ? '' : ' on'}`, title: 'Monitoring on / off (Ctrl+Shift+M)', onClick: () => commands.get('monitor').run() }, icon(ICON.eye), 'Monitor'), h('div', { class: 'sep' }),
      btn('insertNetwork', 'net', ''), btn('insNO', 'no', ''), btn('insNC', 'nc', ''), btn('insCoil', 'coil', ''), btn('insBranch', 'branch', ''), btn('insCmp', 'cmp', ''), h('div', { class: 'sep' }), btn('help', 'help', ''))
    const set = (id, dis) => { const b = el.querySelector(`[data-cmd="${id}"]`); if (b) b.disabled = dis }
    set('goOnline', !o.machine || o.mode !== 'offline'); set('goOffline', o.mode === 'offline'); set('run', !o.machine || o.mode !== 'stop'); set('stop', o.mode !== 'run')
  }
  render(); on('online', render); on('tabs', render)
}

/* -------------------------------------------------------------------- tree -- */
const TS = { open: new Set(['project', 'plc', 'blocks', 'tags', 'watch']), sel: null, renaming: null }
function tree(host) {
  const body = h('div', { class: 'tree', tabindex: '0' })
  host.append(h('div', { class: 'pane-head' }, 'Project tree', h('span', { class: 'grow' })), h('div', { class: 'pane-body', id: 'treebody' }, body))
  const node = (id, depth, { label, ic, icText, badge, open: isOpen, hasKids, run, ctx, renamable, dim, live }) => {
    const rn = TS.renaming === id
    const el = h('div', { class: `node${TS.sel === id ? ' sel' : ''}`, dataset: { id }, style: { paddingLeft: `${6 + depth * 14}px` } },
      h('span', { class: 'tw', onClick: (e) => { e.stopPropagation(); TS.open.has(id) ? TS.open.delete(id) : TS.open.add(id); render() } }, hasKids ? (TS.open.has(id) ? '▼' : '▶') : ''),
      h('span', { class: `ic ${ic}` }, icText ?? ''),
      rn ? h('input', { value: label, onClick: (e) => e.stopPropagation(), onKeydown: (e) => { e.stopPropagation(); if (e.key === 'Enter') commitRename(e.target.value, id); if (e.key === 'Escape') { TS.renaming = null; render() } }, onBlur: (e) => commitRename(e.target.value, id) }) : h('span', { class: `lbl${dim ? ' dim' : ''}` }, label),
      live ? h('span', { class: 'live' }) : badge ? h('span', { class: 'badge' }, badge) : null)
    el.addEventListener('mousedown', () => { TS.sel = id; body.querySelectorAll('.node.sel').forEach((n) => n.classList.remove('sel')); el.classList.add('sel'); body.focus({ preventScroll: true }); document.body.dataset.pane = 'tree' })
    el.addEventListener('dblclick', () => run?.())
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); TS.sel = id; render(); if (ctx) contextMenu(e.clientX, e.clientY, ctx) })
    if (rn) setTimeout(() => body.querySelector('input')?.select(), 0)
    return el
  }
  function commitRename(value, id) {
    if (TS.renaming !== id) return
    TS.renaming = null
    const v = value.trim()
    if (id.startsWith('b:')) {
      const bid = id.slice(2)
      if (!IDENT.test(v)) toast('Block names may contain letters, digits and underscores, and must not start with a digit.')
      else if (state.project.blocks.some((b) => b.name === v && b.id !== bid)) toast(`A block named "${v}" already exists.`)
      else edit((p) => { p.blocks.find((b) => b.id === bid).name = v })
    } else if (id.startsWith('w:')) edit((p) => { p.watch.find((w) => w.id === id.slice(2)).name = v || 'Watch table' })
    else if (id === 'project') edit((p) => { p.name = v || p.name })
    else if (id === 'plc') edit((p) => { p.plc.name = v || p.plc.name })
    render()
  }
  function deleteSelected() {
    const id = TS.sel
    if (id?.startsWith('b:')) { const b = blockById(id.slice(2)); if (b && confirm(`Delete block "${b.name}"?`)) { closeTab(tabKey({ type: 'block', id: b.id })); edit((p) => { p.blocks = p.blocks.filter((x) => x.id !== b.id) }) } }
    else if (id?.startsWith('w:')) { closeTab(tabKey({ type: 'watch', id: id.slice(2) })); edit((p) => { p.watch = p.watch.filter((w) => w.id !== id.slice(2)) }) }
  }
  const openBlock = (b) => () => openTab({ type: 'block', id: b.id })
  function render() {
    const p = state.project, rows = []
    const ob = (b) => ({ OB: 'ob', FB: 'fb', FC: 'fc' })[b.kind]
    rows.push(node('project', 0, { label: p.name, ic: 'folder', icText: '▣', hasKids: true, renamable: true, ctx: [{ label: 'Rename', keys: 'F2', run: () => { TS.renaming = 'project'; render() } }] }))
    if (TS.open.has('project')) {
      rows.push(node('plc', 1, { label: p.plc.name, ic: 'dev', icText: 'CPU', hasKids: true, live: state.online.mode !== 'offline', badge: '', ctx: [{ label: 'Rename', keys: 'F2', run: () => { TS.renaming = 'plc'; render() } }] }))
      if (TS.open.has('plc')) {
        rows.push(node('blocks', 2, { label: 'Program blocks', ic: 'folder', icText: '▤', hasKids: true, ctx: [{ label: 'Add new block…', run: () => emit('addblock') }] }))
        if (TS.open.has('blocks')) {
          rows.push(node('addblock', 3, { label: 'Add new block', ic: 'folder', icText: '✚', dim: true, run: () => emit('addblock') }))
          for (const b of [...p.blocks].sort((a, c) => a.kind.localeCompare(c.kind) * -1 || a.number - c.number)) {
            rows.push(node(`b:${b.id}`, 3, { label: b.name, ic: ob(b), icText: b.kind, badge: `[${b.kind}${b.number}] ${b.lang}`, run: openBlock(b), renamable: true,
              ctx: [{ label: 'Open', run: openBlock(b) }, { label: 'Rename', keys: 'F2', run: () => { TS.renaming = `b:${b.id}`; render() } }, '-', { label: 'Delete', keys: 'Delete', run: deleteSelected }] }))
          }
        }
        rows.push(node('tags', 2, { label: 'PLC tags', ic: 'folder', icText: '▤', hasKids: true }))
        if (TS.open.has('tags')) rows.push(node('tagtable', 3, { label: 'Default tag table', ic: 'tag', icText: 'TAG', badge: `${p.tags.length}`, run: () => openTab({ type: 'tags', id: 'default' }) }))
        rows.push(node('watch', 2, { label: 'Watch and force tables', ic: 'folder', icText: '▤', hasKids: true, ctx: [{ label: 'Add new watch table', run: addWatch }] }))
        if (TS.open.has('watch')) {
          rows.push(node('addwatch', 3, { label: 'Add new watch table', ic: 'folder', icText: '✚', dim: true, run: addWatch }))
          for (const w of p.watch) rows.push(node(`w:${w.id}`, 3, { label: w.name, ic: 'watch', icText: 'WT', run: () => openTab({ type: 'watch', id: w.id }), ctx: [{ label: 'Open', run: () => openTab({ type: 'watch', id: w.id }) }, { label: 'Rename', keys: 'F2', run: () => { TS.renaming = `w:${w.id}`; render() } }, { label: 'Delete', run: deleteSelected }] }))
        }
      }
    }
    clear(body).append(...rows)
  }
  const addWatch = () => { const w = { id: uid('w'), name: `Watch table_${state.project.watch.length + 1}`, rows: [] }; edit((p) => p.watch.push(w)); openTab({ type: 'watch', id: w.id }) }
  on('project', ({ reason } = {}) => { if (reason !== 'edit' || !document.activeElement?.closest?.('#editor')) render() })
  on('online', render)
  on('rename', (id) => { if (id) { TS.sel = `b:${id}`; TS.renaming = `b:${id}`; TS.open.add('blocks'); render() } else if (TS.sel && (TS.sel.startsWith('b:') || TS.sel.startsWith('w:') || TS.sel === 'project' || TS.sel === 'plc')) { TS.renaming = TS.sel; render() } })
  body.addEventListener('keydown', (e) => { if (e.key === 'Delete') { e.preventDefault(); e.stopPropagation(); deleteSelected() } else if (e.key === 'Enter') { e.preventDefault(); body.querySelector('.node.sel')?.dispatchEvent(new MouseEvent('dblclick')) } })
  on('tabs', () => { const t = state.tabs.find((x) => tabKey(x) === state.active); if (t?.type === 'block') { TS.sel = `b:${t.id}`; body.querySelectorAll('.node.sel').forEach((n) => n.classList.remove('sel')); body.querySelector(`[data-id="b:${t.id}"]`)?.classList.add('sel') } })
  render()
  return { deleteSelected }
}

/* ----------------------------------------------------------- editor + tabs -- */
function center(host) {
  const tabs = h('div', { id: 'tabs' }), ed = h('div', { id: 'editor' })
  host.append(tabs, ed)
  let mounted = null
  const labelOf = (t) => (t.type === 'block' ? blockById(t.id)?.name ?? '?' : t.type === 'tags' ? 'PLC tags' : state.project.watch.find((w) => w.id === t.id)?.name ?? 'Watch')
  const iconOf = (t) => { if (t.type !== 'block') return h('span', { class: `ic ${t.type === 'tags' ? 'tag' : 'watch'}` }, t.type === 'tags' ? 'TAG' : 'WT'); const b = blockById(t.id); return h('span', { class: `ic ${b ? b.kind.toLowerCase() : ''}` }, b?.kind ?? '') }
  function renderTabs() {
    clear(tabs)
    for (const t of state.tabs) {
      const k = tabKey(t)
      const el = h('div', { class: `tab${k === state.active ? ' active' : ''}`, onMousedown: (e) => { if (e.button === 1) { e.preventDefault(); closeTab(k) } else { state.active = k; emit('tabs') } } }, iconOf(t), h('span', null, labelOf(t)), h('button', { class: 'x', title: 'Close (Ctrl+F4, or middle-click the tab)', onClick: (e) => { e.stopPropagation(); closeTab(k) } }, '×'))
      tabs.append(el)
    }
  }
  function mount() {
    if (mounted?.key === state.active && mounted.ok) return
    mounted?.inst?.dispose?.(); mounted = null; editor.api = null
    clear(ed)
    const t = state.tabs.find((x) => tabKey(x) === state.active)
    if (!t) { ed.append(h('div', { class: 'empty' }, h('b', null, 'No editor open'), 'Double-click a block in the project tree, or press Ctrl+B to compile.')); return }
    const inst = t.type === 'block' ? mountBlock(ed, t) : t.type === 'tags' ? mountTags(ed) : mountWatch(ed, t)
    mounted = { key: state.active, inst, ok: true }
    setTimeout(() => inst.focus?.(), 0)
  }
  on('tabs', () => { renderTabs(); mount() })
  on('project', ({ reason } = {}) => {
    if (reason === 'replace') { mounted = null; renderTabs(); mount(); return }
    const missing = state.tabs.filter((t) => t.type === 'block' && !blockById(t.id)).map(tabKey); missing.forEach(closeTab)
    renderTabs()
  })
  ed.addEventListener('mousedown', () => { document.body.dataset.pane = 'editor' })
  renderTabs(); mount()
}

/* -------------------------------------------------------------- right cards -- */
function cards(host) {
  const CARDS = [['Instructions', instructionsCard], ['Online tools', onlineCard], ['Simulation', simulationCard]]
  const body = h('div', { id: 'cardbody' }), strip = h('div', { id: 'cardtabs' })
  host.append(body, strip)
  const built = new Map(); let active = 'Instructions'
  const show = () => {
    clear(body).append(h('div', { class: 'pane-head' }, active), h('div', { class: 'pane-body' }, built.get(active)))
    strip.querySelectorAll('.ctab').forEach((b) => b.classList.toggle('active', b.dataset.n === active))
  }
  for (const [n, make] of CARDS) { built.set(n, make()); strip.append(h('button', { class: 'ctab', dataset: { n }, onClick: () => { active = n; show() } }, n)) }
  show()
  on('rename', () => {})
}

/* --------------------------------------------------------------- inspector -- */
function inspector(host) {
  let tab = 'info', sub = 'compile'
  const tabsEl = h('div', { class: 'itabs' }), subEl = h('div', { class: 'isub' }), body = h('div', { class: 'pane-body' })
  host.append(tabsEl, subEl, body)
  const locOf = (d) => { const b = d.block ? blockById(d.block) : null; return b ? `${b.name}${d.network !== undefined ? ` › Network ${d.network + 1}` : d.line ? ` › line ${d.line}` : ''}` : d.where === 'tags' ? 'PLC tags' : d.tag ? `Tag ${d.tag}` : '' }
  const go = (d) => {
    if (d.block) { openTab({ type: 'block', id: d.block }); if (d.network !== undefined) select({ block: d.block, network: d.network }); setTimeout(() => emit('goto', d), 40) }
    else if (d.where === 'tags') openTab({ type: 'tags', id: 'default' })
  }
  const render = () => {
    tabsEl.replaceChildren(...[['properties', 'Properties'], ['info', 'Info'], ['diag', 'Diagnostics']].map(([k, l]) => h('button', { class: `itab${tab === k ? ' active' : ''}`, onClick: () => { tab = k; sub = k === 'info' ? 'compile' : 'general'; render() } }, l)))
    subEl.replaceChildren(...(tab === 'info' ? [['general', 'General'], ['compile', 'Compile'], ['log', 'Messages']] : tab === 'properties' ? [['general', 'General']] : [['cpu', 'CPU']]).map(([k, l]) => h('button', { class: sub === k ? 'active' : '', onClick: () => { sub = k; render() } }, l)))
    if (tab === 'properties') body.replaceChildren(propsView())
    else if (tab === 'info' && sub === 'compile') body.replaceChildren(...(state.diagnostics.length ? state.diagnostics.map((d) => h('div', { class: 'msg', onDblclick: () => go(d), title: 'Double-click to go to the location' }, h('span', { class: `sev ${d.severity}` }, d.severity === 'error' ? '!' : '▲'), h('span', null, d.message), h('span', { class: 'loc' }, locOf(d)))) : [h('div', { class: 'msg' }, h('span', { class: 'sev ok' }, '✓'), h('span', null, 'No compiler messages. Press Ctrl+B to compile.'))]))
    else if (tab === 'info' && sub === 'log') body.replaceChildren(...log.slice(-120).reverse().map((l) => h('div', { class: 'msg' }, h('span', { class: `sev ${l.level === 'error' ? 'error' : l.level === 'warn' ? 'warning' : 'ok'}` }, l.level === 'error' ? '!' : l.level === 'warn' ? '▲' : '✓'), h('span', null, l.text), h('span', { class: 'loc' }, l.at.toLocaleTimeString()))))
    else if (tab === 'info') body.replaceChildren(propsView())
    else body.replaceChildren(diagView())
  }
  function field(label, value, onInput, opts = {}) { return [h('label', null, label), h('input', { class: 'in', value, readonly: opts.ro, type: opts.type, onInput: (e) => onInput?.(e.target.value) })] }
  function propsView() {
    const t = state.tabs.find((x) => tabKey(x) === state.active), b = t?.type === 'block' ? blockById(t.id) : null
    const rows = []
    if (b) rows.push(...field('Name', b.name, null, { ro: true }), ...field('Type', `${b.kind}${b.number} · ${b.lang}`, null, { ro: true }), h('label', null, 'Comment'), h('input', { class: 'in', value: b.comment ?? '', onInput: (e) => edit((p) => { p.blocks.find((x) => x.id === b.id).comment = e.target.value }, `bc:${b.id}`) }))
    rows.push(h('label', { style: { gridColumn: '1 / -1', fontWeight: 600, color: 'var(--navy2)', marginTop: '6px' } }, 'CPU'), ...field('CPU name', state.project.plc.name, (v) => edit((p) => { p.plc.name = v || p.plc.name }, 'plcname')), ...field('Cycle time (ms)', state.project.plc.cycleMs, (v) => edit((p) => { p.plc.cycleMs = Math.max(1, Number(v) || 10) }, 'cycle'), { type: 'number' }))
    return h('div', { class: 'props' }, rows)
  }
  function diagView() {
    const o = state.online, m = o.machine
    return h('div', { class: 'props' }, ...[['Operating state', o.mode === 'offline' ? 'Offline' : o.mode.toUpperCase()], ['Program in CPU', o.downloaded ? 'Yes' : 'None'], ['Scan cycles', m ? m.scanCount : '–'], ['Cycle time', `${state.project.plc.cycleMs} ms`], ['Last error', o.error ?? 'none']].flatMap(([a, c]) => [h('label', null, a), h('span', { style: { color: a === 'Last error' && o.error ? 'var(--err)' : '' } }, c)]),
      h('label', null, ''), h('button', { class: 'btn', style: { width: 'fit-content' }, disabled: !o.source, onClick: () => emit('source') }, 'Show generated ST'))
  }
  on('diagnostics', render); on('log', () => { if (tab === 'info' && sub === 'log') render() }); on('online', render); on('tabs', () => { if (tab === 'properties') render() })
  on('inspector', (t) => { tab = t; sub = t === 'info' ? 'compile' : 'general'; render(); document.getElementById('main').classList.remove('no-bottom') })
  on('project', ({ reason } = {}) => { if (reason !== 'edit' && tab === 'properties') render() })
  render()
}

/* ---------------------------------------------------------------- dialogs -- */
function dialogs() {
  const addDlg = h('dialog', null)
  const open = () => {
    let kind = 'OB', lang = 'LAD'
    const name = h('input', { class: 'in', style: { width: '100%' }, value: '' })
    const nextNum = (k) => { const n = state.project.blocks.filter((b) => b.kind === k).map((b) => b.number); return n.length ? Math.max(...n) + 1 : 1 }
    const num = h('input', { class: 'in', type: 'number', value: String(nextNum('OB')), style: { width: '80px' } })
    const kinds = h('div', { style: { display: 'flex', gap: '8px' } })
    const refresh = () => {
      kinds.replaceChildren(...[['OB', 'Organization block', 'Cyclic program'], ['FB', 'Function block', 'With memory'], ['FC', 'Function', 'No memory']].map(([k, t, s]) => h('button', { class: `btn${kind === k ? ' primary' : ''}`, style: { height: '52px', flex: 1, textAlign: 'left', padding: '4px 10px' }, onClick: () => { kind = k; num.value = String(nextNum(k)); name.value = name.dataset.touched ? name.value : (k === 'OB' ? 'Main' : `${k}_${num.value}`); refresh() } }, h('b', null, `${k} · ${t}`), h('br'), h('small', null, s))))
    }
    refresh()
    name.value = state.project.blocks.some((b) => b.name === 'Main') ? 'Block_2' : 'Main'
    const langs = h('select', { class: 'in', onChange: (e) => { lang = e.target.value } }, [['LAD', 'LAD (Ladder logic)'], ['FBD', 'FBD (Function block diagram)'], ['SCL', 'SCL (Structured control language)']].map(([v, l]) => h('option', { value: v }, l)))
    addDlg.replaceChildren(h('div', { class: 'dhead' }, 'Add new block', h('button', { onClick: () => addDlg.close() }, '×')), h('div', { class: 'dbody' },
      h('div', { class: 'props', style: { gridTemplateColumns: '90px 1fr' } }, h('label', null, 'Name'), name, h('label', null, 'Type'), kinds, h('label', null, 'Language'), langs, h('label', null, 'Number'), num),
      h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' } }, h('button', { class: 'btn', onClick: () => addDlg.close() }, 'Cancel'), h('button', { class: 'btn primary', onClick: () => {
        const n = name.value.trim()
        if (!IDENT.test(n)) return toast('Invalid block name'); if (state.project.blocks.some((b) => b.name === n)) return toast('Name already used')
        addBlock(kind, lang, n, Number(num.value) || 1); addDlg.close()
      } }, 'OK'))))
    addDlg.showModal(); name.select()
  }
  on('addblock', open)

  const keysDlg = h('dialog', null)
  on('shortcuts', () => {
    const rows = [...commands.values()].filter((c) => c.keys).sort((a, b) => a.label.localeCompare(b.label))
    keysDlg.replaceChildren(h('div', { class: 'dhead' }, 'Keyboard and mouse', h('button', { onClick: () => keysDlg.close() }, '×')), h('div', { class: 'dbody' },
      h('table', { class: 'keys' }, h('thead', null, h('tr', null, h('th', null, 'Action'), h('th', null, 'Shortcut'), h('th', null, 'Origin'))), h('tbody', null, rows.map((c) => h('tr', null, h('td', null, c.label), h('td', null, h('kbd', null, c.keys)), h('td', { class: 'tag-app' }, c.src === 'tia' ? 'engineering-tool convention' : 'added by this app'))))),
      h('p', null, h('b', null, 'Mouse: '), 'click selects · double-click an operand edits it · drag instructions from the task card onto a network or pin · right-click opens the context menu · Ctrl+wheel zooms the editor · middle-click closes a tab · Alt+hold on a simulation switch acts as a push button.'),
      h('p', { class: 'tag-app' }, 'Keys marked “engineering-tool convention” follow the S7 engineering workflow. They were assigned from memory — check them against your own tool and adjust src/ui/commands.js if one differs.')))
    keysDlg.showModal()
  })
  const srcDlg = h('dialog', null)
  on('source', () => { srcDlg.replaceChildren(h('div', { class: 'dhead' }, 'Generated Structured Text (what the CPU runs)', h('button', { onClick: () => srcDlg.close() }, '×')), h('div', { class: 'dbody' }, h('pre', { class: 'mono', style: { margin: 0, fontSize: '11.5px', whiteSpace: 'pre-wrap' } }, state.online.source))); srcDlg.showModal() })
  document.body.append(addDlg, keysDlg, srcDlg)
}

/* ------------------------------------------------------------------ status -- */
function status() {
  const el = $('status')
  const render = () => {
    const o = state.online, last = log.at(-1)
    el.replaceChildren(h('span', null, last?.text ?? 'Ready'), h('span', { class: 'grow' }), h('span', null, o.mode === 'offline' ? 'Offline' : `Online · ${o.mode.toUpperCase()}`), h('span', null, `${state.project.blocks.length} blocks · ${state.project.tags.length} tags`), h('span', null, state.dirty ? 'Unsaved changes (autosaved in this browser)' : 'Saved'))
  }
  render(); on('log', render); on('online', render); on('project', render)
}

/* ------------------------------------------------------------------- build -- */
export function buildShell() {
  titlebar(); menubar(); toolbar()
  const main = $('main')
  main.append(h('section', { class: 'pane', id: 'left' }), h('section', { class: 'pane', id: 'center' }), h('section', { class: 'pane', id: 'right' }), h('section', { class: 'pane', id: 'bottom' }))
  const t = tree($('left')); center($('center')); cards($('right')); inspector($('bottom')); dialogs(); status()
  on('layout', (w) => main.classList.toggle(`no-${w}`))
  installKeyboard()
  // Delete applies to the pane the user last worked in (tree or editor)
  const del = commands.get('delete'), orig = del.run
  del.run = () => (document.body.dataset.pane === 'tree' ? t.deleteSelected() : orig())
  const copy = commands.get('copy'); void copy
  document.addEventListener('contextmenu', (e) => { if (!e.target.closest('input,textarea,.cm-editor')) e.preventDefault() })
  if (!state.tabs.length) { const first = state.project.blocks[0]; if (first) openTab({ type: 'block', id: first.id }) }
}
