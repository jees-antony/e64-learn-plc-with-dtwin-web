// Ladder (LAD) editor. Networks of series elements, parallel branches, instruction boxes and coils.
// Mouse: click to select, double-click an operand to edit, drag instructions from the task card,
// right-click for the context menu, Ctrl+wheel to zoom. Keys come from commands.js.
import { COMPARE, DEFAULT_PIN, FB } from '../../core/catalog.js'
import { newNetwork, uid } from '../../core/model.js'
import { contextMenu, h, svg } from '../dom.js'
import { editor } from '../commands.js'
import { isOnline, readOperand } from '../online.js'
import { PALETTE } from '../palette.js'
import { blockById, edit, emit, on, select, state } from '../store.js'

const key = (p) => p.join('.')
const clone = (x) => JSON.parse(JSON.stringify(x))

export function resolve(net, path) {
  let list = net.elements
  const n = path.length, pairs = n % 2 ? n - 1 : n
  for (let k = 0; k < pairs; k += 2) list = list[path[k]].branches[path[k + 1]]
  return n % 2 ? { list, index: path[n - 1] } : { list, index: list.length - 1 }
}
/** All element paths of a network in reading order (left to right, lanes top to bottom). */
function flatten(list, base = [], out = []) {
  list.forEach((e, i) => {
    const p = [...base, i]
    if (e.k === 'branch') e.branches.forEach((lane, li) => flatten(lane, [...p, li], out))
    else out.push(p)
  })
  return out
}

