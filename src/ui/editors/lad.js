// Ladder (LAD) editor, laid out and operated like the S7 engineering tool.
// Select a position (click a rung line or an instruction); insert there from the favorites bar, the
// Instructions card (double-click or drag), the toolbar or a shortcut (Shift+F2 …). Drag an FB or FC from the
// project tree onto a network to call it. Click selects, typing or a double-click edits an operand, right-click
// opens the context menu, a box dragged over empty rung space selects several instructions, Ctrl+wheel zooms.
import { COMPARE, FB } from '../../core/catalog.js'
import { IDENT, newBlock, newNetwork, uid } from '../../core/model.js'
import { BOX_INSTRUCTIONS, boxKindFor, classifyOperand, fieldName, instancesOf, operandFields, operandSequence, pinNames, renameInstance, renameTag, setBlockResolver, suggestedTagType, valueOf } from '../../core/operands.js'
import { contextMenu, h, svg } from '../dom.js'
import { editor, toast } from '../commands.js'
import { isOnline, readOperand } from '../online.js'
import { PALETTE, iconFor } from '../palette.js'
import { opList } from './op-list.js'
import { seriesAt, insertAtGap, startBranch, closeBranch, canDropBranchEnd, addParallelPath, removeBranch, openBranches, validateLadderNetwork } from '../../core/ladder-edit.js'
import { blockById, dragging, edit, on, select, state } from '../store.js'
import { callOptionsDialog, defineTagDialog, renameTagDialog } from '../block-dialogs.js'

const key = (p) => p.join('.')
const clone = (x) => JSON.parse(JSON.stringify(x))
const isCallee = (b) => b && (b.kind === 'FB' || b.kind === 'FC')

