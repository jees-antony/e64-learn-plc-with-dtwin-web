// Ladder (LAD) editor. Networks of series elements, parallel branches, instruction boxes and coils.
// Mouse: click to select, double-click an operand to edit, drag instructions from the task card,
// right-click for the context menu, Ctrl+wheel to zoom. Keys come from commands.js.
import { COMPARE, DEFAULT_PIN, FB } from '../../core/catalog.js'
import { IDENT, newNetwork, uid } from '../../core/model.js'
import { classifyOperand, fieldName, instancesOf, operandFields, operandSequence, pinNames, renameInstance, suggestedTagType, valueOf } from '../../core/operands.js'
import { contextMenu, h, svg } from '../dom.js'
import { editor, toast } from '../commands.js'
import { isOnline, readOperand } from '../online.js'
import { PALETTE, iconFor } from '../palette.js'
import { closeQuick, openQuick } from './lad-quick.js'
import { opList } from './op-list.js'
import { seriesAt, insertAtGap, startBranch, closeBranch, canDropBranchEnd, addParallelPath, removeBranch, openBranches, validateLadderNetwork } from '../../core/ladder-edit.js'
import { blockById, edit, on, select, state } from '../store.js'

const key = (p) => p.join('.')
const clone = (x) => JSON.parse(JSON.stringify(x))