export function mountLadder(host, tab) {
  const blockId = tab.id
  const block = () => blockById(blockId)
  let zoom = 1, pendingEdit = false
  const root = h('div', { class: 'lad', tabindex: '-1' })
  host.append(h('div', { class: 'ed-body', style: { background: '#eef1f4' } }, root))
  const body = host.lastChild
  const refs = { nets: new Map() }   // network index -> { el, wires:[{el,key}], els:Map(key->el), vals:[...] }

  const sel = () => (state.selection?.block === blockId ? state.selection : null)
  const setSel = (s) => { select(s ? { block: blockId, ...s } : null) }
  const addrOf = (name) => state.project.tags.find((t) => t.name === name)?.address ?? ''
  const tagOptions = () => [...state.project.tags.map((t) => t.name), ...Object.values(block().interface).flat().map((v) => v.name)]

  /* ------------------------------------------------------------- editing -- */
  const nameFor = (fb) => { const used = new Set(); (block().networks ?? []).forEach((n) => (function walk(l) { l.forEach((e) => { if (e.inst) used.add(e.inst); e.branches?.forEach(walk) }) })(n.elements)); let i = 1; while (used.has(`${fb}_${i}`)) i++; return `${fb}_${i}` }
  function make(kind) {
    if (kind === 'NO' || kind === 'NC') return { k: kind, tag: '' }
    if (kind === 'P' || kind === 'N') return { k: kind, tag: '', inst: `${kind}_${uid('').slice(-4)}` }
    if (kind === 'cmp') return { k: 'cmp', op: '==', a: '', b: '' }
    if (kind === 'move') return { k: 'move', src: '', dest: '' }
    if (kind === 'branch') return { k: 'branch', branches: [[], []] }
    if (kind.startsWith('box:')) { const fb = kind.slice(4); return { k: 'box', fb, inst: nameFor(fb), args: {} } }
    return null
  }

  function insert(kind, at) {
    const b = block(); if (!b) return
    if (kind === 'box?') { chooseBox(); return }
    edit((p) => {
      const blk = p.blocks.find((x) => x.id === blockId)
      let s = at ?? sel()
      if (!blk.networks.length) blk.networks.push(newNetwork('LAD'))
      let ni = s?.network ?? blk.networks.length - 1
      ni = Math.min(ni, blk.networks.length - 1)
      const net = blk.networks[ni]
      if (['coil', 'ncoil', 'set', 'reset'].includes(kind)) {
        const at2 = s?.coil !== undefined ? s.coil + 1 : net.coils.length
        net.coils.splice(at2, 0, { k: kind, tag: '' })
        pendingEdit = true
        state.selection = { block: blockId, network: ni, coil: at2 }
        return
      }
      if (kind === 'branch') {
        if (s?.path?.length && s.path.length % 2) {
          const { list, index } = resolve(net, s.path)
          list[index] = { k: 'branch', branches: [[list[index]], []] }
          state.selection = { block: blockId, network: ni, path: [...s.path.slice(0, -1), index, 1] }
        } else { net.elements.push({ k: 'branch', branches: [[], []] }); state.selection = { block: blockId, network: ni, path: [net.elements.length - 1, 0] } }
        return
      }
      const el = make(kind); if (!el) return
      let list, index
      if (s?.path?.length) ({ list, index } = resolve(net, s.path)); else { list = net.elements; index = list.length - 1 }
      const pos = s?.path?.length && s.path.length % 2 === 0 ? list.length : index + 1
      list.splice(pos, 0, el)
      const base = s?.path?.length ? (s.path.length % 2 ? s.path.slice(0, -1) : [...s.path]) : []
      pendingEdit = true
      state.selection = { block: blockId, network: ni, path: [...base, pos] }
    })
  }
  function chooseBox() {
    const r = host.getBoundingClientRect()
    const items = PALETTE.flatMap((g) => g.items.filter((i) => i.lad).map((i) => ({ label: `${g.group}  ›  ${i.name}`, run: () => dropPayload(i.lad) })))
    contextMenu(r.left + 80, r.top + 80, items.slice(0, 24))
  }
  function dropPayload(p, at) {
    if (p.coil) return insert(p.coil, at)
    if (p.k === 'box') return insert(`box:${p.fb}`, at)
    if (p.k === 'cmp') { insert('cmp', at); const s = state.selection; edit((pr) => { const { list, index } = resolve(pr.blocks.find((x) => x.id === blockId).networks[s.network], s.path); list[index].op = p.op }); return }
    insert(p.k, at)
  }
  function remove() {
    const s = sel(); if (!s) return
    edit((p) => {
      const blk = p.blocks.find((x) => x.id === blockId), net = blk.networks[s.network]
      if (s.coil !== undefined) { net.coils.splice(s.coil, 1); state.selection = { block: blockId, network: s.network }; return }
      if (s.path?.length) {
        const { list, index } = resolve(net, s.path)
        if (s.path.length % 2) {
          list.splice(index, 1)
          // collapse a branch that lost all lanes' content
          const tidy = (l) => { for (let i = l.length - 1; i >= 0; i--) { const e = l[i]; if (e.k === 'branch') { e.branches.forEach(tidy); if (e.branches.every((b) => !b.length)) l.splice(i, 1); else if (e.branches.length === 1) l.splice(i, 1, ...e.branches[0]) } } }
          tidy(net.elements)
          state.selection = { block: blockId, network: s.network }
        }
        return
      }
      blk.networks.splice(s.network, 1)
      if (!blk.networks.length) blk.networks.push(newNetwork('LAD'))
      state.selection = { block: blockId, network: Math.max(0, s.network - 1) }
    })
  }
  function insertNetwork(after = true) {
    edit((p) => {
      const blk = p.blocks.find((x) => x.id === blockId)
      const i = sel()?.network ?? blk.networks.length - 1
      blk.networks.splice(after ? i + 1 : i, 0, newNetwork('LAD'))
      state.selection = { block: blockId, network: after ? i + 1 : i }
    })
  }
  const copy = () => { const s = sel(); if (s) state.clipboard = { kind: 'network', data: clone(block().networks[s.network]) } }
  function paste() {
    if (state.clipboard?.kind !== 'network') return
    edit((p) => {
      const blk = p.blocks.find((x) => x.id === blockId), i = sel()?.network ?? blk.networks.length - 1
      const n = clone(state.clipboard.data); n.id = uid('n')
      blk.networks.splice(i + 1, 0, n)
      state.selection = { block: blockId, network: i + 1 }
    })
  }
  function move(dir) {
    const b = block(), s = sel(); if (!s) { if (b.networks.length) setSel({ network: 0 }); return }
    const nets = b.networks
    if (dir === 'up' || dir === 'down') { const n = s.network + (dir === 'down' ? 1 : -1); if (n >= 0 && n < nets.length) setSel({ network: n }); return }
    const net = nets[s.network], flat = flatten(net.elements).map((p) => ({ path: p })).concat(net.coils.map((_, i) => ({ coil: i })))
    const cur = flat.findIndex((f) => (s.coil !== undefined ? f.coil === s.coil : s.path && f.path && key(f.path) === key(s.path)))
    const next = flat[cur < 0 ? 0 : Math.max(0, Math.min(flat.length - 1, cur + (dir === 'right' ? 1 : -1)))]
    if (next) setSel({ network: s.network, ...next })
  }

  /* ------------------------------------------------------ operand editing -- */
  function editOperand(span, apply, initial) {
    const r = span.getBoundingClientRect()
    document.querySelector('.op-edit')?.remove()
    const id = `dl${uid('')}`
    const input = h('input', { class: 'op-edit', value: initial ?? '', list: id, style: { left: `${r.left - 4}px`, top: `${r.top - 2}px`, width: `${Math.max(96, r.width + 12)}px` } })
    const dl = h('datalist', { id }, tagOptions().map((n) => h('option', { value: n })))
    document.body.append(dl, input); input.focus(); input.select()
    let done = false
    const finish = (commit, next) => {
      if (done) return; done = true
      const v = input.value.trim(); input.remove(); dl.remove()
      if (commit) apply(v)
      if (next) setTimeout(() => { move('right'); setTimeout(edit0, 30) }, 30)
    }
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true) } else if (e.key === 'Escape') { e.preventDefault(); finish(false) } else if (e.key === 'Tab') { e.preventDefault(); finish(true, true) } e.stopPropagation() })
    input.addEventListener('blur', () => finish(true))
  }
  const setField = (s, field, v, pin) => edit((p) => {
    const net = p.blocks.find((x) => x.id === blockId).networks[s.network]
    const target = s.coil !== undefined ? net.coils[s.coil] : resolve(net, s.path).list[resolve(net, s.path).index]
    if (pin) { target.args = target.args ?? {}; target.args[pin] = v } else target[field] = v
  }, `op:${blockId}`)
  function edit0() {
    const s = sel(); if (!s) return
    const spans = body.querySelectorAll('.el.sel .tagname, .el.sel .pv')
    const first = spans[0]; if (!first) return
    const net = block().networks[s.network]
    const t = s.coil !== undefined ? net.coils[s.coil] : resolve(net, s.path).list[resolve(net, s.path).index]
    if (t.k === 'move') { editOperand(spans[0], (v) => setField(s, 'src', v), t.src); return }
    if (t.k === 'cmp') { editOperand(spans[0], (v) => setField(s, 'a', v), t.a); return }
    if (t.k === 'box') { const pin = Object.keys(FB[t.fb].in).find((p) => p !== FB[t.fb].flowIn); if (pin) editOperand(body.querySelector('.el.sel .pv') ?? first, (v) => setField(s, '', v, pin), t.args?.[pin]); return }
    editOperand(first, (v) => setField(s, 'tag', v), t.tag)
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
  function elementNode(e, path, ni, ctx) {
    const k = key(path)
    const node = h('div', { class: 'el sym-el', dataset: { path: k }, style: { marginTop: '21px' } })
    const onSel = (ev) => { ev.stopPropagation(); setSel({ network: ni, path }) }
    node.addEventListener('mousedown', onSel)
    const tagSpan = (value, apply) => { const sp = h('span', { class: `tagname${value ? '' : ' empty'}`, onDblclick: (ev) => { ev.stopPropagation(); setSel({ network: ni, path }); editOperand(sp, apply, value) } }, value || '<??.?>'); return sp }
    if (e.k === 'NO' || e.k === 'NC' || e.k === 'P' || e.k === 'N') {
      node.append(h('span', { class: 'val' }), tagSpan(e.tag, (v) => setField({ network: ni, path }, 'tag', v)), symbol(e, e.k), h('span', { class: 'addr' }, addrOf(e.tag)))
      node.title = e.k === 'NO' ? 'Normally open contact' : e.k === 'NC' ? 'Normally closed contact' : e.k === 'P' ? 'Positive signal edge' : 'Negative signal edge'
    } else if (e.k === 'cmp') {
      node.style.marginTop = '21px'
      const sel2 = h('select', { class: 'in', style: { width: '50px' }, onChange: (ev) => setField({ network: ni, path }, 'op', ev.target.value) }, COMPARE.map((o) => h('option', { value: o, selected: o === e.op }, o)))
      const a = h('span', { class: `pv${e.a ? '' : ' empty'}`, onDblclick: (ev) => { ev.stopPropagation(); setSel({ network: ni, path }); editOperand(a, (v) => setField({ network: ni, path }, 'a', v), e.a) } }, e.a || '<??.?>')
      const b = h('span', { class: `pv${e.b ? '' : ' empty'}`, onDblclick: (ev) => { ev.stopPropagation(); setSel({ network: ni, path }); editOperand(b, (v) => setField({ network: ni, path }, 'b', v), e.b) } }, e.b || '<??.?>')
      node.append(h('div', { class: 'box', style: { minWidth: '84px' } }, h('div', { class: 'bh' }, 'CMP'), h('div', { class: 'pin' }, a), h('div', { class: 'bi' }, sel2), h('div', { class: 'pin' }, b)))
    } else if (e.k === 'move') {
      const f = (field) => { const sp = h('span', { class: `pv${e[field] ? '' : ' empty'}`, onDblclick: (ev) => { ev.stopPropagation(); setSel({ network: ni, path }); editOperand(sp, (v) => setField({ network: ni, path }, field, v), e[field]) } }, e[field] || '<??.?>'); return sp }
      node.append(h('div', { class: 'box' }, h('div', { class: 'bh' }, 'MOVE'), h('div', { class: 'pin' }, h('span', null, 'IN'), f('src')), h('div', { class: 'pin' }, h('span', null, 'OUT'), f('dest'))))
    } else if (e.k === 'box') {
      const def = FB[e.fb]
      const pins = Object.entries(def.in).filter(([p]) => p !== def.flowIn)
      const outs = Object.keys(def.out)
      node.append(h('span', { class: 'tagname' }, e.inst ?? ''), h('div', { class: 'box', 'data-flow': 'box' },
        h('div', { class: 'bh' }, def.label),
        h('div', { class: 'pin' }, h('span', null, def.flowIn), h('span', { class: 'live', dataset: { out: def.flowOut } }, def.flowOut)),
        ...pins.map(([pin, kindp], idx) => { const v = e.args?.[pin]; const sp = h('span', { class: `pv${v ? '' : ' empty'}`, onDblclick: (ev) => { ev.stopPropagation(); setSel({ network: ni, path }); editOperand(sp, (val) => setField({ network: ni, path }, '', val, pin), v) } }, v || DEFAULT_PIN[kindp]); return h('div', { class: 'pin' }, h('span', null, pin), sp, idx === 0 && outs[1] ? h('span', { class: 'live ov', dataset: { out: outs[1] } }, '') : null) })))
      node.style.marginTop = '0'
    }
    ctx.els.set(k, node)
    node.addEventListener('contextmenu', (ev) => { ev.preventDefault(); onSel(ev); menu(ev) })
    return node
  }
  function wire(flowKey, ctx, grow = false) { const w = h('div', { class: `wire${grow ? ' grow' : ''}`, style: { marginTop: '49px' } }); ctx.wires.push({ el: w, key: flowKey }); return w }
  function series(list, base, ni, ctx, startKey) {
    const row = h('div', { class: 'series' })
    row.append(wire(startKey, ctx))
    list.forEach((e, i) => {
      const path = [...base, i]
      if (e.k === 'branch') row.append(branchNode(e, path, ni, ctx), wire(key(path), ctx))
      else row.append(elementNode(e, path, ni, ctx), wire(key(path), ctx))
    })
    return row
  }
  function branchNode(e, path, ni, ctx) {
    const wrap = h('div', { class: 'branch', dataset: { path: key(path) } })
    e.branches.forEach((lane, li) => {
      const lp = [...path, li], cls = e.branches.length === 1 ? 'first last' : li === 0 ? 'first' : li === e.branches.length - 1 ? 'last' : 'mid'
      const laneEl = h('div', { class: `lane ${cls}`, style: { position: 'relative', paddingBottom: '8px' }, dataset: { path: key(lp) } })
      const startKey = `L${key(path)}`
      const inner = series(lane, lp, ni, ctx, startKey)
      if (!lane.length) inner.append(h('div', { class: 'wire', style: { width: '40px' } }))
      laneEl.append(h('div', { class: 'lbar l', dataset: { f: startKey } }), inner, h('div', { class: 'lbar r', dataset: { f: `R${key(lp)}` } }))
      laneEl.addEventListener('mousedown', (ev) => { if (ev.target === laneEl || ev.target.classList.contains('wire')) { ev.stopPropagation(); setSel({ network: ni, path: lp }) } })
      wrap.append(laneEl)
    })
    return wrap
  }
  function coilNode(c, i, ni, ctx) {
    const node = h('div', { class: 'el sym-el', dataset: { path: `c${i}` }, style: { marginTop: '21px' } })
    const sp = h('span', { class: `tagname${c.tag ? '' : ' empty'}`, onDblclick: (ev) => { ev.stopPropagation(); setSel({ network: ni, coil: i }); editOperand(sp, (v) => setField({ network: ni, coil: i }, 'tag', v), c.tag) } }, c.tag || '<??.?>')
    node.append(sp, symbol(c, c.k), h('span', { class: 'addr' }, addrOf(c.tag)))
    node.addEventListener('mousedown', (ev) => { ev.stopPropagation(); setSel({ network: ni, coil: i }) })
    node.addEventListener('contextmenu', (ev) => { ev.preventDefault(); ev.stopPropagation(); setSel({ network: ni, coil: i }); menu(ev) })
    ctx.els.set(`c${i}`, node)
    node.title = { coil: 'Output coil', ncoil: 'Negated output', set: 'Set output', reset: 'Reset output' }[c.k]
    return node
  }
  function network(net, ni) {
    const ctx = { wires: [], els: new Map(), ni }
    const body2 = h('div', { class: 'net-body' })
    const main = series(net.elements, [], ni, ctx, 'S')
    body2.append(h('div', { class: 'rail' }), main, wire('OUT', ctx, true))
    const coils = h('div', { class: 'coils', style: { position: 'relative' } })
    if (net.coils.length) {
      net.coils.forEach((c, i) => {
        const cls = net.coils.length === 1 ? 'first last' : i === 0 ? 'first' : i === net.coils.length - 1 ? 'last' : 'mid'
        const lane = h('div', { class: `coilrow lane ${cls}`, style: { position: 'relative', paddingBottom: '8px' } }, h('div', { class: 'lbar l', dataset: { f: 'OUT' } }), wire('OUT', ctx), coilNode(c, i, ni, ctx), wire(`k${i}`, ctx))
        coils.append(lane)
      })
    }
    body2.append(coils, h('div', { class: 'end' }))
    const collapsed = net.collapsed
    const title = h('input', { class: 'ntitle', value: net.title ?? '', placeholder: 'Title…', onInput: (ev) => edit((p) => { p.blocks.find((x) => x.id === blockId).networks[ni].title = ev.target.value }, `nt:${net.id}`), onMousedown: (ev) => ev.stopPropagation() })
    const comment = h('input', { class: 'net-comment', value: net.comment ?? '', placeholder: 'Comment…', onInput: (ev) => edit((p) => { p.blocks.find((x) => x.id === blockId).networks[ni].comment = ev.target.value }, `nc:${net.id}`), onMousedown: (ev) => ev.stopPropagation() })
    const el = h('div', { class: 'net', dataset: { ni } },
      h('div', { class: 'net-head' }, h('span', { class: 'tw', onClick: () => edit((p) => { const n = p.blocks.find((x) => x.id === blockId).networks[ni]; n.collapsed = !n.collapsed }) }, collapsed ? '▶' : '▼'), `Network ${ni + 1}:`, title),
      collapsed ? null : [comment, body2])
    el.addEventListener('mousedown', () => setSel({ network: ni }))
    el.addEventListener('contextmenu', (ev) => { ev.preventDefault(); if (sel()?.network !== ni) setSel({ network: ni }); menu(ev) })
    el.addEventListener('dragover', (ev) => { ev.preventDefault(); body2.classList.add('drop-over') })
    el.addEventListener('dragleave', () => body2.classList.remove('drop-over'))
    el.addEventListener('drop', (ev) => {
      ev.preventDefault(); body2.classList.remove('drop-over')
      try {
        const p = JSON.parse(ev.dataTransfer.getData('text/plain')); if (!p.lad) return
        const t = ev.target.closest?.('[data-path]'); const path = t && !t.classList.contains('branch') && t.dataset.path && !t.dataset.path.startsWith('c') ? t.dataset.path.split('.').map(Number) : null
        dropPayload(p.lad, { network: ni, ...(path ? { path } : {}) })
      } catch { /* not ours */ }
    })
    refs.nets.set(ni, { el, ctx })
    return el
  }

  function menu(ev) {
    const ins = (label, kind, keys) => ({ label, keys, run: () => insert(kind) })
    contextMenu(ev.clientX, ev.clientY, [
      ins('Insert normally open contact', 'NO', 'Shift+F2'), ins('Insert normally closed contact', 'NC', 'Shift+F3'), ins('Insert output coil', 'coil', 'Shift+F7'), ins('Insert open branch', 'branch', 'Shift+F8'), ins('Insert TON timer', 'box:TON'), ins('Insert comparison', 'cmp', 'Shift+F10'),
      '-', { label: 'Insert network', keys: 'Ctrl+R', run: () => insertNetwork(true) }, { label: 'Insert network above', run: () => insertNetwork(false) },
      '-', { label: 'Copy network', keys: 'Ctrl+C', run: copy }, { label: 'Paste network', keys: 'Ctrl+V', run: paste, disabled: state.clipboard?.kind !== 'network' },
      '-', { label: 'Delete', keys: 'Delete', run: remove },
    ])
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
    const live = isOnline() && state.monitor !== false
    for (const [ni, { el, ctx }] of refs.nets) {
      el.classList.toggle('mon', live)
      if (!live) { for (const w of ctx.wires) w.el.classList.remove('t', 'f'); for (const n of ctx.els.values()) { n.classList.remove('t', 'f'); n.querySelector('.val')?.replaceChildren(); n.querySelectorAll('.live.ov').forEach((x) => { x.textContent = '' }) } el.querySelectorAll('.lbar').forEach((x) => x.classList.remove('t')); continue }
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
    const scroll = body.scrollTop
    root.replaceChildren()
    refs.nets.clear()
    b.networks.forEach((n, i) => root.append(network(n, i)))
    root.append(h('div', { class: 'insert-hint' }, 'Right-click a network or press Ctrl+R to insert a network. Drag instructions from the task card, or use Shift+F2 / Shift+F3 / Shift+F7.'))
    root.style.zoom = zoom
    body.scrollTop = scroll
    applySelection()
    paint()
  }
  function applySelection() {
    body.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel'))
    const s = sel(); if (!s) return
    const r = refs.nets.get(s.network); if (!r) return
    r.el.classList.add('sel')
    const el = s.coil !== undefined ? r.ctx.els.get(`c${s.coil}`) : s.path?.length % 2 ? r.ctx.els.get(key(s.path)) : null
    el?.classList.add('sel')
    if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    if (pendingEdit) { pendingEdit = false; setTimeout(edit0, 20) }
  }

  const offs = [
    on('project', (e) => { if (!block()) return; if (e?.reason === 'edit' && document.querySelector('.op-edit')) return; render() }),
    on('selection', () => applySelection()),
    on('tick', () => paint()),
    on('online', () => paint()),
  ]
  editor.api = { drop: (pl) => pl.lad && dropPayload(pl.lad), insert, remove, insertNetwork, copy, paste, cut: () => { copy(); remove() }, edit: edit0, move, zoom: (d) => { zoom = Math.max(0.5, Math.min(2, zoom + d)); root.style.zoom = zoom }, escape: () => { document.querySelector('.op-edit')?.remove(); setSel(null) } }
  host.addEventListener('dragover', (e) => e.preventDefault())
  render()
  if (!sel() && block().networks.length) select({ block: blockId, network: 0 })
  return { dispose() { offs.forEach((f) => f()); if (editor.api && host.contains(root)) editor.api = null }, focus() { render() } }
}
void emit