export function resolve(net, path) {
  let list = net.elements
  const n = path.length, pairs = n % 2 ? n - 1 : n
  for (let k = 0; k < pairs; k += 2) list = list[path[k]].branches[path[k + 1]]
  return n % 2 ? { list, index: path[n - 1] } : { list, index: list.length - 1 }
}
/** Operand text as typed or shown ("S1", #x, "DB".x) -> the stored name (S1, x, DB.x). */
export const cleanOperand = (v) => String(v ?? '').trim().replace(/^#/, '').replace(/^"([^"]*)"/, '$1')

export function mountLadder(host, tab) {
  const blockId = tab.id
  const block = () => blockById(blockId)
  setBlockResolver((name) => state.project.blocks.find((b) => isCallee(b) && b.name === name))
  let zoom = 1, pendingEdit = false
  let branchDrag = null
  let moveDrag = null   // an existing instruction being dragged to a new position: { network, path }
  const root = h('div', { class: 'lad', tabindex: '-1' })
  host.append(favoritesBar(), h('div', { class: 'ed-body', style: { background: '#eef1f4' } }, root))
  const body = host.lastChild
  const refs = { nets: new Map() }   // network index -> { el, ctx }

  /* scroll cues: shadows and buttons only on a side that has hidden content */
  const syncs = new WeakMap()
  const ro = new ResizeObserver((es) => es.forEach((e) => syncs.get(e.target)?.()))
  function trackScroll(wrap, bodyEl, out, main) {
    const sync = () => {
      wrap.classList.toggle('has-left', bodyEl.scrollLeft > 1)
      wrap.classList.toggle('has-right', bodyEl.scrollLeft < bodyEl.scrollWidth - bodyEl.clientWidth - 1)
      wrap.style.setProperty('--out-w', `${out.offsetWidth}px`)
    }
    bodyEl.addEventListener('scroll', sync, { passive: true })
    syncs.set(bodyEl, sync); syncs.set(main, sync); ro.observe(bodyEl); ro.observe(main)
    requestAnimationFrame(sync)
  }

  /* the drop position nearest the pointer while dragging */
  let nearEl = null
  const setNear = (el) => { if (nearEl === el) return; nearEl?.classList.remove('near'); nearEl = el; el?.classList.add('near') }
  const sel = () => (state.selection?.block === blockId ? state.selection : null)
  const setSel = (s) => { select(s ? { block: blockId, ...s } : null) }
  const addrOf = (name) => state.project.tags.find((t) => t.name === name)?.address ?? ''
  const MATH_OPS = { add: 'ADD', sub: 'SUB', mul: 'MUL', div: 'DIV' }
  const UNKNOWN_TIP = 'This tag is not defined. Right-click the operand and choose "Define tag…".'
  const globalDbs = () => state.project.blocks.filter((d) => d.kind === 'DB' && !d.instanceOf)
  const scope = () => {
    const b = block()
    const instances = new Map(instancesOf(b).map((i) => [i.name, i.fb]))
    for (const d of globalDbs()) instances.set(d.name, null)
    return { tags: new Set(state.project.tags.map((t) => t.name)), locals: new Set(Object.values(b.interface).flat().map((v) => v.name)), instances }
  }
  let sc = scope()   // refreshed on every render; marks unknown operands
  let palDrag = null   // payload of the Instructions-card item being dragged

  /** How an operand is shown: global tags in quotes, block variables with #, data block members as "DB".x */
  function shown(value) {
    const v = String(value ?? '').trim(); if (!v) return ''
    const kind = classifyOperand(v, sc)
    if (kind === 'tag') return `"${v}"`
    if (kind === 'local') return `#${v}`
    const m = /^([A-Za-z_]\w*)\.(.+)$/.exec(v)
    if (m && kind === 'pin') {
      const isDb = state.project.blocks.some((b) => b.kind === 'DB' && b.name === m[1])
      const local = sc.locals.has(m[1]) || (!isDb && block().kind !== 'OB')
      return local ? `#${m[1]}.${m[2]}` : `"${m[1]}".${m[2]}`
    }
    return v
  }
  const instShown = (name, isDb) => (!name ? '' : isDb || block().kind === 'OB' ? `"${name}"` : `#${name}`)

  /* ------------------------------------------------------------- editing -- */
  function gapOf(net, s, after = true) {
    if (s?.gap) return clone(s.gap)
    if (s?.branch) return { path: s.branch.slice(0, -1), index: s.branch.at(-1) + (after ? 1 : 0) }
    if (s?.path?.length) {
      if (s.path.length % 2) return { path: s.path.slice(0, -1), index: s.path.at(-1) + (after ? 1 : 0) }
      return { path: [...s.path], index: seriesAt(net, s.path).length }
    }
    return { path: [], index: net.elements.length }
  }
  function containingBranch(s) {
    if (s?.branch) return s.branch
    const path = s?.gap?.path ?? s?.path ?? []
    return path.length >= 2 ? path.slice(0, path.length % 2 ? -2 : -1) : null
  }
  const nameFor = (fb) => { const used = new Set(); (block().networks ?? []).forEach((n) => (function walk(l) { l.forEach((e) => { if (e.inst) used.add(e.inst); e.branches?.forEach(walk) }) })(n.elements)); let i = 1; while (used.has(`${fb}_${i}`)) i++; return `${fb}_${i}` }
  function make(kind) {
    if (kind === 'NO' || kind === 'NC') return { k: kind, tag: '' }
    if (kind === 'P' || kind === 'N') return { k: kind, tag: '', inst: `${kind}_${uid('').slice(-4)}` }
    if (kind === 'empty') return { k: 'empty' }
    if (kind === 'cmp' || kind.startsWith('cmp:')) { const op = kind.slice(4); return { k: 'cmp', op: COMPARE.includes(op) ? op : '==', a: '', b: '' } }
    if (kind === 'move') return { k: 'move', src: '', dest: '' }
    if (kind.startsWith('math:') && MATH_OPS[kind.slice(5)]) return { k: 'math', op: kind.slice(5), a: '', b: '', dest: '' }
    if (kind.startsWith('box:')) { const fb = kind.slice(4); return FB[fb] ? { k: 'box', fb, inst: nameFor(fb), args: {} } : null }
    return null
  }
  const COILS = ['coil', 'ncoil', 'set', 'reset']
  /** After a delete: drop branches with nothing left, drop emptied paths of a joined branch (an empty path is an
   *  always-true bypass), and turn a branch with one remaining path back into a plain series. */
  function tidyBranches(l) {
    for (let i = l.length - 1; i >= 0; i--) {
      const e = l[i]; if (e.k !== 'branch') continue
      e.branches.forEach(tidyBranches)
      if (e.closed !== false) e.branches = e.branches.filter((b) => b.length)
      if (e.branches.every((b) => !b.length)) l.splice(i, 1)
      else if (e.branches.length === 1) l.splice(i, 1, ...e.branches[0])
    }
  }

  function insert(kind, at) {
    const b = block(); if (!b) return
    if (kind === 'box?') kind = 'empty'
    if (kind.startsWith('call:')) { insertCall(kind.slice(5), at); return }
    // Validate a detached edit first. A failed close must not alter history or the program.
    if (['branch', 'closeBranch', 'addPath', 'removeBranch'].includes(kind)) {
      const s = at ?? sel(), ni = Math.min(s?.network ?? b.networks.length - 1, b.networks.length - 1)
      if (!b.networks[ni]) return
      const net = clone(b.networks[ni])
      try {
        let gap
        if (kind === 'branch') gap = startBranch(net, gapOf(net, s, false), !!s?.path?.length && s.path.length % 2 === 1)
        else if (kind === 'closeBranch') gap = closeBranch(net, s ? gapOf(net, s) : null)
        else {
          const path = containingBranch(s)
          if (!path) throw new Error('Select a branch or an instruction inside it first.')
          if (kind === 'addPath') gap = addParallelPath(net, path)
          else { removeBranch(net, path); gap = { path: path.slice(0, -1), index: path.at(-1) } }
        }
        edit(p => { p.blocks.find(x => x.id === blockId).networks[ni] = net; state.selection = { block: blockId, network: ni, gap } })
      } catch (error) { toast(error.message) }
      return
    }
    const el = COILS.includes(kind) ? null : make(kind)
    if (!el && !COILS.includes(kind)) return
    edit((p) => {
      const blk = p.blocks.find((x) => x.id === blockId)
      let s = at ?? sel()
      if (!blk.networks.length) blk.networks.push(newNetwork('LAD'))
      let ni = s?.network ?? blk.networks.length - 1
      ni = Math.min(ni, blk.networks.length - 1)
      const net = blk.networks[ni]
      if (COILS.includes(kind)) {
        const at2 = s?.coil !== undefined ? s.coil + 1 : net.coils.length
        net.coils.splice(at2, 0, { k: kind, tag: '' })
        pendingEdit = true
        state.selection = { block: blockId, network: ni, coil: at2 }
        return
      }
      const path = insertAtGap(net, gapOf(net, s?.paths ? null : s), el)
      pendingEdit = true
      state.selection = { block: blockId, network: ni, path }
    })
  }

  /* ------------------------------------------------------- block calls -- */
  /** Ask how a called FB keeps its data (TIA "Call options"), then return the call element plus the change
   *  that creates its instance (an instance DB, or a Static variable of the calling FB). FCs need no instance. */
  async function prepareCall(name) {
    const callee = state.project.blocks.find((b) => isCallee(b) && b.name === name)
    if (!callee) { toast(`There is no FB or FC named "${name}".`); return null }
    const caller = block()
    if (callee.id === caller.id) { toast(`${callee.name} cannot call itself.`); return null }
    if (callee.kind === 'FC') return { el: { k: 'call', block: callee.name, args: {} }, apply: () => {} }
    const choice = await callOptionsDialog({ callee, caller, project: state.project })
    if (!choice) return null
    const el = { k: 'call', block: callee.name, inst: choice.name, ...(choice.multi ? { multi: true } : {}), args: {} }
    const apply = (p) => {
      if (choice.multi) {
        const blk = p.blocks.find((x) => x.id === blockId); blk.interface.static = blk.interface.static ?? []
        if (!blk.interface.static.some((v) => v.name === choice.name)) blk.interface.static.push({ name: choice.name, type: callee.name })
      } else if (!p.blocks.some((b) => b.kind === 'DB' && b.name === choice.name)) p.blocks.push(newBlock('DB', choice.name, null, choice.number, { instanceOf: callee.name }))
    }
    return { el, apply }
  }
  async function insertCall(name, at) {
    const s0 = at ?? sel()
    const prep = await prepareCall(name); if (!prep || !block()) return
    edit((p) => {
      const blk = p.blocks.find((x) => x.id === blockId)
      if (!blk.networks.length) blk.networks.push(newNetwork('LAD'))
      const ni = Math.min(s0?.network ?? blk.networks.length - 1, blk.networks.length - 1), net = blk.networks[ni]
      prep.apply(p)
      let path
      try { path = insertAtGap(net, gapOf(net, s0?.network === ni && !s0.paths ? s0 : null), prep.el) } catch { path = insertAtGap(net, { path: [], index: net.elements.length }, prep.el) }
      pendingEdit = true
      state.selection = { block: blockId, network: ni, path }
    })
  }
  /** Turn an empty box ("??") into the instruction or block the learner typed. */
  async function convertEmpty(at, name) {
    if (!String(name ?? '').trim()) return
    const kind = boxKindFor(name, state.project)
    if (!kind) { toast(`"${name}" is not an instruction or block. Choose one from the list.`); return }
    let el, apply = () => {}
    if (kind.startsWith('call:')) { const prep = await prepareCall(kind.slice(5)); if (!prep) return; el = prep.el; apply = prep.apply }
    else el = make(kind)
    if (!el) return
    edit((p) => {
      const net = p.blocks.find((x) => x.id === blockId)?.networks[at.network]; if (!net) return
      const { list, index } = resolve(net, at.path); if (list[index]?.k !== 'empty') return
      apply(p)
      list[index] = el
      pendingEdit = operandFields(el).length > 0
      state.selection = { block: blockId, network: at.network, path: at.path }
    })
  }

  /* ------------------------------------------------- favorites bar (TIA) -- */
  // The engineering tool's LAD favorites: NO, NC, assignment, empty box, open branch, close branch.
  // Click inserts at the selected position; drag places it on a rung.
  function favoritesBar() {
    const FAVS = [[(l) => l.k === 'NO', 'NO'], [(l) => l.k === 'NC', 'NC'], [(l) => l.coil === 'coil', 'coil'], [(l) => l.k === 'empty', 'empty'], [(l) => l.k === 'branch', 'branch'], [(l) => l.k === 'closeBranch', 'closeBranch']]
    const bar = h('div', { class: 'fav-bar', role: 'toolbar', 'aria-label': 'Favorites' })
    for (const [match, kind] of FAVS) {
      const item = palFind(match); if (!item) continue
      const b = h('button', { type: 'button', class: 'fav', draggable: 'true', title: `${item.name}${item.short ? ` (${item.short})` : ''}`, 'aria-label': item.name,
        onMousedown: (e) => e.preventDefault(),   // keep the selection and any open operand box
        onClick: () => insert(kind) }, iconFor(item))
      b.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', JSON.stringify({ lad: item.lad, fbd: item.fbd })); e.dataTransfer.effectAllowed = 'copy' })
      bar.append(b)
    }
    bar.append(h('span', { class: 'grow' }),
      h('button', { type: 'button', class: 'fav ins-net', title: 'Insert network (Ctrl+R)', 'aria-label': 'Insert network', onMousedown: (e) => e.preventDefault(), onClick: () => insertNetwork(true) },
        svg('svg', { class: 'pi', viewBox: '0 0 30 18', width: 30, height: 18 }, svg('path', { d: 'M3 3v12M3 9h24M20 5h7v8h-7z', fill: 'none', stroke: '#222', 'stroke-width': 1.6 }))))
    return bar
  }
  function palFind(match) { return PALETTE.flatMap((g) => g.items).find((i) => i.lad && match(i.lad)) }
  function railState(ni, gap) {
    const net = block().networks[ni], open = net ? openBranches(net) : []
    return { net, unfinished: open.length > 0, canClose: !!gap && open.length > 0 && canDropBranchEnd(net, open.at(-1), gap) }
  }
  function dropPayload(p, at) {
    if (p.coil) return insert(p.coil, at)
    if (p.k === 'box') return insert(`box:${p.fb}`, at)
    if (p.k === 'cmp') return insert(`cmp:${p.op}`, at)
    if (p.k === 'math') return insert(`math:${p.op}`, at)
    insert(p.k, at)
  }

  /* --------------------------------------------------- marquee multi-select -- */
  // Drag a box over empty rung space to select several instructions. Selection is kept as
  // { network, paths:[key strings] }; copy / cut / delete act on the whole group.
  function startMarquee(ev, ni) {
    const netEl = refs.nets.get(ni)?.el; if (!netEl) return
    const sx = ev.clientX, sy = ev.clientY
    const boxEl = h('div', { class: 'marquee' }); document.body.append(boxEl)
    let moved = false, paths = []
    const onMove = (e) => {
      const x1 = Math.min(sx, e.clientX), y1 = Math.min(sy, e.clientY), x2 = Math.max(sx, e.clientX), y2 = Math.max(sy, e.clientY)
      if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) > 4) moved = true
      Object.assign(boxEl.style, { left: `${x1}px`, top: `${y1}px`, width: `${x2 - x1}px`, height: `${y2 - y1}px` })
      paths = []
      for (const nd of netEl.querySelectorAll('.el[data-path]')) {
        const isCoil = nd.dataset.path.startsWith('c')
        const r = nd.getBoundingClientRect(), hit = moved && !isCoil && r.left < x2 && r.right > x1 && r.top < y2 && r.bottom > y1
        nd.classList.toggle('pre-sel', hit)
        if (hit) paths.push(nd.dataset.path)
      }
    }
    const onUp = () => {
      removeEventListener('mousemove', onMove, true); removeEventListener('mouseup', onUp, true)
      boxEl.remove(); netEl.querySelectorAll('.pre-sel').forEach((x) => x.classList.remove('pre-sel'))
      if (!moved) return
      if (paths.length > 1) setSel({ network: ni, paths })
      else if (paths.length === 1) setSel({ network: ni, path: paths[0].split('.').map(Number) })
      else setSel({ network: ni })
    }
    addEventListener('mousemove', onMove, true); addEventListener('mouseup', onUp, true)
    ev.preventDefault()
  }
  /** Shift+click an instruction to add or remove it from the selection. */
  function toggleInSelection(ni, k) {
    const cur = sel()
    const paths = cur && cur.network === ni ? (cur.paths ? [...cur.paths] : (cur.path?.length % 2 ? [key(cur.path)] : [])) : []
    const i = paths.indexOf(k)
    if (i >= 0) paths.splice(i, 1); else paths.push(k)
    if (paths.length > 1) setSel({ network: ni, paths })
    else if (paths.length === 1) setSel({ network: ni, path: paths[0].split('.').map(Number) })
    else setSel({ network: ni })
  }
  function removeMany(s) {
    if (!block().networks[s.network]) return
    edit((p) => {
      const net = p.blocks.find((x) => x.id === blockId).networks[s.network]
      for (const kk of s.paths) { try { const { list, index } = resolve(net, kk.split('.').map(Number)); if (list[index]) list[index].__del = true } catch { /* gone */ } }
      ;(function strip(l) { for (let i = l.length - 1; i >= 0; i--) { const e = l[i]; if (e.__del) { l.splice(i, 1); continue } if (e.branches) e.branches.forEach(strip) } })(net.elements)
      tidyBranches(net.elements)
      state.selection = { block: blockId, network: s.network }
    })
  }
  /** Open a parallel branch around a contiguous group of selected instructions (empty lower path to fill in). */
  function branchAround() {
    const s = sel(); if (!s?.paths?.length) return
    const arrs = s.paths.map((k) => k.split('.').map(Number)).sort((a, b) => a.at(-1) - b.at(-1))
    const parent = arrs[0].slice(0, -1), idxs = arrs.map((a) => a.at(-1))
    const sameParent = arrs.every((a) => key(a.slice(0, -1)) === key(parent))
    const contiguous = idxs.every((v, i) => i === 0 || v === idxs[i - 1] + 1)
    if (!sameParent || !contiguous) { toast('To branch around a group, select instructions that sit next to each other on the same line.'); return }
    edit((p) => {
      const net = p.blocks.find((x) => x.id === blockId).networks[s.network]
      let list = net.elements; for (let kk = 0; kk < parent.length; kk += 2) list = list[parent[kk]].branches[parent[kk + 1]]
      const seg = list.splice(idxs[0], idxs.length)
      list.splice(idxs[0], 0, { k: 'branch', closed: true, branches: [seg, []] })
      state.selection = { block: blockId, network: s.network, branch: [...parent, idxs[0]] }
    })
  }

  function remove() {
    const s = sel(); if (!s) return
    if (s.paths) { removeMany(s); return }
    if (s.gap) { toast('A connection is selected. Select the instruction or network you want to delete.'); return }
    if (s.branch) { insert('removeBranch'); return }
    if (!block().networks[s.network]) return
    if (s.path?.length && s.path.length % 2 === 0) return   // a parallel path is selected, not an instruction
    const wholeNetwork = s.coil === undefined && !s.path?.length
    edit((p) => {
      const blk = p.blocks.find((x) => x.id === blockId), net = blk.networks[s.network]
      if (s.coil !== undefined) { net.coils.splice(s.coil, 1); state.selection = { block: blockId, network: s.network }; return }
      if (s.path?.length) {
        const { list, index } = resolve(net, s.path)
        list.splice(index, 1)
        tidyBranches(net.elements)
        state.selection = { block: blockId, network: s.network }
        return
      }
      blk.networks.splice(s.network, 1)
      if (!blk.networks.length) blk.networks.push(newNetwork('LAD'))
      state.selection = { block: blockId, network: Math.max(0, s.network - 1) }
    })
    if (wholeNetwork) toast('Network deleted. Press Ctrl+Z to undo.')
  }
  function insertNetworkAt(ni) {
    edit((p) => {
      const blk = p.blocks.find((x) => x.id === blockId)
      blk.networks.splice(ni, 0, newNetwork('LAD'))
      state.selection = { block: blockId, network: ni, gap: { path: [], index: 0 } }
    })
    refs.nets.get(ni)?.el?.scrollIntoView({ block: 'nearest' })
  }
  function insertNetwork(after = true, atEnd = false) {
    const n = block().networks.length, i = atEnd ? n - 1 : sel()?.network ?? n - 1
    insertNetworkAt(Math.max(0, after ? i + 1 : i))
  }
  /** Copy what is selected: a group, one instruction (or a whole branch), one coil, or else the network. */
  function copy() {
    const s = sel(); if (!s) return
    const net = block().networks[s.network]; if (!net) return
    if (s.paths) {
      const clones = []
      for (const k of s.paths) { try { const { list, index } = resolve(net, k.split('.').map(Number)); if (list[index]) clones.push(clone(list[index])) } catch { /* gone */ } }
      if (clones.length) state.clipboard = { kind: 'elements', data: clones }
      return
    }
    if (s.coil !== undefined && net.coils[s.coil]) { state.clipboard = { kind: 'coil', data: clone(net.coils[s.coil]) }; return }
    const at = s.branch ?? (s.path?.length % 2 ? s.path : null)
    if (at) { const { list, index } = resolve(net, at); if (list[index]) { state.clipboard = { kind: 'element', data: clone(list[index]) }; return } }
    state.clipboard = { kind: 'network', data: clone(net) }
  }
  function cut() {
    const s = sel(); if (!s || s.gap) { toast('Select an instruction, a coil or a network to cut.'); return }
    copy(); remove()
  }
  /** Pasted timers/counters/edges get their own instances, and references inside the pasted part follow them. */
  function renewInstances(blk, elements) {
    const used = new Set(), names = new Map()
    ;(function walk(l) { l.forEach((e) => { if (e.inst) used.add(e.inst); e.branches?.forEach(walk) }) })(blk.networks.flatMap((x) => x.elements ?? []))
    ;(function renew(l) { l.forEach((e) => {
      if (e.k === 'box' && e.inst) { let k = 1; while (used.has(`${e.fb}_${k}`)) k++; names.set(e.inst, `${e.fb}_${k}`); e.inst = `${e.fb}_${k}`; used.add(e.inst) }
      else if ((e.k === 'P' || e.k === 'N') && e.inst) { const n = `${e.k}_${uid('').slice(-4)}`; names.set(e.inst, n); e.inst = n }
      e.branches?.forEach(renew)
    }) })(elements)
    const fix = (v) => { const m = /^([A-Za-z_]\w*)(\..+)$/.exec(v ?? ''); return m && names.has(m[1]) ? names.get(m[1]) + m[2] : v }
    return (list) => { (function walk(l) { l.forEach((e) => { for (const f of operandFields(e)) { if (f.pin) { if (e.args?.[f.pin]) e.args[f.pin] = fix(e.args[f.pin]) } else e[f.field] = fix(e[f.field]) } e.branches?.forEach(walk) }) })(list) }
  }
  function paste() {
    const clip = state.clipboard; if (!clip) return
    const s = sel(), blk0 = block()
    const ni = Math.min(s?.network ?? blk0.networks.length - 1, blk0.networks.length - 1)
    if (clip.kind === 'element' || clip.kind === 'coil') {
      if (ni < 0) return
      edit((p) => {
        const blk = p.blocks.find((x) => x.id === blockId), net = blk.networks[ni], data = clone(clip.data)
        if (clip.kind === 'coil') {
          const at2 = s?.network === ni && s.coil !== undefined ? s.coil + 1 : net.coils.length
          net.coils.splice(at2, 0, data); state.selection = { block: blockId, network: ni, coil: at2 }; return
        }
        renewInstances(blk, [data])([data])
        const path = insertAtGap(net, gapOf(net, s?.network === ni && !s.paths ? s : null), data)
        state.selection = { block: blockId, network: ni, path }
      })
      return
    }
    if (clip.kind === 'elements') {
      if (ni < 0) return
      edit((p) => {
        const blk = p.blocks.find((x) => x.id === blockId), net = blk.networks[ni]
        let gap = gapOf(net, s?.network === ni && !s.paths ? s : null), last = null
        for (const d of clip.data) { const data = clone(d); renewInstances(blk, [data])([data]); last = insertAtGap(net, gap, data); gap = { path: gap.path, index: gap.index + 1 } }
        if (last) state.selection = { block: blockId, network: ni, path: last }
      })
      return
    }
    if (clip.kind !== 'network') return
    edit((p) => {
      const blk = p.blocks.find((x) => x.id === blockId), i = sel()?.network ?? blk.networks.length - 1
      const n = clone(clip.data); n.id = uid('n')
      const follow = renewInstances(blk, n.elements ?? [])
      follow(n.elements ?? []); follow(n.coils ?? [])
      blk.networks.splice(i + 1, 0, n)
      state.selection = { block: blockId, network: i + 1 }
    })
  }
  /** Drag an existing instruction to a new connection within the same network. Insert a copy at the target,
   *  then remove the original by identity (so index shifts and branch tidy-up cannot misplace it). */
  function moveElement(from, gap) {
    if (!block()) return
    edit((p) => {
      const net = p.blocks.find((x) => x.id === blockId).networks[from.network]; if (!net) return
      const { list, index } = resolve(net, from.path), src = list[index]; if (!src) return
      src.__moving = true
      const data = clone(src); delete data.__moving; data.__moved = true
      insertAtGap(net, clone(gap), data)
      ;(function strip(l) { for (let i = l.length - 1; i >= 0; i--) { const e = l[i]; if (e.__moving) { l.splice(i, 1); continue } if (e.branches) e.branches.forEach(strip) } })(net.elements)
      tidyBranches(net.elements)
      let found = null
      ;(function find(l, base) { l.forEach((e, i) => { if (e.__moved) { delete e.__moved; found = [...base, i] } if (e.branches) e.branches.forEach((bl, bi) => find(bl, [...base, i, bi])) }) })(net.elements, [])
      state.selection = found ? { block: blockId, network: from.network, path: found } : { block: blockId, network: from.network }
    })
  }
  function move(dir) {
    const b = block(), s = sel(); if (!s) { if (b.networks.length) setSel({ network: 0 }); return }
    if (s.paths) { setSel({ network: s.network, path: s.paths[0].split('.').map(Number) }); return }
    const nets = b.networks
    if (dir === 'up' || dir === 'down') { const n = s.network + (dir === 'down' ? 1 : -1); if (n >= 0 && n < nets.length) setSel({ network: n }); return }
    const net = nets[s.network], flat = []
    const positions = (list, base) => { flat.push({ gap: { path: base, index: 0 } }); list.forEach((e, i) => { if (e.k === 'branch') e.branches.forEach((lane, li) => positions(lane, [...base, i, li])); else flat.push({ path: [...base, i] }); flat.push({ gap: { path: base, index: i + 1 } }) }) }
    positions(net.elements, []); flat.push(...net.coils.map((_, i) => ({ coil: i })))
    const cur = flat.findIndex(f => s.gap ? JSON.stringify(f.gap) === JSON.stringify(s.gap) : s.coil !== undefined ? f.coil === s.coil : s.path && f.path && key(f.path) === key(s.path))
    const next = flat[cur < 0 ? 0 : Math.max(0, Math.min(flat.length - 1, cur + (dir === 'right' ? 1 : -1)))]
    if (next) setSel({ network: s.network, ...next })
  }

  /* ------------------------------------------------------ operand editing -- */
  // `at` addresses an instruction: { network, path } or { network, coil }. Tab / Enter walk operandSequence().
  const atOf = (s) => ({ network: s.network, ...(s.coil !== undefined ? { coil: s.coil } : { path: s.path }) })
  const sameAt = (a, b) => (a.coil !== undefined ? a.coil === b.coil : b.coil === undefined && key(a.path) === key(b.path))
  function targetIn(proj, at) {
    try {
      const net = proj.blocks.find((x) => x.id === blockId)?.networks[at.network]; if (!net) return null
      if (at.coil !== undefined) return net.coils[at.coil] ?? null
      if (!at.path?.length || at.path.length % 2 === 0) return null
      const { list, index } = resolve(net, at.path); return list[index] ?? null
    } catch { return null }   // the path no longer exists
  }
  const PLACEHOLDER = { bool: 'tag name', time: 'e.g. T#5s', int: 'e.g. 10', any: 'number or tag' }
  const placeholderFor = (f) => (f.dir === 'out' || f.field === 'dest' ? 'tag for the result' : PLACEHOLDER[f.kind])
  function suggestionsFor(f) {
    const fits = (type) => (f.kind === 'bool' ? type === 'Bool' : f.kind === 'time' ? type === 'Time' : type !== 'Bool')
    const SECTION = { input: 'Input', output: 'Output', inout: 'InOut', static: 'Static', temp: 'Temp' }
    const names = [
      ...state.project.tags.map((t) => ({ value: t.name, type: t.type, address: t.address ?? '', comment: t.comment ?? '', source: 'PLC tag' })),
      ...Object.entries(block().interface).flatMap(([sec, vars]) => vars.filter((v) => !isCallee(state.project.blocks.find((b) => b.name === v.type))).map((v) => ({ value: v.name, type: v.type, init: v.init ?? '', comment: v.comment ?? '', source: `Local · ${SECTION[sec] ?? sec}` }))),
      ...globalDbs().flatMap((d) => (d.interface.static ?? []).map((v) => ({ value: `${d.name}.${v.name}`, type: v.type, init: v.init ?? '', comment: v.comment ?? '', source: `Data block ${d.name}` }))),
    ]
    const pins = instancesOf(block()).flatMap((i) => pinNames(i.fb).map((p) => ({ value: `${i.name}.${p.pin}`, type: { bool: 'Bool', time: 'Time' }[p.kind] ?? 'Int', comment: `${p.pin} of ${i.fb} ${i.name}`, source: 'Instance' }))).filter((o) => fits(o.type))
    const lits = f.kind === 'bool' && (f.pin || f.dir) ? ['TRUE', 'FALSE'].map((value) => ({ value, type: 'Bool', comment: 'Constant', source: 'Constant' })) : []
    const all = [...names, ...pins, ...lits]
    return [...all.filter((o) => fits(o.type)), ...all.filter((o) => !fits(o.type)).map((o) => ({ ...o, other: true }))]
  }
  /** Why this text cannot be an operand name, or '' when it is fine (an undefined name is allowed: it shows red). */
  function nameProblem(v) {
    const cur = scope()
    if (!v || classifyOperand(v, cur) !== 'unknown') return ''
    if (cur.instances.has(v) && cur.instances.get(v)) return `${v} is an instance in this block. Pick one of its parameters, for example ${v}.${pinNames(cur.instances.get(v))[0]?.pin ?? 'Q'}.`
    return IDENT.test(v) || /^[A-Za-z_]\w*\.[A-Za-z_]\w*$/.test(v) ? '' : `"${v}" is not a valid tag name. Use letters, digits and _ only, with no spaces, and do not start with a digit.`
  }

  /* the one floating text box used for operands, instance names and empty-box names */
  let activeInput = null
  function openInput(span, { initial = '', placeholder = '', options = [], check, done, selectAll = true }) {
    activeInput?.cancel()
    const r = span.getBoundingClientRect()
    const input = h('input', { class: 'op-edit', value: initial, placeholder, autocomplete: 'off', spellcheck: 'false', 'aria-label': placeholder, style: { left: `${r.left - 4}px`, top: `${r.top - 2}px`, width: `${Math.max(120, r.width + 12)}px` } })
    if (!selectAll) input.dataset.typed = '1'   // seeded by typing: filter the list from the first keystroke
    const list = options.length ? opList(input, options, (v) => { input.value = v; finish(true, 'enter') }) : null
    document.body.append(input); if (list) document.body.append(list.el)
    input.focus(); if (selectAll) input.select(); else input.setSelectionRange(input.value.length, input.value.length); list?.place()
    let finished = false
    const close = () => { finished = true; input.remove(); list?.el.remove(); if (activeInput?.input === input) activeInput = null }
    const finish = (commit, how) => {
      if (finished) return
      const v = input.value.trim()
      if (commit && how !== 'blur') { const bad = check?.(v); if (bad) { toast(bad); return } }   // stay open so the learner can fix it
      close()
      if (commit) done(v, how)
    }
    input.addEventListener('keydown', (e) => {
      if (list && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'PageDown' || e.key === 'PageUp')) { e.preventDefault(); list.move({ ArrowDown: 1, ArrowUp: -1, PageDown: 8, PageUp: -8 }[e.key]) }
      else if (e.key === 'Enter') { e.preventDefault(); if (list?.picked()) input.value = list.picked(); finish(true, 'enter') }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false) }
      else if (e.key === 'Tab') { e.preventDefault(); if (list?.picked()) input.value = list.picked(); finish(true, e.shiftKey ? 'back' : 'tab') }
      e.stopPropagation()
    })
    input.addEventListener('blur', () => finish(true, 'blur'))
    activeInput = { input, cancel: () => !finished && close() }
  }

  // The element may be gone (undo while editing): then the edit is dropped.
  function setField(at, f, v, newTag) {
    if (!targetIn(state.project, at)) return false
    edit((p) => {
      const t = targetIn(p, at)
      if (f.pin) { t.args = t.args ?? {}; t.args[f.pin] = v } else t[f.field] = v
      if (newTag) p.tags.push(newTag)
    }, `op:${blockId}:${at.coil !== undefined ? `c${at.coil}` : key(at.path)}:${fieldName(f)}`)   // one undo step per operand
    return true
  }
  function startEdit(at, name, seed) {
    const t = targetIn(state.project, at), f = t && operandFields(t).find((x) => fieldName(x) === name); if (!f) return
    setSel(at)
    const span = body.querySelector(`.el.sel [data-op="${name}"]`); if (!span) return
    const realInitial = valueOf(t, f)
    const initial = seed != null ? seed : realInitial
    openInput(span, { initial, placeholder: placeholderFor(f), options: suggestionsFor(f), check: (raw) => nameProblem(cleanOperand(raw)), done: (v, how) => commitOperand(at, f, realInitial, v, how), selectAll: seed == null })
  }
  function commitOperand(at, f, initial, raw, how) {
    const t = targetIn(state.project, at); if (!t) return
    const v = cleanOperand(raw)
    const bad = nameProblem(v)
    if (bad) toast(bad)   // only a click-away gets here with a bad name; Enter and Tab keep the box open
    if (v !== initial) setField(at, f, v)
    if (!bad && v && v !== initial && classifyOperand(v, scope()) === 'unknown') toast(`"${v}" is not defined yet. Right-click the operand and choose "Define tag…".`)
    goNext(at, fieldName(f), how)
  }
  /** Tab / Shift+Tab: neighbouring operand in reading order. Enter: the next empty required operand of the same instruction. */
  function goNext(at, name, how) {
    const net = block().networks[at.network]; if (!net || !['enter', 'tab', 'back'].includes(how)) return
    const seq = operandSequence(net), i = seq.findIndex((o) => sameAt(o.at, at) && o.name === name)
    if (i < 0) return
    const t = targetIn(state.project, at)
    const next = how === 'tab' ? seq[i + 1] : how === 'back' ? seq[i - 1] : seq.find((o, j) => j !== i && sameAt(o.at, at) && !o.field.optional && !valueOf(t, o.field))
    if (next) startEdit({ network: at.network, ...next.at }, next.name)
  }
  function editInstName(span, at, old) {
    const problem = (v) => {
      if (!IDENT.test(v)) return `"${v}" is not a valid name. Use letters, digits and _ only, with no spaces, and do not start with a digit.`
      const cur = scope()
      return v !== old && (cur.instances.has(v) || cur.tags.has(v) || cur.locals.has(v)) ? `The name ${v} is already used in this block.` : ''
    }
    setSel(at)
    openInput(span, { initial: old, placeholder: 'instance name', check: (raw) => problem(cleanOperand(raw)), done: (raw) => {
      const v = cleanOperand(raw), bad = problem(v)
      if (bad) toast(bad); else if (v !== old) edit((p) => renameInstance(p.blocks.find((x) => x.id === blockId), old, v))
    } })
  }
  /** The "??" header of an empty box: type an instruction (TON, MOVE, CMP ==, ADD …) or the name of an FB / FC. */
  function openBoxName(at, seed) {
    setSel(at)
    const span = body.querySelector('.el.sel [data-boxname]'); if (!span) return
    const options = [
      ...BOX_INSTRUCTIONS.map(([value, comment]) => ({ value, type: 'Instruction', comment, source: 'Instruction' })),
      ...state.project.blocks.filter((b) => isCallee(b) && b.id !== blockId).map((b) => ({ value: b.name, type: `${b.kind}${b.number}`, comment: b.comment || (b.kind === 'FB' ? 'Function block' : 'Function'), source: 'Block' })),
    ]
    openInput(span, { initial: seed ?? '', placeholder: 'instruction or block', options, selectAll: seed == null,
      check: (v) => (boxKindFor(v, state.project) ? '' : `"${v}" is not an instruction or block. Choose one from the list.`),
      done: (v, how) => { if (how !== 'blur' || boxKindFor(v, state.project)) convertEmpty(at, v) } })
  }
  function edit0() {
    const s = sel(); if (!s || s.gap || s.paths) return
    if (s.branch) { const el = body.querySelector('.branch.sel'); if (el) { const r = el.getBoundingClientRect(); menu({ clientX: r.left, clientY: r.bottom }) } return }
    const t = targetIn(state.project, s)
    if (t?.k === 'empty') { openBoxName(atOf(s)); return }
    const first = t && operandFields(t)[0]
    if (first) startEdit(atOf(s), fieldName(first))
  }
  // Type-to-edit: with an instruction selected, a printable key opens its first operand (or the "??" name) seeded with it.
  function typeInto(ch) {
    const s = sel(); if (!s || s.gap || s.branch || s.paths) return false
    const t = targetIn(state.project, s); if (!t) return false
    if (t.k === 'empty') { openBoxName(atOf(s), ch); return !!activeInput }
    const f = operandFields(t)[0]; if (!f) return false
    startEdit(atOf(s), fieldName(f), ch)
    return !!activeInput
  }
  async function defineTag(at, f, v) {
    const t0 = targetIn(state.project, at)
    const r = await defineTagDialog({ name: v, type: f.type ?? suggestedTagType(t0, f), block: block() })
    if (!r) return
    edit((p) => {
      if (r.section === 'global') p.tags.push({ name: r.name, type: r.type, address: r.address, comment: r.comment })
      else { const blk = p.blocks.find((x) => x.id === blockId); (blk.interface[r.section] = blk.interface[r.section] ?? []).push({ name: r.name, type: r.type, ...(r.comment ? { comment: r.comment } : {}) }) }
      const t = targetIn(p, at)
      if (t && r.name !== v) { if (f.pin) { t.args = t.args ?? {}; t.args[f.pin] = r.name } else t[f.field] = r.name }
    })
  }
  async function renameTagAt(v) {
    const n = await renameTagDialog(v)
    if (n && n !== v) edit((p) => renameTag(p, v, n))
  }

  /* ------------------------------------------------------------ rendering -- */
  const lineSvg = (w) => svg('svg', { class: 'sym', width: w, height: 26, viewBox: `0 0 ${w} 26` })
  const ln = (x1, y1, x2, y2) => svg('line', { x1, y1, x2, y2 })
  function symbol(e, kind) {
    const s = lineSvg(44)
    if (kind === 'NO' || kind === 'NC') { s.append(ln(0, 13, 14, 13), ln(14, 3, 14, 23), ln(30, 3, 30, 23), ln(30, 13, 44, 13)); if (kind === 'NC') s.append(ln(11, 21, 33, 5)) }
    else if (kind === 'P' || kind === 'N') { s.append(ln(0, 13, 14, 13), ln(14, 3, 14, 23), ln(30, 3, 30, 23), ln(30, 13, 44, 13), svg('text', { x: 22, y: 17, 'text-anchor': 'middle' }, kind)) }
    else { // coils
      s.append(ln(0, 13, 8, 13), svg('path', { d: 'M15 3 Q7 13 15 23 M29 3 Q37 13 29 23' }), ln(36, 13, 44, 13))
      const lab = { set: 'S', reset: 'R', ncoil: '/' }[kind]; if (lab) s.append(svg('text', { x: 22, y: 18, 'text-anchor': 'middle' }, lab))
    }
    return s
  }
  const fieldAt = (at, name) => { const t = targetIn(state.project, at); return t && operandFields(t).find((x) => fieldName(x) === name) }
  /** An operand: <??.?> when missing (... when optional), the formatted name otherwise. Accepts a dragged tag. */
  const opSpan = (at, name, value, cls, fallback = '<??.?>') => {
    const unknown = classifyOperand(value, sc) === 'unknown'
    const span = h('span', { class: `${cls}${value ? '' : ' empty'}${unknown ? ' unknown' : ''}`, dataset: { op: name }, title: unknown ? UNKNOWN_TIP : undefined,
      onClick: (ev) => { if (!value && !ev.shiftKey) { ev.stopPropagation(); startEdit(at, name) } },
      onDblclick: (ev) => { ev.stopPropagation(); startEdit(at, name) } }, value ? shown(value) : fallback)
    span.addEventListener('dragover', (ev) => { if (dragging.payload?.tag) { ev.preventDefault(); ev.stopPropagation(); span.classList.add('drop-op') } })
    span.addEventListener('dragleave', () => span.classList.remove('drop-op'))
    span.addEventListener('drop', (ev) => {
      let tag = dragging.payload?.tag
      if (!tag) { try { tag = JSON.parse(ev.dataTransfer.getData('text/plain')).tag } catch { /* not a tag */ } }
      if (!tag) return
      ev.preventDefault(); ev.stopPropagation(); span.classList.remove('drop-op'); dragging.payload = null
      const f = fieldAt(at, name); if (f) setField(at, f, tag)
    })
    return span
  }
  function makeDraggable(node, ni, path, k) {
    node.setAttribute('draggable', 'true')
    node.addEventListener('dragstart', (ev) => {
      if (ev.target.closest?.('.op-edit')) return
      ev.stopPropagation()
      moveDrag = { network: ni, path }
      setSel({ network: ni, path })
      ev.dataTransfer.effectAllowed = 'move'
      try { ev.dataTransfer.setData('application/x-plc-move', k) } catch { /* ignore */ }
      node.classList.add('moving')
    })
    node.addEventListener('dragend', () => { node.classList.remove('moving'); moveDrag = null; clearDrag() })
  }
  /** Instruction box in the engineering-tool layout: instance above, title, EN/ENO (or IN/Q) on the rung row,
   *  input operands outside on the left, output operands outside on the right. */
  function boxGrid({ title, titleAttrs = {}, flowIn = 'EN', flowOut = 'ENO', rows = [] }) {
    const grid = h('div', { class: 'tbox' })
    const row = (cls, l, mid, r) => grid.append(h('div', { class: `tb-l ${cls}` }, l), h('div', { class: `tb-mid ${cls}` }, mid), h('div', { class: `tb-r ${cls}` }, r))
    row('tb-head', null, h('span', { class: 'tb-title', ...titleAttrs }, title), null)
    row(`tb-flow${rows.length ? '' : ' tb-last'}`, null, [h('span', { class: 'pn' }, flowIn), h('span', { class: 'pn r' }, flowOut)], null)
    rows.forEach((r, i) => row(`${i === rows.length - 1 ? 'tb-last' : ''}${r.l ? ' stub-l' : ''}${r.r ? ' stub-r' : ''}`, r.lop ?? null, [h('span', { class: 'pn' }, r.l ?? ''), h('span', { class: 'pn r' }, r.r ?? '')], r.rop ?? null))
    return grid
  }
  function elementNode(e, path, ni, ctx) {
    const k = key(path), at = { network: ni, path }, op = (name, value, cls, fallback) => opSpan(at, name, value, cls, fallback)
    const node = h('div', { class: 'el', dataset: { path: k } })
    const onSel = (ev) => { ev.stopPropagation(); if (ev.shiftKey) toggleInSelection(ni, k); else setSel({ network: ni, path }) }
    node.addEventListener('mousedown', onSel)
    makeDraggable(node, ni, path, k)
    if (e.k === 'NO' || e.k === 'NC' || e.k === 'P' || e.k === 'N') {
      node.classList.add('sym-el')
      node.append(h('span', { class: 'val' }), h('span', { class: 'addr' }, addrOf(e.tag)), op('tag', e.tag, 'tagname'), symbol(e, e.k))
      node.title = { NO: 'Normally open contact', NC: 'Normally closed contact', P: 'Scan operand for positive signal edge', N: 'Scan operand for negative signal edge' }[e.k]
    } else if (e.k === 'cmp') {
      node.classList.add('box-el', 'cmp-el')
      const sel2 = h('select', { class: 'in', onMousedown: (ev) => ev.stopPropagation(), onChange: (ev) => edit((p) => { const t = targetIn(p, at); if (t) t.op = ev.target.value }, `op:${blockId}:${k}:op`) }, COMPARE.map((o) => h('option', { value: o, selected: o === e.op }, o)))
      node.append(op('a', e.a, 'pv cmp-op'), h('div', { class: 'cmp-box' }, h('div', { class: 'cmp-title' }, 'CMP'), sel2), op('b', e.b, 'pv cmp-op'))
      node.title = 'Compare'
    } else if (e.k === 'move' || e.k === 'math') {
      node.classList.add('box-el')
      const ins = operandFields(e).filter((f) => f.field !== 'dest'), out = { l: null, r: 'OUT', rop: h('span', { class: 'outv' }, op('dest', e.dest, 'pv'), h('span', { class: 'dval' })) }
      const rows = ins.map((f, i) => ({ l: e.k === 'move' ? 'IN' : f.label, lop: op(f.field, e[f.field], 'pv'), ...(i === 0 ? { r: out.r, rop: out.rop } : {}) }))
      node.append(h('div', { class: 'tb-top' }), boxGrid({ title: e.k === 'move' ? 'MOVE' : MATH_OPS[e.op] ?? 'MATH', rows }))
    } else if (e.k === 'box') {
      node.classList.add('box-el')
      const def = FB[e.fb], ins = operandFields(e), outs = Object.keys(def.out).filter((p) => p !== def.flowOut)
      const inst = h('span', { class: 'tagname inst', title: 'Double-click to rename the instance' }, instShown(e.inst, false))
      inst.addEventListener('dblclick', (ev) => { ev.stopPropagation(); editInstName(inst, at, e.inst) })
      const n = Math.max(ins.length, outs.length)
      const rows = Array.from({ length: n }, (_, i) => ({ l: ins[i]?.pin ?? null, lop: ins[i] ? op(ins[i].pin, e.args?.[ins[i].pin], 'pv', ins[i].optional ? '...' : '<??.?>') : null, r: outs[i] ?? null, rop: outs[i] ? h('span', { class: 'live', dataset: { live: `${e.inst}.${outs[i]}` } }, '...') : null }))
      node.append(h('div', { class: 'tb-top' }, h('span', { class: 'addr' }), inst), boxGrid({ title: def.label, flowIn: def.flowIn, flowOut: def.flowOut, titleAttrs: { title: def.title }, rows }))
    } else if (e.k === 'call') {
      node.classList.add('box-el', 'call-el')
      const callee = state.project.blocks.find((b) => isCallee(b) && b.name === e.block)
      const db = !e.multi && e.inst ? state.project.blocks.find((b) => b.kind === 'DB' && b.name === e.inst) : null
      const fields = operandFields(e), ins = fields.filter((f) => f.dir !== 'out'), outs = fields.filter((f) => f.dir === 'out')
      const n = Math.max(ins.length, outs.length)
      const rows = Array.from({ length: n }, (_, i) => ({
        l: ins[i]?.pin ?? null, lop: ins[i] ? op(ins[i].pin, e.args?.[ins[i].pin], 'pv', ins[i].optional ? '...' : '<??.?>') : null,
        r: outs[i]?.pin ?? null, rop: outs[i] ? op(outs[i].pin, e.args?.[outs[i].pin], 'pv', outs[i].optional ? '...' : '<??.?>') : null,
      }))
      node.append(h('div', { class: 'tb-top' }, h('span', { class: 'addr' }, db ? `%DB${db.number}` : ''), h('span', { class: 'tagname inst' }, e.inst ? instShown(e.inst, !e.multi) : '')),
        boxGrid({ title: e.block, titleAttrs: { title: callee ? `${callee.kind}${callee.number} ${callee.name}` : `${e.block} does not exist` }, rows }))
      if (!callee) node.classList.add('missing')
      node.title = callee ? `Call of ${callee.kind === 'FB' ? 'function block' : 'function'} ${callee.name}` : `Block ${e.block} does not exist`
    } else if (e.k === 'empty') {
      node.classList.add('box-el', 'empty-el')
      const name = h('span', { class: 'tb-name', dataset: { boxname: '1' }, title: 'Click and type an instruction (TON, MOVE, CMP ==, ADD …) or the name of an FB or FC',
        onClick: (ev) => { ev.stopPropagation(); openBoxName(at) } }, '??')
      node.append(h('div', { class: 'tb-top' }), boxGrid({ title: name, rows: [] }))
    }
    ctx.els.set(k, node)
    node.addEventListener('contextmenu', (ev) => { ev.preventDefault(); ev.stopPropagation(); const cur = sel(); if (!(cur?.paths && cur.paths.includes(k))) setSel({ network: ni, path }); menu(ev) })
    return node
  }
  function wire(flowKey, ctx, grow = false, gap = null, empty = false) {
    // While a branch is open, the connections where it may close are marked so they are easy to hit.
    const join = !!(gap && ctx.join && canDropBranchEnd(ctx.net, ctx.join, gap))
    const w = h('div', { class: `wire${grow ? ' grow' : ''}${gap ? ' wire-slot' : ''}${empty ? ' empty-slot' : ''}${join ? ' join-target' : ''}`, ...(gap ? { role: 'button', tabindex: '0', 'aria-label': 'Connection', title: join ? 'Close the branch here (Shift+F9)' : 'Connection: select it, then insert an instruction', dataset: { gap: JSON.stringify(gap) } } : {}) }, gap ? h('span', { class: 'drop-mark' }) : null)
    if (gap) {
      const selectGap = (e) => { e.stopPropagation(); setSel({ network: ctx.ni, gap }) }
      w.addEventListener('mousedown', selectGap)
      w.addEventListener('focus', () => setSel({ network: ctx.ni, gap }))
      w.addEventListener('contextmenu', (e) => { e.preventDefault(); selectGap(e); menu(e) })
    }
    ctx.wires.push({ el: w, key: flowKey }); return w
  }
  function series(list, base, ni, ctx, startKey, main = false) {
    const row = h('div', { class: main ? 'series main-series' : 'series' })
    row.append(wire(startKey, ctx, main && !list.length, { path: base, index: 0 }, main && !list.length))
    list.forEach((e, i) => {
      const path = [...base, i]
      const node = e.k === 'branch' ? branchNode(e, path, ni, ctx) : elementNode(e, path, ni, ctx)
      row.append(node, wire(key(path), ctx, main && i === list.length - 1, { path: base, index: i + 1 }))
    })
    return row
  }
  function endBranchDrag() {
    branchDrag = null
    root.querySelectorAll('.branch-target, .join-near').forEach(slot => slot.classList.remove('branch-target', 'join-near'))
  }
  function branchEnd(path, ni, lanePath, count) {
    const handle = h('button', {
      type: 'button', class: 'branch-end', draggable: 'true',
      'aria-label': 'Close branch', title: 'Drag the arrow onto the rung where the branch should close (or press Shift+F9)',
      onMousedown: ev => ev.stopPropagation(),
      onClick: () => setSel({ network: ni, gap: { path: lanePath, index: count } }),
    }, svg('svg', { viewBox: '0 0 12 16', width: 12, height: 16 }, svg('path', { d: 'M6 15V2M2 6l4-4 4 4', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8 })))
    handle.addEventListener('dragstart', ev => {
      branchDrag = { network: ni }
      ev.dataTransfer.effectAllowed = 'link'
      ev.dataTransfer.setData('application/x-plc-branch-end', key(path))
      const net = block().networks[ni]
      for (const slot of refs.nets.get(ni).el.querySelectorAll('[data-gap]')) {
        if (canDropBranchEnd(net, path, JSON.parse(slot.dataset.gap))) slot.classList.add('branch-target')
      }
    })
    handle.addEventListener('dragend', endBranchDrag)
    return handle
  }
  function branchNode(e, path, ni, ctx) {
    const wrap = h('div', { class: `branch${e.closed === false ? ' branch-open' : ''}`, dataset: { path: key(path) } })
    wrap.addEventListener('mousedown', ev => { if (ev.target === wrap || ev.target.classList.contains('lbar')) { ev.stopPropagation(); setSel({ network: ni, branch: path }) } })
    e.branches.forEach((lane, li) => {
      const lp = [...path, li], cls = e.branches.length === 1 ? 'first last' : li === 0 ? 'first' : li === e.branches.length - 1 ? 'last' : 'mid'
      const laneEl = h('div', { class: `lane ${cls}`, style: { position: 'relative', paddingBottom: '8px' }, dataset: { path: key(lp) } })
      const startKey = `L${key(path)}`
      const inner = series(lane, lp, ni, ctx, startKey)
      if (!lane.length) inner.append(h('div', { class: 'wire', style: { width: '40px' } }))
      laneEl.append(h('div', { class: 'lbar l', dataset: { f: startKey } }), inner, h('div', { class: 'lbar r', dataset: { f: `R${key(lp)}` } }))
      if (e.closed === false && li === e.branches.length - 1) laneEl.append(branchEnd(path, ni, lp, lane.length))
      laneEl.addEventListener('mousedown', (ev) => { if (ev.target === laneEl || ev.target.classList.contains('wire')) { ev.stopPropagation(); setSel({ network: ni, path: lp }) } })
      wrap.append(laneEl)
    })
    return wrap
  }
  function coilNode(c, i, ni, ctx) {
    const node = h('div', { class: 'el sym-el', dataset: { path: `c${i}` } })
    node.append(h('span', { class: 'addr' }, addrOf(c.tag)), opSpan({ network: ni, coil: i }, 'tag', c.tag, 'tagname'), symbol(c, c.k))
    node.addEventListener('mousedown', (ev) => { ev.stopPropagation(); setSel({ network: ni, coil: i }) })
    node.addEventListener('contextmenu', (ev) => { ev.preventDefault(); ev.stopPropagation(); setSel({ network: ni, coil: i }); menu(ev) })
    ctx.els.set(`c${i}`, node)
    node.title = { coil: 'Assignment', ncoil: 'Negate assignment', set: 'Set output', reset: 'Reset output' }[c.k]
    return node
  }
  function nearestSlot(netEl, ev, only = '') {
    let best = null, bd = Infinity
    for (const slot of netEl.querySelectorAll(`.wire-slot${only}`)) {
      const r = slot.getBoundingClientRect(), d = Math.hypot(Math.max(r.left - ev.clientX, 0, ev.clientX - r.right), ev.clientY - r.top)
      if (d < bd) { bd = d; best = slot }
    }
    return best
  }
  function clearDrag() { setNear(null); root.classList.remove('dragging'); root.querySelectorAll('.out-col.drop-over, .drop-op').forEach((x) => x.classList.remove('drop-over', 'drop-op')) }
  const onDragStart = (e) => { try { palDrag = e.target.closest?.('.pal-item, .fav') ? JSON.parse(e.dataTransfer.getData('text/plain')) : null } catch { palDrag = null } }
  const onDragEnd = () => { palDrag = null; moveDrag = null; clearDrag() }
  function network(net, ni) {
    const ctx = { wires: [], els: new Map(), ni, net, join: openBranches(net).at(-1) }
    const body2 = h('div', { class: 'net-body' })
    const main = series(net.elements, [], ni, ctx, 'S', true)
    body2.append(h('div', { class: 'rail' }), main)
    const coils = h('div', { class: 'coils', style: { position: 'relative' } })
    net.coils.forEach((c, i) => {
      const cls = net.coils.length === 1 ? 'first last' : i === 0 ? 'first' : i === net.coils.length - 1 ? 'last' : 'mid'
      coils.append(h('div', { class: `coilrow lane ${cls}`, style: { position: 'relative', paddingBottom: '8px' } }, h('div', { class: 'lbar l', dataset: { f: 'OUT' } }), wire('OUT', ctx), coilNode(c, i, ni, ctx), wire(`k${i}`, ctx)))
    })
    const outCol = h('div', { class: 'out-col' }, coils)
    body2.append(outCol)
    const scroller = h('div', { class: 'net-scroll' }, body2,
      h('button', { type: 'button', class: 'scroll-btn l', tabindex: '-1', 'aria-label': 'Scroll left', title: 'Scroll left', onClick: () => body2.scrollBy({ left: -300, behavior: 'smooth' }) }, '‹'),
      h('button', { type: 'button', class: 'scroll-btn r', tabindex: '-1', 'aria-label': 'Scroll right', title: 'Scroll right', onClick: () => body2.scrollBy({ left: 300, behavior: 'smooth' }) }, '›'))
    trackScroll(scroller, body2, outCol, main)
    const collapsed = net.collapsed
    const title = h('input', { class: 'ntitle', value: net.title ?? '', placeholder: '', 'aria-label': `Title of network ${ni + 1}`, onInput: (ev) => edit((p) => { p.blocks.find((x) => x.id === blockId).networks[ni].title = ev.target.value }, `nt:${net.id}`), onMousedown: (ev) => ev.stopPropagation() })
    const comment = h('input', { class: 'net-comment', value: net.comment ?? '', placeholder: 'Comment', 'aria-label': `Comment of network ${ni + 1}`, onInput: (ev) => edit((p) => { p.blocks.find((x) => x.id === blockId).networks[ni].comment = ev.target.value }, `nc:${net.id}`), onMousedown: (ev) => ev.stopPropagation() })
    const issues = validateLadderNetwork(net)
    const el = h('div', { class: `net${issues.length ? ' unfinished' : ''}`, dataset: { ni } },
      h('div', { class: 'net-head' }, h('span', { class: 'tw', onClick: () => edit((p) => { const n = p.blocks.find((x) => x.id === blockId).networks[ni]; n.collapsed = !n.collapsed }) }, collapsed ? '▶' : '▼'),
        issues.length ? h('span', { class: 'net-err', role: 'img', 'aria-label': 'Network has errors', title: issues.map((i) => i.message).join('\n') }, '!') : null,
        h('span', { class: 'nlabel' }, `Network ${ni + 1}:`), title),
      collapsed ? null : [comment, scroller])
    el.addEventListener('mousedown', () => setSel({ network: ni }))
    body2.addEventListener('mousedown', (ev) => { if (ev.button === 0 && !ev.target.closest('.el, .wire-slot, .branch, .branch-end, .lbar, input, select, button, textarea')) startMarquee(ev, ni) })
    el.addEventListener('contextmenu', (ev) => { ev.preventDefault(); if (sel()?.network !== ni && !sel()?.paths) setSel({ network: ni }); menu(ev) })
    el.addEventListener('dragover', (ev) => {
      if (branchDrag) {
        // Snap to the nearest connection where the branch may close, wherever the pointer is in this network.
        const slot = branchDrag.network === ni ? nearestSlot(el, ev, '.join-target') : null
        el.querySelectorAll('.join-near').forEach((x) => x !== slot && x.classList.remove('join-near'))
        if (slot) { slot.classList.add('join-near'); ev.preventDefault(); ev.dataTransfer.dropEffect = 'link' }
        return
      }
      if (moveDrag && moveDrag.network !== ni) { ev.dataTransfer.dropEffect = 'none'; return }   // moves stay in one network
      if (dragging.payload?.tag) { ev.preventDefault(); return }   // a tag lands on an operand, not on the rung
      ev.preventDefault()
      // A coil lands in the output column; everything else on the connection nearest the pointer.
      const coil = !!palDrag?.lad?.coil
      outCol.classList.toggle('drop-over', coil); root.classList.toggle('dragging', !coil)
      setNear(coil ? null : nearestSlot(el, ev))
    })
    el.addEventListener('dragleave', (ev) => { if (!el.contains(ev.relatedTarget)) clearDrag() })
    el.addEventListener('drop', (ev) => {
      ev.preventDefault()
      ev.stopPropagation()
      clearDrag()
      if (branchDrag) {
        const slot = branchDrag.network === ni && nearestSlot(el, ev, '.join-target')
        endBranchDrag()
        if (slot) insert('closeBranch', { network: ni, gap: JSON.parse(slot.dataset.gap) })
        return
      }
      if (moveDrag) {
        const md = moveDrag; moveDrag = null
        if (md.network === ni) { const slot = nearestSlot(el, ev); if (slot) moveElement(md, JSON.parse(slot.dataset.gap)) }
        return
      }
      let p = null
      try { p = JSON.parse(ev.dataTransfer.getData('text/plain')) } catch { /* not ours */ }
      p = p ?? dragging.payload
      dragging.payload = null
      if (!p) return
      const slot = nearestSlot(el, ev), at = { network: ni, ...(slot ? { gap: JSON.parse(slot.dataset.gap) } : {}) }
      if (p.block) { insertCall(p.block, at); return }
      if (p.tag) { toast('Drop the tag onto an operand (<??.?>) of an instruction.'); return }
      if (p.lad) dropPayload(p.lad, p.lad.coil ? { network: ni } : at)
    })
    refs.nets.set(ni, { el, ctx })
    return el
  }

  /* ------------------------------------------------------- context menu -- */
  function menu(ev) {
    const s = sel(), ni = s?.network, st = block().networks[ni] ? railState(ni, s.gap) : { unfinished: false, canClose: false }
    const ins = (label, kind, keys) => ({ label, keys, run: () => insert(kind) })
    const clipName = { network: 'Paste', element: 'Paste', coil: 'Paste', elements: 'Paste' }[state.clipboard?.kind]
    const edits = [{ label: 'Cut', keys: 'Ctrl+X', run: cut }, { label: 'Copy', keys: 'Ctrl+C', run: copy }, { label: 'Paste', keys: 'Ctrl+V', run: paste, disabled: !clipName }, { label: 'Delete', keys: 'Del', run: remove }]
    if (s?.paths) {
      contextMenu(ev.clientX, ev.clientY, [...edits, '-', { label: 'Open branch around selection', run: branchAround }, '-', { label: 'Insert network', keys: 'Ctrl+R', run: () => insertNetwork(true) }])
      return
    }
    // Tag actions for the operand under the pointer (or the first operand of the selected instruction).
    const t = s && !s.gap && !s.branch ? targetIn(state.project, s) : null
    const opName = ev.target?.closest?.('[data-op]')?.dataset.op ?? (t && operandFields(t)[0] ? fieldName(operandFields(t)[0]) : null)
    const f = t && opName ? operandFields(t).find((x) => fieldName(x) === opName) : null
    const v = t && f ? valueOf(t, f) : ''
    const kind = v ? classifyOperand(v, scope()) : 'empty'
    const tags = []
    if (f && kind === 'unknown' && IDENT.test(v)) tags.push({ label: 'Define tag…', run: () => defineTag(atOf(s), f, v) })
    if (f && kind === 'tag') tags.push({ label: 'Rename tag…', run: () => renameTagAt(v) })
    if (f) tags.push({ label: 'Rewire tag…', run: () => startEdit(atOf(s), opName) })
    if (t?.k === 'box' && t.inst) tags.push({ label: 'Rename instance…', run: () => { const span = body.querySelector('.el.sel .inst'); if (span) editInstName(span, atOf(s), t.inst) } })
    const branch = [st.canClose ? ins('Close branch', 'closeBranch', 'Shift+F9') : null, st.unfinished ? null : ins('Open branch', 'branch', 'Shift+F8'), s?.branch ? ins('Insert parallel path', 'addPath') : null].filter(Boolean)
    contextMenu(ev.clientX, ev.clientY, [...edits, ...(tags.length ? ['-', ...tags] : []), '-', { label: 'Insert network', keys: 'Ctrl+R', run: () => insertNetwork(true) }, ...(branch.length ? ['-', ...branch] : [])])
  }

  /* ------------------------------------------------------------ monitoring -- */
  const val = (t) => readOperand(block().name, t)
  function evalSeries(list, base, flowIn, map) {
    let flow = flowIn
    list.forEach((e, i) => {
      const p = [...base, i], k = key(p)
      if (e.k === 'branch') {
        let any = false
        e.branches.forEach((lane, li) => { const lf = evalSeries(lane, [...p, li], flow, map); map.set(`R${key([...p, li])}`, lf); any = any || lf === true; if (lf === undefined) any = undefined })
        flow = flow === undefined ? undefined : flow && any
        map.set(`L${k}`, flowIn); map.set(k, flow)
      } else if (flow !== undefined) {
        if (e.k === 'NO') flow = flow && !!val(e.tag)
        else if (e.k === 'NC') flow = flow && !val(e.tag)
        else if (e.k === 'P' || e.k === 'N') flow = flow && !!val(`${e.inst}.Q`)
        else if (e.k === 'cmp') { const a = val(e.a), b = val(e.b); flow = flow && a !== undefined && b !== undefined && ({ '==': a === b, '<>': a !== b, '>': a > b, '>=': a >= b, '<': a < b, '<=': a <= b })[e.op] }
        else if (e.k === 'box') flow = !!val(`${e.inst}.${FB[e.fb].flowOut}`)
        else if (e.k === 'empty') flow = undefined
        map.set(k, flow)   // a call, MOVE or math box passes EN on as ENO
      } else map.set(k, undefined)
    })
    return flow
  }
  const fmtLive = (x) => (x === undefined ? '' : typeof x === 'boolean' ? (x ? 'TRUE' : 'FALSE') : typeof x === 'number' && x > 1e6 ? `${(x / 1e6).toFixed(0)}ms` : String(x))
  function paint() {
    if (!block()) return
    const live = isOnline() && state.monitor !== false
    for (const [ni, { el, ctx }] of refs.nets) {
      const complete = live && !validateLadderNetwork(block().networks[ni]).length
      el.classList.toggle('mon', complete)
      if (!complete) { for (const w of ctx.wires) w.el.classList.remove('t', 'f'); for (const n of ctx.els.values()) { n.classList.remove('t', 'f'); n.querySelector('.val')?.replaceChildren(); n.querySelectorAll('[data-live]').forEach((x) => { x.textContent = '...' }); n.querySelectorAll('.dval').forEach((x) => { x.textContent = '' }) } el.querySelectorAll('.lbar').forEach((x) => x.classList.remove('t')); continue }
      const net = block().networks[ni], map = new Map()
      const out = evalSeries(net.elements, [], true, map)
      map.set('S', true); map.set('OUT', out)
      net.coils.forEach((c, i) => map.set(`k${i}`, c.k === 'ncoil' ? !out : out))
      for (const w of ctx.wires) { const v = map.get(w.key); w.el.classList.toggle('t', v === true); w.el.classList.toggle('f', v === false) }
      el.querySelectorAll('.lbar').forEach((b) => { const v = map.get(b.dataset.f); b.classList.toggle('t', v === true) })
      const walk = (list, base) => list.forEach((e, i) => {
        const p = [...base, i], n = ctx.els.get(key(p))
        if (e.k === 'branch') e.branches.forEach((l, li) => walk(l, [...p, li]))
        else if (n) {
          const v = map.get(key(p))
          n.classList.toggle('t', v === true); n.classList.toggle('f', v !== true)
          n.querySelectorAll('[data-live]').forEach((sp) => { sp.textContent = fmtLive(val(sp.dataset.live)) || '...' })
          if (e.k === 'move' || e.k === 'math') { const x = val(e.dest); const d = n.querySelector('.dval'); if (d) d.textContent = x === undefined ? '' : `= ${x}` }
        }
      })
      walk(net.elements, [])
      net.coils.forEach((c, i) => { const n = ctx.els.get(`c${i}`); if (!n) return; const x = val(c.tag); n.classList.toggle('t', x === true); n.classList.toggle('f', x === false) })
    }
  }

  /* -------------------------------------------------------------- render -- */
  function render() {
    const b = block(); if (!b) return
    const scroll = body.scrollTop, hscroll = new Map([...refs.nets].map(([i, r]) => [i, r.el.querySelector('.net-body')?.scrollLeft ?? 0]))
    activeInput?.cancel(); ro.disconnect(); sc = scope()
    root.replaceChildren()
    refs.nets.clear()
    b.networks.forEach((n, i) => root.append(network(n, i)))
    root.style.zoom = zoom
    body.scrollTop = scroll
    hscroll.forEach((x, i) => { const nb = refs.nets.get(i)?.el.querySelector('.net-body'); if (nb) nb.scrollLeft = x })
    applySelection()
    paint()
  }
  function applySelection() {
    body.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel'))
    const s = sel(); if (!s) return
    const r = refs.nets.get(s.network); if (!r) return
    r.el.classList.add('sel')
    if (s.paths) { for (const k of s.paths) r.ctx.els.get(k)?.classList.add('sel'); return }
    const el = s.coil !== undefined ? r.ctx.els.get(`c${s.coil}`) : s.path?.length % 2 ? r.ctx.els.get(key(s.path)) : null
    el?.classList.add('sel')
    if (s.gap) for (const w of r.el.querySelectorAll('[data-gap]')) w.classList.toggle('sel', w.dataset.gap === JSON.stringify(s.gap))
    if (s.branch) for (const branch of r.el.querySelectorAll('.branch')) branch.classList.toggle('sel', branch.dataset.path === key(s.branch))
    const slot = s.gap ? r.el.querySelector('.wire-slot.sel') : null
    ;(el ?? slot)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    if (pendingEdit) { pendingEdit = false; setTimeout(edit0, 20) }
  }

  const offs = [
    on('project', (e) => { if (!block()) return; if (e?.reason === 'edit' && document.querySelector('.op-edit')) return; if (e?.reason === 'undo') state.selection = { block: blockId, network: Math.max(0, Math.min(sel()?.network ?? 0, block().networks.length - 1)) }; render() }),
    on('selection', () => applySelection()),
    on('tick', () => paint()),
    on('online', () => paint()),
  ]
  editor.api = {
    drop: (pl) => { if (pl?.block) insertCall(pl.block); else if (pl?.lad) dropPayload(pl.lad) },
    insert, insertCall, remove, insertNetwork, copy, paste, cut, edit: edit0, move, type: typeInto,
    zoom: (d) => { zoom = Math.round(Math.max(0.6, Math.min(1.6, zoom + d)) * 10) / 10; root.style.zoom = zoom },
    escape: () => { activeInput?.cancel(); setSel(null) },
  }
  host.addEventListener('dragover', (e) => e.preventDefault())
  addEventListener('dragstart', onDragStart); addEventListener('dragend', onDragEnd)
  render()
  if (!sel() && block().networks.length) select({ block: blockId, network: 0 })
  return { dispose() { offs.forEach((f) => f()); ro.disconnect(); activeInput?.cancel(); removeEventListener('dragstart', onDragStart); removeEventListener('dragend', onDragEnd); if (editor.api && host.contains(root)) editor.api = null }, focus() { render() } }
}