export function resolve(net, path) {
  let list = net.elements
  const n = path.length, pairs = n % 2 ? n - 1 : n
  for (let k = 0; k < pairs; k += 2) list = list[path[k]].branches[path[k + 1]]
  return n % 2 ? { list, index: path[n - 1] } : { list, index: list.length - 1 }
}
export function mountLadder(host, tab) {
  const blockId = tab.id
  const block = () => blockById(blockId)
  let zoom = 1, pendingEdit = false
  let branchDrag = null
  let moveDrag = null   // an existing instruction being dragged to a new position: { network, path }
  const root = h('div', { class: 'lad', tabindex: '-1' })
  host.append(favoritesBar(), h('div', { class: 'ed-body', style: { background: '#eef1f4' } }, root))
  const body = host.lastChild
  const refs = { nets: new Map() }   // network index -> { el, wires:[{el,key}], els:Map(key->el), vals:[...] }

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
  const netGap = (i) => h('div', { class: 'net-gap' }, h('button', { type: 'button', class: 'net-plus', tabindex: '-1', title: 'Add a network here', onClick: () => insertNetworkAt(i) }, '+ Network'))

  /* the "+" nearest the pointer (within 48px) fades in; only one at a time */
  let nearEl = null, probeRaf = 0, lastMove = null
  const setNear = (el) => { if (nearEl === el) return; nearEl?.classList.remove('near'); nearEl = el; el?.classList.add('near') }
  function probe(ev) {
    let best = null, bd = 48
    const net = ev.target.closest?.('.net')
    if (net) for (const b of net.querySelectorAll('.gap-plus:not(.pill)')) {
      const r = b.getBoundingClientRect(), d = Math.hypot(ev.clientX - (r.left + r.width / 2), ev.clientY - (r.top + r.height / 2))
      if (d < bd) { bd = d; best = b.parentElement }
    }
    if (!best) for (const z of root.querySelectorAll('.net-gap')) { const r = z.getBoundingClientRect(); if (ev.clientY >= r.top - 8 && ev.clientY <= r.bottom + 8) { best = z; break } }
    setNear(best)
  }
  const sel = () => (state.selection?.block === blockId ? state.selection : null)
  const setSel = (s) => { select(s ? { block: blockId, ...s } : null) }
  const addrOf = (name) => state.project.tags.find((t) => t.name === name)?.address ?? ''
  const MATH_OPS = { add: 'ADD', sub: 'SUB', mul: 'MUL', div: 'DIV' }
  const UNKNOWN_TIP = 'This tag does not exist yet. Double-click to change it, or create it.'
  const scope = () => ({ tags: new Set(state.project.tags.map((t) => t.name)), locals: new Set(Object.values(block().interface).flat().map((v) => v.name)), instances: new Map(instancesOf(block()).map((i) => [i.name, i.fb])) })
  let sc = scope()   // refreshed on every render; marks unknown operands
  let palDrag = null   // payload of the Instructions-card item being dragged

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
    if (kind === 'box?') { chooseBox(); return }
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
        if (kind === 'branch') toast('Parallel path started. Add instructions to it, then close it where the paths should meet (Shift+F9).')
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
      const path = insertAtGap(net, gapOf(net, s), el)
      pendingEdit = true
      state.selection = { block: blockId, network: ni, path }
    })
  }
  /* ------------------------------------------------- favorites bar (TIA) -- */
  // The row of most-used instructions above the editor: click inserts at the selection, or drag onto a rung.
  function favoritesBar() {
    const FAVS = [
      [(l) => l.k === 'NO', 'NO'], [(l) => l.k === 'NC', 'NC'], [(l) => l.coil === 'coil', 'coil'], [(l) => l.coil === 'set', 'set'], [(l) => l.coil === 'reset', 'reset'],
      '|', [(l) => l.fb === 'TON', 'box:TON'], [(l) => l.fb === 'CTU', 'box:CTU'], [(l) => l.k === 'cmp' && l.op === '==', 'cmp'], [(l) => l.k === 'move', 'move'],
      '|', [(l) => l.k === 'branch', 'branch'], [(l) => l.k === 'closeBranch', 'closeBranch'],
    ]
    const bar = h('div', { class: 'fav-bar', role: 'toolbar', 'aria-label': 'Favorite instructions' })
    for (const f of FAVS) {
      if (f === '|') { bar.append(h('span', { class: 'fav-sep' })); continue }
      const item = palFind(f[0]); if (!item) continue
      const b = h('button', { type: 'button', class: 'fav', draggable: 'true', title: `${item.name}${item.short ? ` (${item.short})` : ''}\nClick to insert at the selection, or drag onto a rung.`, 'aria-label': item.name,
        onMousedown: (e) => e.preventDefault(),   // keep the selection and any open operand box
        onClick: () => (f[1].includes(':') || ['NO', 'NC', 'cmp', 'move', 'branch', 'closeBranch', ...COILS].includes(f[1]) ? insert(f[1]) : dropPayload(item.lad)) }, iconFor(item))
      b.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', JSON.stringify({ lad: item.lad, fbd: item.fbd })); e.dataTransfer.effectAllowed = 'copy' })
      bar.append(b)
    }
    bar.append(h('span', { class: 'fav-sep' }), h('button', { type: 'button', class: 'fav more', title: 'All instructions (Shift+F5)', onMousedown: (e) => e.preventDefault(), onClick: () => chooseBox() }, 'More…'),
      h('span', { class: 'grow' }),
      h('button', { type: 'button', class: 'fav text', title: 'Insert a network below the selected one (Ctrl+R)', onMousedown: (e) => e.preventDefault(), onClick: () => insertNetwork(true) }, '+ Network'))
    return bar
  }

  /* ---------------------------------------------- quick-insert popover -- */
  function palFind(match) { return PALETTE.flatMap((g) => g.items).find((i) => i.lad && match(i.lad)) }
  const palIcon = (match) => { const i = palFind(match); return i ? iconFor(i) : null }
  function railState(ni, gap) {
    const net = block().networks[ni], open = net ? openBranches(net) : []
    return { net, unfinished: open.length > 0, canClose: !!gap && open.length > 0 && canDropBranchEnd(net, open.at(-1), gap) }
  }
  const slotFor = (ni, gap) => [...(refs.nets.get(ni)?.el.querySelectorAll('[data-gap]') ?? [])].find((w) => w.dataset.gap === JSON.stringify(gap))
  function openQuickAt(ni, gap, more = false) {
    const slot = slotFor(ni, gap), anchor = slot?.querySelector('.gap-plus'); if (!anchor) return
    setSel({ network: ni, gap })
    const at = { network: ni, gap }
    const go = (kind) => () => { setSel({ network: ni, gap }); insert(kind, at) }
    const { unfinished, canClose } = railState(ni, gap)
    const row = (label, desc, kind, keys, icon, extra) => ({ label, desc, keys, icon, run: go(kind), ...extra })
    const rows = [
      canClose ? row('Close the parallel path here', 'Join the two paths on this wire', 'closeBranch', 'Shift+F9', palIcon((l) => l.k === 'closeBranch'), { hot: true }) : null,
      row('Normally open contact', 'Passes power when the tag is ON', 'NO', 'Shift+F2', palIcon((l) => l.k === 'NO')),
      row('Normally closed contact', 'Passes power when the tag is OFF', 'NC', 'Shift+F3', palIcon((l) => l.k === 'NC')),
      row('Output coil', 'Turns the tag ON while the rung has power', 'coil', 'Shift+F7', palIcon((l) => l.coil === 'coil')),
      row('Set coil (S)', 'Switches the tag ON and keeps it ON', 'set', 'Shift+F4', palIcon((l) => l.coil === 'set')),
      row('Reset coil (R)', 'Switches the tag OFF and keeps it OFF', 'reset', 'Shift+F6', palIcon((l) => l.coil === 'reset')),
      row('On-delay timer (TON)', 'Output comes ON after the input has been ON for the set time', 'box:TON', '', palIcon((l) => l.fb === 'TON')),
      row('Up counter (CTU)', 'Counts every OFF to ON change of the input', 'box:CTU', '', palIcon((l) => l.fb === 'CTU')),
      unfinished ? null : row('Parallel path (OR)', 'Start a second path here', 'branch', 'Shift+F8', palIcon((l) => l.k === 'branch')),
      { label: 'New network below', desc: 'Add an empty rung under this one', keys: 'Ctrl+R', icon: h('span', { class: 'qm-plus' }, '+'), run: () => { setSel({ network: ni }); insertNetwork(true) } },
      { label: 'More instructions…', desc: 'Timers, counters, compare, move and more', more: true, icon: h('span', { class: 'qm-plus' }, '…') },
    ].filter(Boolean)
    const groups = PALETTE.map((g) => ({ group: g.group, items: g.items.filter((i) => i.lad).map((i) => ({ label: i.name, keys: i.short, icon: iconFor(i), run: () => { setSel({ network: ni, gap }); dropPayload(i.lad, at) } })) })).filter((g) => g.items.length)
    openQuick({ anchor, rows, groups, startMore: more, restore: () => slotFor(ni, gap)?.focus({ preventScroll: true }) })
  }
  function chooseBox() {
    const s = sel(), b = block()
    const ni = Math.min(s?.network ?? b.networks.length - 1, b.networks.length - 1); if (ni < 0) return
    openQuickAt(ni, s?.gap && s.network === ni && slotFor(ni, s.gap) ? clone(s.gap) : { path: [], index: 0 }, true)
  }
  function dropPayload(p, at) {
    if (p.coil) return insert(p.coil, at)
    if (p.k === 'box') return insert(`box:${p.fb}`, at)
    if (p.k === 'cmp') return insert(`cmp:${p.op}`, at)
    if (p.k === 'math') return insert(`math:${p.op}`, at)
    insert(p.k, at)
  }
  /* --------------------------------------------------- marquee multi-select -- */
  // Drag a box over empty rung space to select several instructions, like TIA. Selection is kept as
  // { network, paths:[key strings] }; copy / cut / delete and "branch around" all act on the whole group.
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
      for (const nd of netEl.querySelectorAll('.el.sym-el')) {
        const isCoil = nd.dataset.path.startsWith('c')
        const r = nd.getBoundingClientRect(), hit = moved && !isCoil && r.left < x2 && r.right > x1 && r.top < y2 && r.bottom > y1
        nd.classList.toggle('pre-sel', hit)
        if (hit) paths.push(nd.dataset.path)
      }
    }
    const onUp = () => {
      removeEventListener('mousemove', onMove, true); removeEventListener('mouseup', onUp, true)
      boxEl.remove(); netEl.querySelectorAll('.pre-sel').forEach((x) => x.classList.remove('pre-sel'))
      if (!moved) return   // a plain click: the network selection set by the .net handler stands
      if (paths.length > 1) setSel({ network: ni, paths })
      else if (paths.length === 1) setSel({ network: ni, path: paths[0].split('.').map(Number) })
      else setSel({ network: ni })
    }
    addEventListener('mousemove', onMove, true); addEventListener('mouseup', onUp, true)
    ev.preventDefault()
  }
  /** Shift+click an instruction to add or remove it from the selection (TIA extends a selection this way). */
  function toggleInSelection(ni, k) {
    const cur = sel()
    let paths = cur && cur.network === ni ? (cur.paths ? [...cur.paths] : (cur.path?.length % 2 ? [key(cur.path)] : [])) : []
    const i = paths.indexOf(k)
    if (i >= 0) paths.splice(i, 1); else paths.push(k)
    if (paths.length > 1) setSel({ network: ni, paths })
    else if (paths.length === 1) setSel({ network: ni, path: paths[0].split('.').map(Number) })
    else setSel({ network: ni })
  }
  function removeMany(s) {
    if (!block().networks[s.network]) return
    edit((p) => {
      const blk = p.blocks.find((x) => x.id === blockId), net = blk.networks[s.network]
      for (const kk of s.paths) { try { const { list, index } = resolve(net, kk.split('.').map(Number)); if (list[index]) list[index].__del = true } catch { /* path gone */ } }
      ;(function strip(l) { for (let i = l.length - 1; i >= 0; i--) { const e = l[i]; if (e.__del) { l.splice(i, 1); continue } if (e.branches) e.branches.forEach(strip) } })(net.elements)
      tidyBranches(net.elements)
      state.selection = { block: blockId, network: s.network }
    })
  }
  /** Wrap a contiguous group of selected instructions in a new parallel branch (empty second path to fill in). */
  function branchAround() {
    const s = sel(); if (!s?.paths?.length) return
    const arrs = s.paths.map((k) => k.split('.').map(Number)).sort((a, b) => a.at(-1) - b.at(-1))
    const parent = arrs[0].slice(0, -1), idxs = arrs.map((a) => a.at(-1))
    const sameParent = arrs.every((a) => key(a.slice(0, -1)) === key(parent))
    const contiguous = idxs.every((v, i) => i === 0 || v === idxs[i - 1] + 1)
    if (!sameParent || !contiguous) { toast('To branch around a group, select instructions that sit next to each other on the same line.'); return }
    edit((p) => {
      const blk = p.blocks.find((x) => x.id === blockId), net = blk.networks[s.network]
      let list = net.elements; for (let kk = 0; kk < parent.length; kk += 2) list = list[parent[kk]].branches[parent[kk + 1]]
      const seg = list.splice(idxs[0], idxs.length)
      list.splice(idxs[0], 0, { k: 'branch', closed: true, branches: [seg, []] })
      state.selection = { block: blockId, network: s.network, branch: [...parent, idxs[0]] }
    })
    toast('Branched around the selection. Add the alternative instructions to the empty parallel path.')
  }
  function remove() {
    const s = sel(); if (!s) return
    if (s.paths) { removeMany(s); return }
    if (s.gap) { toast('A wire is selected. Select the instruction or network you want to delete.'); return }
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
    const rung = refs.nets.get(ni)?.el
    rung?.scrollIntoView({ block: 'nearest' })
    rung?.querySelector('[data-gap]')?.focus({ preventScroll: true })
  }
  function insertNetwork(after = true, atEnd = false) {
    const n = block().networks.length, i = atEnd ? n - 1 : sel()?.network ?? n - 1
    insertNetworkAt(Math.max(0, after ? i + 1 : i))
  }
  /** Copy what is selected: one instruction (or a whole parallel branch), one coil, or else the network. */
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
  /** Like TIA, pasted timers/counters/edges get their own instances, and references inside the pasted part follow them. */
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
    if (clip.kind === 'element' || clip.kind === 'coil') {
      const ni = Math.min(s?.network ?? blk0.networks.length - 1, blk0.networks.length - 1); if (ni < 0) return
      edit((p) => {
        const blk = p.blocks.find((x) => x.id === blockId), net = blk.networks[ni], data = clone(clip.data)
        if (clip.kind === 'coil') {
          const at2 = s?.network === ni && s.coil !== undefined ? s.coil + 1 : net.coils.length
          net.coils.splice(at2, 0, data); state.selection = { block: blockId, network: ni, coil: at2 }; return
        }
        renewInstances(blk, [data])([data])
        const path = insertAtGap(net, gapOf(net, s?.network === ni ? s : null), data)
        state.selection = { block: blockId, network: ni, path }
      })
      return
    }
    if (clip.kind === 'elements') {
      const ni = Math.min(s?.network ?? blk0.networks.length - 1, blk0.networks.length - 1); if (ni < 0) return
      edit((p) => {
        const blk = p.blocks.find((x) => x.id === blockId), net = blk.networks[ni]
        let gap = gapOf(net, s?.network === ni ? s : null), last = null
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
  /** Drag an existing instruction to a new wire within the same network. Insert a copy at the target, then
   *  remove the original by identity (so index shifts and branch tidy-up cannot land it in the wrong place). */
  function moveElement(from, gap) {
    if (!block()) return
    edit((p) => {
      const blk = p.blocks.find((x) => x.id === blockId), net = blk.networks[from.network]; if (!net) return
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
    if (s.paths) { setSel({ network: s.network, path: s.paths[0].split('.').map(Number) }); return }   // arrow keys collapse a multi-selection
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
  const placeholderFor = (f) => (f.field === 'dest' ? 'tag for the result' : PLACEHOLDER[f.kind])
  function suggestionsFor(f) {
    const fits = (type) => (f.kind === 'bool' ? type === 'Bool' : f.kind === 'time' ? type === 'Time' : type !== 'Bool')
    const SECTION = { input: 'Input', output: 'Output', inout: 'InOut', static: 'Static', temp: 'Temp' }
    const names = [
      ...state.project.tags.map((t) => ({ value: t.name, type: t.type, address: t.address ?? '', comment: t.comment ?? '', source: 'PLC tag' })),
      ...Object.entries(block().interface).flatMap(([sec, vars]) => vars.map((v) => ({ value: v.name, type: v.type, init: v.init ?? '', comment: v.comment ?? '', source: `Local · ${SECTION[sec] ?? sec}` }))),
    ]
    const pins = instancesOf(block()).flatMap((i) => pinNames(i.fb).map((p) => ({ value: `${i.name}.${p.pin}`, type: { bool: 'Bool', time: 'Time' }[p.kind] ?? 'Int', comment: `${p.pin} of ${i.fb} ${i.name}`, source: 'Instance' }))).filter((o) => fits(o.type))
    const lits = f.pin && f.kind === 'bool' ? ['TRUE', 'FALSE'].map((value) => ({ value, type: 'Bool', comment: 'Constant', source: 'Constant' })) : []
    const all = [...names, ...pins, ...lits]
    return [...all.filter((o) => fits(o.type)), ...all.filter((o) => !fits(o.type)).map((o) => ({ ...o, other: true }))]
  }
  /** Why this text cannot be an operand name, or '' when it is fine (a new valid name is allowed: it can be created). */
  function nameProblem(v) {
    const cur = scope()
    if (classifyOperand(v, cur) !== 'unknown') return ''
    if (cur.instances.has(v)) return `${v} is a timer or counter in this block. Pick one of its pins, for example ${v}.${pinNames(cur.instances.get(v))[0]?.pin ?? 'Q'}.`
    return IDENT.test(v) ? '' : `"${v}" is not a valid tag name. Use letters, digits and _ only, with no spaces, and do not start with a digit.`
  }

  /* the one floating text box used for operands and instance names */
  let activeInput = null
  function openInput(span, { initial = '', placeholder = '', options = [], check, done, selectAll = true }) {
    activeInput?.cancel()
    const r = span.getBoundingClientRect()
    const input = h('input', { class: 'op-edit', value: initial, placeholder, autocomplete: 'off', spellcheck: 'false', 'aria-label': placeholder, style: { left: `${r.left - 4}px`, top: `${r.top - 2}px`, width: `${Math.max(120, r.width + 12)}px` } })
    if (!selectAll) input.dataset.typed = '1'   // seeded by type-to-edit: filter the tag list from the first keystroke
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

  /* "Tag X does not exist yet" bubble. proceed(create) runs once, after either button. */
  let bubble = null
  const closeBubble = () => bubble?.dismiss()
  function showBubble(span, name, proceed) {
    closeBubble()
    let settled = false
    const settle = (create) => { if (settled) return; settled = true; dismiss(); proceed(create) }
    const yes = h('button', { type: 'button', class: 'btn primary', onClick: () => settle(true) }, 'Create tag')
    const no = h('button', { type: 'button', class: 'btn', onClick: () => settle(false) }, 'Not now')
    const pop = h('div', { class: 'tag-bubble', role: 'alertdialog', 'aria-label': 'Tag does not exist' }, h('div', { class: 'tb-text' }, `Tag '${name}' does not exist yet.`), h('div', { class: 'tb-actions' }, yes, no))
    pop.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || /^F\d/.test(e.key)) return
      if (e.key === 'Enter') { e.preventDefault(); settle(document.activeElement !== no) }
      else if (e.key === 'Escape') { e.preventDefault(); settle(false) }
      else if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === yes ? no : yes).focus() }
    })
    const outside = (e) => { if (!pop.contains(e.target)) settle(false) }
    function dismiss() { pop.remove(); removeEventListener('mousedown', outside, true); if (bubble?.pop === pop) bubble = null }
    document.body.append(pop)
    const r = span.getBoundingClientRect()
    pop.style.left = `${Math.max(4, Math.min(r.left - 4, innerWidth - pop.offsetWidth - 4))}px`
    pop.style.top = `${r.bottom + 6 + pop.offsetHeight > innerHeight ? Math.max(4, r.top - pop.offsetHeight - 6) : r.bottom + 6}px`
    addEventListener('mousedown', outside, true)
    bubble = { pop, dismiss }
    yes.focus()
  }

  // The element may be gone (undo while editing): then the edit is dropped.
  function setField(at, f, v, newTagType) {
    if (!targetIn(state.project, at)) return false
    edit((p) => {
      const t = targetIn(p, at)
      if (f.pin) { t.args = t.args ?? {}; t.args[f.pin] = v } else t[f.field] = v
      if (newTagType) p.tags.push({ name: v, type: newTagType, address: '', comment: '' })
    }, `op:${blockId}:${at.coil !== undefined ? `c${at.coil}` : key(at.path)}:${fieldName(f)}`)   // one undo step per operand
    return true
  }
  function startEdit(at, name, seed) {
    const t = targetIn(state.project, at), f = t && operandFields(t).find((x) => fieldName(x) === name); if (!f) return
    setSel(at)
    const span = body.querySelector(`.el.sel [data-op="${name}"]`); if (!span) return
    const realInitial = valueOf(t, f)                       // the operand's current value, for change detection
    const initial = seed != null ? seed : realInitial       // what the box shows: a typed character seeds a fresh entry
    openInput(span, { initial, placeholder: placeholderFor(f), options: suggestionsFor(f), check: nameProblem, done: (v, how) => commitOperand(at, f, realInitial, v, how, span), selectAll: seed == null })
  }
  function commitOperand(at, f, initial, v, how, span) {
    const t = targetIn(state.project, at); if (!t) return
    const bad = nameProblem(v)
    if (bad) toast(bad)   // only a click-away gets here with a bad name; Enter and Tab keep the box open
    const type = suggestedTagType(t, f)
    const go = (create) => {
      if (create || v !== initial) setField(at, f, v, create && !state.project.tags.some((x) => x.name === v) && type)
      if (create) toast(`Tag ${v} created as ${type}. It has no address yet, so it is internal memory. Give it an address in the PLC tag table if it is wired to an input or output.`)
      goNext(at, fieldName(f), how)
    }
    const unknown = !bad && classifyOperand(v, scope()) === 'unknown' && how !== 'blur' && (v !== initial || how === 'enter')
    if (!unknown) { go(false); return }
    // Write the name now: the bubble only decides whether to create the tag. If the learner moves on instead
    // (Shift+F9, another wire, Esc), the bubble closes and the typed name stays on the rung.
    if (v !== initial) setField(at, f, v, false)
    const here = (at.coil !== undefined ? body.querySelector(`[data-path="c${at.coil}"] [data-op="${fieldName(f)}"]`) : body.querySelector(`.el.sel [data-op="${fieldName(f)}"]`)) ?? span
    showBubble(here.isConnected ? here : span, v, (create) => {
      if (create) setField(at, f, v, !state.project.tags.some((x) => x.name === v) && type)
      if (create) toast(`Tag ${v} created as ${type}. It has no address yet, so it is internal memory. Give it an address in the PLC tag table if it is wired to an input or output.`)
      goNext(at, fieldName(f), how)
    })
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
    openInput(span, { initial: old, placeholder: 'instance name', check: problem, done: (v) => {
      const bad = problem(v)
      if (bad) toast(bad); else if (v !== old) edit((p) => renameInstance(p.blocks.find((x) => x.id === blockId), old, v))
    } })
  }
  function edit0() {
    const s = sel(); if (!s) return
    if (s.gap) { openQuickAt(s.network, s.gap); return }
    if (s.branch) { const el = body.querySelector('.branch.sel'); if (el) { const r = el.getBoundingClientRect(); menu({ clientX: r.left, clientY: r.bottom }) } return }
    const t = targetIn(state.project, s), first = t && operandFields(t)[0]
    if (first) startEdit(atOf(s), fieldName(first))
  }

  /* ------------------------------------------------------------ rendering -- */
  const lineSvg = (w) => svg('svg', { class: 'sym', width: w, height: 26, viewBox: `0 0 ${w} 26` })
  const ln = (x1, y1, x2, y2) => svg('line', { x1, y1, x2, y2 })
  function symbol(e, kind) {
    const s = lineSvg(44)
    if (kind === 'NO' || kind === 'NC') { s.append(ln(0, 13, 14, 13), ln(14, 3, 14, 23), ln(30, 3, 30, 23), ln(30, 13, 44, 13)); if (kind === 'NC') s.append(ln(11, 21, 33, 5)) }
    else if (kind === 'P' || kind === 'N') { s.append(ln(0, 13, 10, 13), svg('rect', { x: 10, y: 3, width: 24, height: 20 }), svg('text', { x: 22, y: 18, 'text-anchor': 'middle' }, kind), ln(34, 13, 44, 13)) }
    else { // coils
      s.append(ln(0, 13, 8, 13), svg('path', { d: 'M15 3 Q7 13 15 23 M29 3 Q37 13 29 23' }), ln(36, 13, 44, 13))
      const lab = { set: 'S', reset: 'R', ncoil: '/' }[kind]; if (lab) s.append(svg('text', { x: 22, y: 18, 'text-anchor': 'middle' }, lab))
    }
    return s
  }
  const opSpan = (at, name, value, cls, fallback = '<??.?>') => {
    const unknown = classifyOperand(value, sc) === 'unknown'
    return h('span', { class: `${cls}${value ? '' : ' empty'}${unknown ? ' unknown' : ''}`, dataset: { op: name }, title: unknown ? UNKNOWN_TIP : undefined,
      // An empty operand opens on a single click (TIA invites entry straight away); a filled one needs a double-click so it is not edited by accident.
      onClick: (ev) => { if (!value && !ev.shiftKey) { ev.stopPropagation(); startEdit(at, name) } },
      onDblclick: (ev) => { ev.stopPropagation(); startEdit(at, name) } }, value || fallback)
  }
  function elementNode(e, path, ni, ctx) {
    const k = key(path), at = { network: ni, path }, op = (name, value, cls, fallback) => opSpan(at, name, value, cls, fallback)
    const node = h('div', { class: 'el sym-el', dataset: { path: k }, style: { marginTop: '21px' } })
    const onSel = (ev) => { ev.stopPropagation(); if (ev.shiftKey) toggleInSelection(ni, k); else setSel({ network: ni, path }) }
    node.addEventListener('mousedown', onSel)
    node.setAttribute('draggable', 'true')
    node.addEventListener('dragstart', (ev) => {
      ev.stopPropagation()
      moveDrag = { network: ni, path }
      setSel({ network: ni, path })
      ev.dataTransfer.effectAllowed = 'move'
      try { ev.dataTransfer.setData('application/x-plc-move', k) } catch { /* ignore */ }
      node.classList.add('moving')
    })
    node.addEventListener('dragend', () => { node.classList.remove('moving'); moveDrag = null; clearDrag() })
    if (e.k === 'NO' || e.k === 'NC' || e.k === 'P' || e.k === 'N') {
      node.append(h('span', { class: 'val' }), op('tag', e.tag, 'tagname'), symbol(e, e.k), h('span', { class: 'addr' }, addrOf(e.tag)))
      node.title = e.k === 'NO' ? 'Normally open contact' : e.k === 'NC' ? 'Normally closed contact' : e.k === 'P' ? 'Positive signal edge' : 'Negative signal edge'
    } else if (e.k === 'cmp') {
      node.style.marginTop = '21px'
      const sel2 = h('select', { class: 'in', style: { width: '50px' }, onChange: (ev) => edit((p) => { const t = targetIn(p, at); if (t) t.op = ev.target.value }, `op:${blockId}:${k}:op`) }, COMPARE.map((o) => h('option', { value: o, selected: o === e.op }, o)))
      const a = op('a', e.a, 'pv'), b = op('b', e.b, 'pv')
      node.append(h('div', { class: 'box', style: { minWidth: '84px' } }, h('div', { class: 'bh' }, 'CMP'), h('div', { class: 'pin' }, a), h('div', { class: 'bi' }, sel2), h('div', { class: 'pin' }, b)))
    } else if (e.k === 'move' || e.k === 'math') {
      // The result's live value (online) sits next to OUT.
      const pins = operandFields(e).map((f) => h('div', { class: 'pin' }, h('span', null, f.label), f.field === 'dest' ? h('span', { class: 'pin-r' }, h('span', { class: 'dval' }), op('dest', e.dest, 'pv')) : op(f.field, e[f.field], 'pv')))
      node.append(h('div', { class: 'box' }, h('div', { class: 'bh' }, e.k === 'move' ? 'MOVE' : MATH_OPS[e.op] ?? 'MATH'), ...pins))
    } else if (e.k === 'box') {
      const def = FB[e.fb]
      const pins = Object.entries(def.in).filter(([p]) => p !== def.flowIn)
      const outs = Object.keys(def.out)
      const inst = h('span', { class: 'tagname inst', title: 'Double-click to rename' }, e.inst ?? '')
      inst.addEventListener('dblclick', (ev) => { ev.stopPropagation(); editInstName(inst, at, e.inst) })
      node.append(inst, h('div', { class: 'box', 'data-flow': 'box' },
        h('div', { class: 'bh' }, def.label),
        h('div', { class: 'pin' }, h('span', null, def.flowIn), h('span', { class: 'live', dataset: { out: def.flowOut } }, def.flowOut)),
        ...pins.map(([pin, kindp], idx) => h('div', { class: 'pin' }, h('span', null, pin), op(pin, e.args?.[pin], 'pv', DEFAULT_PIN[kindp]), idx === 0 && outs[1] ? h('span', { class: 'live ov', dataset: { out: outs[1] } }, '') : null))))
      node.style.marginTop = '0'
    }
    ctx.els.set(k, node)
    node.addEventListener('contextmenu', (ev) => { ev.preventDefault(); ev.stopPropagation(); const cur = sel(); if (!(cur?.paths && cur.paths.includes(k))) setSel({ network: ni, path }); menu(ev) })
    return node
  }
  function wire(flowKey, ctx, grow = false, gap = null, empty = false) {
    const label = 'Add an instruction here'
    const plus = gap ? h('button', { type: 'button', class: empty ? 'gap-plus pill' : 'gap-plus', tabindex: '-1', 'aria-label': label, title: label, onClick: (e) => { e.stopPropagation(); openQuickAt(ctx.ni, gap) } }, empty ? '+ Add instruction' : '+') : null
    // While a parallel path is open, the wires where it may join are marked (green, wider) so they are easy to hit.
    const join = !!(gap && ctx.join && canDropBranchEnd(ctx.net, ctx.join, gap))
    if (join && plus) plus.title = 'Join the parallel path here (or add an instruction)'
    const w = h('div', { class: `wire${grow ? ' grow' : ''}${gap ? ' wire-slot' : ''}${empty ? ' empty-slot' : ''}${join ? ' join-target' : ''}`, style: { marginTop: '49px' }, ...(gap ? { role: 'group', tabindex: '0', 'aria-label': label, title: join ? 'Join the parallel path here' : label, dataset: { gap: JSON.stringify(gap) } } : {}) }, plus)
    if (gap) {
      const selectGap = e => { e.stopPropagation(); setSel({ network: ctx.ni, gap }) }
      w.addEventListener('mousedown', selectGap)
      w.addEventListener('focus', () => setSel({ network: ctx.ni, gap }))
      w.addEventListener('keydown', (e) => { if (e.key === ' ' && e.target === w) { e.preventDefault(); openQuickAt(ctx.ni, gap) } })
      w.addEventListener('contextmenu', e => { e.preventDefault(); selectGap(e); menu(e) })
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
      'aria-label': 'Join the parallel path', title: 'Drag this to a highlighted wire to join the two paths',
      onMousedown: ev => ev.stopPropagation(),
      onClick: () => setSel({ network: ni, gap: { path: lanePath, index: count } }),
    }, 'Drag to join')
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
    const node = h('div', { class: 'el sym-el', dataset: { path: `c${i}` }, style: { marginTop: '21px' } })
    node.append(opSpan({ network: ni, coil: i }, 'tag', c.tag, 'tagname'), symbol(c, c.k), h('span', { class: 'addr' }, addrOf(c.tag)))
    node.addEventListener('mousedown', (ev) => { ev.stopPropagation(); setSel({ network: ni, coil: i }) })
    node.addEventListener('contextmenu', (ev) => { ev.preventDefault(); ev.stopPropagation(); setSel({ network: ni, coil: i }); menu(ev) })
    ctx.els.set(`c${i}`, node)
    node.title = { coil: 'Output coil', ncoil: 'Negated output', set: 'Set output', reset: 'Reset output' }[c.k]
    return node
  }
  function nearestSlot(netEl, ev, only = '') {
    let best = null, bd = Infinity
    for (const slot of netEl.querySelectorAll(`.wire-slot${only}`)) {
      if (!slot.querySelector(':scope > .gap-plus')) continue
      const r = slot.getBoundingClientRect(), d = Math.hypot(Math.max(r.left - ev.clientX, 0, ev.clientX - r.right), ev.clientY - r.top)
      if (d < bd) { bd = d; best = slot }
    }
    return best
  }
  function clearDrag() { setNear(null); root.classList.remove('dragging'); root.querySelectorAll('.out-col.drop-over').forEach((x) => x.classList.remove('drop-over')) }
  const onDragStart = (e) => { try { palDrag = e.target.closest?.('.pal-item, .fav') ?JSON.parse(e.dataTransfer.getData('text/plain')) : null } catch { palDrag = null } }
  const onDragEnd = () => { palDrag = null; moveDrag = null; clearDrag() }
  function network(net, ni) {
    const ctx = { wires: [], els: new Map(), ni, net, join: openBranches(net).at(-1) }
    const body2 = h('div', { class: 'net-body' })
    const main = series(net.elements, [], ni, ctx, 'S', true)
    body2.append(h('div', { class: 'rail' }), main)
    const coils = h('div', { class: 'coils', style: { position: 'relative' } })
    if (net.coils.length) {
      net.coils.forEach((c, i) => {
        const cls = net.coils.length === 1 ? 'first last' : i === 0 ? 'first' : i === net.coils.length - 1 ? 'last' : 'mid'
        const lane = h('div', { class: `coilrow lane ${cls}`, style: { position: 'relative', paddingBottom: '8px' } }, h('div', { class: 'lbar l', dataset: { f: 'OUT' } }), wire('OUT', ctx), coilNode(c, i, ni, ctx), wire(`k${i}`, ctx))
        coils.append(lane)
      })
    }
    else coils.append(h('div', { class: 'coilrow ghost-row' }, h('div', { class: 'wire', style: { marginTop: '49px' } }), h('button', { type: 'button', class: 'ghost-coil', title: 'Add an output coil', 'aria-label': 'Add output', onClick: () => insert('coil', { network: ni }) }, h('span', { class: 'gname' }, 'Add output'), symbol(null, 'coil')), h('div', { class: 'wire', style: { marginTop: '49px' } })))
    if (net.coils.length) coils.append(h('div', { class: 'coil-add' }, h('button', { type: 'button', class: 'gap-plus coil-plus', tabindex: '-1', title: 'Add another output', 'aria-label': 'Add another output', onClick: (e) => { e.stopPropagation(); insert('coil', { network: ni, coil: net.coils.length - 1 }) } }, '+')))
    const outCol = h('div', { class: 'out-col' }, coils, h('div', { class: 'end' }))
    body2.append(outCol)
    const scroller = h('div', { class: 'net-scroll' }, body2,
      h('button', { type: 'button', class: 'scroll-btn l', tabindex: '-1', 'aria-label': 'Scroll left', title: 'Scroll left', onClick: () => body2.scrollBy({ left: -300, behavior: 'smooth' }) }, '‹'),
      h('button', { type: 'button', class: 'scroll-btn r', tabindex: '-1', 'aria-label': 'Scroll right', title: 'Scroll right', onClick: () => body2.scrollBy({ left: 300, behavior: 'smooth' }) }, '›'))
    trackScroll(scroller, body2, outCol, main)
    const collapsed = net.collapsed
    const title = h('input', { class: 'ntitle', value: net.title ?? '', placeholder: 'Title…', onInput: (ev) => edit((p) => { p.blocks.find((x) => x.id === blockId).networks[ni].title = ev.target.value }, `nt:${net.id}`), onMousedown: (ev) => ev.stopPropagation() })
    const comment = h('input', { class: 'net-comment', value: net.comment ?? '', placeholder: 'Comment…', onInput: (ev) => edit((p) => { p.blocks.find((x) => x.id === blockId).networks[ni].comment = ev.target.value }, `nc:${net.id}`), onMousedown: (ev) => ev.stopPropagation() })
    const issues = validateLadderNetwork(net), open = openBranches(net).length > 0
    const el = h('div', { class: `net${issues.length ? ' unfinished' : ''}`, dataset: { ni } },
      h('div', { class: 'net-head' }, h('span', { class: 'tw', onClick: () => edit((p) => { const n = p.blocks.find((x) => x.id === blockId).networks[ni]; n.collapsed = !n.collapsed }) }, collapsed ? '▶' : '▼'), `Network ${ni + 1}:`, title,
        h('button', { type: 'button', class: 'rung-add', title: 'Insert a blank network below this one', onMousedown: e => e.stopPropagation(), onClick: () => { setSel({ network: ni }); insertNetwork(true) } }, 'Insert network')),
      issues.length ? h('div', { class: 'rung-warning', role: 'status' }, issues.map(i => h('div', null, i.message))) : null,
      collapsed ? null : [comment, scroller,
        net.elements.length > 10 ? h('div', { class: 'rung-tip' }, 'Tip: long rungs are hard to read. Split the logic over two networks with a memory bit.') : null,
        open ? h('div', { class: 'branch-actions' }, h('span', null, 'This parallel path is not joined yet. Drag its end towards a green wire (it snaps to the nearest one), or click a green + and close it there.'), h('button', { type: 'button', class: 'btn', onMousedown: e => e.stopPropagation(), onClick: () => { if (sel()?.network !== ni) setSel({ network: ni }); insert('closeBranch') } }, 'Close the parallel path · Shift+F9')) : null])
    el.addEventListener('mousedown', () => setSel({ network: ni }))
    body2.addEventListener('mousedown', (ev) => { if (ev.button === 0 && ev.target.closest('.net-body') === body2 && !ev.target.closest('.el, .wire-slot, .gap-plus, .branch, .branch-end, .lbar, input, select, button, textarea')) startMarquee(ev, ni) })
    el.addEventListener('contextmenu', (ev) => { ev.preventDefault(); if (sel()?.network !== ni && !sel()?.paths) setSel({ network: ni }); menu(ev) })
    el.addEventListener('dragover', (ev) => {
      if (branchDrag) {
        // Snap to the nearest wire where the path may join, wherever the pointer is in this network.
        const slot = branchDrag.network === ni ? nearestSlot(el, ev, '.join-target') : null
        el.querySelectorAll('.join-near').forEach((x) => x !== slot && x.classList.remove('join-near'))
        if (slot) { slot.classList.add('join-near'); ev.preventDefault(); ev.dataTransfer.dropEffect = 'link' }
        return
      }
      if (moveDrag && moveDrag.network !== ni) { ev.dataTransfer.dropEffect = 'none'; return }   // moves stay in one network
      ev.preventDefault()
      // A coil lands in the output column; everything else on the wire nearest the pointer.
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
      try {
        const p = JSON.parse(ev.dataTransfer.getData('text/plain')); if (!p.lad) return
        const slot = nearestSlot(el, ev)
        dropPayload(p.lad, { network: ni, ...(slot && !p.lad.coil ? { gap: JSON.parse(slot.dataset.gap) } : {}) })
      } catch { /* not ours */ }
    })
    refs.nets.set(ni, { el, ctx })
    return el
  }

  function menu(ev) {
    const s = sel(), ni = s?.network, st = block().networks[ni] ? railState(ni, s.gap) : { unfinished: false, canClose: false }, inBranch = !!containingBranch(s)
    const ins = (label, kind, keys) => ({ label, keys, run: () => insert(kind) })
    if (s?.paths) {   // a multi-selection: offer only the group actions
      contextMenu(ev.clientX, ev.clientY, [
        { label: `Open parallel branch around selection (${s.paths.length})`, run: branchAround },
        '-', { label: `Copy (${s.paths.length})`, keys: 'Ctrl+C', run: copy }, { label: `Cut (${s.paths.length})`, keys: 'Ctrl+X', run: cut },
        '-', { label: `Delete (${s.paths.length})`, keys: 'Delete', run: remove },
      ])
      return
    }
    const paths = [st.unfinished ? null : ins('Start a parallel path (OR)', 'branch', 'Shift+F8'), inBranch ? ins('Add another parallel path', 'addPath') : null, inBranch ? ins('Remove parallel path (keep the top path)', 'removeBranch') : null].filter(Boolean)
    contextMenu(ev.clientX, ev.clientY, [
      st.canClose ? ins('Close the parallel path here', 'closeBranch', 'Shift+F9') : null,
      ins('Insert normally open contact', 'NO', 'Shift+F2'), ins('Insert normally closed contact', 'NC', 'Shift+F3'), ins('Insert output coil', 'coil', 'Shift+F7'),
      ins('Insert set coil (S)', 'set', 'Shift+F4'), ins('Insert reset coil (R)', 'reset', 'Shift+F6'), ins('Insert on-delay timer (TON)', 'box:TON'), ins('Insert up counter (CTU)', 'box:CTU'), ins('Insert comparison', 'cmp', 'Shift+F10'),
      { label: 'More instructions…', keys: 'Shift+F5', run: chooseBox },
      ...(paths.length ? ['-', ...paths] : []),
      '-', { label: 'Insert network below', keys: 'Ctrl+R', run: () => insertNetwork(true) }, { label: 'Insert network above', run: () => insertNetwork(false) },
      '-', { label: 'Cut', keys: 'Ctrl+X', run: cut }, { label: 'Copy', keys: 'Ctrl+C', run: copy }, { label: { network: 'Paste network', element: 'Paste instruction', coil: 'Paste coil' }[state.clipboard?.kind] ?? 'Paste', keys: 'Ctrl+V', run: paste, disabled: !['network', 'element', 'coil'].includes(state.clipboard?.kind) },
      '-', { label: 'Delete', keys: 'Delete', run: remove },
    ].filter(Boolean))
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
        map.set(k, flow)
      } else map.set(k, undefined)
    })
    return flow
  }
  function paint() {
    if (!block()) return
    const live = isOnline() && state.monitor !== false
    for (const [ni, { el, ctx }] of refs.nets) {
      const complete = live && !validateLadderNetwork(block().networks[ni]).length
      el.classList.toggle('mon', complete)
      if (!complete) { for (const w of ctx.wires) w.el.classList.remove('t', 'f'); for (const n of ctx.els.values()) { n.classList.remove('t', 'f'); n.querySelector('.val')?.replaceChildren(); n.querySelectorAll('.live.ov, .dval').forEach((x) => { x.textContent = '' }) } el.querySelectorAll('.lbar').forEach((x) => x.classList.remove('t')); continue }
      const net = block().networks[ni], map = new Map()
      const out = evalSeries(net.elements, [], true, map)
      map.set('S', true); map.set('OUT', out)
      net.coils.forEach((c, i) => { const v = out === true ? (c.k === 'ncoil' ? false : c.k === 'set' || c.k === 'reset' ? undefined : true) : (c.k === 'ncoil' ? true : false); map.set(`k${i}`, c.k === 'set' || c.k === 'reset' ? out : v === undefined ? out : c.k === 'ncoil' ? !out : out) })
      for (const w of ctx.wires) { const v = map.get(w.key); w.el.classList.toggle('t', v === true); w.el.classList.toggle('f', v === false) }
      el.querySelectorAll('.lbar').forEach((b) => { const v = map.get(b.dataset.f); b.classList.toggle('t', v === true) })
      const walk = (list, base) => list.forEach((e, i) => {
        const p = [...base, i], n = ctx.els.get(key(p))
        if (e.k === 'branch') e.branches.forEach((l, li) => walk(l, [...p, li]))
        else if (n) {
          const v = map.get(key(p))
          n.classList.toggle('t', v === true); n.classList.toggle('f', v !== true)
          if (e.k === 'box') { const def = FB[e.fb]; n.querySelectorAll('.live').forEach((sp) => { const pin = sp.dataset.out; const x = val(`${e.inst}.${pin}`); sp.textContent = sp.classList.contains('ov') ? `${pin}=${fmt(x)}` : `${pin}${typeof x === 'boolean' ? (x ? ' ■' : ' □') : ''}`; void def }) }
          if (['NO', 'NC', 'P', 'N'].includes(e.k)) n.querySelector('.val').textContent = ''
          if (e.k === 'move' || e.k === 'math') { const x = val(e.dest); n.querySelector('.dval').textContent = x === undefined ? '' : `= ${x}` }
        }
      })
      walk(net.elements, [])
      net.coils.forEach((c, i) => { const n = ctx.els.get(`c${i}`); if (!n) return; const x = val(c.tag); n.classList.toggle('t', x === true); n.classList.toggle('f', x === false) })
    }
  }
  const fmt = (x) => (typeof x === 'number' && x > 1e6 ? `${(x / 1e6).toFixed(0)}ms` : x)

  /* -------------------------------------------------------------- render -- */
  function render() {
    const b = block(); if (!b) return
    const scroll = body.scrollTop, hscroll = new Map([...refs.nets].map(([i, r]) => [i, r.el.querySelector('.net-body')?.scrollLeft ?? 0]))
    closeQuick(); closeBubble(); activeInput?.cancel(); ro.disconnect(); sc = scope()
    root.replaceChildren()
    refs.nets.clear()
    b.networks.forEach((n, i) => root.append(netGap(i), network(n, i)))
    root.append(h('button', { type: 'button', class: 'add-network', onClick: () => insertNetwork(true, true) }, 'Add network at end'), h('div', { class: 'insert-hint' }, 'Move the mouse along a rung and click + to add an instruction.'))
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
    if (s.gap) for (const wire of r.el.querySelectorAll('[data-gap]')) wire.classList.toggle('sel', wire.dataset.gap === JSON.stringify(s.gap))
    if (s.branch) for (const branch of r.el.querySelectorAll('.branch')) branch.classList.toggle('sel', branch.dataset.path === key(s.branch))
    const plus = s.gap ? r.el.querySelector('.wire-slot.sel > .gap-plus') : null
    ;(el ?? plus)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    if (pendingEdit) { pendingEdit = false; setTimeout(edit0, 20) }
  }

  const offs = [
    on('project', (e) => { if (!block()) return; if (e?.reason === 'edit' && document.querySelector('.op-edit')) return; if (e?.reason === 'undo') state.selection = { block: blockId, network: Math.max(0, Math.min(sel()?.network ?? 0, block().networks.length - 1)) }; render() }),
    on('selection', () => applySelection()),
    on('tick', () => paint()),
    on('online', () => paint()),
  ]
  // Type-to-edit (TIA): with an instruction selected, a printable key opens its first operand box seeded with that key.
  function typeInto(ch) {
    const s = sel(); if (!s || s.gap || s.branch || s.paths) return false
    const t = targetIn(state.project, s); if (!t) return false
    const f = operandFields(t)[0]; if (!f) return false
    startEdit(atOf(s), fieldName(f), ch)
    return !!activeInput
  }
  editor.api = { drop: (pl) => pl.lad && dropPayload(pl.lad), insert, remove, insertNetwork, copy, paste, cut, edit: edit0, move, type: typeInto, zoom: (d) => { zoom = Math.round(Math.max(0.6, Math.min(1.6, zoom + d)) * 10) / 10; root.style.zoom = zoom }, escape: () => { activeInput?.cancel(); closeBubble(); setSel(null) } }
  root.addEventListener('mousemove', (ev) => { lastMove = ev; if (!probeRaf) probeRaf = requestAnimationFrame(() => { probeRaf = 0; probe(lastMove) }) })
  root.addEventListener('mouseleave', () => setNear(null))
  host.addEventListener('dragover', (e) => e.preventDefault())
  addEventListener('dragstart', onDragStart); addEventListener('dragend', onDragEnd)
  render()
  if (!sel() && block().networks.length) select({ block: blockId, network: 0 })
  return { dispose() { offs.forEach((f) => f()); ro.disconnect(); closeQuick(); closeBubble(); activeInput?.cancel(); removeEventListener('dragstart', onDragStart); removeEventListener('dragend', onDragEnd); if (editor.api && host.contains(root)) editor.api = null }, focus() { render() } }
}
